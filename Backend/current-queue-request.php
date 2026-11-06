<?php
declare(strict_types=1);

require_once __DIR__ . '/queue-actions.php';

// Returns [HTTP status, JSON data]. The user ID comes from the PHP session.
function handleCurrentQueueRequest(
    string $method,
    callable $readUserId,
    callable $openDb
): array {
    if ($method !== 'GET') {
        return [405, [
            'error' => 'Use GET to check your current queue.'
        ]];
    }

    try {
        $id = $readUserId();

        $userId = (is_int($id) || is_string($id))
            ? filter_var(
                $id,
                FILTER_VALIDATE_INT,
                ['options' => ['min_range' => 1]]
            )
            : false;

        if ($userId === false) {
            return [401, ['error' => 'Please log in first.']];
        }

        return [200, [
            'currentQueue' => getCurrentQueue($openDb(), $userId)
        ]];
    } catch (Throwable $error) {
        if ($error instanceof QueueActionException &&
            $error->getCode() === 401) {
            return [401, ['error' => $error->getMessage()]];
        }

        error_log('QueueSmart current queue: ' . $error->getMessage());

        return [500, [
            'error' => 'Could not load your current queue right now.'
        ]];
    }
}