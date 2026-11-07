## Service and admin backend tests

From the repository root run `composer install` and start MySQL.
Use PHP 8.3+ with `pdo_mysql` enabled. Set `QUEUESMART_DB_USER` and
`QUEUESMART_DB_PASSWORD` for a local MySQL account that can create and drop
test databases, views, and triggers.

The database tests load `database/schema.sql` and create test accounts in a
temporary database. You dont need to import the schema manually or set
`QUEUESMART_DB_NAME`. Tests do not change `queuesmart_dev`.

Run the service and admin tests:

```sh
php vendor/phpunit/phpunit/phpunit -c tests/services/phpunit.xml --testdox
```

To run only tests that dont need MySQL:

```sh
php vendor/phpunit/phpunit/phpunit -c tests/services/phpunit.xml --testsuite service-unit
```

To include line coverage enable Xdebug in CLI PHP and run:

```sh
php -d xdebug.mode=coverage vendor/phpunit/phpunit/phpunit -c tests/services/phpunit.xml --coverage-text
```

To check service and admin operations over HTTP run the separate smoke test:

```sh
php tests/services/service-http-smoke.php
```

The HTTP test starts and stops its own local PHP server with private test
sessions. It doesnt require the applications login page
