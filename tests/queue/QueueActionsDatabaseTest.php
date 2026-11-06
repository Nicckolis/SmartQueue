<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/QueueDb.php';

final class QueueActionsDatabaseTest extends TestCase
{
    private ?QueueDb $fixture = null;
    private PDO $db;

    protected function setUp(): void
    {
        $this->fixture = QueueDb::create();
        $this->db = $this->fixture->db;
    }

    protected function tearDown(): void
    {
        if ($this->fixture !== null) {
            // Release locks even if the action or an assertion unexpectedly failed.
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            $this->fixture->drop();
        }
    }

    public function testJoinPersistsAWaitingVisit(): void
    {
        $result = joinQueue($this->db, 1, 1);
        self::assertGreaterThan(0, $result['entryId']);
        self::assertSame(1, $result['position']);
        self::assertSame(0, $result['waitMinutes']);
        self::assertSame('Prescription Pickup', $result['serviceName']);
        self::assertSame('waiting', $result['status']);

        $visit = $this->visits(1)[0];
        self::assertSame($result['entryId'], (int) $visit['entry_id']);
        self::assertSame(11, (int) $visit['queue_id']);
        self::assertSame('waiting', $visit['status']);
        self::assertNotNull($visit['joined_at']);
        self::assertNull($visit['completed_at']);
    }

    public function testPriorityThenArrivalDeterminesPositionAndWaitAcrossServices(): void
    {
        joinQueue($this->db, 1, 4); // low, first arrival
        joinQueue($this->db, 2, 1); // medium, 5 minutes
        $fill = joinQueue($this->db, 3, 3); // medium, 15 minutes
        self::assertSame(2, $fill['position']);
        self::assertSame(5, $fill['waitMinutes']);

        $consultation = joinQueue($this->db, 4, 2); // high, last arrival
        self::assertSame(1, $consultation['position']);
        self::assertSame(0, $consultation['waitMinutes']);
        // Each row is [user ID, position, minutes of work ahead].
        self::assertSame([[4, 1, 0], [2, 2, 10], [3, 3, 15], [1, 4, 30]], $this->line());

        leaveQueue($this->db, 4);
        self::assertSame([[2, 1, 0], [3, 2, 5], [1, 3, 20]], $this->line());
    }

    public function testDuplicateJoinCannotReplaceTheOriginalVisit(): void
    {
        $first = joinQueue($this->db, 1, 1);
        $before = $this->visits(1);

        $this->assertRejected(409, fn() => joinQueue($this->db, 1, 1));
        $this->assertRejected(409, fn() => joinQueue($this->db, 1, 2));

        self::assertSame($before, $this->visits(1));
        self::assertSame($first['entryId'], leaveQueue($this->db, 1)['entryId']);
    }

    public function testLeavingPreservesHistoryAndRepeatingLeaveIsHarmless(): void
    {
        $first = joinQueue($this->db, 1, 1);
        $left = leaveQueue($this->db, 1);

        self::assertTrue($left['left']);
        self::assertSame($first['entryId'], $left['entryId']);
        self::assertSame('left', $left['status']);
        self::assertNull($left['currentQueue']);
        self::assertSame([], $this->line());

        $history = $this->visits(1);
        self::assertCount(1, $history);
        self::assertSame('left', $history[0]['status']);
        self::assertNotNull($history[0]['completed_at']);
        self::assertSame(
            ['left' => false, 'entryId' => null, 'status' => null, 'currentQueue' => null],
            leaveQueue($this->db, 1)
        );
        self::assertSame($history, $this->visits(1));
    }

    public function testCanLeaveAClosedQueueAndRejoinWithANewEntry(): void
    {
        $first = joinQueue($this->db, 1, 1);
        $this->db->exec("UPDATE `Queue` SET status = 'closed' WHERE service_id = 1");
        $this->assertRejected(409, fn() => joinQueue($this->db, 2, 1));

        self::assertTrue(leaveQueue($this->db, 1)['left']);
        $next = joinQueue($this->db, 1, 2);
        self::assertNotSame($first['entryId'], $next['entryId']);
        self::assertSame(['left', 'waiting'], array_column($this->visits(1), 'status'));
        self::assertSame([], $this->visits(2));
    }

