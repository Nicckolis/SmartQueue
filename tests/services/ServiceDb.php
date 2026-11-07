<?php
declare(strict_types=1);

// Isolated test database only and never accepts an application database name
final class ServiceDb
{
    private function __construct(private PDO $admin, private string $name, public PDO $db) {}

    private static function connect(string $name = '', bool $scripts = false): PDO
    {
        $dsn = 'mysql:host=127.0.0.1;port=3306;charset=utf8mb4';
        if ($name !== '') { $dsn .= ';dbname=' . $name; }
        $db = new PDO($dsn, getenv('QUEUESMART_DB_USER') ?: 'root',
            (string) getenv('QUEUESMART_DB_PASSWORD'), [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => $scripts
            ]);
        $db->exec("SET time_zone = '+00:00'");
        return $db;
    }

    public static function create(): self
    {
        $admin = self::connect('', true);
        $name = 'queuesmart_service_test_' . bin2hex(random_bytes(8));
        $admin->exec("CREATE DATABASE `$name` CHARACTER SET utf8mb4");
        try {
            $admin->exec("USE `$name`");
            foreach (['schema.sql'] as $file) {
                $sql = file_get_contents(dirname(__DIR__, 2) . '/database/' . $file);
                if ($sql === false || trim($sql) === '' ||
                    preg_match('/^\s*(?:USE\b|SOURCE\b|(?:CREATE|ALTER|DROP)\s+(?:DATABASE|SCHEMA)\b)/mi', $sql)) {
                    throw new RuntimeException('Invalid test schema file: ' . $file);
                }
                $statement = $admin->query($sql);
                while ($statement->nextRowset()) {}
                $statement->closeCursor();
            }
            // These accounts belong only to this test database
            $users = $admin->prepare('INSERT INTO UserCredentials (user_id, username, password_hash, role) VALUES (?, ?, ?, ?)');
            $hash = password_hash('test-only-password', PASSWORD_DEFAULT);
            $users->execute([1, 'test-user-1', $hash, 'user']);
            $users->execute([2, 'test-user-2', $hash, 'user']);
            $users->execute([3, 'test-admin', $hash, 'admin']);
            return new self($admin, $name, self::connect($name));
        } catch (Throwable $error) {
            $admin->exec("DROP DATABASE `$name`");
            throw $error;
        }
    }

    public function observer(): PDO { return self::connect($this->name); }
    public function drop(): void { $this->admin->exec("DROP DATABASE `$this->name`"); }
}
