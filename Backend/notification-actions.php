<?php
declare(strict_types=1);

require_once __DIR__ . '/queue-action-exception.php';

// Same values as NotificationHistory.event_type in
// database/notification-history.sql.
const NOTIFICATION_EVENT_TYPES = [
    'joined', 'position_update', 'almost_ready',
    'served', 'left', 'removed', 'no_show'
];

// A user is "almost ready" at this position or closer to the front.
const ALMOST_READY_THRESHOLD = 2;

// Matches NotificationHistory.message VARCHAR(1000).
const MAX_NOTIFICATION_MESSAGE_LENGTH = 1000;

// The notification list shows at most this many (newest first).
const MAX_NOTIFICATIONS_RETURNED = 100;

function requireLoggedInUser(int $userId): void
{
    if ($userId < 1) {
        throw new QueueActionException('Please log in first.', 401);
    }
}

// Status for a waiting user. position 1 = next to be served.
// Served visits have no position, so pass $served = true for them.
function queueStatusForPosition(int $position, bool $served = false): string
{
    if ($served || $position === 0) {
        return 'served';
    }

    if ($position < 0) {
        throw new QueueActionException(
            'position must be a non-negative integer.', 400
        );
    }

    return $position <= ALMOST_READY_THRESHOLD ? 'almost_ready' : 'waiting';
}

// Turn a NotificationHistory row into the shape our JavaScript displays.
function notificationFromRow(array $row): array
{
    return [
        'id' => (int) $row['event_id'],
        'entryId' => (int) $row['entry_id'],
        'type' => $row['event_type'],
        'message' => $row['message'],
        'createdAt' => $row['created_at'],
        'readAt' => $row['read_at'],
        'read' => $row['read_at'] !== null
    ];
}

// Stores one notification for a queue visit.
// This does NOT start a transaction, so queue actions can call it before
// they commit and the notification stays part of the same unit of work.
function addNotification(
    PDO $db, int $entryId, string $eventType, string $message
): array {
    if ($entryId < 1) {
        throw new QueueActionException(
            'entryId must be a positive integer.', 400
        );
    }

    if (!in_array($eventType, NOTIFICATION_EVENT_TYPES, true)) {
        throw new QueueActionException(
            'eventType must be one of: ' .
            implode(', ', NOTIFICATION_EVENT_TYPES) . '.',
            400
        );
    }

    $text = trim($message);

    if ($text === '') {
        throw new QueueActionException('message is required.', 400);
    }

    if (mb_strlen($text) > MAX_NOTIFICATION_MESSAGE_LENGTH) {
        throw new QueueActionException(
            'message must be at most ' .
            MAX_NOTIFICATION_MESSAGE_LENGTH . ' characters.',
            400
        );
    }

    try {
        $insert = $db->prepare(
            'INSERT INTO NotificationHistory (entry_id, event_type, message)
             VALUES (?, ?, ?)'
        );
        $insert->execute([$entryId, $eventType, $text]);
    } catch (PDOException $error) {
        // 1452 = the foreign key to QueueEntry failed.
        if ((int) ($error->errorInfo[1] ?? 0) === 1452) {
            throw new QueueActionException(
                'Queue entry not found.', 404, $error
            );
        }

        throw $error;
    }

    $select = $db->prepare(
        'SELECT event_id, entry_id, event_type, message, created_at, read_at
         FROM NotificationHistory WHERE event_id = ?'
    );
    $select->execute([(int) $db->lastInsertId()]);

    return notificationFromRow($select->fetch(PDO::FETCH_ASSOC));
}

// ---------- Triggers: call these from the queue actions ----------

function notifyJoined(
    PDO $db, int $entryId, string $serviceName, int $position, int $waitMinutes
): array {
    return addNotification(
        $db, $entryId, 'joined',
        "You joined the {$serviceName} queue. Position: {$position}. " .
        "Estimated wait: {$waitMinutes} minutes."
    );
}

function notifyServed(PDO $db, int $entryId, string $serviceName): array
{
    return addNotification(
        $db, $entryId, 'served', "You have been served for {$serviceName}."
    );
}

function notifyLeft(PDO $db, int $entryId, string $serviceName): array
{
    return addNotification(
        $db, $entryId, 'left', "You left the {$serviceName} queue."
    );
}

