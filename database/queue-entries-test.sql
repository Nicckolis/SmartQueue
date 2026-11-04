-- Section 1, 3 are placeholders
-- Section 2 -> team schema

CREATE DATABASE IF NOT EXISTS queuesmart_queue_clean_test;
USE queuesmart_queue_clean_test;

-- 1.
CREATE TABLE UserCredentials (user_id BIGINT PRIMARY KEY) ENGINE=InnoDB;

CREATE TABLE Service (
    service_id BIGINT NOT NULL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    priority ENUM('low', 'medium', 'high') NOT NULL,
    expected_duration_minutes INT NOT NULL
) ENGINE=InnoDB;

CREATE TABLE `Queue` (
    queue_id BIGINT PRIMARY KEY,
    service_id BIGINT NOT NULL UNIQUE,
    status ENUM('open','closed') NOT NULL,
    FOREIGN KEY (service_id) REFERENCES Service (service_id)
) ENGINE=InnoDB;

-- 2.
SOURCE database/queue-entries.sql

-- 3. local sample data and checks.
INSERT INTO UserCredentials (user_id) VALUES (1), (2), (3);
INSERT INTO Service (service_id, name, priority, expected_duration_minutes)
VALUES (1, 'Prescription Pickup', 'medium', 5),
       (2, 'Consultation', 'high', 10),
       (3, 'New Prescription Fill', 'medium', 15);
INSERT INTO `Queue` (queue_id, service_id, status)
VALUES (11, 1, 'open'), (12, 2, 'open'), (13, 3, 'open');

INSERT INTO QueueEntry (queue_id, user_id) VALUES (11, 1); -- pickup first
INSERT INTO QueueEntry (queue_id, user_id) VALUES (13, 2); -- fill second
INSERT INTO QueueEntry (queue_id, user_id) VALUES (12, 3); -- consultation last

SELECT 'Joined: expect users 3, 1, 2 with waits 0, 10, 15' AS checkpoint;
SELECT user_id, service_name, `position`, wait_minutes
FROM combined_waiting_line ORDER BY `position`;

-- Check a departure and a later visit, then restore the original example.
START TRANSACTION;
UPDATE QueueEntry
SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
WHERE user_id = 3 AND status = 'waiting';

SELECT 'After user 3 leaves: expect users 1, 2 with waits 0, 5' AS checkpoint;
SELECT user_id, service_name, `position`, wait_minutes
FROM combined_waiting_line ORDER BY `position`;

INSERT INTO QueueEntry (queue_id, user_id) VALUES (11, 3);
SELECT 'User 3 rejoined: expect a cancelled visit and a new waiting visit' AS checkpoint;
SELECT user_id, status, completed_at FROM QueueEntry
WHERE user_id = 3 ORDER BY entry_id;
ROLLBACK;

-- Manual test: user 1 is already waiting.
-- Expected: duplicate key error for uq_one_waiting_visit.
-- INSERT INTO QueueEntry (queue_id, user_id) VALUES (12, 1);