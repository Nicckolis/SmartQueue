<?php
declare(strict_types=1);

ini_set('display_errors', '0');

require_once __DIR__ . '/quieter-time-request.php';

[$status, $body] = handleQuieterTimeRequest(
    $_SERVER['REQUEST_METHOD'] ?? '',
    $_GET['serviceId'] ?? null,

    // Read the signed-in user the same way as current-queue.php.
    static function () {
        if (session_status() !== PHP_SESSION_ACTIVE &&
            !session_start(['read_and_close' => true])) {
            throw new RuntimeException('Could not read the PHP session.');
        }

        return $_SESSION['user_id'] ?? null;
    },

    // The handler opens MySQL only after validating the request.
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
    header('Allow: GET');
}

echo json_encode($body, JSON_INVALID_UTF8_SUBSTITUTE);