function notifyRemoved(PDO $db, int $entryId, string $serviceName): array
{
    return addNotification(
        $db, $entryId, 'removed',
        "You were removed from the {$serviceName} queue by an administrator."
    );
}

function notifyNoShow(PDO $db, int $entryId, string $serviceName): array
{
    return addNotification(
        $db, $entryId, 'no_show',
        "You were marked as a no-show for {$serviceName}."
    );
}

// Call when a waiting user's position changed.
// Returns null when there is nothing new to tell the user.
function notifyPositionChange(
    PDO $db, int $entryId, string $serviceName, int $position, int $waitMinutes
): ?array {
    if (queueStatusForPosition($position) === 'almost_ready') {
        // Send once per visit. A new visit is a new entry, so rejoining
        // starts a fresh "almost ready" alert.
        $sent = $db->prepare(
            "SELECT 1 FROM NotificationHistory
             WHERE entry_id = ? AND event_type = 'almost_ready' LIMIT 1"
        );
        $sent->execute([$entryId]);

        if ($sent->fetchColumn() !== false) {
            return null;
        }

        return addNotification(
            $db, $entryId, 'almost_ready',
            "You're almost up for {$serviceName}! Position: {$position}."
        );
    }

    return addNotification(
        $db, $entryId, 'position_update',
        "Your position in {$serviceName} is now {$position}. " .
        "Estimated wait: {$waitMinutes} minutes."
    );
}

// ---------- Reads for the Dashboard / notification list ----------

// Newest first. Notifications belong to a visit, so the user comes from
// QueueEntry.user_id.
function getUserNotifications(
    PDO $db, int $userId, bool $unreadOnly = false
): array {
    requireLoggedInUser($userId);

    $sql = 'SELECT n.event_id, n.entry_id, n.event_type, n.message,
                   n.created_at, n.read_at
            FROM NotificationHistory AS n
            JOIN QueueEntry AS e ON e.entry_id = n.entry_id
            WHERE e.user_id = ?';

    if ($unreadOnly) {
        $sql .= ' AND n.read_at IS NULL';
    }

    $sql .= ' ORDER BY n.event_id DESC LIMIT ' . MAX_NOTIFICATIONS_RETURNED;

    $statement = $db->prepare($sql);
    $statement->execute([$userId]);

    return array_map(
        'notificationFromRow', $statement->fetchAll(PDO::FETCH_ASSOC)
    );
}

// Marks one notification read. A notification that is already read keeps its
// original read time.
function markNotificationRead(PDO $db, int $userId, int $eventId): array
{
    requireLoggedInUser($userId);

    if ($eventId < 1) {
        throw new QueueActionException(
            'eventId must be a positive integer.', 400
        );
    }

    $update = $db->prepare(
        'UPDATE NotificationHistory AS n
         JOIN QueueEntry AS e ON e.entry_id = n.entry_id
         SET n.read_at = CURRENT_TIMESTAMP
         WHERE n.event_id = ? AND e.user_id = ? AND n.read_at IS NULL'
    );
    $update->execute([$eventId, $userId]);

    $select = $db->prepare(
        'SELECT n.event_id, n.entry_id, n.event_type, n.message,
                n.created_at, n.read_at
         FROM NotificationHistory AS n
         JOIN QueueEntry AS e ON e.entry_id = n.entry_id
         WHERE n.event_id = ? AND e.user_id = ?'
    );
    $select->execute([$eventId, $userId]);
    $row = $select->fetch(PDO::FETCH_ASSOC);

    // Unknown ids and other users' notifications look the same on purpose.
    if ($row === false) {
        throw new QueueActionException('Notification not found.', 404);
    }

    return notificationFromRow($row);
}

// Returns how many notifications were newly marked read.
function markAllNotificationsRead(PDO $db, int $userId): int
{
    requireLoggedInUser($userId);

    $update = $db->prepare(
        'UPDATE NotificationHistory AS n
         JOIN QueueEntry AS e ON e.entry_id = n.entry_id
         SET n.read_at = CURRENT_TIMESTAMP
         WHERE e.user_id = ? AND n.read_at IS NULL'
    );
    $update->execute([$userId]);

    return $update->rowCount();
}
