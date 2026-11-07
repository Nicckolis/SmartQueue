<?php
declare(strict_types=1);

require_once __DIR__ . '/QueueDatabaseTestCase.php';

final class HistoryActionsDatabaseTest extends QueueDatabaseTestCase
{
    // User 1 has a served visit, a cancelled visit, then a waiting visit.
    private function seed(): void
    {
        $served = joinQueue($this->db, 1, 1)['entryId'];
        $this->finishVisit($served, 'served');
        joinQueue($this->db, 1, 2);
        leaveQueue($this->db, 1);
        joinQueue($this->db, 1, 1);
        joinQueue($this->db, 2, 1); // another user's visit must never show up
    }

    public function testReturnsOnlyThisUsersVisitsNewestFirst(): void
    {
        $this->seed();

        $history = getUserHistory($this->db, 1);

        self::assertSame(
            ['waiting', 'cancelled', 'served'], array_column($history, 'outcome')
        );
        self::assertSame(
            ['Prescription Pickup', 'Consultation', 'Prescription Pickup'],
            array_column($history, 'serviceName')
        );
        self::assertGreaterThan($history[1]['entryId'], $history[0]['entryId']);
        self::assertNull($history[0]['completedAt']);
        self::assertNotNull($history[1]['completedAt']);
        self::assertNotNull($history[0]['joinedAt']);
        self::assertSame([], getUserHistory($this->db, 3));
    }

    public function testFiltersByOutcomeServiceAndLimit(): void
    {
        $this->seed();

        self::assertCount(1, getUserHistory($this->db, 1, 'served'));
        self::assertCount(1, getUserHistory($this->db, 1, 'cancelled'));
        self::assertSame([], getUserHistory($this->db, 1, 'no_show'));
        self::assertCount(2, getUserHistory($this->db, 1, null, 'Prescription Pickup'));
        self::assertCount(1, getUserHistory($this->db, 1, 'served', 'Prescription Pickup'));
        self::assertSame([], getUserHistory($this->db, 1, 'served', 'Consultation'));

        $latest = getUserHistory($this->db, 1, null, null, 1);
        self::assertCount(1, $latest);
        self::assertSame('waiting', $latest[0]['outcome']);
    }

    public function testRemovedAndNoShowVisitsAppearWithTheirOutcome(): void
    {
        $first = joinQueue($this->db, 1, 1)['entryId'];
        $this->finishVisit($first, 'no_show');
        $second = joinQueue($this->db, 1, 1)['entryId'];
        $this->finishVisit($second, 'removed');

        self::assertSame(
            ['removed', 'no_show'],
            array_column(getUserHistory($this->db, 1), 'outcome')
        );
    }

    public function testServiceNameFilterIsNotSqlInjectable(): void
    {
        $this->seed();

        self::assertSame(
            [], getUserHistory($this->db, 1, null, "x' OR '1'='1")
        );
    }
}
