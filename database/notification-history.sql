-- 6. NotificationHistory: messages and events for one customer visit.
-- Load after queue-entries.sql (it references QueueEntry).
-- History and Queue Status need no table of their own: they read QueueEntry
-- and the combined_waiting_line view.
CREATE TABLE NotificationHistory (
    event_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    entry_id BIGINT NOT NULL,
    event_type ENUM('joined', 'position_update', 'almost_ready',
                    'served', 'left', 'removed', 'no_show') NOT NULL,
    message VARCHAR(1000) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME DEFAULT NULL, -- NULL until the notification is read

    FOREIGN KEY (entry_id) REFERENCES QueueEntry (entry_id),
    INDEX idx_notification_entry (entry_id, event_id),
    CONSTRAINT chk_notification_message_not_blank
        CHECK (CHAR_LENGTH(TRIM(message)) > 0),
    CONSTRAINT chk_notification_read_after_created
        CHECK (read_at IS NULL OR read_at >= created_at)
) ENGINE=InnoDB;
