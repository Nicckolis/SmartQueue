<?php
declare(strict_types=1);

require_once __DIR__ . '/QueueDatabaseTestCase.php';

final class QueueStatusActionsDatabaseTest extends QueueDatabaseTestCase
{
    public function testUserWithNoVisitsHasNoStatus(): void
    {
        self::assertNull(getUserQueueStatus($this->db, 1));
    }

    public function testWaitingAndAlmostReadyComeFromTheSharedLine(): void
    {
        foreach ([1, 2, 3] as $user) {
            joinQueue($this->db, $user, 1); // 5 minutes each
        }

        $third = getUserQueueStatus($this->db, 3);
        self::assertSame('waiting', $third['status']);
        self::assertSame(3, $third['position']);
        self::assertSame(2, $third['peopleAhead']);
        self::assertSame(10, $third['waitMinutes']);
        self::assertSame('Prescription Pickup', $third['serviceName']);
        self::assertSame(1, $third['serviceId']);
        self::assertSame(QUEUE_STATUS_NOTES['waiting'], $third['note']);

        $second = getUserQueueStatus($this->db, 2);
        self::assertSame('almost_ready', $second['status']);
        self::assertSame(1, $second['peopleAhead']);
        self::assertSame(QUEUE_STATUS_NOTES['almost_ready'], $second['note']);
    }

    public function testPriorityAcrossServicesChangesPositionAndWait(): void
    {
        joinQueue($this->db, 1, 1);
        joinQueue($this->db, 2, 2); // high priority, 10 minutes

        $first = getUserQueueStatus($this->db, 1);
        self::assertSame(2, $first['position']);
        self::assertSame(10, $first['waitMinutes']);
        self::assertSame(1, getUserQueueStatus($this->db, 2)['position']);
    }

    public function testStatusUpdatesAfterSomeoneLeaves(): void
    {
        foreach ([1, 2, 3] as $user) {
            joinQueue($this->db, $user, 1);
        }
        self::assertSame(3, getUserQueueStatus($this->db, 3)['position']);

        leaveQueue($this->db, 1);

        $third = getUserQueueStatus($this->db, 3);
        self::assertSame(2, $third['position']);
        self::assertSame(5, $third['waitMinutes']);
        self::assertSame('almost_ready', $third['status']);
    }

    public function testServedVisitShowsServedUntilTheUserJoinsAgain(): void
    {
        $entry = joinQueue($this->db, 1, 3)['entryId'];
        $this->finishVisit($entry, 'served');

        $status = getUserQueueStatus($this->db, 1);
        self::assertSame('served', $status['status']);
        self::assertSame('New Prescription Fill', $status['serviceName']);
        self::assertNull($status['entryId']);
        self::assertNull($status['position']);
        self::assertNull($status['waitMinutes']);
        self::assertSame(QUEUE_STATUS_NOTES['served'], $status['note']);

        joinQueue($this->db, 1, 1);
        self::assertSame('almost_ready', getUserQueueStatus($this->db, 1)['status']);
    }

    public function testCancelledOrRemovedLatestVisitHasNoStatus(): void
    {
        joinQueue($this->db, 1, 1);
        leaveQueue($this->db, 1);
        self::assertNull(getUserQueueStatus($this->db, 1));

        $entry = joinQueue($this->db, 2, 1)['entryId'];
        $this->finishVisit($entry, 'removed');
        self::assertNull(getUserQueueStatus($this->db, 2));
    }

    public function testMovementNotificationsOnlyGoToUsersWhoMoved(): void
    {
        foreach ([1, 2, 3, 4] as $user) {
            joinQueue($this->db, $user, 1);
        }

        // Nothing changed since the snapshot: nobody is notified.
        self::assertSame(
            [], notifyQueueMovement($this->db, snapshotWaitingPositions($this->db))
        );

        // Serve the front user, then tell everyone who moved.
        $before = snapshotWaitingPositions($this->db);
        $front = $this->db->query(
            "SELECT entry_id FROM combined_waiting_line WHERE `position` = 1"
        )->fetchColumn();
        $this->finishVisit((int) $front, 'served');
        $created = notifyQueueMovement($this->db, $before);

        // Users 3 and 4 moved into 2 and 3. User 2 was already almost ready.
        self::assertSame(
            ['almost_ready', 'position_update'], array_column($created, 'type')
        );
    }
}
