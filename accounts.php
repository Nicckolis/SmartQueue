<?php
declare(strict_types=1);
 
/**
 * accounts.php - server-side replacement for the localStorage AccountManager.
 * Requires PHP 8.0+ with PDO MySQL (bundled). No other dependencies.
 *
 * Every request: accounts.php?action=<name>
 *   GET  : currentUser, isCurrentUserAdmin
 *   POST : (JSON body, Content-Type: application/json) everything else
 *
 * JS method          -> action             notes
 * -----------------------------------------------------------------------------
 * setAccount         -> register           username, password, [email, first_name, last_name, phone]
 * checkAccount +
 *   setCurrentUser   -> login              username, password (starts the session)
 * removeCurrentUser +
 *   logout           -> logout             ends the session, returns redirect URL
 * getCurrentUser     -> currentUser
 * isCurrentUserAdmin -> isCurrentUserAdmin
 * addAdmin           -> addAdmin           admin only; username
 * removeAdmin        -> removeAdmin        admin only; username
 * removeAccount      -> removeAccount      admin, or the account owner; username
 * getUserList        -> getUserList        admin only
 * hasAccount         -> hasAccount         admin only; username
 * isAdmin            -> isAdmin            admin, or the account owner; username
 */
 
// ---------- Configuration (override with environment variables) ----------
const LOGIN_PAGE = 'LogIn/queue-login.html';
 
function env(string $key, string $default): string
{
    $v = getenv($key);
    return ($v === false || $v === '') ? $default : $v;
}
 
// ---------- Helpers ----------
function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
 
function fail(string $message, int $status = 400): never
{
    respond(['ok' => false, 'error' => $message], $status);
}
 
function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        // Reuse the project's existing connection (reads the QUEUESMART_DB_* environment variables).
        $pdo = require __DIR__ . '/Backend/db.php';
        if (!$pdo instanceof PDO) {
            throw new RuntimeException('Backend/db.php must return a PDO instance.');
        }
        // Make sure this file's assumptions hold even if db.php configures things differently.
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    }
    return $pdo;
}
 
/** Character count (UTF-8 aware) without requiring the mbstring extension. */
function charLen(string $s): int
{
    $n = preg_match_all('/./us', $s);
    return $n === false ? strlen($s) : $n;
}
 
function str(array $in, string $key): string
{
    $v = $in[$key] ?? '';
    return is_string($v) ? trim($v) : '';
}
 
/** Returns the credentials row for a username (or null). */
function findUser(string $username, bool $lock = false): ?array
{
    $sql = 'SELECT user_id, username, password_hash, `role` FROM UserCredentials WHERE username = ?'
         . ($lock ? ' FOR UPDATE' : '');
    $st = db()->prepare($sql);
    $st->execute([$username]);
    $row = $st->fetch();
    return $row ?: null;
}
 
/** Creates credentials + profile in one transaction. Returns user_id, or null if the username/email exists. */
function createAccount(string $username, string $password, string $email, string $first, string $last,
                       ?string $phone, string $role = 'user'): ?int
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('INSERT INTO UserCredentials (username, password_hash, `role`) VALUES (?, ?, ?)');
        $st->execute([$username, password_hash($password, PASSWORD_DEFAULT), $role]);
        $id = (int) $pdo->lastInsertId();
 
        $st = $pdo->prepare('INSERT INTO UserProfile (user_id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)');
        $st->execute([$id, $first, $last, $email, $phone]);
 
        $pdo->commit();
        return $id;
    } catch (PDOException $e) {
        $pdo->rollBack();
        if ($e->getCode() === '23000') { // duplicate username or email
            return null;
        }
        throw $e;
    }
}
 
/** Mirrors the JS constructor: a default admin exists if the system has no accounts yet. */
function ensureDefaultAdmin(): void
{
    $any = db()->query('SELECT 1 FROM UserCredentials LIMIT 1')->fetchColumn();
    if ($any !== false) {
        return;
    }
    // CHANGE THIS PASSWORD (or set ADMIN_DEFAULT_PASSWORD) before going live.
    createAccount(
        'adminDefault@gmail.com',
        env('ADMIN_DEFAULT_PASSWORD', '12345'),
        'adminDefault@gmail.com',
        'Default',
        'Admin',
        null,
        'admin'
    );
}
 
