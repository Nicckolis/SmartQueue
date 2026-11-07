<?php
declare(strict_types=1);

// Application error codes and future endpoints translate them
class ServiceActionException extends RuntimeException {}

// $requireAdmin is a trusted SERVER callback
// must return true only for an authenticated administrator or throw (401/403)
function requireServiceAdmin(callable $requireAdmin): void
{
    if ($requireAdmin() !== true) {
        throw new ServiceActionException('Only administrators can manage services.', 403);
    }
}

function validateServiceInput(mixed $input): array
{
    if (!is_array($input)) {
        throw new ServiceActionException('Service details must be an object.', 400);
    }
    $details = [];
    foreach (['name' => 100, 'description' => 1000] as $field => $limit) {
        if (!isset($input[$field]) || !is_string($input[$field])) {
            throw new ServiceActionException("$field must be text.", 400);
        }
        $value = trim($input[$field]);
        // Count Unicode characters without requiring the mbstring extension
        $length = preg_match_all('/./us', $value);
        if ($length === false || $length < 1 || $length > $limit) {
            throw new ServiceActionException("$field must contain 1–$limit valid characters.", 400);
        }
        $details[$field] = $value;
    }
    $duration = $input['expectedDuration'] ?? null;
    // Matches the signed MySQL INT
    if (!is_int($duration) || $duration < 1 || $duration > 2147483647) {
        throw new ServiceActionException('Expected duration must be a positive whole number within the database INT range.', 400);
    }
    if (!in_array($input['priority'] ?? null, ['low', 'medium', 'high'], true)) {
        throw new ServiceActionException('Priority must be low, medium, or high.', 400);
    }
    $details['expectedDuration'] = $duration;
    $details['priority'] = $input['priority'];
    return $details;
}

// Keep browser facing field names and IDs come from MySQL
function serviceResult(array $row): array
{
    if (!in_array($row['status'] ?? null, ['open', 'closed'], true)) {
        throw new RuntimeException('The service must have an open or closed queue.');
    }
    return [
        'id' => (int) $row['service_id'],
        'name' => $row['name'],
        'description' => $row['description'],
        'expectedDuration' => (int) $row['expected_duration_minutes'],
        'priority' => $row['priority'],
        'queueId' => (int) $row['queue_id'],
        'isOpen' => $row['status'] === 'open'
    ];
}

function readService(PDO $db, int $serviceId): array
{
    $statement = $db->prepare(
        'SELECT s.service_id, s.name, s.description, s.expected_duration_minutes,
                s.priority, q.queue_id, q.status
         FROM Service AS s LEFT JOIN `Queue` AS q ON q.service_id = s.service_id
         WHERE s.service_id = ?'
    );
    $statement->execute([$serviceId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if ($row === false) {
        throw new ServiceActionException('Service not found.', 404);
    }
    return serviceResult($row);
}

// Requires PDO::ERRMODE_EXCEPTION and InnoDB tables
// each write owns its transaction and refuses to commit a callers transaction
function createService(PDO $db, callable $requireAdmin, mixed $input): array
{
    requireServiceAdmin($requireAdmin);
    $details = validateServiceInput($input);
    if ($db->inTransaction()) {
        throw new LogicException('createService must start its own transaction.');
    }
    $db->beginTransaction();
    try {
        $statement = $db->prepare(
            'INSERT INTO Service (name, description, expected_duration_minutes, priority)
             VALUES (?, ?, ?, ?)'
        );
        $statement->execute([$details['name'], $details['description'],
            $details['expectedDuration'], $details['priority']]);
        $id = (int) $db->lastInsertId();
        $queue = $db->prepare("INSERT INTO `Queue` (service_id, status) VALUES (?, 'open')");
        $queue->execute([$id]);
        $result = readService($db, $id);
        $db->commit();
        return $result;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function updateService(PDO $db, callable $requireAdmin, int $serviceId, mixed $input): array
{
    requireServiceAdmin($requireAdmin);
    if ($serviceId < 1) {
        throw new ServiceActionException('A positive service ID is required.', 400);
    }
    $details = validateServiceInput($input);
    if ($db->inTransaction()) {
        throw new LogicException('updateService must start its own transaction.');
    }
    $db->beginTransaction();
    try {
        $lock = $db->prepare('SELECT service_id FROM Service WHERE service_id = ? FOR UPDATE');
        $lock->execute([$serviceId]);
        if ($lock->fetchColumn() === false) {
            throw new ServiceActionException('Service not found.', 404);
        }
        $statement = $db->prepare(
            'UPDATE Service SET name = ?, description = ?, expected_duration_minutes = ?,
             priority = ? WHERE service_id = ?'
        );
        $statement->execute([$details['name'], $details['description'],
            $details['expectedDuration'], $details['priority'], $serviceId]);
        // Preserve the queue identity and open/closed status
        $result = readService($db, $serviceId);
        $db->commit();
        return $result;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

// Management list including closed queues
function listServices(PDO $db, callable $requireAdmin): array
{
    requireServiceAdmin($requireAdmin);
    $statement = $db->query(
        'SELECT s.service_id, s.name, s.description, s.expected_duration_minutes,
                s.priority, q.queue_id, q.status
         FROM Service AS s LEFT JOIN `Queue` AS q ON q.service_id = s.service_id
         ORDER BY s.service_id'
    );
    return array_map('serviceResult', $statement->fetchAll(PDO::FETCH_ASSOC));
}
