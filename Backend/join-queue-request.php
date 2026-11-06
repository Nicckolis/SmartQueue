<?php
declare(strict_types=1);

require_once __DIR__ . '/queue-actions.php';

function handleJoinQueueRequest(
    string $method,
    string $contentType,
    string|false $rawBody,
    callable $readUserId,
    callable $openDb
): array {
    if ($method !== 'POST') {
        return [405, ['error' => 'Use POST to join a queue.']];
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

        if (!($data instanceof stdClass) ||
            array_keys(get_object_vars($data)) !== ['serviceId'] ||
            !is_int($data->serviceId) || $data->serviceId < 1) {
            return [400, ['error' => 'Send only serviceId as a positive JSON integer.']];
        }

        // Your existing function saves the visit and reads its position and wait.
        $currentQueue = joinQueue($openDb(), $userId, $data->serviceId);
        return [201, ['currentQueue' => $currentQueue]];

    } catch (Throwable $error) {
        if ($error instanceof QueueActionException &&
            in_array($error->getCode(), [400, 401, 404, 409], true)) {
            return [$error->getCode(), ['error' => $error->getMessage()]];
        }

        error_log('QueueSmart join: ' . $error->getMessage());
        return [500, ['error' => 'Could not join the queue right now.']];
    }
}