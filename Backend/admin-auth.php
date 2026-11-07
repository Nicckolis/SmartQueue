<?php
declare(strict_types=1);
require_once __DIR__ . '/service-actions.php';

// Check the session users role in MySQL
function requireDatabaseAdmin(PDO $db, int $userId): bool
{
    $statement = $db->prepare('SELECT role FROM UserCredentials WHERE user_id = ?');
    $statement->execute([$userId]);
    $role = $statement->fetchColumn();
    if ($role === false) { throw new ServiceActionException('Please log in first.', 401); }
    if ($role !== 'admin') { throw new ServiceActionException('Administrator access is required.', 403); }
    return true;
}
