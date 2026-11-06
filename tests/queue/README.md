## Queue backend tests

From the repository root, run `composer install` and start MySQL.
Set `QUEUESMART_DB_USER` and `QUEUESMART_DB_PASSWORD` for a local MySQL
account that can create and drop temporary databases.

The database tests load `database/schema.sql` and sample rows from
`tests/queue/parents.sql` into a temporary database. You do not need to
import the schema manually or set `QUEUESMART_DB_NAME` to run these tests.

Run the PHPUnit suite:

```sh
vendor/bin/phpunit -c tests/queue/phpunit.xml --testdox
```

To include line coverage, enable Xdebug in CLI PHP and run:

```sh
XDEBUG_MODE=coverage vendor/bin/phpunit -c tests/queue/phpunit.xml --coverage-text
```

To check Join, Leave, and Current Queue over HTTP, run the separate smoke test:

```sh
php tests/queue/queue-http-smoke.php
```