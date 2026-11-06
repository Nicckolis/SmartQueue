<?php
declare(strict_types=1);

require_once __DIR__ . '/queue-actions.php';

// Returns [HTTP status, JSON data]. Neither the browser nor the URL selects a user.
function handleLeaveQueueRequest(
    string $method,
    string $contentType,
    string|false $rawBody,
    callable $readUserId,
    callable $openDb
): array {
    if ($method !== 'POST') {
        return [405, ['error' => 'Use POST to leave the queue.']];
    }

    try {
        $id = $readUserId();
        $userId = (is_int($id) || is_string($id))
            ? filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])
            : false;
        if ($userId === false) {
            return [401, ['error' => 'Please log in first.']];
        }

        $mediaType = strtolower(trim(explode(';', $contentType, 2)[0]));
        if ($mediaType !== 'application/json') {
            return [415, ['error' => 'Use Content-Type: application/json.']];
        }
        if ($rawBody === false) {
            throw new RuntimeException('Could not read the request body.');
        }

        try {
            $data = json_decode($rawBody, false, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return [400, ['error' => 'The request body must be valid JSON.']];
        }
        if (!($data instanceof stdClass) || get_object_vars($data) !== []) {
            return [400, ['error' => 'Send an empty JSON object: {}.']];
        }

        return [200, leaveQueue($openDb(), $userId)];
    } catch (Throwable $error) {
        if ($error instanceof QueueActionException && $error->getCode() === 401) {
            return [401, ['error' => $error->getMessage()]];
        }
        error_log('QueueSmart leave: ' . $error->getMessage());
        return [500, ['error' => 'Could not leave the queue right now.']];
    }
}
