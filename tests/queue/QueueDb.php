<?php
declare(strict_types=1);

// Each integration test owns a fresh local database. Never accept an application
// database name here: cleanup must only remove the database this fixture created.
final class QueueDb
{
    private function __construct(
        private readonly PDO $admin,
        private readonly string $name,
        public readonly PDO $db
    ) {}

    public static function create(): self
    {
        $schemaPath = dirname(__DIR__, 2) . '/database/queue-entries.sql';
        if (!is_readable($schemaPath)) {
            throw new RuntimeException("Missing required schema: $schemaPath");
        }

        // Only this fixture connection runs trusted multi-statement DDL scripts.
        $admin = self::connect('', true);
        $name = 'queuesmart_phpunit_' . bin2hex(random_bytes(8));
        $admin->exec("CREATE DATABASE `$name` CHARACTER SET utf8mb4");

        try {
            $admin->exec("USE `$name`");
            self::loadSql($admin, __DIR__ . '/parents.sql');
            self::loadSql($admin, $schemaPath);
            return new self($admin, $name, self::connect($name));
        } catch (Throwable $error) {
            $admin->exec("DROP DATABASE `$name`");
            throw $error;
        }
    }

    // An independent client confirms what was actually committed.
    public function observer(): PDO
    {
        return self::connect($this->name);
    }

    public function drop(): void
    {
        $this->admin->exec("DROP DATABASE `$this->name`");
    }

    private static function connect(string $name, bool $forScripts = false): PDO
    {
        $dsn = 'mysql:host=127.0.0.1;port=3306;charset=utf8mb4';
        if ($name !== '') {
            $dsn .= ';dbname=' . $name;
        }
        return new PDO(
            $dsn,
            getenv('QUEUESMART_DB_USER') ?: 'root',
            (string) getenv('QUEUESMART_DB_PASSWORD'),
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => $forScripts
            ]
        );
    }

    private static function loadSql(PDO $db, string $path): void
    {
        $sql = file_get_contents($path);
        if ($sql === false || trim($sql) === '') {
            throw new RuntimeException("Cannot read SQL fixture: $path");
        }
        // Catch accidental use of the manual lab script, which selects another database.
        if (preg_match('/^\s*(?:USE\b|SOURCE\b|(?:CREATE|ALTER|DROP)\s+(?:DATABASE|SCHEMA)\b)/mi', $sql)) {
            throw new RuntimeException("Expected table/view definitions or fixture data in: $path");
        }
        // Consume every result so an error in a later statement also fails setup.
        $statement = $db->query($sql);
        while ($statement->nextRowset()) {
            // The fixture scripts contain DDL and inserts; no rows are needed.
        }
        $statement->closeCursor();
    }
}
