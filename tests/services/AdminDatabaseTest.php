<?php
declare(strict_types=1);
use PHPUnit\Framework\TestCase;
require_once __DIR__ . '/ServiceDb.php';
require_once __DIR__ . '/../../Backend/service-request.php';
require_once __DIR__ . '/../../Backend/queue-actions.php';

final class AdminDatabaseTest extends TestCase
{
    private ?ServiceDb $fixture = null;
    private PDO $db;
    protected function setUp(): void { $this->fixture = ServiceDb::create(); $this->db = $this->fixture->db; }
    protected function tearDown(): void {
        if ($this->fixture !== null) {
            if ($this->db->inTransaction()) { $this->db->rollBack(); }
            $this->fixture->drop();
        }
    }
    private function input(): array {
        return ['name' => 'Consultation', 'description' => 'Talk to a pharmacist.', 'expectedDuration' => 10, 'priority' => 'medium'];
    }
    private function request(string $action, array $data = [], int $user = 3): array {
        return handleServiceRequest($action, in_array($action, ['list', 'queue']) ? 'GET' : 'POST',
            'application/json', json_encode((object) $data), fn() => $user, fn() => $this->db);
    }
    public function testAdminCanCreateEditListAndToggle(): void {
        [$status, $body] = $this->request('create', $this->input());
        self::assertSame(201, $status);
        $id = $body['service']['id'];
        self::assertSame(200, $this->request('update', array_replace($this->input(), ['serviceId' => $id, 'name' => 'Updated']))[0]);
        $closed = $this->request('set-open', ['serviceId' => $id, 'isOpen' => false]);
        self::assertFalse($closed[1]['service']['isOpen']);
        self::assertSame('Updated', $this->request('list')[1]['services'][0]['name']);
        self::assertTrue($this->request('set-open', ['serviceId' => $id, 'isOpen' => true])[1]['service']['isOpen']);
    }
    public function testRegularAndDeletedUsersCannotUseAdminOperations(): void {
        $service = createService($this->db, fn() => true, $this->input());
        foreach (['list' => [], 'queue' => [], 'create' => $this->input(),
            'update' => $this->input() + ['serviceId' => $service['id']],
            'set-open' => ['serviceId' => $service['id'], 'isOpen' => false], 'serve-next' => []] as $action => $data) {
            self::assertSame(403, $this->request($action, $data, 1)[0]);
            self::assertSame(401, $this->request($action, $data, 99)[0]);
        }
        self::assertTrue(readService($this->db, $service['id'])['isOpen']);
    }
    public function testClosingBlocksNewJoinsButServeNextStillWorks(): void {
        $first = createService($this->db, fn() => true, $this->input());
        $high = createService($this->db, fn() => true, array_replace($this->input(), ['priority' => 'high', 'expectedDuration' => 7]));
        joinQueue($this->db, 1, $first['id']);
        $visit = joinQueue($this->db, 2, $high['id']);
        setServiceOpen($this->db, fn() => true, $high['id'], false);
        self::assertSame(2, $this->request('queue')[1]['queue'][0]['userId']);
        try { joinQueue($this->db, 3, $high['id']); self::fail('Closed queues must reject joins.'); }
        catch (QueueActionException $error) { self::assertSame(409, $error->getCode()); }
        $served = $this->request('serve-next');
        self::assertSame(200, $served[0]);
        self::assertSame($visit['entryId'], $served[1]['served']['entryId']);
        $record = $this->db->query("SELECT status, completed_at FROM QueueEntry WHERE user_id = 2")->fetch();
        self::assertSame('served', $record['status']);
        self::assertNotNull($record['completed_at']);
        self::assertSame(0, $this->request('queue')[1]['queue'][0]['waitMinutes']);
        self::assertSame(1, $this->request('serve-next')[1]['served']['userId']);
        self::assertNull($this->request('serve-next')[1]['served']);
    }
    public function testNotificationHookFailureRollsBackServing(): void {
        $service = createService($this->db, fn() => true, $this->input());
        joinQueue($this->db, 1, $service['id']);
        try {
            serveNextUser($this->db, fn() => true, function () { throw new RuntimeException('Notification test failure'); });
            self::fail('Expected hook failure.');
        } catch (RuntimeException $error) { self::assertSame('Notification test failure', $error->getMessage()); }
        self::assertSame('waiting', $this->db->query('SELECT status FROM QueueEntry')->fetchColumn());
        self::assertNotNull(serveNextUser($this->db, fn() => true));
    }
    public function testAnotherConnectionCannotServeWhileLockIsHeld(): void {
        $other = $this->fixture->observer();
        $name = 'queuesmart-serve-' . substr(hash('sha256', (string) $other->query('SELECT DATABASE()')->fetchColumn()), 0, 40);
        $lock = $other->prepare('SELECT GET_LOCK(?, 0)');
        $lock->execute([$name]);
        try { self::assertSame(409, $this->request('serve-next')[0]); }
        finally { $release = $other->prepare('SELECT RELEASE_LOCK(?)'); $release->execute([$name]); }
    }
    public function testUnknownServiceAndNestedTransactionsAreRejected(): void {
        self::assertSame(404, $this->request('set-open', ['serviceId' => 999, 'isOpen' => true])[0]);
        self::assertSame(404, $this->request('update', $this->input() + ['serviceId' => 999])[0]);
        $this->db->beginTransaction();
        try { serveNextUser($this->db, fn() => true); self::fail('Expected nested transaction error.'); }
        catch (LogicException) { self::assertTrue($this->db->inTransaction()); }
        $this->db->rollBack();
    }
    public function testSharedConnectionCanReadServiceChanges(): void {
        $oldName = getenv('QUEUESMART_DB_NAME');
        $oldUser = getenv('QUEUESMART_DB_USER');
        putenv('QUEUESMART_DB_NAME=' . $this->db->query('SELECT DATABASE()')->fetchColumn());
        putenv('QUEUESMART_DB_USER=' . ($oldUser ?: 'root'));
        try {
            $connection = require __DIR__ . '/../../Backend/db.php';
            $created = createService($connection, fn() => requireDatabaseAdmin($connection, 3), $this->input());
            self::assertSame($created, listServices($this->db, fn() => true)[0]);
        } finally {
            putenv($oldName === false ? 'QUEUESMART_DB_NAME' : 'QUEUESMART_DB_NAME=' . $oldName);
            putenv($oldUser === false ? 'QUEUESMART_DB_USER' : 'QUEUESMART_DB_USER=' . $oldUser);
        }
    }
}
