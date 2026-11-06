<?php
declare(strict_types=1);

// Join, Leave and current queue over HTTP. Run: php tests/queue/join-http-smoke.php
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/QueueDb.php';

function checkThat(bool $ok, string $message): void {
    if (!$ok) {
        throw new RuntimeException($message);
    }
}

function postQueue(string $url, ?string $sessionId, string $json): array {
    return requestQueue('POST', $url, $sessionId, $json);
}

function requestQueue(string $method, string $url, ?string $sessionId, string $json = ''): array {
    $headers = ['Content-Type: application/json', 'Connection: close'];
    if ($sessionId !== null) {
        $headers[] = 'Cookie: PHPSESSID=' . $sessionId;
    }
    $context = stream_context_create(['http' => [
        'method' => $method, 'header' => implode("\r\n", $headers),
        'content' => $json, 'ignore_errors' => true,
        'follow_location' => 0, 'timeout' => 4
    ]]);
    $stream = fopen($url, 'rb', false, $context);
    checkThat($stream !== false, 'The PHP server did not respond.');
    try {
        $headers = stream_get_meta_data($stream)['wrapper_data'];
        $body = stream_get_contents($stream);
        checkThat((bool) preg_match('/^HTTP\/\S+\s+(\d{3})\b/', $headers[0], $match),
            'The response did not have an HTTP status.');
        return [(int) $match[1], json_decode($body, true, 32, JSON_THROW_ON_ERROR), $headers];
    } finally {
        fclose($stream);
    }
}

