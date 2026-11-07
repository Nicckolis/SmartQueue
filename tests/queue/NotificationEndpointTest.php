<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/Backend/notifications-request.php';
require_once __DIR__ . '/QueueDb.php';

final class NotificationEndpointTest extends TestCase
{
    public static function rejectedLists(): array
    {
        return [
            'client user id' => [['userId' => '2']],
            'unreadOnly must be 1' => [['unreadOnly' => 'true']],
            'extra parameter' => [['unreadOnly' => '1', 'userId' => '2']],
        ];
    }

    public static function rejectedMarks(): array
    {
        $json = 'application/json';
        return [
            'form body' => ['text/plain', '{"eventId":1}', 415],
            'invalid JSON' => [$json, '{', 400],
            'array body' => [$json, '[]', 400],
            'missing event id' => [$json, '{}', 400],
            'string event id' => [$json, '{"eventId":"1"}', 400],
            'zero event id' => [$json, '{"eventId":0}', 400],
            'client user id' => [$json, '{"eventId":1,"userId":2}', 400],
        ];
    }

    public function testWrongMethodsDoNotReadTheSessionOrDatabase(): void
    {
        $unused = static function () {
            self::fail('Wrong method must be rejected before session or database access.');
        };

        self::assertSame(
            [405, ['error' => 'Use GET to read your notifications.']],
            handleNotificationsRequest('POST', [], $unused, $unused)
        );
        self::assertSame(
            [405, ['error' => 'Use POST to mark a notification read.']],
            handleMarkNotificationReadRequest('GET', 'application/json', '{}', $unused, $unused)
        );
        self::assertSame(
            [405, ['error' => 'Use POST to mark all notifications read.']],
            handleMarkAllNotificationsReadRequest('GET', 'application/json', '{}', $unused, $unused)
        );
    }

    public function testInvalidSessionDoesNotOpenTheDatabase(): void
    {
        $opened = false;
        $open = static function () use (&$opened): PDO {
            $opened = true;
            throw new LogicException('Unexpected database access.');
        };

        foreach ([null, 0, 'nope', [1]] as $userId) {
            $read = static fn() => $userId;
            self::assertSame(
                [401, ['error' => 'Please log in first.']],
                handleNotificationsRequest('GET', [], $read, $open)
            );
            self::assertSame(
                [401, ['error' => 'Please log in first.']],
                handleMarkNotificationReadRequest('POST', 'application/json', '{"eventId":1}', $read, $open)
            );
            self::assertSame(
                [401, ['error' => 'Please log in first.']],
                handleMarkAllNotificationsReadRequest('POST', 'application/json', '{}', $read, $open)
            );
        }

        self::assertFalse($opened);
    }

    #[DataProvider('rejectedLists')]
    public function testBadListQueriesDoNotOpenTheDatabase(array $query): void
    {
        $opened = false;
        [$status] = handleNotificationsRequest('GET', $query, static fn() => 1, static function () use (&$opened): PDO {
            $opened = true;
            throw new LogicException('Unexpected database access.');
        });
        self::assertSame(400, $status);
        self::assertFalse($opened);
    }

    #[DataProvider('rejectedMarks')]
    public function testBadMarkRequestsDoNotOpenTheDatabase(string $type, string $body, int $expected): void
    {
        $opened = false;
        $open = static function () use (&$opened): PDO {
            $opened = true;
            throw new LogicException('Unexpected database access.');
        };
        $read = static fn() => 1;

        [$status] = handleMarkNotificationReadRequest('POST', $type, $body, $read, $open);
        self::assertSame($expected, $status);
        self::assertFalse($opened);

        // "{}" is a valid mark-all body, so only the single-notification cases reject it.
        if ($body !== '{}') {
            [$allStatus] = handleMarkAllNotificationsReadRequest('POST', $type, $body, $read, $open);
            self::assertContains($allStatus, [400, 415]);
            self::assertFalse($opened);
        }
    }

    public function testMarkAllRejectsAnythingExceptAnEmptyObject(): void
    {
        $opened = false;
        [$status, $body] = handleMarkAllNotificationsReadRequest(
            'POST',
            'application/json',
            '{"userId":1}',
            static fn() => 1,
            static function () use (&$opened): PDO {
                $opened = true;
                throw new LogicException('Unexpected database access.');
            }
        );

        self::assertSame(400, $status);
        self::assertSame('Send an empty JSON object: {}.', $body['error']);
        self::assertFalse($opened);
    }

    public function testListAndMarkStayWithTheSessionUser(): void
    {
        $fixture = QueueDb::create();
        try {
            joinQueue($fixture->db, 1, 1);
            joinQueue($fixture->db, 2, 1);
            $db = $fixture->db;
            $list = static fn(int $userId, array $query = []): array => handleNotificationsRequest(
                'GET', $query, static fn() => $userId, static fn() => $db
            );

            self::assertSame(
                [200, ['notifications' => getUserNotifications($db, 1)]],
                $list(1)
            );
            self::assertSame(
                [200, ['notifications' => getUserNotifications($db, 1, true)]],
                $list(1, ['unreadOnly' => '1'])
            );

            $mine = $list(1)[1]['notifications'];
            $theirs = $list(2)[1]['notifications'];
            self::assertNotSame([], $mine);
            self::assertNotContains($mine[0]['id'], array_column($theirs, 'id'));

            $markOther = handleMarkNotificationReadRequest(
                'POST', 'application/json', '{"eventId":' . $mine[0]['id'] . '}',
                static fn() => 2, static fn() => $db
            );
            self::assertSame(404, $markOther[0]);
            self::assertNull(getUserNotifications($db, 1)[0]['readAt']);

            $marked = handleMarkNotificationReadRequest(
                'POST', 'application/json; charset=utf-8',
                json_encode(['eventId' => $mine[0]['id']], JSON_THROW_ON_ERROR),
                static fn() => '1', static fn() => $db
            );
            self::assertSame(200, $marked[0]);
            self::assertTrue($marked[1]['notification']['read']);
            self::assertSame($mine[0]['id'], $marked[1]['notification']['id']);
            self::assertSame(
                count(getUserNotifications($db, 1)) - 1,
                count(getUserNotifications($db, 1, true))
            );

            $before = count(getUserNotifications($db, 2, true));
            $all = handleMarkAllNotificationsReadRequest(
                'POST', 'application/json', '{}', static fn() => 1, static fn() => $db
            );
            self::assertSame(200, $all[0]);
            self::assertSame(count(getUserNotifications($db, 1)) - 1, $all[1]['marked']);
            self::assertSame([], getUserNotifications($db, 1, true));
            self::assertSame(0, handleMarkAllNotificationsReadRequest(
                'POST', 'application/json', '{}', static fn() => 1, static fn() => $db
            )[1]['marked']);
            self::assertCount($before, getUserNotifications($db, 2, true));
            self::assertSame(404, handleMarkNotificationReadRequest(
                'POST', 'application/json', '{"eventId":9999}',
                static fn() => 1, static fn() => $db
            )[0]);
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

        self::assertSame(
            [500, ['error' => 'Could not load your notifications right now.']],
            handleNotificationsRequest('GET', [], $boom, $unused)
        );
        self::assertSame(
            [500, ['error' => 'Could not update that notification right now.']],
            handleMarkNotificationReadRequest('POST', 'application/json', '{"eventId":1}', static fn() => 1, $boom)
        );
        self::assertSame(
            [500, ['error' => 'Could not update your notifications right now.']],
            handleMarkAllNotificationsReadRequest('POST', 'application/json', '{}', static fn() => 1, $boom)
        );
    }
}
