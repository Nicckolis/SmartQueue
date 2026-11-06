<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use PHPUnit\Framework\TestCase;

#[RunTestsInSeparateProcesses]
#[PreserveGlobalState(false)]
final class QueueEntryPointTest extends TestCase
{
    public static function requests(): array
    {
        return [
            'GET cannot join'   => ['join-queue.php', 'GET', 405, 'Use POST to join a queue.'],
            'GET cannot leave'  => ['leave-queue.php', 'GET', 405, 'Use POST to leave the queue.'],
            'POST cannot read'  => ['current-queue.php', 'POST', 405, 'Use GET to check your current queue.'],
            'anonymous join'    => ['join-queue.php', 'POST', 401, 'Please log in first.'],
            'anonymous leave'   => ['leave-queue.php', 'POST', 401, 'Please log in first.'],
            'anonymous lookup'  => ['current-queue.php', 'GET', 401, 'Please log in first.'],
        ];
    }

    #[DataProvider('requests')]
    public function testEntryPointReturnsStatusAndJson(
        string $script, string $method, int $expectedStatus, string $expectedError
    ): void {
        $_SERVER['REQUEST_METHOD'] = $method;
        $_SERVER['CONTENT_TYPE'] = 'application/json';
        $_COOKIE = [];

        // Use an empty session directory so no real login can affect this test.
        $sessionDir = sys_get_temp_dir() . '/queuesmart-entry-' . bin2hex(random_bytes(8));
        if (!mkdir($sessionDir, 0700)) {
            self::fail('Could not create the test session directory.');
        }

        try {
            ini_set('session.save_handler', 'files');
            session_save_path($sessionDir);

            ob_start();
            try {
                // Run the actual file the browser calls, and capture its JSON output.
                require dirname(__DIR__, 2) . '/Backend/' . $script;
            } finally {
                $json = ob_get_clean();
            }

            self::assertSame($expectedStatus, http_response_code());
            self::assertSame(
                ['error' => $expectedError],
                json_decode($json, true, 32, JSON_THROW_ON_ERROR)
            );
        } finally {
            foreach (glob($sessionDir . '/sess_*') ?: [] as $sessionFile) {
                unlink($sessionFile);
            }
            rmdir($sessionDir);
        }
    }
}