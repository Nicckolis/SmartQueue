<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/ServiceDb.php';
require_once __DIR__ . '/../../Backend/service-actions.php';
require_once __DIR__ . '/../../Backend/queue-actions.php';

final class ServiceDatabaseTest extends TestCase
{
    private ?ServiceDb $fixture = null;
    private PDO $db;

    protected function setUp(): void
    {
        $this->fixture = ServiceDb::create();
        $this->db = $this->fixture->db;
    }

    protected function tearDown(): void
    {
        if ($this->fixture !== null) {
            if ($this->db->inTransaction()) { $this->db->rollBack(); }
            $this->fixture->drop();
        }
    }

    private function input(): array
    {
        return ['name' => " Pharmacist's Consultation ", 'description' => ' Discuss medication. ',
            'expectedDuration' => 15, 'priority' => 'medium'];
    }

    public function testCreateCommitsServiceAndQueueAndListsThem(): void
    {
        self::assertSame([], listServices($this->db, fn() => true));
        $service = createService($this->db, fn() => true, $this->input());
        self::assertGreaterThan(0, $service['id']);
        self::assertGreaterThan(0, $service['queueId']);
        self::assertSame("Pharmacist's Consultation", $service['name']);
        self::assertTrue($service['isOpen']);
        self::assertSame([$service], listServices($this->fixture->observer(), fn() => true));
    }

    public function testUpdatePreservesIdentityClosedQueueAndWaitingVisit(): void
    {
        $service = createService($this->db, fn() => true, $this->input());
        $visit = joinQueue($this->db, 1, $service['id']);
        $this->db->exec("UPDATE `Queue` SET status = 'closed'");
        $changed = array_replace($this->input(), ['name' => 'Changed', 'priority' => 'high',
            'expectedDuration' => 25, 'id' => 999, 'isOpen' => true]);
        $result = updateService($this->db, fn() => true, $service['id'], $changed);
        self::assertSame($service['id'], $result['id']);
        self::assertSame($service['queueId'], $result['queueId']);
        self::assertFalse($result['isOpen']);
        self::assertSame(25, $result['expectedDuration']);
        self::assertSame('high', $result['priority']);
        self::assertSame($visit['entryId'], (int) $this->db->query('SELECT entry_id FROM QueueEntry')->fetchColumn());
        self::assertSame([$result], listServices($this->fixture->observer(), fn() => true));
        self::assertSame($result, updateService($this->db, fn() => true, $service['id'], $changed));
    }

    public function testUnknownServiceReturns404AndClosesTransaction(): void
    {
        try {
            updateService($this->db, fn() => true, 999, $this->input());
            self::fail('Expected missing service.');
        } catch (ServiceActionException $error) {
            self::assertSame(404, $error->getCode());
        }
        self::assertFalse($this->db->inTransaction());
    }

    public function testInvalidUpdateLeavesSavedDataUnchanged(): void
    {
        $before = createService($this->db, fn() => true, $this->input());
        try {
            updateService($this->db, fn() => true, $before['id'], ['name' => 'Incomplete']);
            self::fail('Expected validation failure.');
        } catch (ServiceActionException $error) { self::assertSame(400, $error->getCode()); }
        self::assertSame([$before], listServices($this->db, fn() => true));
    }

    public function testFailedQueueInsertRollsBackService(): void
    {
        // A test trigger forces the second write to fail
        $this->db->exec("CREATE TRIGGER reject_queue BEFORE INSERT ON `Queue`
            FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Test failure'");
        try {
            createService($this->db, fn() => true, $this->input());
            self::fail('Expected failed queue insert.');
        } catch (PDOException $error) { self::assertSame('45000', $error->getCode()); }
        self::assertFalse($this->db->inTransaction());
        self::assertSame(0, (int) $this->fixture->observer()->query('SELECT COUNT(*) FROM Service')->fetchColumn());
    }

    public function testMissingQueueRollsBackUpdate(): void
    {
        $service = createService($this->db, fn() => true, $this->input());
        $this->db->exec('DELETE FROM `Queue`');
        try {
            updateService($this->db, fn() => true, $service['id'], array_replace($this->input(), ['name' => 'Wrong']));
            self::fail('Expected missing queue error.');
        } catch (RuntimeException $error) {
            self::assertSame('The service must have an open or closed queue.', $error->getMessage());
        }
        self::assertSame($service['name'], $this->fixture->observer()->query('SELECT name FROM Service')->fetchColumn());
    }

    public function testPriorityAndDurationUpdatesAffectTeammatesCombinedLine(): void
    {
        $first = createService($this->db, fn() => true, $this->input());
        $second = createService($this->db, fn() => true, $this->input());
        joinQueue($this->db, 1, $first['id']);
        joinQueue($this->db, 2, $second['id']);
        updateService($this->db, fn() => true, $second['id'], array_replace($this->input(),
            ['priority' => 'high', 'expectedDuration' => 7]));
        $line = $this->db->query('SELECT user_id, wait_minutes FROM combined_waiting_line ORDER BY `position`')->fetchAll(PDO::FETCH_NUM);
        self::assertSame([[2, 0], [1, 7]], array_map(fn($row) => array_map('intval', $row), $line));
    }
}