    public function testUnknownUsersAndServicesAreRejectedWithoutCreatingAVisit(): void
    {
        $this->assertRejected(401, fn() => joinQueue($this->db, 99, 1));
        $this->assertRejected(401, fn() => leaveQueue($this->db, 99));
        $this->assertRejected(404, fn() => joinQueue($this->db, 1, 99));
        self::assertSame([], $this->line());
    }

    public function testDatabaseRejectsZeroServiceDuration(): void
    {
        $this->expectException(PDOException::class);
        $this->expectExceptionMessage('chk_service_duration');

        $this->db->exec(
            'UPDATE Service SET expected_duration_minutes = 0 WHERE service_id = 1'
        );
    }

    public function testLeaveDoesNotRewriteAServedVisit(): void
    {
        $entry = joinQueue($this->db, 1, 1);
        $serve = $this->db->prepare(
            "UPDATE QueueEntry SET status = 'served', completed_at = CURRENT_TIMESTAMP
             WHERE entry_id = ?"
        );
        $serve->execute([$entry['entryId']]);
        $before = $this->visits(1);
        self::assertFalse(leaveQueue($this->db, 1)['left']);
        self::assertSame($before, $this->visits(1));
    }

    public function testJoinRollsBackIfTheQueueViewCannotBeRead(): void
    {
        // Simulate an incomplete migration in THIS test's throwaway database.
        $this->db->exec('DROP VIEW combined_waiting_line');
        try {
            joinQueue($this->db, 1, 1);
            self::fail('Expected MySQL to report the missing view.');
        } catch (PDOException $error) {
            self::assertSame('42S02', (string) $error->getCode());
        }
        self::assertFalse($this->db->inTransaction());
        self::assertSame([], $this->visits(1), 'A failed join must not strand a waiting visit.');
    }

    private function assertRejected(int $expectedCode, callable $attempt): void
    {
        try {
            $attempt();
            self::fail("Expected queue error $expectedCode.");
        } catch (QueueActionException $error) {
            self::assertSame($expectedCode, $error->getCode());
        }
        self::assertFalse($this->db->inTransaction(), 'The rejected action left a transaction open.');
    }

    private function visits(int $userId): array
    {
        $query = $this->fixture->observer()->prepare(
            'SELECT entry_id, queue_id, status, joined_at, completed_at FROM QueueEntry
             WHERE user_id = ? ORDER BY entry_id'
        );
        $query->execute([$userId]);
        return $query->fetchAll();
    }

    private function line(): array
    {
        $rows = $this->fixture->observer()->query(
            'SELECT user_id, `position`, wait_minutes FROM combined_waiting_line ORDER BY `position`'
        )->fetchAll(PDO::FETCH_NUM);
        return array_map(static fn(array $row): array => array_map('intval', $row), $rows);
    }

    #[\PHPUnit\Framework\Attributes\RunInSeparateProcess]
    #[\PHPUnit\Framework\Attributes\PreserveGlobalState(false)]
    public function testSharedConnectionUsesTheConfiguredDatabase(): void
    {
        $expectedName = $this->db->query('SELECT DATABASE()')->fetchColumn();

        // Use this test's temporary database and the same local MySQL credentials.
        putenv('QUEUESMART_DB_NAME=' . $expectedName);
        putenv('QUEUESMART_DB_HOST=127.0.0.1');
        putenv('QUEUESMART_DB_PORT=3306');
        putenv('QUEUESMART_DB_USER=' . (getenv('QUEUESMART_DB_USER') ?: 'root'));

        $appDb = require dirname(__DIR__, 2) . '/Backend/db.php';

        self::assertInstanceOf(PDO::class, $appDb);
        self::assertSame($expectedName, $appDb->query('SELECT DATABASE()')->fetchColumn());

        // A visit committed through one connection is visible through db.php.
        $joined = joinQueue($this->db, 1, 1);
        $current = getCurrentQueue($appDb, 1);
        self::assertSame($joined['entryId'], $current['entryId'] ?? null);
    }
}
