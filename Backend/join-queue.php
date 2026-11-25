<?php
declare(strict_types=1);

ini_set('display_errors', '0');
require_once __DIR__ . '/join-queue-request.php';

[$status, $body] = handleJoinQueueRequest(
    $_SERVER['REQUEST_METHOD'] ?? '',
    $_SERVER['CONTENT_TYPE'] ?? '',
    file_get_contents('php://input'),

    // Read the identity saved by the login.
    static function () {
        if (session_status() !== PHP_SESSION_ACTIVE &&
            !session_start(['read_and_close' => true])) {
            throw new RuntimeException('Could not read the PHP session.');
        }

        return $_SESSION['user_id'] ?? null;
    },

    // Open the database only after the request passes validation.
    static function (): PDO {
        $file = __DIR__ . '/db.php';
        if (!is_readable($file)) {
            throw new RuntimeException('Backend/db.php is not available.');
        }

        return require $file;
    }
);

http_response_code($status);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($status === 405) {
    header('Allow: POST');
}

echo json_encode($body, JSON_INVALID_UTF8_SUBSTITUTE);