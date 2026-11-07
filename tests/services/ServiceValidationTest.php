<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
require_once __DIR__ . '/../../Backend/service-actions.php';

final class ServiceValidationTest extends TestCase
{
    public static function input(): array
    {
        return ['name' => ' Consultation ', 'description' => ' Meet a pharmacist. ',
            'expectedDuration' => 15, 'priority' => 'medium'];
    }

    public function testNormalizesTextAndIgnoresProtectedFields(): void
    {
        $input = self::input() + ['id' => 99, 'isOpen' => false, 'queueId' => 88];
        self::assertSame(['name' => 'Consultation', 'description' => 'Meet a pharmacist.',
            'expectedDuration' => 15, 'priority' => 'medium'], validateServiceInput($input));
    }

    public function testUnicodeCharacterLimits(): void
    {
        $input = self::input();
        $input['name'] = str_repeat('é', 100);
        self::assertSame($input['name'], validateServiceInput($input)['name']);
        $input['name'] .= 'é';
        $this->expectExceptionCode(400);
        validateServiceInput($input);
    }

    public static function invalidInputs(): iterable
    {
        foreach ([null, 'text', [], new stdClass()] as $value) {
            yield [$value];
        }
        foreach (['name' => ['', '  ', 42, str_repeat('x', 101), "\xFF"],
                  'description' => ['', ' ', null, str_repeat('x', 1001)],
                  'expectedDuration' => [0, -1, 1.5, '15', true, 2147483648],
                  'priority' => ['urgent', 'HIGH', null, 1]] as $field => $values) {
            foreach ($values as $value) {
                yield [array_replace(self::input(), [$field => $value])];
            }
        }
    }

    #[DataProvider('invalidInputs')]
    public function testInvalidCreateDoesNotTouchDatabase(mixed $input): void
    {
        $db = $this->createMock(PDO::class);
        $db->expects(self::never())->method('beginTransaction');
        $db->expects(self::never())->method('prepare');
        $this->expectException(ServiceActionException::class);
        $this->expectExceptionCode(400);
        createService($db, fn() => true, $input);
    }

    public static function deniedActions(): iterable
    {
        foreach (['create', 'update', 'list'] as $action) {
            foreach ([401, 403] as $code) {
                yield [$action, $code];
            }
        }
    }

    #[DataProvider('deniedActions')]
    public function testAuthorizationRunsBeforeDatabaseAccess(string $action, int $code): void
    {
        $db = $this->createMock(PDO::class);
        $db->expects(self::never())->method('prepare');
        $db->expects(self::never())->method('query');
        $db->expects(self::never())->method('beginTransaction');
        $guard = function () use ($code): bool {
            if ($code === 401) {
                throw new ServiceActionException('Please log in first.', 401);
            }
            return false;
        };
        $this->expectException(ServiceActionException::class);
        $this->expectExceptionCode($code);
        match ($action) {
            'create' => createService($db, $guard, self::input()),
            'update' => updateService($db, $guard, 1, self::input()),
            'list' => listServices($db, $guard)
        };
    }

    public function testInvalidUpdateId(): void
    {
        $this->expectExceptionCode(400);
        updateService($this->createStub(PDO::class), fn() => true, 0, self::input());
    }

    public function testNestedTransactionIsNotCommitted(): void
    {
        $db = $this->createMock(PDO::class);
        $db->method('inTransaction')->willReturn(true);
        $db->expects(self::never())->method('commit');
        $db->expects(self::never())->method('rollBack');
        $this->expectException(LogicException::class);
        createService($db, fn() => true, self::input());
    }
}
