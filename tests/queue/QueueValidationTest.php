<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class QueueValidationTest extends TestCase
{
    public function testJoinRequiresALoggedInUser(): void
    {
        $db = $this->createStub(PDO::class);
        $this->expectException(QueueActionException::class);
        $this->expectExceptionCode(401);

        joinQueue($db, 0, 1);
    }

    public function testJoinRequiresAPositiveServiceId(): void
    {
        $db = $this->createStub(PDO::class);
        $this->expectException(QueueActionException::class);
        $this->expectExceptionCode(400);

        joinQueue($db, 1, 0);
    }

    public function testLeaveRequiresALoggedInUser(): void
    {
        $db = $this->createStub(PDO::class);
        $this->expectException(QueueActionException::class);
        $this->expectExceptionCode(401);

        leaveQueue($db, -1);
    }
}
