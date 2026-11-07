<?php
declare(strict_types=1);

require_once __DIR__ . '/queue-action-exception.php';
require_once __DIR__ . '/notification-actions.php';
require_once __DIR__ . '/history-actions.php';

// Text shown under the status badge on the Queue Status screen.
const QUEUE_STATUS_NOTES = [
    'waiting' => "We'll notify you when you're almost up.",
    'almost_ready' => "You're almost up — please head to the counter.",
    'served' => "You've been served. Thanks for waiting!"
];

// Everything the Queue Status screen shows, read from the database so
// position and wait are never out of date. Position and wait come from the
// combined_waiting_line view.
// Returns null when the user has no active queue and was not just served.
function getUserQueueStatus(PDO $db, int $userId): ?array
{
    if ($userId < 1) {
        throw new QueueActionException('Please log in first.', 401);
    }

    $statement = $db->prepare(
        'SELECT entry_id, service_id, service_name, `position`, wait_minutes
         FROM combined_waiting_line WHERE user_id = ?'
    );
    $statement->execute([$userId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    if ($row !== false) {
        $position = (int) $row['position'];
        $status = queueStatusForPosition($position);

        return [
            'entryId' => (int) $row['entry_id'],
            'serviceId' => (int) $row['service_id'],
            'serviceName' => $row['service_name'],
            'status' => $status,
            'position' => $position,
            'peopleAhead' => $position - 1,
            'waitMinutes' => (int) $row['wait_minutes'],
            'note' => QUEUE_STATUS_NOTES[$status]
        ];
    }

    // No waiting visit: show "served" if the most recent visit ended that way.
    $latest = getUserHistory($db, $userId, null, null, 1)[0] ?? null;

    if ($latest !== null && $latest['outcome'] === 'served') {
        return [
            'entryId' => null,
            'serviceId' => $latest['serviceId'],
            'serviceName' => $latest['serviceName'],
            'status' => 'served',
            'position' => null,
            'peopleAhead' => null,
            'waitMinutes' => null,
            'note' => QUEUE_STATUS_NOTES['served']
        ];
    }

    return null;
}

// Every waiting visit's current position: [entry_id => position].
// Take one before a join, leave or serve, and pass it to
// notifyQueueMovement() afterwards.
function snapshotWaitingPositions(PDO $db): array
{
    $positions = [];

    foreach ($db->query(
        'SELECT entry_id, `position` FROM combined_waiting_line'
    )->fetchAll(PDO::FETCH_NUM) as [$entryId, $position]) {
        $positions[(int) $entryId] = (int) $position;
    }

    return $positions;
}

// Call after anyone joins, is served, leaves, or is removed.
// Notifies each waiting user whose position changed since $before was taken.
// One change can move people waiting for other services too, so this checks
// the whole shared line. Returns the notifications that were created.
function notifyQueueMovement(PDO $db, array $before): array
{
    $line = $db->query(
        'SELECT entry_id, service_name, `position`, wait_minutes
         FROM combined_waiting_line ORDER BY `position`'
    )->fetchAll(PDO::FETCH_ASSOC);

    $created = [];

    foreach ($line as $row) {
        $entryId = (int) $row['entry_id'];
        $position = (int) $row['position'];
        $previous = $before[$entryId] ?? null;

        if ($previous === $position) {
            continue;
        }

        // A brand-new visit already got a "joined" message with its
        // position, so only add an alert if it is already almost ready.
        if ($previous === null &&
            queueStatusForPosition($position) !== 'almost_ready') {
            continue;
        }

        $note = notifyPositionChange(
            $db, $entryId, $row['service_name'], $position,
            (int) $row['wait_minutes']
        );

        if ($note !== null) {
            $created[] = $note;
        }
    }

    return $created;
}
