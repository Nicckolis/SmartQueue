<?php
declare(strict_types=1);

// A missing account returns null. An existing account with no open queues gets [].
function readOpenServicesWithWait(PDO $db, int $userId): ?array
{
    // The backlog includes people still waiting for services now closed to arrivals.
    // An arrival goes behind everyone of equal or higher priority across all services.
    $sql = <<<'SQL'
WITH backlog AS (
    SELECT
        COALESCE(SUM(CASE WHEN priority = 'high' THEN expected_duration_minutes ELSE 0 END), 0) AS high_wait,
        COALESCE(SUM(CASE WHEN priority IN ('high', 'medium') THEN expected_duration_minutes ELSE 0 END), 0) AS medium_wait,
        COALESCE(SUM(expected_duration_minutes), 0) AS low_wait
    FROM combined_waiting_line
),
open_catalog AS (
    SELECT s.service_id, s.name,
           CASE s.priority WHEN 'high' THEN b.high_wait
                           WHEN 'medium' THEN b.medium_wait
                           ELSE b.low_wait END AS estimated_wait_minutes
    FROM Service AS s
    JOIN `Queue` AS q ON q.service_id = s.service_id
    CROSS JOIN backlog AS b
    WHERE q.status = 'open'
)
SELECT c.service_id, c.name, c.estimated_wait_minutes
FROM UserCredentials AS u
LEFT JOIN open_catalog AS c ON 1 = 1
WHERE u.user_id = ?
ORDER BY c.service_id
SQL;

    $query = $db->prepare($sql);
    $query->execute([$userId]);
    $rows = $query->fetchAll(PDO::FETCH_ASSOC);
    if ($rows === []) {
        return null; // The session's account no longer exists.
    }
    if ($rows[0]['service_id'] === null) {
        return []; // LEFT JOIN found the account but no open service.
    }
    return array_map(static fn(array $row): array => [
        'id' => (int) $row['service_id'],
        'name' => $row['name'],
        'estimatedWaitMinutes' => (int) $row['estimated_wait_minutes'],
    ], $rows);
}

function handleAvailableServicesRequest(string $method, callable $readUserId, callable $openDb): array
{
    if ($method !== 'GET') {
        return [405, ['error' => 'Use GET to list available services.']];
    }
    try {
        $raw = $readUserId();
        $userId = (is_int($raw) || is_string($raw))
            ? filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])
            : false;
        if ($userId === false) {
            return [401, ['error' => 'Please log in first.']];
        }
        $services = readOpenServicesWithWait($openDb(), $userId);
        if ($services === null) {
            return [401, ['error' => 'Please log in first.']];
        }
        return [200, ['services' => $services]];
    } catch (Throwable $error) {
        error_log('QueueSmart available services: ' . $error->getMessage());
        return [500, ['error' => 'Could not load available services right now.']];
    }
}
