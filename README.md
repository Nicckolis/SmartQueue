# QueueSmart System

When viewing/testing admin pages use the default admin login
Default Admin Account:
email: adminDefault@gmail.com
password: 12345

## Local backend setup

Use MySQL 8.4 and PHP 8.3+ with `pdo_mysql` enabled. Start MySQL and open a terminal at the repository root. The commands below use Bash or zsh. Replace `your_mysql_user` with your local MySQL username.

### 1. Create the database (first time only)

In your terminal, run `mysql -h 127.0.0.1 -u your_mysql_user -p` and enter your MySQL password.

At the `mysql>` prompt, run:

```sql
CREATE DATABASE queuesmart_dev CHARACTER SET utf8mb4;
USE queuesmart_dev;
SOURCE database/schema.sql
SHOW FULL TABLES;
```

You should see six tables and the `combined_waiting_line` view. Type `exit` to return to your terminal.

### 2. Start the app

In the terminal where you’ll run PHP, set:

```sh
export QUEUESMART_DB_NAME=queuesmart_dev
export QUEUESMART_DB_USER=your_mysql_user
```

Run `read -rs QUEUESMART_DB_PASSWORD`, enter your MySQL password, and press Return. The input is hidden. Then run:

```sh
export QUEUESMART_DB_PASSWORD
php -S localhost:8000
```

Open [QueueSmart Login](http://localhost:8000/Login/queue-login.html).

To run the tests, use `composer install` and follow the [queue test instructions](tests/queue/README.md).