<?php
declare(strict_types=1);
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
require_once __DIR__ . '/../../Backend/service-request.php';

final class ServiceRequestTest extends TestCase
{
    public static function rejectedRequests(): iterable
    {
        yield ['create', 'GET', 'application/json', '{}', 3, 405];
        yield ['list', 'GET', '', '', null, 401];
        yield ['queue', 'GET', '', '', true, 401];
        yield ['create', 'POST', 'text/plain', '{}', 3, 415];
        yield ['create', 'POST', 'application/json', '{bad', 3, 400];
        yield ['create', 'POST', 'application/json', '[]', 3, 400];
        yield ['serve-next', 'POST', 'application/json', '{"userId":1}', 3, 400];
        yield ['set-open', 'POST', 'application/json', '{"serviceId":"1","isOpen":true}', 3, 400];
        yield ['set-open', 'POST', 'application/json', '{"serviceId":1,"isOpen":"true"}', 3, 400];
        yield ['create', 'POST', 'application/json', '{"name":"","description":"x","expectedDuration":1,"priority":"low"}', 3, 400];
        yield ['missing', 'GET', '', '', 3, 404];
    }

    #[DataProvider('rejectedRequests')]
    public function testInvalidRequestsDoNotOpenDatabase(string $action, string $method,
        string $type, string $body, mixed $id, int $expected): void
    {
        $result = handleServiceRequest($action, $method, $type, $body, fn() => $id,
            function () { self::fail('The database should not open.'); });
        self::assertSame($expected, $result[0]);
        self::assertArrayHasKey('error', $result[1]);
    }

    public function testConnectionErrorsAreNotSentToBrowser(): void
    {
        $result = handleServiceRequest('list', 'GET', '', '', fn() => 3,
            function () { throw new RuntimeException('Internal test connection error'); });
        self::assertSame(500, $result[0]);
        self::assertStringNotContainsString('Internal', $result[1]['error']);
    }
}
