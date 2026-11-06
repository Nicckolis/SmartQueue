# QueueSmart System

When viewing/testing admin pages use the default admin login
Default Admin Account:
email: adminDefault@gmail.com
password: 12345

## Local backend setup

Use MySQL 8.4 and PHP 8.3+ with `pdo_mysql` enabled. Start MySQL and run all terminal commands from the repository root. The shell examples use Bash or zsh.

**1. Initialize the database once.** Connect with `mysql -h 127.0.0.1 -u your_mysql_user -p`, replacing `your_mysql_user` with your local MySQL username. At the `mysql>` prompt, run:

```sql
CREATE DATABASE queuesmart_dev CHARACTER SET utf8mb4;
USE queuesmart_dev;
SOURCE database/schema.sql
SHOW FULL TABLES;
```

Expect six tables and one view, `combined_waiting_line`. The schema starts empty. Type `exit` to return to your terminal. Skip this step on later runs.

**2. Configure PHP.** In the terminal where you will start the server, set:

```sh
export QUEUESMART_DB_NAME=queuesmart_dev
export QUEUESMART_DB_USER=your_mysql_user
```

Replace `your_mysql_user` with the same account used above. To set its password, run `read -rs QUEUESMART_DB_PASSWORD`, type the password, press Return, then run `export QUEUESMART_DB_PASSWORD`. The connection defaults to `127.0.0.1:3306`.

**3. Verify the connection and start the app.** This check should show `db` as `queuesmart_dev` and `waiting` as `0` on a fresh database:

```sh
php -r '$db = require "Backend/db.php"; print_r($db->query("SELECT DATABASE() AS db, (SELECT COUNT(*) FROM combined_waiting_line) AS waiting")->fetch(PDO::FETCH_ASSOC));'
```

From the same terminal, run `php -S localhost:8000`, then open [QueueSmart Login](http://localhost:8000/Login/queue-login.html).

For PHPUnit and coverage, run `composer install` and follow the [queue test instructions](tests/queue/README.md).