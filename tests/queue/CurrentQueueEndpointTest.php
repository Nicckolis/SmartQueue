<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../Backend/current-queue-request.php';
require_once __DIR__ . '/QueueDb.php';

final class CurrentQueueEndpointTest extends TestCase
{
    public static function invalidSessions(): array
    {
        return [
            'missing' => [null], 'zero' => [0], 'negative' => [-1],
            'email instead of database ID' => ['user@example.com'],
            'array' => [[1]], 'boolean' => [true], 'fraction' => [1.5]
        ];
    }

    #[DataProvider('invalidSessions')]
    public function testInvalidSessionNeverOpensDatabase(mixed $id): void
    {
        $result = handleCurrentQueueRequest('GET', static fn() => $id,
            static function (): PDO {
                self::fail('An invalid session must not open the database.');
            }
        );
        self::assertSame([401, ['error' => 'Please log in first.']], $result);
    }

    public function testWrongMethodDoesNotReadSessionOrDatabase(): void
    {
        $unused = static function () {
            self::fail('Wrong method must be rejected before session/database access.');
        };
        self::assertSame(
            [405, ['error' => 'Use GET to check your current queue.']],
            handleCurrentQueueRequest('POST', $unused, $unused)
        );
    }

    public function testDirectQueryRequiresPositiveUserId(): void
    {
        $db = $this->createMock(PDO::class);
        $db->expects(self::never())->method('prepare');
        $this->expectException(QueueActionException::class);
        $this->expectExceptionCode(401);
        getCurrentQueue($db, 0);
    }

    public function testSessionAndConnectionFailuresReturnGenericErrors(): void
    {
        $failure = static function () {
            throw new RuntimeException('private diagnostic detail');
        };
        $unused = static function (): PDO {
            self::fail('The database must not open when session access failed.');
        };
        $expected = [500, ['error' => 'Could not load your current queue right now.']];
        self::assertSame($expected, handleCurrentQueueRequest('GET', $failure, $unused));
        self::assertSame($expected, handleCurrentQueueRequest('GET', static fn() => 1, $failure));
    }

    public function testValidEmptyQueueIsDifferentFromUnknownUser(): void
    {
        $fixture = QueueDb::create();
        try {
            $connect = static fn() => $fixture->db;
            // A numeric-string session ID is accepted too.
            self::assertSame([200, ['currentQueue' => null]],
                handleCurrentQueueRequest('GET', static fn() => '1', $connect));
            self::assertSame([401, ['error' => 'Please log in first.']],
                handleCurrentQueueRequest('GET', static fn() => 99, $connect));
            self::assertSame(0, (int) $fixture->observer()->query(
                'SELECT COUNT(*) FROM QueueEntry')->fetchColumn());
        } finally {
            $fixture->drop();
        }
    }

    public function testReadsGlobalPriorityAndArrivalOrderWithoutChangingVisits(): void
    {
        $fixture = QueueDb::create();
        try {
            $db = $fixture->db;
            joinQueue($db, 1, 1); // Medium, five minutes.
            $fill = joinQueue($db, 2, 3); // Medium, fifteen minutes, later arrival.
            joinQueue($db, 3, 2); // High, ten minutes: goes first.
            $observer = $fixture->observer();
            $sql = 'SELECT * FROM QueueEntry ORDER BY entry_id';
            $before = $observer->query($sql)->fetchAll();

            $expected = [
                'entryId' => $fill['entryId'], 'queueId' => 13, 'userId' => 2,
                'serviceId' => 3, 'serviceName' => 'New Prescription Fill',
                'status' => 'waiting', 'position' => 3, 'waitMinutes' => 15
            ];
            self::assertSame([200, ['currentQueue' => $expected]],
                handleCurrentQueueRequest('GET', static fn() => 2, static fn() => $observer));
            self::assertSame(1, getCurrentQueue($observer, 3)['position']);
            self::assertSame(0, getCurrentQueue($observer, 3)['waitMinutes']);
            self::assertNull(getCurrentQueue($observer, 4));
            self::assertSame($before, $observer->query($sql)->fetchAll());

            leaveQueue($db, 3);
            self::assertNull(getCurrentQueue($observer, 3));
            self::assertSame(2, getCurrentQueue($observer, 2)['position']);
            self::assertSame(5, getCurrentQueue($observer, 2)['waitMinutes']);

            // Serving someone ahead is reflected on the next read.
            $db->exec("UPDATE QueueEntry SET status = 'served', completed_at = CURRENT_TIMESTAMP
                       WHERE user_id = 1 AND status = 'waiting'");
            self::assertNull(getCurrentQueue($observer, 1));
            self::assertSame(1, getCurrentQueue($observer, 2)['position']);
            self::assertSame(0, getCurrentQueue($observer, 2)['waitMinutes']);

            // Closing a queue stops new joins; it does not hide existing visits.
            $db->exec("UPDATE `Queue` SET status = 'closed' WHERE queue_id = 13");
            self::assertSame($fill['entryId'], getCurrentQueue($observer, 2)['entryId']);

            // A priority change is read from the database, not a saved snapshot.
            joinQueue($db, 4, 4); // Low priority initially.
            self::assertSame(1, getCurrentQueue($observer, 2)['position']);
            $db->exec("UPDATE Service SET priority = 'high' WHERE service_id = 4");
            self::assertSame(2, getCurrentQueue($observer, 2)['position']);
            self::assertSame(7, getCurrentQueue($observer, 2)['waitMinutes']);
        } finally {
            $fixture->drop();
        }
    }

    public static function completedStatuses(): array
    {
        return [['served'], ['left'], ['removed'], ['no_show']];
    }

    #[DataProvider('completedStatuses')]
    public function testCompletedVisitReturnsNullWithoutDeletingHistory(string $status): void
    {
        $fixture = QueueDb::create();
        try {
            joinQueue($fixture->db, 1, 1);
            $statement = $fixture->db->prepare(
                'UPDATE QueueEntry SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE user_id = 1');
            $statement->execute([$status]);
            self::assertNull(getCurrentQueue($fixture->observer(), 1));
            self::assertSame($status, $fixture->db->query(
                'SELECT status FROM QueueEntry WHERE user_id = 1')->fetchColumn());
        } finally {
            $fixture->drop();
        }
    }

    public function testUnreadableViewReturnsErrorWithoutLosingTheVisit(): void
    {
        $fixture = QueueDb::create();
        try {
            joinQueue($fixture->db, 1, 1);
            $before = $fixture->db->query('SELECT * FROM QueueEntry')->fetchAll();
            $fixture->db->exec('DROP VIEW combined_waiting_line');
            self::assertSame([500, ['error' => 'Could not load your current queue right now.']],
                handleCurrentQueueRequest('GET', static fn() => 1, static fn() => $fixture->db));
            self::assertSame($before, $fixture->db->query('SELECT * FROM QueueEntry')->fetchAll());
        } finally {
            $fixture->drop();
        }
    }
}
