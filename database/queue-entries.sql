

CREATE TABLE QueueEntry (
    entry_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    queue_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    status ENUM('waiting', 'served', 'cancelled', 'removed', 'no_show')
        NOT NULL DEFAULT 'waiting',
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME DEFAULT NULL,

    -- Only a waiting visit occupies the user's place in line.
    waiting_user_id BIGINT GENERATED ALWAYS AS (
        CASE WHEN status = 'waiting' THEN user_id ELSE NULL END
    ) STORED,
    UNIQUE KEY uq_one_waiting_visit (waiting_user_id),

    FOREIGN KEY (queue_id) REFERENCES `Queue` (queue_id),
    FOREIGN KEY (user_id) REFERENCES UserCredentials (user_id),
    CONSTRAINT chk_visit_completion CHECK (
        (status = 'waiting' AND completed_at IS NULL) OR
        (status <> 'waiting' AND completed_at IS NOT NULL
                             AND completed_at >= joined_at)
    )
) ENGINE=InnoDB;

CREATE VIEW combined_waiting_line AS
SELECT
    e.entry_id, e.user_id, e.queue_id, s.service_id,
    s.name AS service_name, s.priority, s.expected_duration_minutes,
    e.joined_at,
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
    ORDER BY CASE s.priority
                 WHEN 'high' THEN 1
                 WHEN 'medium' THEN 2
                 ELSE 3  -- low
             END,
             e.entry_id
);