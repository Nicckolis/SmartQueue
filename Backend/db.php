<?php
declare(strict_types=1);
// Returns a PDO connection to the MySQL database using QUEUESMART_DB_* environment variables.
// Usage from another PHP file in Backend/: $db = require __DIR__ . '/db.php';

$dbHost = getenv('QUEUESMART_DB_HOST') ?: '127.0.0.1';
$dbPort = getenv('QUEUESMART_DB_PORT') ?: '3306';

$dbName = (string) getenv('QUEUESMART_DB_NAME');
$dbUser = (string) getenv('QUEUESMART_DB_USER');
$dbPassword = (string) getenv('QUEUESMART_DB_PASSWORD');

if (trim($dbName) === '' || trim($dbUser) === '') {
    throw new RuntimeException(
        'Set QUEUESMART_DB_NAME and QUEUESMART_DB_USER before starting PHP.'
    );
}

$dsn = "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4";

return new PDO($dsn, $dbUser, $dbPassword, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
]);