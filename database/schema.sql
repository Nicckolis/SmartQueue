-- MySQL 8.4 / InnoDB
-- Select an EMPTY application database, then run from the repository root:
--   mysql> SOURCE database/schema.sql

-- 1. Login credentials. PHP supplies a password hash, never the raw password.
CREATE TABLE UserCredentials (
    user_id       BIGINT NOT NULL AUTO_INCREMENT,
    username      VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    `role`        ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id),
    UNIQUE KEY uq_credentials_username (username),
    CONSTRAINT chk_credentials_username CHECK (CHAR_LENGTH(TRIM(username)) > 0),
    CONSTRAINT chk_credentials_hash CHECK (CHAR_LENGTH(TRIM(password_hash)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2. One profile per user. Registration inserts account and profile in one transaction.
-- If login accepts an email address, look it up here and join to UserCredentials by user_id.
CREATE TABLE UserProfile (
    user_id    BIGINT NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name  VARCHAR(100) NOT NULL,
    email      VARCHAR(254) NOT NULL,
    phone      VARCHAR(30) NULL DEFAULT NULL,

    PRIMARY KEY (user_id),
    UNIQUE KEY uq_profile_email (email),
    CONSTRAINT fk_profile_user FOREIGN KEY (user_id) REFERENCES UserCredentials (user_id),
    CONSTRAINT chk_profile_first_name CHECK (CHAR_LENGTH(TRIM(first_name)) > 0),
    CONSTRAINT chk_profile_last_name CHECK (CHAR_LENGTH(TRIM(last_name)) > 0),
    CONSTRAINT chk_profile_email CHECK (
        CHAR_LENGTH(email) > 0 AND CHAR_LENGTH(email) = CHAR_LENGTH(TRIM(email))
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 3. Service priorities determine the order of the shared waiting line.
CREATE TABLE Service (
    service_id                BIGINT NOT NULL AUTO_INCREMENT,
    name                      VARCHAR(100) NOT NULL,
    description               VARCHAR(1000) NOT NULL,
    expected_duration_minutes INT NOT NULL,
    priority                  ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
    created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (service_id),
    CONSTRAINT chk_service_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
    CONSTRAINT chk_service_description CHECK (CHAR_LENGTH(TRIM(description)) > 0),
    CONSTRAINT chk_service_duration CHECK (expected_duration_minutes > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4. PHP creates the service and its queue in one transaction. Closing stops new joins only.
CREATE TABLE `Queue` (
    queue_id   BIGINT NOT NULL AUTO_INCREMENT,
    service_id BIGINT NOT NULL,
    status     ENUM('open', 'closed') NOT NULL DEFAULT 'open',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (queue_id),
    UNIQUE KEY uq_queue_service (service_id),
    CONSTRAINT fk_queue_service FOREIGN KEY (service_id) REFERENCES Service (service_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 5. Each join creates a visit. Completed rows remain available to the History page.
CREATE TABLE QueueEntry (
    entry_id     BIGINT NOT NULL AUTO_INCREMENT,
    queue_id     BIGINT NOT NULL,
    user_id      BIGINT NOT NULL,
    status       ENUM('waiting', 'served', 'left', 'removed', 'no_show') NOT NULL DEFAULT 'waiting',
    joined_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL DEFAULT NULL,
    people_ahead_at_join INT UNSIGNED NULL DEFAULT NULL,

    -- A user can have only one waiting visit across all services. Completed visits
    -- generate NULL, allowing the same user to keep history and join again later.
    waiting_user_id BIGINT GENERATED ALWAYS AS (
        CASE WHEN status = 'waiting' THEN user_id ELSE NULL END
    ) STORED,

    PRIMARY KEY (entry_id),
    UNIQUE KEY uq_one_waiting_visit (waiting_user_id),
    KEY ix_entry_user_history (user_id, joined_at, entry_id),
    KEY ix_entry_status_arrival (status, entry_id),
    KEY ix_entry_queue_joined (queue_id, joined_at),
    CONSTRAINT fk_entry_queue FOREIGN KEY (queue_id) REFERENCES `Queue` (queue_id),
    CONSTRAINT fk_entry_user FOREIGN KEY (user_id) REFERENCES UserCredentials (user_id),
    CONSTRAINT chk_visit_completion CHECK (
        (status = 'waiting' AND completed_at IS NULL) OR
        (status IN ('served', 'left', 'removed', 'no_show')
         AND completed_at IS NOT NULL AND completed_at >= joined_at)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 6. The visit identifies the recipient; NULL read_at means the notification is unread.
CREATE TABLE NotificationHistory (
    event_id   BIGINT NOT NULL AUTO_INCREMENT,
    entry_id   BIGINT NOT NULL,
    event_type ENUM('joined', 'position_update', 'almost_ready', 'served', 'left', 'removed', 'no_show') NOT NULL,
    message    VARCHAR(1000) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at    DATETIME NULL DEFAULT NULL,

    PRIMARY KEY (event_id),
    KEY ix_notification_visit_time (entry_id, created_at, event_id),
    CONSTRAINT fk_notification_entry FOREIGN KEY (entry_id) REFERENCES QueueEntry (entry_id),
    CONSTRAINT chk_notification_message CHECK (CHAR_LENGTH(TRIM(message)) > 0),
    CONSTRAINT chk_notification_read_time CHECK (read_at IS NULL OR read_at >= created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One counter serves every service. Rank all waiting visits, including existing visits
-- for closed queues. For the next customer, query this view ORDER BY `position` LIMIT 1.
CREATE VIEW combined_waiting_line AS
SELECT
    e.entry_id, e.user_id, e.queue_id, s.service_id,
    s.name AS service_name, s.priority, s.expected_duration_minutes, e.joined_at,
    ROW_NUMBER() OVER line_order AS `position`,
    COALESCE(
        SUM(s.expected_duration_minutes) OVER (
            line_order ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0
    ) AS wait_minutes
FROM QueueEntry AS e
JOIN `Queue` AS q ON q.queue_id = e.queue_id
JOIN Service AS s ON s.service_id = q.service_id
WHERE e.status = 'waiting'
WINDOW line_order AS (
    ORDER BY CASE s.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             e.entry_id
);