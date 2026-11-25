<?php
declare(strict_types=1);

// QueueActionException lives in its own file so every Backend module can use it.
require_once __DIR__ . '/queue-action-exception.php';
require_once __DIR__ . '/notification-actions.php';
require_once __DIR__ . '/queue-status-actions.php';

// The PDO connection must use PDO::ERRMODE_EXCEPTION.
// This function starts and finishes its own transaction.
function joinQueue(PDO $db, int $userId, int $serviceId): array
{
    if ($userId < 1) {
        throw new QueueActionException('Please log in first.', 401);
    }

    if ($serviceId < 1) {
        throw new QueueActionException('Please select a valid service.', 400);
    }

    if ($db->inTransaction()) {
        throw new LogicException('joinQueue must start its own transaction.');
    }

    $db->beginTransaction();

    try {
        // Confirm the user exists and prevent deletion during this join.
        $userStatement = $db->prepare(
            'SELECT user_id FROM UserCredentials
             WHERE user_id = ? FOR SHARE'
        );
        $userStatement->execute([$userId]);

        if ($userStatement->fetchColumn() === false) {
            throw new QueueActionException('Please log in first.', 401);
        }

        // Lock the selected queue while checking whether joining is allowed.
        $queueStatement = $db->prepare(
            'SELECT q.queue_id, q.status, s.expected_duration_minutes
             FROM `Queue` AS q
             JOIN Service AS s ON s.service_id = q.service_id
             WHERE s.service_id = ?
             FOR UPDATE'
        );
        $queueStatement->execute([$serviceId]);
        $queue = $queueStatement->fetch(PDO::FETCH_ASSOC);

        if ($queue === false) {
            throw new QueueActionException('Service or queue not found.', 404);
        }

        if ($queue['status'] !== 'open') {
            throw new QueueActionException(
                'This queue is closed to new arrivals.', 409
            );
        }

        if ((int) $queue['expected_duration_minutes'] < 1) {
            throw new QueueActionException(
                'The service duration is not configured correctly.', 500
            );
        }

        // Remember everyone's place so we can tell who moves after this join.
        $positionsBefore = snapshotWaitingPositions($db);

        // Defaults supply status = waiting and the current join time.
        // uq_one_waiting_visit prevents a second waiting visit for this user.
        $insertStatement = $db->prepare(
            'INSERT INTO QueueEntry (queue_id, user_id) VALUES (?, ?)'
        );
        $insertStatement->execute([$queue['queue_id'], $userId]);
        $entryId = $db->lastInsertId();

        // The view ranks the entire shared line before we select this entry.
        $statusStatement = $db->prepare(
            'SELECT entry_id, queue_id, user_id, service_id, service_name,
                    `position`, wait_minutes
             FROM combined_waiting_line
             WHERE entry_id = ?'
        );
        $statusStatement->execute([$entryId]);
        $currentQueue = $statusStatement->fetch(PDO::FETCH_ASSOC);

        if ($currentQueue === false) {
            throw new RuntimeException('The new queue entry could not be read.');
        }

        // Use the field names that our JavaScript can display.
        $result = [
            'entryId' => (int) $currentQueue['entry_id'],
            'queueId' => (int) $currentQueue['queue_id'],
            'userId' => (int) $currentQueue['user_id'],
            'serviceId' => (int) $currentQueue['service_id'],
            'serviceName' => $currentQueue['service_name'],
            'status' => 'waiting',
            'position' => (int) $currentQueue['position'],
            'waitMinutes' => (int) $currentQueue['wait_minutes']
        ];

        // Save how many people were ahead when this user joined.
        $peopleAheadAtJoin = $result['position'] - 1;
        $savePeopleAhead = $db->prepare(
            'UPDATE QueueEntry
            SET people_ahead_at_join = ?
            WHERE entry_id = ?'
        );
        $savePeopleAhead->execute([$peopleAheadAtJoin, $result['entryId']]);
        
        // Notifications commit or roll back together with the join itself.
        notifyJoined(
            $db, $result['entryId'], $result['serviceName'],
            $result['position'], $result['waitMinutes']
        );
        // Joining can push users of other services back.
        notifyQueueMovement($db, $positionsBefore);

        $db->commit();
        return $result;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }

        // Translate only this particular duplicate-key error.
        if ($error instanceof PDOException &&
            (int) ($error->errorInfo[1] ?? 0) === 1062 &&
            str_contains(
                $error->errorInfo[2] ?? '',
                'uq_one_waiting_visit'
            )) {
            throw new QueueActionException(
                'Leave your current queue before joining another.',
                409,
                $error
            );
        }

        throw $error;
    }
}

