<?php
declare(strict_types=1);
require_once __DIR__ . '/service-actions.php';

// Read the same shared line used by the customer dashboard
function listAdminQueue(PDO $db, callable $requireAdmin): array
{
    requireServiceAdmin($requireAdmin);
    $rows = $db->query('SELECT * FROM combined_waiting_line ORDER BY `position`')->fetchAll(PDO::FETCH_ASSOC);
    return array_map(static fn(array $row): array => [
        'entryId' => (int) $row['entry_id'], 'userId' => (int) $row['user_id'],
        'serviceId' => (int) $row['service_id'], 'serviceName' => $row['service_name'],
        'position' => (int) $row['position'], 'waitMinutes' => (int) $row['wait_minutes']
    ], $rows);
}

function setServiceOpen(PDO $db, callable $requireAdmin, int $serviceId, bool $isOpen): array
{
    requireServiceAdmin($requireAdmin);
    if ($serviceId < 1) { throw new ServiceActionException('A positive service ID is required.', 400); }
    if ($db->inTransaction()) { throw new LogicException('setServiceOpen must start its own transaction.'); }
    $db->beginTransaction();
    try {
        // Lock the queue while saving its status, existing visits stay in line
        $find = $db->prepare('SELECT queue_id FROM `Queue` WHERE service_id = ? FOR UPDATE');
        $find->execute([$serviceId]);
        if ($find->fetchColumn() === false) { throw new ServiceActionException('Service or queue not found.', 404); }
        $update = $db->prepare('UPDATE `Queue` SET status = ? WHERE service_id = ?');
        $update->execute([$isOpen ? 'open' : 'closed', $serviceId]);
        $result = readService($db, $serviceId);
        $db->commit();
        return $result;
    } catch (Throwable $error) {
        if ($db->inTransaction()) { $db->rollBack(); }
        throw $error;
    }
}

// receives ($db, $served, $remaining) and must not commit or roll back
function serveNextUser(PDO $db, callable $requireAdmin, ?callable $onServed = null): ?array
{
    requireServiceAdmin($requireAdmin);
    if ($db->inTransaction()) { throw new LogicException('serveNextUser must start its own transaction.'); }
    // This database lock keeps two admins from choosing the same visit
    $lockName = 'queuesmart-serve-' . substr(hash('sha256', (string) $db->query('SELECT DATABASE()')->fetchColumn()), 0, 40);
    $lock = $db->prepare('SELECT GET_LOCK(?, 5)');
    $lock->execute([$lockName]);
    if ((int) $lock->fetchColumn() !== 1) { throw new ServiceActionException('Another admin is serving a user. Please try again.', 409); }
    try {
        $db->beginTransaction();
        $rows = $db->query(
            "SELECT e.entry_id, e.user_id, s.service_id, s.name AS service_name
             FROM QueueEntry e JOIN `Queue` q ON q.queue_id = e.queue_id
             JOIN Service s ON s.service_id = q.service_id
             WHERE e.status = 'waiting'
             ORDER BY CASE s.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                      e.entry_id LIMIT 1 FOR UPDATE"
        );
        $next = $rows->fetch(PDO::FETCH_ASSOC);
        if ($next === false) { $db->commit(); return null; }
        $update = $db->prepare("UPDATE QueueEntry SET status = 'served', completed_at = CURRENT_TIMESTAMP
            WHERE entry_id = ? AND status = 'waiting'");
        $update->execute([$next['entry_id']]);
        if ($update->rowCount() !== 1) { throw new RuntimeException('The visit could not be served.'); }
        $served = ['entryId' => (int) $next['entry_id'], 'userId' => (int) $next['user_id'],
            'serviceId' => (int) $next['service_id'], 'serviceName' => $next['service_name'], 'status' => 'served'];
        if ($onServed !== null) { $onServed($db, $served, listAdminQueue($db, $requireAdmin)); }
        // Keep the completed visit so History can still display it
        $db->commit();
        return $served;
    } catch (Throwable $error) {
        if ($db->inTransaction()) { $db->rollBack(); }
        throw $error;
    } finally {
        $release = $db->prepare('SELECT RELEASE_LOCK(?)');
        $release->execute([$lockName]);
    }
}
