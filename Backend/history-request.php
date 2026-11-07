<?php
declare(strict_types=1);

require_once __DIR__ . '/history-actions.php';

// Returns [HTTP status, JSON data]. The user id comes from the PHP session.
function handleHistoryRequest(
    string $method,
    array $query,
    callable $readUserId,
    callable $openDb
): array {
    if ($method !== 'GET') {
        return [405, ['error' => 'Use GET to view your history.']];
    }

    try {
        $id = $readUserId();
        $userId = (is_int($id) || is_string($id))
            ? filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])
            : false;

        if ($userId === false) {
            return [401, ['error' => 'Please log in first.']];
        }

        $filters = historyFilters($query);
        if (isset($filters['error'])) {
            return $filters['error'];
        }

        return [200, [
            'history' => getUserHistory(
                $openDb(),
                $userId,
                $filters['outcome'],
                $filters['serviceName'],
                $filters['limit']
            )
        ]];
    } catch (Throwable $error) {
        if ($error instanceof QueueActionException &&
            in_array($error->getCode(), [400, 401], true)) {
            return [$error->getCode(), ['error' => $error->getMessage()]];
        }

        error_log('QueueSmart history: ' . $error->getMessage());
        return [500, ['error' => 'Could not load your history right now.']];
    }
}

// Optional filters match getUserHistory(). A user id in the query is rejected.
function historyFilters(array $query): array
{
    $allowed = ['outcome', 'serviceName', 'limit'];

    foreach ($query as $key => $value) {
        if (!is_string($key) || !is_string($value) || !in_array($key, $allowed, true)) {
            return ['error' => [400, [
                'error' => 'Send only outcome, serviceName, or limit.'
            ]]];
        }
    }

    $outcome = null;
    if (array_key_exists('outcome', $query)) {
        $outcome = $query['outcome'];
        if (!in_array($outcome, HISTORY_OUTCOMES, true)) {
            return ['error' => [400, [
                'error' => 'outcome must be one of: ' . implode(', ', HISTORY_OUTCOMES) . '.'
            ]]];
        }
    }

    $serviceName = null;
    if (array_key_exists('serviceName', $query)) {
        $serviceName = trim($query['serviceName']);
        if ($serviceName === '') {
            return ['error' => [400, ['error' => 'serviceName is required.']]];
        }
        if (mb_strlen($serviceName) > MAX_HISTORY_SERVICE_NAME_LENGTH) {
            return ['error' => [400, [
                'error' => 'serviceName must be at most ' .
                    MAX_HISTORY_SERVICE_NAME_LENGTH . ' characters.'
            ]]];
        }
    }

    $limit = null;
    if (array_key_exists('limit', $query)) {
        $limit = filter_var(
            trim($query['limit']),
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 1]]
        );
        if ($limit === false) {
            return ['error' => [400, ['error' => 'limit must be a positive integer.']]];
        }
    }

    return [
        'outcome' => $outcome,
        'serviceName' => $serviceName,
        'limit' => $limit
    ];
}
