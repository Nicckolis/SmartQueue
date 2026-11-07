<?php
declare(strict_types=1);

require_once __DIR__ . '/notification-actions.php';

// GET the signed-in user's notifications, newest first.
function handleNotificationsRequest(
    string $method,
    array $query,
    callable $readUserId,
    callable $openDb
): array {
    if ($method !== 'GET') {
        return [405, ['error' => 'Use GET to read your notifications.']];
    }

    try {
        $userId = notificationUserId($readUserId);
        if ($userId === false) {
            return [401, ['error' => 'Please log in first.']];
        }

        $unreadOnly = unreadOnlyFlag($query);
        if (is_array($unreadOnly)) {
            return $unreadOnly;
        }

        return [200, [
            'notifications' => getUserNotifications($openDb(), $userId, $unreadOnly)
        ]];
    } catch (Throwable $error) {
        return notificationFailure(
            $error,
            [401],
            'Could not load your notifications right now.'
        );
    }
}

// POST {"eventId": 123} marks one of this user's notifications read.
function handleMarkNotificationReadRequest(
    string $method,
    string $contentType,
    string|false $rawBody,
    callable $readUserId,
    callable $openDb
): array {
    if ($method !== 'POST') {
        return [405, ['error' => 'Use POST to mark a notification read.']];
    }

    try {
        $userId = notificationUserId($readUserId);
        if ($userId === false) {
            return [401, ['error' => 'Please log in first.']];
        }

        $data = notificationJsonBody($contentType, $rawBody);
        if (is_array($data)) {
            return $data;
        }

        if (array_keys(get_object_vars($data)) !== ['eventId'] ||
            !is_int($data->eventId) || $data->eventId < 1) {
            return [400, ['error' => 'Send only eventId as a positive JSON integer.']];
        }

        return [200, [
            'notification' => markNotificationRead($openDb(), $userId, $data->eventId)
        ]];
    } catch (Throwable $error) {
        return notificationFailure(
            $error,
            [400, 401, 404],
            'Could not update that notification right now.'
        );
    }
}

// POST {} marks every unread notification for this user.
function handleMarkAllNotificationsReadRequest(
    string $method,
    string $contentType,
    string|false $rawBody,
    callable $readUserId,
    callable $openDb
): array {
    if ($method !== 'POST') {
        return [405, ['error' => 'Use POST to mark all notifications read.']];
    }

    try {
        $userId = notificationUserId($readUserId);
        if ($userId === false) {
            return [401, ['error' => 'Please log in first.']];
        }

        $data = notificationJsonBody($contentType, $rawBody);
        if (is_array($data)) {
            return $data;
        }

        if (get_object_vars($data) !== []) {
            return [400, ['error' => 'Send an empty JSON object: {}.']];
        }

        return [200, [
            'marked' => markAllNotificationsRead($openDb(), $userId)
        ]];
    } catch (Throwable $error) {
        return notificationFailure(
            $error,
            [401],
            'Could not update your notifications right now.'
        );
    }
}

function notificationUserId(callable $readUserId): int|false
{
    $id = $readUserId();

    return (is_int($id) || is_string($id))
        ? filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])
        : false;
}

// true/false when the query is valid, or a [status, body] error.
function unreadOnlyFlag(array $query): bool|array
{
    foreach ($query as $key => $value) {
        if (!is_string($key) || !is_string($value) || $key !== 'unreadOnly') {
            return [400, ['error' => 'Send only unreadOnly, or no parameters.']];
        }
    }

    if (!array_key_exists('unreadOnly', $query)) {
        return false;
    }

    if ($query['unreadOnly'] !== '1') {
        return [400, ['error' => 'unreadOnly must be 1.']];
    }

    return true;
}

// A JSON object, or a [status, body] error. Does not open the database.
function notificationJsonBody(string $contentType, string|false $rawBody): stdClass|array
{
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

    if (!($data instanceof stdClass)) {
        return [400, ['error' => 'Send a JSON object.']];
    }

    return $data;
}

function notificationFailure(Throwable $error, array $codes, string $fallback): array
{
    if ($error instanceof QueueActionException &&
        in_array($error->getCode(), $codes, true)) {
        return [$error->getCode(), ['error' => $error->getMessage()]];
    }

    error_log('QueueSmart notifications: ' . $error->getMessage());
    return [500, ['error' => $fallback]];
}
