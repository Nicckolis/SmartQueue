<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/Backend/queue-status-request.php';
require_once __DIR__ . '/QueueDb.php';

final class QueueStatusEndpointTest extends TestCase
{
    public function testWrongMethodDoesNotReadTheSessionOrDatabase(): void
    {
        $unused = static function () {
            self::fail('Wrong method must be rejected before session or database access.');
        };

        self::assertSame(
            [405, ['error' => 'Use GET to check your queue status.']],
            handleQueueStatusRequest('POST', [], $unused, $unused)
        );
    }

    public function testInvalidSessionOrQueryDoesNotOpenTheDatabase(): void
    {
        $opened = false;
        $open = static function () use (&$opened): PDO {
            $opened = true;
            throw new LogicException('Unexpected database access.');
        };

        foreach ([null, 0, 'user@example.com', [1], false] as $userId) {
            self::assertSame(
                [401, ['error' => 'Please log in first.']],
                handleQueueStatusRequest('GET', [], static fn() => $userId, $open)
            );
        }

        [$status, $body] = handleQueueStatusRequest(
            'GET',
            ['userId' => '1'],
            static fn() => 1,
            $open
        );
        self::assertSame(400, $status);
        self::assertSame('This request does not accept parameters.', $body['error']);
        self::assertFalse($opened);
    }

    public function testReturnsTheSessionUsersStatusAndNullWhenTheyHaveLeft(): void
    {
        $fixture = QueueDb::create();
        try {
            $read = static fn(int|string $userId): array => handleQueueStatusRequest(
                'GET',
                [],
                static fn() => $userId,
                static fn() => $fixture->db
            );

            self::assertSame([200, ['queueStatus' => null]], $read('1'));

            joinQueue($fixture->db, 1, 1);
            joinQueue($fixture->db, 2, 1);
            joinQueue($fixture->db, 3, 1);

            [$status, $body] = $read(3);
            self::assertSame(200, $status);
            self::assertSame(getUserQueueStatus($fixture->db, 3), $body['queueStatus']);
            self::assertSame('Prescription Pickup', $body['queueStatus']['serviceName']);
            self::assertSame('waiting', $body['queueStatus']['status']);
            self::assertSame(3, $body['queueStatus']['position']);
            self::assertSame(10, $body['queueStatus']['waitMinutes']);
            self::assertNull($read(4)[1]['queueStatus']);

            leaveQueue($fixture->db, 1);
            self::assertNull($read(1)[1]['queueStatus']);
            self::assertSame(2, $read(3)[1]['queueStatus']['position']);

            $served = joinQueue($fixture->db, 1, 3);
            $fixture->db->prepare(
                "UPDATE QueueEntry SET status = 'served', completed_at = CURRENT_TIMESTAMP WHERE entry_id = ?"
            )->execute([$served['entryId']]);

            $done = $read(1)[1]['queueStatus'];
            self::assertSame('served', $done['status']);
            self::assertSame('New Prescription Fill', $done['serviceName']);
            self::assertNull($done['position']);
            self::assertNull($done['waitMinutes']);
        } finally {
            $fixture->drop();
        }
    }

    public function testFailuresStayGeneric(): void
    {
        $boom = static function (): never {
            throw new RuntimeException('secret database host');
        };
        $expected = [500, ['error' => 'Could not load your queue status right now.']];

        self::assertSame($expected, handleQueueStatusRequest('GET', [], $boom, static function (): PDO {
            self::fail('The database must not open when the session cannot be read.');
        }));
        self::assertSame($expected, handleQueueStatusRequest('GET', [], static fn() => 1, $boom));
    }
}
