<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/QueueDb.php';
require_once __DIR__ . '/../../Backend/queue-actions.php';
require_once __DIR__ . '/../../Backend/quieter-time-request.php';

final class QuieterTimeTest extends TestCase
{
    public function testPeopleAheadAtJoinStaysTheSameWhenTheQueueMoves(): void
    {
        $fixture = QueueDb::create();

        try {
            $db = $fixture->db;
            $observer = $fixture->observer(); // Reads what was committed to MySQL.
            $serviceId = 1;

            // User 1 joins an empty queue: first in line, zero people ahead.
            $first = joinQueue($db, 1, $serviceId);
            self::assertSame(1, $first['position']);
            self::assertSame(0, $this->savedPeopleAhead($observer, $first['entryId']));

            // User 2 joins the same service: second in line, one person ahead.
            $second = joinQueue($db, 2, $serviceId);
            self::assertSame(2, $second['position']);
            self::assertSame(1, $this->savedPeopleAhead($observer, $second['entryId']));

            // User 2 moves to first, but their original arrival count stays at one.
            leaveQueue($db, 1);

            $current = getCurrentQueue($observer, 2);
            self::assertNotNull($current);
            self::assertSame(1, $current['position']);
            self::assertSame(1, $this->savedPeopleAhead($observer, $second['entryId']));
        } finally {
            $fixture->drop();
        }
    }

    private function savedPeopleAhead(PDO $db, int $entryId): int
    {
        $query = $db->prepare(
            'SELECT people_ahead_at_join FROM QueueEntry WHERE entry_id = ?'
        );
        $query->execute([$entryId]);
        $value = $query->fetchColumn();

        // Check before casting: a missing row or NULL must not pass as zero.
        self::assertIsNumeric($value, "No arrival count was saved for entry $entryId.");

        return (int) $value;
    }

    public function testNotEnoughMeasuredVisitsReturnsNoSuggestion(): void
    {
        $fixture = QueueDb::create();

        try {
            $this->addWeeklyVisits($fixture->db, 'last Tuesday 10:00', [4, 5, 6]);
            $this->addWeeklyVisits($fixture->db, 'last Friday 16:00', [0, 1, null]);

            [$status, $body] = handleQuieterTimeRequest(
                'GET', '1', static fn() => 1, static fn() => $fixture->db
            );

            // Tuesday qualifies. Friday has only two known counts:
            // zero is a measurement, but NULL is not.
            self::assertSame(200, $status);
            self::assertSame('insufficient_history', $body['status']);
            self::assertNull($body['suggestion']);
        } finally {
            $fixture->drop();
        }
    }

    public function testRecommendsTheHourWithFewerPeopleAhead(): void
    {
        $fixture = QueueDb::create();

        try {
            $this->addWeeklyVisits($fixture->db, 'last Tuesday 10:00', [4, 5, 6]);
            $this->addWeeklyVisits($fixture->db, 'last Friday 16:00', [0, 1, 2]);

            [$status, $body] = handleQuieterTimeRequest(
                'GET', '1', static fn() => 1, static fn() => $fixture->db
            );

            self::assertSame(200, $status);
            self::assertSame('suggested', $body['status']);

            // Friday at 4 p.m.: (0 + 1 + 2) / 3 = 1 person ahead.
            $suggestion = $body['suggestion'];
            self::assertSame(4, $suggestion['weekday']); // MySQL: Monday = 0
            self::assertSame(16, $suggestion['hour']);
            self::assertSame(1.0, $suggestion['averageAhead']);
            self::assertSame(3, $suggestion['visits']);

            // Tuesday at 10 a.m.: (4 + 5 + 6) / 3 = 5 people ahead.
            $comparison = $body['comparison'];
            self::assertSame(1, $comparison['weekday']);
            self::assertSame(10, $comparison['hour']);
            self::assertSame(5.0, $comparison['averageAhead']);
        } finally {
            $fixture->drop();
        }
    }

    private function addWeeklyVisits(PDO $db, string $slot, array $counts): void
    {
        // parents.sql gives Prescription Pickup service ID 1 and queue ID 11.
        $insert = $db->prepare(
            "INSERT INTO QueueEntry
                (queue_id, user_id, status, joined_at, completed_at, people_ahead_at_join)
            VALUES (11, 1, 'served', ?, ?, ?)"
        );

        // Same weekday and hour on different weeks, within the 12-week window.
        $joinedAt = (new DateTimeImmutable($slot))->modify('-1 week');

        foreach ($counts as $count) {
            $insert->execute([
                $joinedAt->format('Y-m-d H:i:s'),
                $joinedAt->modify('+5 minutes')->format('Y-m-d H:i:s'),
                $count,
            ]);

            $joinedAt = $joinedAt->modify('-1 week');
        }
    }
}