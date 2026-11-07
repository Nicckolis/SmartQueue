<?php
declare(strict_types=1);
require_once __DIR__ . '/admin-auth.php';
require_once __DIR__ . '/admin-queue-actions.php';

// Return an HTTP status and JSON data
function handleServiceRequest(string $action, string $method, string $contentType,
    string|false $rawBody, callable $readUserId, callable $openDb): array
{
    $methods = ['list' => 'GET', 'create' => 'POST', 'update' => 'POST',
        'queue' => 'GET', 'set-open' => 'POST', 'serve-next' => 'POST'];
    if (!isset($methods[$action])) { return [404, ['error' => 'Unknown operation.']]; }
    if ($method !== $methods[$action]) { return [405, ['error' => 'Use ' . $methods[$action] . ' for this operation.']]; }
    try {
        $id = $readUserId();
        $userId = (is_int($id) || is_string($id))
            ? filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) : false;
        if ($userId === false) { throw new ServiceActionException('Please log in first.', 401); }
        $data = [];
        if ($method === 'POST') {
            if (strtolower(trim(explode(';', $contentType, 2)[0])) !== 'application/json') {
                return [415, ['error' => 'Use Content-Type: application/json.']];
            }
            if ($rawBody === false) { throw new RuntimeException('Could not read the request.'); }
            try { $body = json_decode($rawBody, false, 32, JSON_THROW_ON_ERROR); }
            catch (JsonException) { return [400, ['error' => 'Send valid JSON.']]; }
            if (!$body instanceof stdClass) { return [400, ['error' => 'Send a JSON object.']]; }
            $data = get_object_vars($body);
            $allowed = match ($action) {
                'create' => ['name', 'description', 'expectedDuration', 'priority'],
                'update' => ['serviceId', 'name', 'description', 'expectedDuration', 'priority'],
                'set-open' => ['serviceId', 'isOpen'], default => []
            };
            if (array_diff(array_keys($data), $allowed) || array_diff($allowed, array_keys($data))) {
                return [400, ['error' => 'Send only the required fields for this operation.']];
            }
            if (in_array($action, ['update', 'set-open'], true) && (!is_int($data['serviceId']) || $data['serviceId'] < 1)) {
                return [400, ['error' => 'serviceId must be a positive JSON integer.']];
            }
            if ($action === 'set-open' && !is_bool($data['isOpen'])) { return [400, ['error' => 'isOpen must be true or false.']]; }
            if (in_array($action, ['create', 'update'], true)) { validateServiceInput($data); }
        }
        $db = $openDb();
        $admin = static fn(): bool => requireDatabaseAdmin($db, $userId);
        return match ($action) {
            'create' => [201, ['service' => createService($db, $admin, $data)]],
            'update' => [200, ['service' => updateService($db, $admin, $data['serviceId'], $data)]],
            'set-open' => [200, ['service' => setServiceOpen($db, $admin, $data['serviceId'], $data['isOpen'])]],
            'serve-next' => [200, ['served' => serveNextUser($db, $admin)]],
            'queue' => [200, ['queue' => listAdminQueue($db, $admin)]],
            'list' => [200, ['services' => listServices($db, $admin)]]
        };
    } catch (Throwable $error) {
        if ($error instanceof ServiceActionException && in_array($error->getCode(), [400, 401, 403, 404, 409], true)) {
            return [$error->getCode(), ['error' => $error->getMessage()]];
        }
        error_log('QueueSmart service/admin: ' . $error->getMessage());
        return [500, ['error' => 'The operation could not be completed. Please try again.']];
    }
}