// Cancel the user's waiting visit while preserving the record for history.
function leaveQueue(PDO $db, int $userId): array
{
    if ($userId < 1) {
        throw new QueueActionException('Please log in first.', 401);
    }

    if ($db->inTransaction()) {
        throw new LogicException('leaveQueue must start its own transaction.');
    }

    $db->beginTransaction();

    try {
        $userStatement = $db->prepare(
            'SELECT user_id FROM UserCredentials
             WHERE user_id = ? FOR SHARE'
        );
        $userStatement->execute([$userId]);

        if ($userStatement->fetchColumn() === false) {
            throw new QueueActionException('Please log in first.', 401);
        }

        // Lock the waiting visit until this transaction finishes.
        $entryStatement = $db->prepare(
            'SELECT entry_id FROM QueueEntry
             WHERE waiting_user_id = ? FOR UPDATE'
        );
        $entryStatement->execute([$userId]);
        $entry = $entryStatement->fetch(PDO::FETCH_ASSOC);

        // Repeated leave requests do not change completed visits.
        if ($entry === false) {
            $db->commit();
            return [
                'left' => false,
                'entryId' => null,
                'status' => null,
                'currentQueue' => null
            ];
        }

        // Look up the service name without locking more rows than above.
        $nameStatement = $db->prepare(
            'SELECT s.name
             FROM QueueEntry AS e
             JOIN `Queue` AS q ON q.queue_id = e.queue_id
             JOIN Service AS s ON s.service_id = q.service_id
             WHERE e.entry_id = ?'
        );
        $nameStatement->execute([$entry['entry_id']]);
        $serviceName = (string) $nameStatement->fetchColumn();

        // Remember everyone's place so we can tell who moves up.
        $positionsBefore = snapshotWaitingPositions($db);

        // Leaving is allowed even when the service's queue is closed.
        $updateStatement = $db->prepare(
            "UPDATE QueueEntry
             SET status = 'left', completed_at = CURRENT_TIMESTAMP
             WHERE entry_id = ? AND user_id = ? AND status = 'waiting'"
        );
        $updateStatement->execute([$entry['entry_id'], $userId]);

        if ($updateStatement->rowCount() !== 1) {
            throw new RuntimeException('The waiting visit could not be marked as left.');
        }

        $result = [
            'left' => true,
            'entryId' => (int) $entry['entry_id'],
            // QueueEntry.status is "left". The History page shows that as Cancelled.
            'status' => 'left',
            'currentQueue' => null
        ];

        // Notifications commit or roll back together with the leave itself.
        notifyLeft($db, (int) $entry['entry_id'], $serviceName);
        notifyQueueMovement($db, $positionsBefore);

        $db->commit();
        return $result;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }

        throw $error;
    }
}

function getCurrentQueue(PDO $db, int $userId): ?array
{
    if ($userId < 1) {
        throw new QueueActionException('Please log in first.', 401);
    }

    // The view calculates each user's position across the whole line.
    $statement = $db->prepare(
        'SELECT u.user_id, v.entry_id, v.queue_id, v.service_id,
                v.service_name, v.`position`, v.wait_minutes
         FROM UserCredentials AS u
         LEFT JOIN combined_waiting_line AS v ON v.user_id = u.user_id
         WHERE u.user_id = ?'
    );
    $statement->execute([$userId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    if ($row === false) {
        // The session refers to an account that no longer exists.
        throw new QueueActionException('Please log in first.', 401);
    }

    if ($row['entry_id'] === null) {
        // The account exists, but the user is not waiting.
        return null;
    }

    return [
        'entryId'     => (int) $row['entry_id'],
        'queueId'     => (int) $row['queue_id'],
        'userId'      => (int) $row['user_id'],
        'serviceId'   => (int) $row['service_id'],
        'serviceName' => $row['service_name'],
        'status'      => 'waiting',
        'position'    => (int) $row['position'],
        'waitMinutes' => (int) $row['wait_minutes']
    ];
}
