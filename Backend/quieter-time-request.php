<?php
declare(strict_types=1);

// Returns [HTTP status, response data], like handleCurrentQueueRequest().
function handleQuieterTimeRequest(
    string $method,
    mixed $rawServiceId,
    callable $readUserId,
    callable $openDb
): array {
    if ($method !== 'GET') {
        return [405, ['error' => 'Use GET to request a suggested time.']];
    }

    $positiveId = static function (mixed $value): int|false {
        if (!is_int($value) && !is_string($value)) {
            return false;
        }

        return filter_var(
            $value,
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 1]]
        );
    };

    try {
        $userId = $positiveId($readUserId());
        if ($userId === false) {
            return [401, ['error' => 'Please log in first.']];
        }

        $serviceId = $positiveId($rawServiceId);
        if ($serviceId === false) {
            return [400, ['error' => 'Choose a valid service.']];
        }

        $db = $openDb();

        // Confirm the session still belongs to an existing account.
        $userCheck = $db->prepare(
            'SELECT 1 FROM UserCredentials WHERE user_id = ?'
        );
        $userCheck->execute([$userId]);

        if ($userCheck->fetchColumn() === false) {
            return [401, ['error' => 'Please log in first.']];
        }

        $queueCheck = $db->prepare(
            'SELECT queue_id, status, @@session.time_zone AS clock_zone
             FROM `Queue`
             WHERE service_id = ?'
        );
        $queueCheck->execute([$serviceId]);
        $queue = $queueCheck->fetch(PDO::FETCH_ASSOC);

        if ($queue === false) {
            return [404, ['error' => 'Service or queue not found.']];
        }

        if ($queue['status'] !== 'open') {
            return [409, ['error' => 'This service is currently closed.']];
        }

        // Each measured arrival counts once, even if the customer later left.
        $query = $db->prepare(<<<'SQL'
            SELECT WEEKDAY(joined_at) AS weekday_no,
                   HOUR(joined_at) AS hour_no,
                   AVG(people_ahead_at_join) AS avg_ahead,
                   COUNT(*) AS visits,
                   COUNT(DISTINCT DATE(joined_at)) AS observed_dates
            FROM QueueEntry
            WHERE queue_id = ?
              AND people_ahead_at_join IS NOT NULL
              AND joined_at BETWEEN CURRENT_TIMESTAMP - INTERVAL 12 WEEK
                                AND CURRENT_TIMESTAMP
            GROUP BY WEEKDAY(joined_at), HOUR(joined_at)
            HAVING COUNT(*) >= 3
               AND COUNT(DISTINCT DATE(joined_at)) >= 2
            ORDER BY avg_ahead ASC, visits DESC, weekday_no ASC, hour_no ASC
            SQL
        );
        $query->execute([(int) $queue['queue_id']]);
        $hours = $query->fetchAll(PDO::FETCH_ASSOC);

        $info = [
            'serviceId' => $serviceId,
            'clock' => match ($queue['clock_zone']) {
                'SYSTEM' => 'queue server time',
                '+00:00' => 'UTC',
                default => $queue['clock_zone'],
            },
        ];

        // We need at least two qualifying time slots to make a comparison.
        if (count($hours) < 2) {
            return [200, $info + [
                'status' => 'insufficient_history',
                'suggestion' => null,
            ]];
        }

        $formatHour = static fn(array $row): array => [
            'weekday' => (int) $row['weekday_no'], // Monday = 0, Sunday = 6
            'hour' => (int) $row['hour_no'],       // 0 through 23
            'averageAhead' => round((float) $row['avg_ahead'], 1),
            'visits' => (int) $row['visits'],
            'dates' => (int) $row['observed_dates'],
        ];

        $quietest = $formatHour($hours[0]);
        $busiest = $formatHour($hours[array_key_last($hours)]);

        if ($quietest['averageAhead'] === $busiest['averageAhead']) {
            return [200, $info + [
                'status' => 'similar_hours',
                'suggestion' => null,
            ]];
        }

        return [200, $info + [
            'status' => 'suggested',
            'suggestion' => $quietest,
            'comparison' => $busiest,
        ]];
    } catch (Throwable $error) {
        error_log('QueueSmart quieter time: ' . $error->getMessage());
        return [500, ['error' => 'Could not look up a quieter time right now.']];
    }
}