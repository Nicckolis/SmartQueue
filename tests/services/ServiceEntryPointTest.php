<?php
declare(strict_types=1);
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\TestCase;

#[RunTestsInSeparateProcesses]
#[PreserveGlobalState(false)]
final class ServiceEntryPointTest extends TestCase
{
    public static function requests(): iterable {
        foreach (['create-service.php', 'update-service.php', 'set-service-open.php', 'serve-next.php'] as $file) {
            yield [$file, 'GET', 405];
            yield [$file, 'POST', 401];
        }
        foreach (['list-services.php', 'admin-queue.php'] as $file) {
            yield [$file, 'POST', 405];
            yield [$file, 'GET', 401];
        }
    }
    #[DataProvider('requests')]
    public function testRealEntryPoints(string $file, string $method, int $status): void {
        $temp = sys_get_temp_dir() . '/queuesmart-service-session-' . bin2hex(random_bytes(8));
        mkdir($temp, 0700);
        session_save_path($temp);
        $_COOKIE = [];
        $_SERVER['REQUEST_METHOD'] = $method;
        $_SERVER['CONTENT_TYPE'] = 'application/json';
        try {
            ob_start();
            try { require __DIR__ . '/../../Backend/' . $file; }
            finally { $output = ob_get_clean(); }
            self::assertSame($status, http_response_code());
            self::assertArrayHasKey('error', json_decode($output, true, 32, JSON_THROW_ON_ERROR));
        } finally {
            foreach (glob($temp . '/sess_*') ?: [] as $path) unlink($path);
            rmdir($temp);
        }
    }
}
