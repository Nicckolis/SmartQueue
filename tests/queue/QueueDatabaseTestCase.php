<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/QueueDb.php';

// Shared setup for the history, notification and queue-status tests.
// Each test gets its own throwaway database (see QueueDb) with parents.sql:
// users 1-4 and services 1-4 (queue ID = 10 + service ID).
//   service 1 Prescription Pickup  medium  5 min
//   service 2 Consultation         high   10 min
//   service 3 New Prescription Fill medium 15 min
//   service 4 Routine Review       low     7 min
abstract class QueueDatabaseTestCase extends TestCase
{
    private ?QueueDb $fixture = null;
    protected PDO $db;

    protected function setUp(): void
    {
        $this->fixture = QueueDb::create();
        $this->db = $this->fixture->db;
    }

    protected function tearDown(): void
    {
        if ($this->fixture !== null) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            $this->fixture->drop();
        }
    }

    // Ends a user's waiting visit directly in SQL, like an admin action would.
    protected function finishVisit(int $entryId, string $status): void
    {
        $statement = $this->db->prepare(
            'UPDATE QueueEntry SET status = ?, completed_at = CURRENT_TIMESTAMP
             WHERE entry_id = ?'
        );
        $statement->execute([$status, $entryId]);
    }

    protected function assertRejected(int $expectedCode, callable $attempt): void
    {
        try {
            $attempt();
            self::fail("Expected queue error $expectedCode.");
        } catch (QueueActionException $error) {
            self::assertSame($expectedCode, $error->getCode());
        }
        self::assertFalse($this->db->inTransaction(), 'The rejected action left a transaction open.');
    }

    // Notification types for one user, newest first.
    protected function types(int $userId): array
    {
        return array_column(getUserNotifications($this->db, $userId), 'type');
    }
}
