<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/Backend/leave-queue-request.php';
require_once __DIR__ . '/QueueDb.php';

final class LeaveQueueEndpointTest extends TestCase
{
    public static function rejectedRequests(): array
    {
        return [
            'GET cannot change a visit' => ['GET', 'application/json', '{}', 1, 405],
            'no signed-in user' => ['POST', 'application/json', '{}', null, 401],
            'invalid session identity' => ['POST', 'application/json', '{}', '1x', 401],
            'form post is not JSON' => ['POST', 'application/x-www-form-urlencoded', '', 1, 415],
            'invalid JSON' => ['POST', 'application/json', '{', 1, 400],
            'an array is not an object' => ['POST', 'application/json', '[]', 1, 400],
            'body cannot choose another user' => ['POST', 'application/json', '{"userId":2}', 1, 400],
            'body cannot target an entry' => ['POST', 'application/json', '{"entryId":7}', 1, 400]
        ];
    }

    #[DataProvider('rejectedRequests')]
    public function testRejectsInvalidRequestsBeforeOpeningTheDatabase(
        string $method, string $type, string $body, mixed $userId, int $expected
    ): void {
        $opened = false;
        [$status, $reply] = handleLeaveQueueRequest(
            $method, $type, $body, static fn() => $userId,
            static function () use (&$opened): PDO {
                $opened = true;
                throw new LogicException('Unexpected database access.');
            }
        );
        self::assertSame($expected, $status);
        self::assertArrayHasKey('error', $reply);
        self::assertFalse($opened);
    }

    public function testOnlyCancelsTheSessionUsersVisitAndRepeatLeaveChangesNothing(): void
    {
        $fixture = QueueDb::create();
        try {
            $mine = joinQueue($fixture->db, 1, 1);
            $other = joinQueue($fixture->db, 2, 1);
            $observer = $fixture->observer();
            $query = 'SELECT entry_id, user_id, status, completed_at FROM QueueEntry ORDER BY user_id';
            $before = $observer->query($query)->fetchAll();
            // Closing the queue must not trap people who are already waiting.
            $fixture->db->exec("UPDATE `Queue` SET status = 'closed' WHERE service_id = 1");
            $request = static fn(string $body): array => handleLeaveQueueRequest(
                'POST', 'application/json; charset=utf-8', $body,
                static fn() => '1', static fn() => $fixture->db
            );

            self::assertSame(400, $request('{"userId":2}')[0]);
            self::assertSame($before, $observer->query($query)->fetchAll());

            [$status, $result] = $request('{}');
            self::assertSame(200, $status);
            self::assertTrue($result['left']);
            self::assertSame($mine['entryId'], $result['entryId']);
            self::assertSame('left', $result['status']);
            self::assertNull($result['currentQueue']);

            $after = $observer->query($query)->fetchAll();
            self::assertCount(2, $after);
            self::assertSame($mine['entryId'], (int) $after[0]['entry_id']);
            self::assertSame('left', $after[0]['status']);
            self::assertNotNull($after[0]['completed_at']);
            self::assertSame($before[1], $after[1], "Another user's visit changed.");
            $line = $observer->query('SELECT entry_id, `position`, wait_minutes FROM combined_waiting_line')->fetchAll();
            self::assertCount(1, $line);
            self::assertSame($other['entryId'], (int) $line[0]['entry_id']);
            self::assertSame(1, (int) $line[0]['position']);
            self::assertSame(0, (int) $line[0]['wait_minutes']);

            [$status, $again] = $request('{}');
            self::assertSame(200, $status);
            self::assertFalse($again['left']);
            self::assertNull($again['entryId']);
            self::assertNull($again['status']);
            self::assertNull($again['currentQueue']);
            self::assertSame($after, $observer->query($query)->fetchAll());
        } finally {
            $fixture->drop();
        }
    }

    public function testSessionForMissingAccountReturns401(): void
    {
        $fixture = QueueDb::create();
        try {
            [$status] = handleLeaveQueueRequest('POST', 'application/json', '{}',
                static fn() => 99, static fn() => $fixture->db);
            self::assertSame(401, $status);
        } finally {
            $fixture->drop();
        }
    }

    public function testDatabaseFailureReturnsAGenericMessage(): void
    {
        $result = handleLeaveQueueRequest('POST', 'application/json', '{}', static fn() => 1,
            static function (): PDO { throw new RuntimeException('Simulated connection failure.'); });
        self::assertSame([500, ['error' => 'Could not leave the queue right now.']], $result);
    }
}
