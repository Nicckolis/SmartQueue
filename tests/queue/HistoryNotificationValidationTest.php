<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

// Input checks that never reach the database, so no MySQL server is needed.
final class HistoryNotificationValidationTest extends TestCase
{
    private function assertCode(int $code, callable $attempt): void
    {
        try {
            $attempt();
            self::fail("Expected queue error $code.");
        } catch (QueueActionException $error) {
            self::assertSame($code, $error->getCode());
        }
    }

    public function testEveryReadRequiresALoggedInUser(): void
    {
        $db = $this->createStub(PDO::class);

        $this->assertCode(401, fn() => getUserHistory($db, 0));
        $this->assertCode(401, fn() => getUserNotifications($db, -1));
        $this->assertCode(401, fn() => markNotificationRead($db, 0, 1));
        $this->assertCode(401, fn() => markAllNotificationsRead($db, 0));
        $this->assertCode(401, fn() => getUserQueueStatus($db, 0));
    }

    public function testHistoryFiltersAreValidated(): void
    {
        $db = $this->createStub(PDO::class);

        // "cancelled" is only a History page label. The stored status is "left".
        $this->assertCode(400, fn() => getUserHistory($db, 1, 'cancelled'));
        $this->assertCode(400, fn() => getUserHistory($db, 1, null, '   '));
        $this->assertCode(400, fn() => getUserHistory($db, 1, null, str_repeat('x', 101)));
        $this->assertCode(400, fn() => getUserHistory($db, 1, null, null, 0));
    }

    public function testNotificationInputsAreValidated(): void
    {
        $db = $this->createStub(PDO::class);

        $this->assertCode(400, fn() => addNotification($db, 0, 'joined', 'x'));
        $this->assertCode(400, fn() => addNotification($db, 1, 'nope', 'x'));
        $this->assertCode(400, fn() => addNotification($db, 1, 'joined', '   '));
        $this->assertCode(400, fn() => addNotification($db, 1, 'joined', str_repeat('x', 1001)));
        $this->assertCode(400, fn() => markNotificationRead($db, 1, 0));
    }

    public function testStatusForPosition(): void
    {
        self::assertSame('almost_ready', queueStatusForPosition(1));
        self::assertSame('almost_ready', queueStatusForPosition(ALMOST_READY_THRESHOLD));
        self::assertSame('waiting', queueStatusForPosition(ALMOST_READY_THRESHOLD + 1));
        self::assertSame('served', queueStatusForPosition(0));
        self::assertSame('served', queueStatusForPosition(5, true));
        $this->assertCode(400, fn() => queueStatusForPosition(-1));
    }
}
