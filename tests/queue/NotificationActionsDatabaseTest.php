<?php
declare(strict_types=1);

require_once __DIR__ . '/QueueDatabaseTestCase.php';

final class NotificationActionsDatabaseTest extends QueueDatabaseTestCase
{
    public function testJoiningStoresJoinedAndAlmostReadyForAFrontPosition(): void
    {
        joinQueue($this->db, 1, 1);

        $notes = getUserNotifications($this->db, 1);
        self::assertSame(['almost_ready', 'joined'], array_column($notes, 'type'));
        self::assertMatchesRegularExpression(
            '/Prescription Pickup.*Position: 1.*0 minutes/', $notes[1]['message']
        );
        self::assertFalse($notes[0]['read']);
        self::assertNull($notes[0]['readAt']);
    }

    public function testLeavingNotifiesTheLeaverAndMovesOthersUp(): void
    {
        // Four people, one service: positions 1, 2, 3, 4.
        foreach ([1, 2, 3, 4] as $user) {
            joinQueue($this->db, $user, 1);
        }
        self::assertSame(['joined'], $this->types(4)); // position 4 is not close yet

        leaveQueue($this->db, 1);

        self::assertSame(['left', 'almost_ready', 'joined'], $this->types(1));
        // User 2 was already almost ready when joining: no duplicate alert.
        self::assertSame(['almost_ready', 'joined'], $this->types(2));
        // User 3 moved from 3 to 2 and is now almost ready.
        self::assertSame(['almost_ready', 'joined'], $this->types(3));
        // User 4 moved from 4 to 3: a plain position update.
        $four = getUserNotifications($this->db, 4);
        self::assertSame(['position_update', 'joined'], array_column($four, 'type'));
        self::assertMatchesRegularExpression('/now 3.*10 minutes/', $four[0]['message']);
    }

    public function testAHighPriorityJoinPushesOthersBackAcrossServices(): void
    {
        joinQueue($this->db, 1, 1);
        joinQueue($this->db, 2, 1);
        joinQueue($this->db, 3, 1); // position 3: joined only
        joinQueue($this->db, 4, 2); // high priority goes to the front

        $three = getUserNotifications($this->db, 3);
        self::assertSame(['position_update', 'joined'], array_column($three, 'type'));
        self::assertMatchesRegularExpression('/now 4/', $three[0]['message']);
    }

    public function testRejoiningStartsAFreshAlmostReadyAlert(): void
    {
        joinQueue($this->db, 1, 1);
        leaveQueue($this->db, 1);
        joinQueue($this->db, 1, 1);

        self::assertSame(
            ['almost_ready', 'joined', 'left', 'almost_ready', 'joined'],
            $this->types(1)
        );
    }

    public function testNotificationsAreOnlyVisibleToTheirOwner(): void
    {
        joinQueue($this->db, 1, 1);
        joinQueue($this->db, 2, 1);

        foreach (getUserNotifications($this->db, 1) as $note) {
            self::assertStringNotContainsString('Position: 2', $note['message']);
        }
        self::assertSame([], getUserNotifications($this->db, 3));
    }

    public function testMarkingReadKeepsTheFirstReadTime(): void
    {
        $entry = joinQueue($this->db, 1, 1);
        $notes = getUserNotifications($this->db, 1);

        $first = markNotificationRead($this->db, 1, $notes[0]['id']);
        self::assertTrue($first['read']);
        self::assertNotNull($first['readAt']);
        self::assertCount(1, getUserNotifications($this->db, 1, true));
        self::assertCount(2, getUserNotifications($this->db, 1));

        // Pretend it was read long ago, then mark it again.
        $this->db->prepare(
            "UPDATE NotificationHistory
             SET created_at = '2020-01-01 00:00:00', read_at = '2020-01-02 00:00:00'
             WHERE event_id = ?"
        )->execute([$notes[0]['id']]);
        $again = markNotificationRead($this->db, 1, $notes[0]['id']);
        self::assertSame('2020-01-02 00:00:00', $again['readAt']);
        self::assertSame($entry['entryId'], $again['entryId']);
    }

    public function testMarkReadRejectsUnknownAndOtherUsersNotifications(): void
    {
        joinQueue($this->db, 1, 1);
        $note = getUserNotifications($this->db, 1)[0];

        $this->assertRejected(404, fn() => markNotificationRead($this->db, 2, $note['id']));
        $this->assertRejected(404, fn() => markNotificationRead($this->db, 1, 9999));
        self::assertNull(getUserNotifications($this->db, 1)[0]['readAt']);
    }

    public function testMarkAllReadReturnsHowManyChanged(): void
    {
        joinQueue($this->db, 1, 1);
        joinQueue($this->db, 2, 1);

        self::assertSame(2, markAllNotificationsRead($this->db, 1));
        self::assertSame(0, markAllNotificationsRead($this->db, 1));
        self::assertSame([], getUserNotifications($this->db, 1, true));
        // User 2's notifications are untouched.
        self::assertCount(2, getUserNotifications($this->db, 2, true));
    }

    public function testEveryTriggerStoresItsOwnType(): void
    {
        $entry = joinQueue($this->db, 1, 1)['entryId'];

        self::assertSame('served', notifyServed($this->db, $entry, 'Advising')['type']);
        self::assertSame('left', notifyLeft($this->db, $entry, 'Advising')['type']);
        self::assertMatchesRegularExpression(
            '/administrator/', notifyRemoved($this->db, $entry, 'Advising')['message']
        );
        $noShow = notifyNoShow($this->db, $entry, 'Advising');
        self::assertSame('no_show', $noShow['type']);
        self::assertMatchesRegularExpression('/no-show.*Advising/', $noShow['message']);
    }

    public function testMessageLengthLimitAndUnknownEntry(): void
    {
        $entry = joinQueue($this->db, 1, 1)['entryId'];

        $long = addNotification($this->db, $entry, 'joined', str_repeat('x', 1000));
        self::assertSame(1000, strlen($long['message']));

        $this->assertRejected(404, fn() => addNotification($this->db, 9999, 'joined', 'hi'));
    }

    public function testTheDatabaseRejectsBadRowsEvenWhenCalledDirectly(): void
    {
        $entry = joinQueue($this->db, 1, 1)['entryId'];
        $insert = $this->db->prepare(
            'INSERT INTO NotificationHistory (entry_id, event_type, message) VALUES (?, ?, ?)'
        );

        foreach ([
            [$entry, 'joined', '   '],              // blank message
            [$entry, 'joined', str_repeat('x', 1001)], // too long
            [$entry, 'not_a_type', 'hello'],        // not in the ENUM
            [9999, 'joined', 'hello'],              // no such QueueEntry
        ] as $badRow) {
            try {
                $insert->execute($badRow);
                self::fail('The database accepted an invalid notification.');
            } catch (PDOException $error) {
                self::assertNotSame('', $error->getMessage());
            }
        }
    }

    public function testAFailedJoinLeavesNoNotificationsBehind(): void
    {
        joinQueue($this->db, 1, 1);
        $before = count(getUserNotifications($this->db, 1));

        $this->assertRejected(409, fn() => joinQueue($this->db, 1, 2)); // already waiting

        self::assertCount($before, getUserNotifications($this->db, 1));
    }
}