function runQueueSmoke(): void {
    $temp = sys_get_temp_dir() . '/queuesmart-join-' . bin2hex(random_bytes(12));
    checkThat(mkdir($temp, 0700), 'Could not create a private temporary folder.');
    $fixture = null;
    $process = null;
    try {
        $fixture = QueueDb::create();
        $dbName = $fixture->db->query('SELECT DATABASE()')->fetchColumn();
        checkThat((bool) preg_match('/\Aqueuesmart_phpunit_[0-9a-f]{16}\z/', $dbName),
            'Expected a temporary QueueDb database.');

        // Stage the unmodified application code with a test-only PDO adapter.
        $backend = "$temp/www/Backend";
        checkThat(mkdir($backend, 0700, true) && mkdir("$temp/sessions", 0700),
            'Could not prepare the test folders.');
        foreach (['queue-actions.php', 'join-queue-request.php', 'join-queue.php',
                  'leave-queue-request.php', 'leave-queue.php',
                  'current-queue-request.php', 'current-queue.php'] as $name) {
            checkThat(copy(dirname(__DIR__, 2) . "/Backend/$name", "$backend/$name"),
                "Missing required file: Backend/$name");
        }
        $adapter = <<<'PHP'
<?php
return new PDO(getenv('QUEUESMART_HTTP_TEST_DSN'),
    getenv('QUEUESMART_DB_USER') ?: 'root', (string) getenv('QUEUESMART_DB_PASSWORD'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]);
PHP;
        checkThat(file_put_contents("$backend/db.php", $adapter) !== false,
            'Could not prepare the test adapter.');
        $env = getenv();
        $env['QUEUESMART_HTTP_TEST_DSN'] = "mysql:host=127.0.0.1;port=3306;dbname=$dbName;charset=utf8mb4";
        unset($env['PHP_CLI_SERVER_WORKERS']); // This check owns a single local process.

        // A server-side session for the fixture user; no login-bypass route is exposed.
        $sid = bin2hex(random_bytes(24));
        checkThat(file_put_contents("$temp/sessions/sess_$sid", serialize(['user_id' => 1])) !== false,
            'Could not create the private test session.');
        $otherSid = bin2hex(random_bytes(24));
        checkThat(file_put_contents("$temp/sessions/sess_$otherSid", serialize(['user_id' => 2])) !== false,
            'Could not create the second private test session.');

        $socket = stream_socket_server('tcp://127.0.0.1:0');
        checkThat($socket !== false, 'Could not reserve a local TCP port.');
        $address = stream_socket_get_name($socket, false);
        fclose($socket);
        checkThat($address !== false, 'Could not read the local port.');
        $command = [PHP_BINARY, '-d', 'session.save_handler=files',
            '-d', 'session.serialize_handler=php_serialize', '-d', "session.save_path=$temp/sessions",
            '-d', 'session.name=PHPSESSID', '-d', 'session.use_cookies=1',
            '-d', 'session.use_strict_mode=1', '-S', $address, '-t', "$temp/www"];
        $process = proc_open($command, [
            0 => ['file', '/dev/null', 'r'], 1 => ['file', "$temp/server.log", 'a'],
            2 => ['file', "$temp/server.log", 'a']
        ], $pipes, null, $env);
        checkThat(is_resource($process), 'Could not start the PHP development server.');

        $ready = false;
        $deadline = microtime(true) + 5;
        do {
            checkThat(proc_get_status($process)['running'], 'The local test server stopped early.');
            $probe = @stream_socket_client("tcp://$address", $errNo, $errText, 0.1);
            if ($probe !== false) {
                fclose($probe);
                $ready = true;
                break;
            }
            usleep(40000);
        } while (microtime(true) < $deadline);
        checkThat($ready, 'The local test server did not start in time.');

        $joinUrl = "http://$address/Backend/join-queue.php";
        $leaveUrl = "http://$address/Backend/leave-queue.php";
        $currentUrl = "http://$address/Backend/current-queue.php";
        checkThat(requestQueue('GET', $currentUrl, null)[0] === 401,
            'Anonymous current queue must return 401.');
        [$status, $body, $headers] = requestQueue('GET', $currentUrl, $sid);
        checkThat($status === 200 && $body === ['currentQueue' => null],
            'A signed-in user without a waiting visit must get currentQueue=null.');
        $headerText = strtolower(implode("\n", $headers));
        checkThat(str_contains($headerText, 'content-type: application/json') &&
            str_contains($headerText, 'cache-control: no-store'),
            'Current queue must return non-cached JSON.');
        [$status, $body, $headers] = postQueue($currentUrl, $sid, '{}');
        checkThat($status === 405 && in_array('allow: get', array_map('strtolower', $headers), true),
            'POST current queue must return 405 with Allow: GET.');
        $selection = '{"serviceId":1}';
        checkThat(postQueue($joinUrl, null, $selection)[0] === 401, 'Anonymous Join must return 401.');
        [$status, $body] = postQueue($joinUrl, $sid, $selection);
        $q = $body['currentQueue'] ?? [];
        checkThat($status === 201 && ($q['userId'] ?? null) === 1 && ($q['serviceId'] ?? null) === 1 &&
            ($q['position'] ?? null) === 1 && ($q['waitMinutes'] ?? null) === 0,
            "Expected 201 and the first place in line; got HTTP $status.");
        checkThat(postQueue($joinUrl, $sid, $selection)[0] === 409, 'A duplicate join must return 409.');
        [$status, $current] = requestQueue('GET', $currentUrl, $sid);
        checkThat($status === 200 && $current === ['currentQueue' => $q],
            'Current queue must restore the committed joined visit.');
        [$status, $other] = requestQueue('GET', $currentUrl . '?userId=1', $otherSid);
        checkThat($status === 200 && $other === ['currentQueue' => null],
            'A query parameter must not let user 2 read user 1\'s visit.');
        $rows = $fixture->observer()->query(
            "SELECT entry_id, user_id, queue_id FROM QueueEntry WHERE status = 'waiting'"
        )->fetchAll();
        checkThat(count($rows) === 1 && (int) $rows[0]['user_id'] === 1 &&
            (int) $rows[0]['queue_id'] === 11 && (int) $rows[0]['entry_id'] === $q['entryId'],
            'Expected one matching, committed waiting visit in MySQL.');

        // A client cannot cancel user 1's visit without a session or target another user.
        checkThat(postQueue($leaveUrl, null, '{}')[0] === 401, 'Anonymous Leave must return 401.');
        checkThat(postQueue($leaveUrl, $sid, '{"userId":2}')[0] === 400, 'Leave must reject client userId.');
        [$status, $left] = postQueue($leaveUrl, $sid, '{}');
        checkThat($status === 200 && ($left['left'] ?? null) === true &&
            ($left['entryId'] ?? null) === $q['entryId'] && ($left['status'] ?? null) === 'left' &&
            array_key_exists('currentQueue', $left) && $left['currentQueue'] === null,
            "Expected the signed-in leave to cancel the joined entry; got HTTP $status.");

        $observer = $fixture->observer();
        $historySql = 'SELECT entry_id, user_id, status, completed_at FROM QueueEntry ORDER BY entry_id';
        $history = $observer->query($historySql)->fetchAll();
        checkThat(count($history) === 1 && (int) $history[0]['entry_id'] === $q['entryId'] &&
            (int) $history[0]['user_id'] === 1 && $history[0]['status'] === 'left' &&
            $history[0]['completed_at'] !== null,
            'MySQL must keep the cancelled visit and its completion time.');
        checkThat((int) $observer->query('SELECT COUNT(*) FROM combined_waiting_line')->fetchColumn() === 0,
            'A cancelled visit must no longer appear in the waiting line.');

        [$status, $again] = postQueue($leaveUrl, $sid, '{}');
        checkThat($status === 200 && ($again['left'] ?? null) === false &&
            array_key_exists('currentQueue', $again) && $again['currentQueue'] === null,
            'Repeating Leave must return 200 with left=false.');
        checkThat($observer->query($historySql)->fetchAll() === $history, 'Repeat Leave changed history.');
        [$status, $current] = requestQueue('GET', $currentUrl, $sid);
        checkThat($status === 200 && $current === ['currentQueue' => null],
            'Current queue must return null after leaving.');
    } finally {
        if (is_resource($process)) {
            proc_terminate($process);
            proc_close($process);
        }
        try {
            $fixture?->drop();
        } finally {
            $files = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($temp, FilesystemIterator::SKIP_DOTS),
                RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($files as $file) {
                $file->isDir() && !$file->isLink() ? rmdir($file->getPathname()) : unlink($file->getPathname());
            }
            rmdir($temp);
        }
    }
}

try {
    runQueueSmoke();
    echo "PASS: Join, Leave and current queue; session isolation; cancelled visit preserved.\n";
} catch (Throwable $e) {
    fwrite(STDERR, "FAIL: " . $e->getMessage() . "\n");
    exit(1);
}