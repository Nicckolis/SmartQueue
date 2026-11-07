<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/Backend/history-request.php';
require_once __DIR__ . '/QueueDb.php';

final class HistoryEndpointTest extends TestCase
{
    public static function rejectedQueries(): array
    {
        return [
            'client user id' => [['userId' => '2']],
            'unknown parameter' => [['foo' => '1']],
            'cancelled is not a stored status' => [['outcome' => 'cancelled']],
            'unknown outcome' => [['outcome' => 'bogus']],
            'blank service name' => [['serviceName' => '   ']],
            'service name is too long' => [['serviceName' => str_repeat('x', 101)]],
            'limit zero' => [['limit' => '0']],
            'limit is not an integer' => [['limit' => '1.5']],
            'limit is text' => [['limit' => 'many']],
            'array value' => [['outcome' => ['left']]],
        ];
    }

    public function testWrongMethodDoesNotReadTheSessionOrDatabase(): void
    {
        $unused = static function () {
            self::fail('Wrong method must be rejected before session or database access.');
        };

        self::assertSame(
            [405, ['error' => 'Use GET to view your history.']],
            handleHistoryRequest('POST', [], $unused, $unused)
        );
    }

    public function testInvalidSessionDoesNotOpenTheDatabase(): void
    {
        $opened = false;
        $open = static function () use (&$opened): PDO {
            $opened = true;
            throw new LogicException('Unexpected database access.');
        };

        foreach ([null, 0, -1, '1x', 1.5, true, [1]] as $userId) {
            [$status, $body] = handleHistoryRequest('GET', [], static fn() => $userId, $open);
            self::assertSame(401, $status);
            self::assertSame('Please log in first.', $body['error']);
        }

        self::assertFalse($opened);
    }

    #[DataProvider('rejectedQueries')]
    public function testBadFiltersDoNotOpenTheDatabase(array $query): void
    {
        $opened = false;
        [$status, $body] = handleHistoryRequest(
            'GET',
            $query,
            static fn() => 1,
            static function () use (&$opened): PDO {
                $opened = true;
                throw new LogicException('Unexpected database access.');
            }
        );

        self::assertSame(400, $status);
        self::assertArrayHasKey('error', $body);
        self::assertFalse($opened);
    }

    public function testSessionUserSeesOnlyTheirOwnHistory(): void
    {
        $fixture = QueueDb::create();
        try {
            joinQueue($fixture->db, 1, 1);
            leaveQueue($fixture->db, 1);
            joinQueue($fixture->db, 1, 2);
            joinQueue($fixture->db, 2, 1);

            $asUser = static fn(int|string $userId, array $query = []): array => handleHistoryRequest(
                'GET',
                $query,
                static fn() => $userId,
                static fn() => $fixture->db
            );

            self::assertSame(
                [200, ['history' => getUserHistory($fixture->db, 1)]],
                $asUser('1')
            );
            self::assertSame(
                ['waiting', 'left'],
                array_column($asUser(1)[1]['history'], 'outcome')
            );
            self::assertSame(
                [200, ['history' => getUserHistory($fixture->db, 1, 'left', 'Prescription Pickup')]],
                $asUser(1, ['outcome' => 'left', 'serviceName' => 'Prescription Pickup'])
            );
            self::assertSame(
                [200, ['history' => getUserHistory($fixture->db, 1, null, null, 1)]],
                $asUser(1, ['limit' => '1'])
            );
            self::assertSame([], $asUser(1, ['serviceName' => "x' OR '1'='1"])[1]['history']);

            $other = $asUser(2)[1]['history'];
            self::assertCount(1, $other);
            self::assertSame(2, (int) $fixture->db->query(
                'SELECT user_id FROM QueueEntry WHERE entry_id = ' . (int) $other[0]['entryId']
            )->fetchColumn());
            self::assertSame([], $asUser(3)[1]['history']);
        } finally {
            $fixture->drop();
        }
    }

    public function testFailuresStayGeneric(): void
    {
        $boom = static function (): never {
            throw new RuntimeException('secret database host');
        };
        $unused = static function (): PDO {
            self::fail('The database must not open when the session cannot be read.');
        };
        $expected = [500, ['error' => 'Could not load your history right now.']];

        self::assertSame($expected, handleHistoryRequest('GET', [], $boom, $unused));
        self::assertSame($expected, handleHistoryRequest('GET', [], static fn() => 1, $boom));
    }
}
