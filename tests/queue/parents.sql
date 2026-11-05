-- Fixture only. QueueDb creates and selects a fresh local test database first.
-- The real QueueEntry table and combined_waiting_line view come from the repo.
CREATE TABLE UserCredentials (
    user_id BIGINT PRIMARY KEY
) ENGINE=InnoDB;
CREATE TABLE Service (
    service_id BIGINT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    priority ENUM('low', 'medium', 'high') NOT NULL,
    expected_duration_minutes INT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE `Queue` (
    queue_id BIGINT PRIMARY KEY,
    service_id BIGINT NOT NULL UNIQUE,
    status ENUM('open', 'closed') NOT NULL,
    FOREIGN KEY (service_id) REFERENCES Service(service_id)
) ENGINE=InnoDB;

INSERT INTO UserCredentials (user_id) VALUES (1), (2), (3), (4);
INSERT INTO Service (service_id, name, priority, expected_duration_minutes)
VALUES (1, 'Prescription Pickup', 'medium', 5),
       (2, 'Consultation', 'high', 10),
       (3, 'New Prescription Fill', 'medium', 15),
       (4, 'Routine Review', 'low', 7);
INSERT INTO `Queue` (queue_id, service_id, status)
VALUES (11, 1, 'open'), (12, 2, 'open'), (13, 3, 'open'), (14, 4, 'open');
