## Queue backend tests

Run `composer install` from the repository root and start MySQL.
Set `QUEUESMART_DB_USER` and `QUEUESMART_DB_PASSWORD` for a local
account that can create and drop temporary test databases.

```sh
vendor/bin/phpunit -c tests/queue/phpunit.xml --testdox
```

To run the suite with line coverage, enable Xdebug in CLI PHP and run:

```sh
XDEBUG_MODE=coverage vendor/bin/phpunit -c tests/queue/phpunit.xml --coverage-text
```