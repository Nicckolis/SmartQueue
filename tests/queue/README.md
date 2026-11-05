# QueueSmart: automated queue-action tests

Copy this `tests/queue/` folder into the repository containing `Backend/queue-actions.php` and `database/queue-entries.sql`. Use a normal terminal opened at the repository root. Keep the SQL schema file limited to its QueueEntry table and combined_waiting_line view definitions. Do not substitute the manual SQL test script.

## Setup

This suite targets PHPUnit 12.5 and PHP 8.3 or later, with PDO and pdo_mysql. Check `php -v` and `composer --version`. If Composer is missing on your Mac, install it with `brew install composer`. If the project already lists PHPUnit 12.5 in composer.json, run `composer install`; otherwise add the development dependency once:

```sh
composer require --dev 'phpunit/phpunit:^12.5'
```

No changes to queue-actions.php or db.php are required. The config bootstraps the existing queue-actions.php directly.

## Run in two steps

First, run the three unit tests (a PDO stub is passed in, and no MySQL server is needed):

```sh
vendor/bin/phpunit -c tests/queue/phpunit.xml --testsuite queue-unit --testdox
```

Then, with MySQL running on your Mac, run **both** suites:

```sh
vendor/bin/phpunit -c tests/queue/phpunit.xml --testdox
```

The nine integration tests connect to 127.0.0.1:3306. They use the same QUEUESMART_DB_PASSWORD environment variable as db-check.php. QUEUESMART_DB_USER is optional and defaults to root. The local test account needs permission to create and drop its own databases and views. If your password is blank, no password setting is needed. Otherwise, in zsh or bash run `read -rs QUEUESMART_DB_PASSWORD`, type the password and press Return, then run `export QUEUESMART_DB_PASSWORD` in the same terminal.

Every integration test creates its own database named queuesmart_phpunit_ followed by a random suffix. parents.sql supplies only the necessary parent tables and sample users/services. The fixture then loads the project's real database/queue-entries.sql. Teardown drops only the database the fixture created. No test relies on user 4 already waiting in your manual database, and no outer rollback is used to simulate isolation: the production functions commit their own transactions.

The tests check input errors, committed rows from a second connection, high/medium/low priority and arrival order across services, cumulative waits, duplicate joins, closed queues, preserved history, repeated leaves, rejoining, unknown records, invalid service duration, served visits and rollback after a failed status read. Error codes such as 409 are checked on QueueActionException; HTTP response tests belong to the future endpoints.

## Measure coverage

A coverage driver must be enabled in the CLI PHP installation. Inspect Xdebug with `php --ri xdebug` or PCOV with `php --ri pcov`. Tests work without a coverage driver. Official Xdebug setup: https://xdebug.org/docs/install ; PHPUnit's coverage guide: https://docs.phpunit.de/en/12.5/code-coverage.html .

With Xdebug loaded:

```sh
XDEBUG_MODE=coverage vendor/bin/phpunit -c tests/queue/phpunit.xml --coverage-text --coverage-html build/queue-coverage
```

With PCOV loaded, explicitly include Backend as the instrumented directory:

```sh
php -d pcov.enabled=1 -d "pcov.directory=$PWD/Backend" vendor/bin/phpunit -c tests/queue/phpunit.xml --coverage-text --coverage-html build/queue-coverage
```

Read the **Lines** percentage, or open build/queue-coverage/index.html. The assignment target is strictly greater than 80%. The source filter in this config measures **Backend/queue-actions.php only**. A project-wide coverage run must include the other PHP backend files and team tests as well. A passing test count is not a coverage percentage.

Commit the tests/queue folder, plus composer.json and composer.lock if you added the dependency. Keep vendor/, build/, and passwords out of Git. There is no need to rerun the schema seed commands between test runs.