function startSession(): void
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    // Use PHP's default session name (PHPSESSID) so the service and queue endpoints
    // share this login session. Do not call session_name() here or anywhere else.
    session_start();
}
 
/** Current user from the session, re-validated against the DB so deleted/demoted users lose access at once. */
function currentUser(): ?array
{
    $id = $_SESSION['user_id'] ?? null;
    if (!is_int($id)) {
        return null;
    }
    $st = db()->prepare('SELECT user_id, username, `role` FROM UserCredentials WHERE user_id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        unset($_SESSION['user_id']); // handle deleted accounts
        return null;
    }
    return $row;
}
 
function requireAdmin(): array
{
    $me = currentUser();
    if ($me === null) {
        fail('Not logged in.', 401);
    }
    if ($me['role'] !== 'admin') {
        fail('Admin access required.', 403);
    }
    return $me;
}
 
function countAdminsLocked(): int
{
    // Locks admin rows so two concurrent requests cannot remove the last two admins.
    $st = db()->query("SELECT user_id FROM UserCredentials WHERE `role` = 'admin' FOR UPDATE");
    return count($st->fetchAll());
}
 
// ---------- Request handling ----------
try {
    startSession();
    ensureDefaultAdmin();
 
    $action = $_GET['action'] ?? '';
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $readOnly = ['currentUser', 'isCurrentUserAdmin'];
 
    $in = [];
    if (!in_array($action, $readOnly, true)) {
        if ($method !== 'POST') {
            fail('POST required.', 405);
        }
        // Requiring JSON forces a CORS preflight for cross-site callers (basic CSRF defense).
        if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
            fail('Content-Type must be application/json.', 415);
        }
        $in = json_decode(file_get_contents('php://input') ?: '', true);
        if (!is_array($in)) {
            fail('Invalid JSON body.');
        }
    }
 
    switch ($action) {
 
        case 'register': { // setAccount
            $username = str($in, 'username');
            $password = is_string($in['password'] ?? null) ? $in['password'] : '';
            $email    = str($in, 'email') ?: $username;
            $first    = str($in, 'first_name') ?: 'User';
            $last     = str($in, 'last_name') ?: 'User';
            $phone    = str($in, 'phone') ?: null;
 
            if ($username === '' || charLen($username) > 100) fail('Username must be 1-100 characters.');
            if (strlen($password) < 8) fail('Password must be at least 8 characters.');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) fail('A valid email is required.');
            if (charLen($first) > 100 || charLen($last) > 100) fail('Name is too long.');
            if ($phone !== null && charLen($phone) > 30) fail('Phone is too long.');
 
            $id = createAccount($username, $password, $email, $first, $last, $phone);
            if ($id === null) fail('That username or email is already registered.', 409);
            respond(['ok' => true]);
        }
 
        case 'login': { // checkAccount + setCurrentUser
            $username = str($in, 'username');
            $password = is_string($in['password'] ?? null) ? $in['password'] : '';
            $user = findUser($username);
 
            // Verify against a dummy hash when the user is unknown, to keep timing similar.
            $hash = $user['password_hash'] ?? '$2y$10$usesomesillystringforeNOTAREALHASHabcdefghijklmnopqrstu';
            $valid = password_verify($password, $hash) && $user !== null;
            if (!$valid) fail('Invalid username or password.', 401);
 
            if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
                db()->prepare('UPDATE UserCredentials SET password_hash = ? WHERE user_id = ?')
                    ->execute([password_hash($password, PASSWORD_DEFAULT), $user['user_id']]);
            }
            session_regenerate_id(true);
            $_SESSION['user_id'] = (int) $user['user_id'];
            respond(['ok' => true, 'username' => $user['username'], 'isAdmin' => $user['role'] === 'admin']);
        }
 
        case 'logout': { // removeCurrentUser + logout
            $_SESSION = [];
            if (ini_get('session.use_cookies')) {
                $p = session_get_cookie_params();
                setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'],
                    'secure' => $p['secure'], 'httponly' => true, 'samesite' => 'Lax']);
            }
            session_destroy();
            respond(['ok' => true, 'redirect' => LOGIN_PAGE]);
        }
 
        case 'currentUser': { // getCurrentUser
            $me = currentUser();
            respond(['ok' => true, 'username' => $me['username'] ?? null]);
        }
 
        case 'isCurrentUserAdmin': {
            $me = currentUser();
            respond(['ok' => true, 'isAdmin' => $me !== null && $me['role'] === 'admin']);
        }
 
        case 'addAdmin': {
            requireAdmin();
            $pdo = db();
            $pdo->beginTransaction();
            $user = findUser(str($in, 'username'), true);
            $done = $user !== null && $user['role'] !== 'admin';
            if ($done) {
                $pdo->prepare("UPDATE UserCredentials SET `role` = 'admin' WHERE user_id = ?")->execute([$user['user_id']]);
            }
            $pdo->commit();
            respond(['ok' => true, 'result' => $done]);
        }
 
        case 'removeAdmin': {
            requireAdmin();
            $pdo = db();
            $pdo->beginTransaction();
            $admins = countAdminsLocked();
            $user = findUser(str($in, 'username'), true);
            $done = $user !== null && $user['role'] === 'admin' && $admins > 1;
            if ($done) {
                $pdo->prepare("UPDATE UserCredentials SET `role` = 'user' WHERE user_id = ?")->execute([$user['user_id']]);
            }
            $pdo->commit();
            respond(['ok' => true, 'result' => $done]);
        }
 
        case 'removeAccount': {
            $me = currentUser();
            if ($me === null) fail('Not logged in.', 401);
            $target = str($in, 'username');
            if ($me['role'] !== 'admin' && strcasecmp($me['username'], $target) !== 0) {
                fail('Admin access required.', 403);
            }
 
            $pdo = db();
            $pdo->beginTransaction();
            try {
                $admins = countAdminsLocked();
                $user = findUser($target, true);
                if ($user === null) {
                    $pdo->rollBack();
                    respond(['ok' => true, 'result' => false]);
                }
                if ($user['role'] === 'admin' && $admins <= 1) { // never remove the last admin
                    $pdo->rollBack();
                    respond(['ok' => true, 'result' => false, 'error' => 'Cannot remove the last admin.']);
                }
                $pdo->prepare('DELETE FROM UserProfile WHERE user_id = ?')->execute([$user['user_id']]);
                $pdo->prepare('DELETE FROM UserCredentials WHERE user_id = ?')->execute([$user['user_id']]);
                $pdo->commit();
            } catch (PDOException $e) {
                $pdo->rollBack();
                if ($e->getCode() === '23000') { // QueueEntry rows still reference this user
                    respond(['ok' => true, 'result' => false,
                             'error' => 'Account has queue history and cannot be deleted.']);
                }
                throw $e;
            }
            if ((int) $user['user_id'] === (int) $me['user_id']) {
                $_SESSION = [];
                session_destroy();
            }
            respond(['ok' => true, 'result' => true]);
        }
 
        case 'getUserList': {
            requireAdmin();
            $rows = db()->query('SELECT username, `role` FROM UserCredentials ORDER BY username')->fetchAll();
            respond(['ok' => true, 'users' => array_column($rows, 'username'), 'details' => $rows]);
        }
 
        case 'hasAccount': {
            requireAdmin();
            respond(['ok' => true, 'result' => findUser(str($in, 'username')) !== null]);
        }
 
        case 'isAdmin': {
            $me = currentUser();
            if ($me === null) fail('Not logged in.', 401);
            $target = str($in, 'username');
            if ($me['role'] !== 'admin' && strcasecmp($me['username'], $target) !== 0) {
                fail('Admin access required.', 403);
            }
            $user = findUser($target);
            respond(['ok' => true, 'result' => $user !== null && $user['role'] === 'admin']);
        }
 
        default:
            fail('Unknown action.', 404);
    }
} catch (Throwable $e) {
    error_log($e->getMessage());
    fail('Server error.', 500);
}
