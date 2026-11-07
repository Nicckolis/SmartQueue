<?php
declare(strict_types=1);

require_once __DIR__ . '/queue-action-exception.php';

// Same values as QueueEntry.status in database/schema.sql.
// Leaving a queue stores "left". The History page labels that "Cancelled".
const HISTORY_OUTCOMES = ['waiting', 'served', 'left', 'removed', 'no_show'];

const MAX_HISTORY_SERVICE_NAME_LENGTH = 100;

function historyFromRow(array $row): array
{
    return [
        'entryId' => (int) $row['entry_id'],
        'serviceId' => (int) $row['service_id'],
        'serviceName' => $row['service_name'],
        'outcome' => $row['status'],
        'joinedAt' => $row['joined_at'],
        'completedAt' => $row['completed_at']
    ];
}

// A user's past and current visits, newest first. There is no separate
// history table: every visit is a QueueEntry row, and leaving or being
// served only changes its status, so nothing is ever lost.
// Optional filters: outcome, service name, and a maximum number of rows.
function getUserHistory(
    PDO $db,
    int $userId,
    ?string $outcome = null,
    ?string $serviceName = null,
    ?int $limit = null
): array {
    if ($userId < 1) {
        throw new QueueActionException('Please log in first.', 401);
    }

    if ($outcome !== null && !in_array($outcome, HISTORY_OUTCOMES, true)) {
        throw new QueueActionException(
            'outcome must be one of: ' . implode(', ', HISTORY_OUTCOMES) . '.',
            400
        );
    }

    if ($serviceName !== null) {
        $serviceName = trim($serviceName);

        if ($serviceName === '') {
            throw new QueueActionException('serviceName is required.', 400);
        }

        if (mb_strlen($serviceName) > MAX_HISTORY_SERVICE_NAME_LENGTH) {
            throw new QueueActionException(
                'serviceName must be at most ' .
                MAX_HISTORY_SERVICE_NAME_LENGTH . ' characters.',
                400
            );
        }
    }

    if ($limit !== null && $limit < 1) {
        throw new QueueActionException(
            'limit must be a positive integer.', 400
        );
    }

    $sql = 'SELECT e.entry_id, s.service_id, s.name AS service_name,
                   e.status, e.joined_at, e.completed_at
            FROM QueueEntry AS e
            JOIN `Queue` AS q ON q.queue_id = e.queue_id
            JOIN Service AS s ON s.service_id = q.service_id
            WHERE e.user_id = ?';
    $parameters = [$userId];

    if ($outcome !== null) {
        $sql .= ' AND e.status = ?';
        $parameters[] = $outcome;
    }

    if ($serviceName !== null) {
        $sql .= ' AND s.name = ?';
        $parameters[] = $serviceName;
    }

    $sql .= ' ORDER BY e.entry_id DESC';

    if ($limit !== null) {
        $sql .= ' LIMIT ' . $limit; // already validated as an integer
    }

    $statement = $db->prepare($sql);
    $statement->execute($parameters);

    return array_map('historyFromRow', $statement->fetchAll(PDO::FETCH_ASSOC));
}
