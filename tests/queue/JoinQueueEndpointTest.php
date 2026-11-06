<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/Backend/join-queue-request.php';
require_once __DIR__ . '/QueueDb.php';

final class JoinQueueEndpointTest extends TestCase
{
    public static function invalidRequests(): array
    {
        return [
            'GET is not allowed'            => ['GET', 'application/json', '{}', 1, 405],
            'no session'                    => ['POST', 'application/json', '{"serviceId":1}', null, 401],
            'non-numeric session ID'        => ['POST', 'application/json', '{"serviceId":1}', '1x', 401],
            'form content is not JSON'      => ['POST', 'text/plain', '{"serviceId":1}', 1, 415],
            'malformed JSON'                => ['POST', 'application/json', '{', 1, 400],
            'missing service ID'            => ['POST', 'application/json', '{}', 1, 400],
            'an array is not an object'     => ['POST', 'application/json', '[1]', 1, 400],
            'zero service ID'               => ['POST', 'application/json', '{"serviceId":0}', 1, 400],
            'service ID is a string'        => ['POST', 'application/json', '{"serviceId":"1"}', 1, 400],
            'fractional service ID'         => ['POST', 'application/json', '{"serviceId":1.5}', 1, 400],
            'user ID supplied by the client'=> ['POST', 'application/json', '{"serviceId":1,"userId":2}', 1, 400]
        ];
    }

    #[DataProvider('invalidRequests')]
    public function testRejectsInvalidRequestsBeforeOpeningMysql(
        string $method, string $type, string $body, mixed $sessionId, int $expected
    ): void {
        $opened = false;
        [$status, $reply] = handleJoinQueueRequest(
            $method, $type, $body, static fn() => $sessionId,
            static function () use (&$opened): PDO {
                $opened = true;
                throw new LogicException('Invalid requests should not open MySQL.');
            }
        );
        self::assertSame($expected, $status);
        self::assertArrayHasKey('error', $reply);
        self::assertFalse($opened);
    }

    public function testUsesSessionIdentityAndCommitsTheVisit(): void
    {
        $fixture = QueueDb::create();
        try {
            // Login code may have stored a numeric ID as a string.
            $post = static fn(int $serviceId): array => handleJoinQueueRequest(
                'POST', 'application/json; charset=utf-8',
                json_encode(['serviceId' => $serviceId], JSON_THROW_ON_ERROR),
                static fn() => '1', static fn() => $fixture->db
            );

            [$status, $reply] = $post(1);
            self::assertSame(201, $status);
            $queue = $reply['currentQueue'];
            self::assertSame(1, $queue['userId']);
            self::assertSame(1, $queue['serviceId']);
            self::assertSame('Prescription Pickup', $queue['serviceName']);
            self::assertSame('waiting', $queue['status']);
            self::assertSame(1, $queue['position']);
            self::assertSame(0, $queue['waitMinutes']);

            self::assertSame(409, $post(2)[0], 'A second join must be a conflict.');
            $rows = $fixture->observer()->query(
                "SELECT entry_id, user_id FROM QueueEntry WHERE status = 'waiting'"
            )->fetchAll();
            self::assertCount(1, $rows);
            self::assertSame($queue['entryId'], (int) $rows[0]['entry_id']);
            self::assertSame(1, (int) $rows[0]['user_id']);
        } finally {
            $fixture->drop();
        }
    }

    public function testReturns404ForAnUnknownServiceAnd409ForAClosedQueue(): void
    {
        $fixture = QueueDb::create();
        try {
            $post = static fn(string $json): array => handleJoinQueueRequest(
                'POST', 'application/json', $json, static fn() => 1, static fn() => $fixture->db
            );
            self::assertSame(404, $post('{"serviceId":90}')[0]);
            $fixture->db->exec("UPDATE `Queue` SET status = 'closed' WHERE service_id = 1");
            self::assertSame(409, $post('{"serviceId":1}')[0]);
            self::assertSame(0, (int) $fixture->observer()->query('SELECT COUNT(*) FROM QueueEntry')->fetchColumn());
        } finally {
            $fixture->drop();
        }
    }

    public function testInternalErrorsHaveAGenericResponse(): void
    {
        // A missing db.php or an unavailable DB should not return a stack trace.
        $reply = handleJoinQueueRequest(
            'POST', 'application/json', '{"serviceId":1}', static fn() => 1,
            static function (): PDO { throw new RuntimeException('Simulated connection failure.'); }
        );
        self::assertSame([500, ['error' => 'Could not join the queue right now.']], $reply);
    }
}
