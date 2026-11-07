<?php
declare(strict_types=1);
// Run from the terminal
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/ServiceDb.php';

function serviceCheck(bool $ok, string $message): void {
    if (!$ok) throw new RuntimeException($message);
}
function serviceHttp(string $url, string $method, ?string $session, array $data = []): array {
    $headers = ['Content-Type: application/json', 'Connection: close'];
    if ($session !== null) $headers[] = 'Cookie: PHPSESSID=' . $session;
    $context = stream_context_create(['http' => ['method' => $method,
        'header' => implode("\r\n", $headers), 'content' => $method === 'POST' ? json_encode((object) $data) : '',
        'ignore_errors' => true, 'timeout' => 10, 'follow_location' => 0]]);
    $stream = fopen($url, 'rb', false, $context);
    serviceCheck($stream !== false, 'HTTP request failed.');
    try {
        $headers = stream_get_meta_data($stream)['wrapper_data'];
        preg_match('/^HTTP\/\S+\s+(\d{3})/', $headers[0], $match);
        return [(int) $match[1], json_decode(stream_get_contents($stream), true, 32, JSON_THROW_ON_ERROR)];
    } finally { fclose($stream); }
}

$temp = sys_get_temp_dir() . '/queuesmart-service-http-' . bin2hex(random_bytes(12));
$fixture = null;
$process = null;
try {
    mkdir($temp, 0700);
    mkdir($temp . '/www/Backend', 0700, true);
    mkdir($temp . '/sessions', 0700);
    $fixture = ServiceDb::create();
    foreach (glob(dirname(__DIR__, 2) . '/Backend/*.php') as $file) {
        copy($file, $temp . '/www/Backend/' . basename($file));
    }
    $env = getenv();
    $env['QUEUESMART_DB_NAME'] = $fixture->db->query('SELECT DATABASE()')->fetchColumn();
    $env['QUEUESMART_DB_USER'] = getenv('QUEUESMART_DB_USER') ?: 'root';
    $env['QUEUESMART_DB_HOST'] = '127.0.0.1';
    $env['QUEUESMART_DB_PORT'] = '3306';
    unset($env['PHP_CLI_SERVER_WORKERS']);
    $admin = bin2hex(random_bytes(24));
    $user = bin2hex(random_bytes(24));
    file_put_contents("$temp/sessions/sess_$admin", serialize(['user_id' => 3]));
    file_put_contents("$temp/sessions/sess_$user", serialize(['user_id' => 1]));
    $socket = stream_socket_server('tcp://127.0.0.1:0');
    $address = stream_socket_get_name($socket, false);
    fclose($socket);
    // An ini file handles Windows folder names with spaces and parentheses
    $extensions = str_replace('\\', '/', realpath(ini_get('extension_dir')));
    $sessions = str_replace('\\', '/', "$temp/sessions");
    file_put_contents("$temp/php.ini", "extension_dir=\"$extensions\"\nextension=pdo_mysql\n"
        . "session.serialize_handler=php_serialize\nsession.save_path=\"$sessions\"\nsession.use_strict_mode=1\n");
    $command = [PHP_BINARY, '-c', "$temp/php.ini", '-S', $address, '-t', "$temp/www"];
    $process = proc_open($command, [0 => ['file', PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null', 'r'],
        1 => ['file', "$temp/server.log", 'a'], 2 => ['file', "$temp/server.log", 'a']], $pipes, null, $env);
    serviceCheck(is_resource($process), 'Could not start the test server.');
    $ready = false;
    for ($attempt = 0; $attempt < 100; $attempt++) {
        $probe = @stream_socket_client("tcp://$address", $number, $error, 0.1);
        if ($probe !== false) { fclose($probe); $ready = true; break; }
        usleep(50000);
    }
    serviceCheck($ready, 'The test server did not start.');
    $base = "http://$address/Backend/";
    $input = ['name' => 'HTTP Consultation', 'description' => 'HTTP test service', 'expectedDuration' => 12, 'priority' => 'medium'];
    serviceCheck(serviceHttp($base . 'list-services.php', 'GET', null)[0] === 401, 'Anonymous request was not rejected.');
    $denied = serviceHttp($base . 'create-service.php', 'POST', $user, $input);
    serviceCheck($denied[0] === 403, 'Expected regular-user 403, got ' . json_encode($denied));
    [$status, $result] = serviceHttp($base . 'create-service.php', 'POST', $admin, $input);
    serviceCheck($status === 201, 'Create endpoint failed.');
    $id = $result['service']['id'];
    $changed = array_replace($input, ['name' => 'Edited HTTP Service', 'serviceId' => $id]);
    serviceCheck(serviceHttp($base . 'update-service.php', 'POST', $admin, $changed)[0] === 200, 'Update endpoint failed.');
    serviceCheck(serviceHttp($base . 'list-services.php', 'GET', $admin)[1]['services'][0]['name'] === 'Edited HTTP Service', 'List did not show saved changes.');
    serviceCheck(serviceHttp($base . 'join-queue.php', 'POST', $user, ['serviceId' => $id])[0] === 201, 'Team join endpoint failed with the new service.');
    serviceCheck(serviceHttp($base . 'set-service-open.php', 'POST', $admin, ['serviceId' => $id, 'isOpen' => false])[0] === 200, 'Close endpoint failed.');
    serviceCheck(count(serviceHttp($base . 'admin-queue.php', 'GET', $admin)[1]['queue']) === 1, 'Admin queue did not show the visit.');
    serviceCheck(serviceHttp($base . 'serve-next.php', 'POST', $admin)[1]['served']['userId'] === 1, 'Serve Next failed.');
    serviceCheck(serviceHttp($base . 'current-queue.php', 'GET', $user)[1]['currentQueue'] === null, 'User still appears in the waiting line.');
    serviceCheck($fixture->observer()->query('SELECT status FROM QueueEntry')->fetchColumn() === 'served', 'History was not saved.');
    echo "PASS: HTTP create/edit/list, admin permissions, close queue, team join/current queue, and Serve Next.\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'FAIL: ' . $error->getMessage() . "\n");
    if (is_file("$temp/server.log")) fwrite(STDERR, file_get_contents("$temp/server.log"));
    $failed = true;
} finally {
    if (is_resource($process)) { proc_terminate($process); proc_close($process); }
    $fixture?->drop();
    // Only remove the random folder created by this test
    if (is_dir($temp) && str_starts_with(basename($temp), 'queuesmart-service-http-')) {
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($temp, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($files as $file) {
            $file->isDir() && !$file->isLink() ? rmdir($file->getPathname()) : unlink($file->getPathname());
        }
        rmdir($temp);
    }
}
exit(isset($failed) ? 1 : 0);
