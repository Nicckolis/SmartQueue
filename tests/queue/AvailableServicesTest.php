<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/QueueDb.php';
require_once __DIR__ . '/../../Backend/available-services-request.php';
require_once __DIR__ . '/../../Backend/queue-actions.php';

final class AvailableServicesTest extends TestCase
{
    public static function invalidSessions(): array
    {
        return [[null], [0], [-1], ['user@example.test'], [true], [[1]]];
    }

    #[DataProvider('invalidSessions')]
    public function testInvalidSessionCannotReadTheList(mixed $id): void
    {
        $dbOpened = false;
        $result = handleAvailableServicesRequest('GET', static fn() => $id,
            static function () use (&$dbOpened) { $dbOpened = true; });
        self::assertFalse($dbOpened);
        self::assertSame([401, ['error' => 'Please log in first.']], $result);
    }

    public function testOtherMethodsAreRejectedBeforeAccessingSessionOrDatabase(): void
    {
        $touched = false;
        $unused = static function () use (&$touched) { $touched = true; };
        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            self::assertSame([405, ['error' => 'Use GET to list available services.']],
                handleAvailableServicesRequest($method, $unused, $unused));
        }
        self::assertFalse($touched);
    }

    public function testRegularUserCanReadOpenServicesAndEmptyLineWaitsAreZero(): void
    {
        $fx = QueueDb::create();
        try {
            $db = $fx->db;
            self::assertSame('user', $db->query('SELECT `role` FROM UserCredentials WHERE user_id=1')->fetchColumn());
            $db->exec("UPDATE `Queue` SET status='closed' WHERE service_id=2");
            [$code, $body] = handleAvailableServicesRequest('GET', static fn() => '1', static fn() => $db);
            self::assertSame(200, $code);
            self::assertSame([
                ['id' => 1, 'name' => 'Prescription Pickup', 'estimatedWaitMinutes' => 0],
                ['id' => 3, 'name' => 'New Prescription Fill', 'estimatedWaitMinutes' => 0],
                ['id' => 4, 'name' => 'Routine Review', 'estimatedWaitMinutes' => 0],
            ], $body['services']);

            $db->exec("UPDATE `Queue` SET status='closed'");
            self::assertSame([200, ['services' => []]],
                handleAvailableServicesRequest('GET', static fn() => 1, static fn() => $db));
            self::assertSame([401, ['error' => 'Please log in first.']],
                handleAvailableServicesRequest('GET', static fn() => 99, static fn() => $db));
        } finally {
            $fx->drop();
        }
    }

    public function testSharedLinePreviewMatchesJoinAndReadingDoesNotCreateAVisit(): void
    {
        $fx = QueueDb::create();
        try {
            $db = $fx->db;
            joinQueue($db, 2, 2); // High: 10 minutes.
            joinQueue($db, 3, 3); // Medium: 15 minutes. Keep waiting even when closed.
            joinQueue($db, 4, 4); // Low: 7 minutes.
            $db->exec("UPDATE `Queue` SET status='closed' WHERE service_id=3");
            $snapshot = static fn() => $db->query('SELECT * FROM QueueEntry ORDER BY entry_id')->fetchAll();
            $before = $snapshot();
            [$code, $body] = handleAvailableServicesRequest('GET', static fn() => 1, static fn() => $db);
            self::assertSame(200, $code);
            $waits = array_column($body['services'], 'estimatedWaitMinutes', 'id');
            self::assertSame([1 => 25, 2 => 10, 4 => 32], $waits);
            self::assertSame($before, $snapshot());

            $joined = joinQueue($db, 1, 1);
            self::assertSame($waits[1], $joined['waitMinutes']);
            self::assertSame(3, $joined['position']); // Behind high and earlier medium, ahead of low.

            // Completed visits contribute nothing to the next snapshot.
            $db->exec("UPDATE QueueEntry SET status='served', completed_at=CURRENT_TIMESTAMP WHERE user_id=2");
            [$code, $next] = handleAvailableServicesRequest('GET', static fn() => 1, static fn() => $db);
            self::assertSame(200, $code);
            self::assertSame([1 => 20, 2 => 0, 4 => 27], array_column($next['services'], 'estimatedWaitMinutes', 'id'));
        } finally {
            $fx->drop();
        }
    }

    public function testErrorsDoNotExposeConnectionDetails(): void
    {
        $broken = static function (): PDO { throw new RuntimeException('simulated connection failure'); };
        self::assertSame([500, ['error' => 'Could not load available services right now.']],
            handleAvailableServicesRequest('GET', static fn() => 1, $broken));
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testPublicGetUsesThePhpSessionAndRealDbConnectionFile(): void
    {
        $fx = QueueDb::create();
        $dir = null;
        try {
            putenv('QUEUESMART_DB_NAME=' . $fx->db->query('SELECT DATABASE()')->fetchColumn());
            putenv('QUEUESMART_DB_HOST=127.0.0.1');
            putenv('QUEUESMART_DB_PORT=3306');
            putenv('QUEUESMART_DB_USER=' . (getenv('QUEUESMART_DB_USER') ?: 'root'));

            $path = sys_get_temp_dir() . '/queuesmart-list-' . bin2hex(random_bytes(8));
            if (!mkdir($path, 0700)) self::fail('Could not create the private test session directory.');
            $dir = $path;
            ini_set('session.save_handler', 'files');
            session_save_path($dir);
            $_COOKIE = [];
            self::assertTrue(session_start());
            $_SESSION['user_id'] = 1; // Regular fixture user; no administrator role.
            $sid = session_id();
            session_write_close();
            $_SESSION = [];
            session_id($sid);
            $_COOKIE[session_name()] = $sid;
            $_SERVER['REQUEST_METHOD'] = 'GET';

            ob_start();
            try {
                require dirname(__DIR__, 2) . '/Backend/available-services.php';
            } finally {
                $json = ob_get_clean();
            }
            self::assertSame(200, http_response_code());
            $data = json_decode($json, true, 32, JSON_THROW_ON_ERROR);
            self::assertSame([1, 2, 3, 4], array_column($data['services'], 'id'));
            self::assertSame([0, 0, 0, 0], array_column($data['services'], 'estimatedWaitMinutes'));
        } finally {
            if (session_status() === PHP_SESSION_ACTIVE) session_abort();
            if ($dir !== null) {
                foreach (glob($dir . '/sess_*') ?: [] as $sessionFile) unlink($sessionFile);
                rmdir($dir);
            }
            $fx->drop();
        }
    }
}
