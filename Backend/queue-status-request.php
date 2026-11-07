<?php
declare(strict_types=1);

require_once __DIR__ . '/queue-status-actions.php';

// Returns [HTTP status, JSON data]. queueStatus is null when the user
// is not waiting and was not just served.
function handleQueueStatusRequest(
    string $method,
    array $query,
    callable $readUserId,
    callable $openDb
): array {
    if ($method !== 'GET') {
        return [405, ['error' => 'Use GET to check your queue status.']];
    }

    try {
        $id = $readUserId();
        $userId = (is_int($id) || is_string($id))
            ? filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])
            : false;

        if ($userId === false) {
            return [401, ['error' => 'Please log in first.']];
        }

        // The signed-in user is the only one this screen can show.
        if ($query !== []) {
            return [400, ['error' => 'This request does not accept parameters.']];
        }

        return [200, [
            'queueStatus' => getUserQueueStatus($openDb(), $userId)
        ]];
    } catch (Throwable $error) {
        if ($error instanceof QueueActionException &&
            $error->getCode() === 401) {
            return [401, ['error' => $error->getMessage()]];
        }

        error_log('QueueSmart queue status: ' . $error->getMessage());
        return [500, ['error' => 'Could not load your queue status right now.']];
    }
}
