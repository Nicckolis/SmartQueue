<?php
declare(strict_types=1);

ini_set('display_errors', '0');
require_once __DIR__ . '/available-services-request.php';

[$status, $body] = handleAvailableServicesRequest(
    $_SERVER['REQUEST_METHOD'] ?? '',
    static function () {
        if (session_status() !== PHP_SESSION_ACTIVE &&
            !session_start(['read_and_close' => true])) {
            throw new RuntimeException('Could not read the PHP session.');
        }
        return $_SESSION['user_id'] ?? null;
    },
    static function (): PDO {
        return require __DIR__ . '/db.php';
    }
);

http_response_code($status);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
if ($status === 405) {
    header('Allow: GET');
}
echo json_encode($body, JSON_INVALID_UTF8_SUBSTITUTE);
