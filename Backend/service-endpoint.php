<?php
declare(strict_types=1);
require_once __DIR__ . '/service-request.php';

function runServiceEndpoint(string $action): void
{
    ini_set('display_errors', '0');
    [$status, $body] = handleServiceRequest($action, $_SERVER['REQUEST_METHOD'] ?? '',
        $_SERVER['CONTENT_TYPE'] ?? '', file_get_contents('php://input'),
        static function () {
            if (session_status() !== PHP_SESSION_ACTIVE && !session_start(['read_and_close' => true])) {
                throw new RuntimeException('Could not read the session.');
            }
            return $_SESSION['user_id'] ?? null;
        },
        static function (): PDO { return require __DIR__ . '/db.php'; }
    );
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if ($status === 405) { header('Allow: ' . (in_array($action, ['list', 'queue'], true) ? 'GET' : 'POST')); }
    echo json_encode($body, JSON_INVALID_UTF8_SUBSTITUTE);
}
