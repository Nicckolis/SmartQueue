-- Test accounts only; the queue tests do not log in by password.
SET @queue_test_hash = '$2y$10$rexkjp.zXxO9TM31135iLeNJqSqDOZGAeoNvMHMHsynty5FeeL59q';

INSERT INTO UserCredentials (user_id, username, password_hash) VALUES
    (1, 'queue-test-1', @queue_test_hash),
    (2, 'queue-test-2', @queue_test_hash),
    (3, 'queue-test-3', @queue_test_hash),
    (4, 'queue-test-4', @queue_test_hash);

INSERT INTO Service (service_id, name, description, priority, expected_duration_minutes) VALUES
    (1, 'Prescription Pickup', 'Pick up a prescription.', 'medium', 5),
    (2, 'Consultation', 'Speak with a pharmacist.', 'high', 10),
    (3, 'New Prescription Fill', 'Fill a new prescription.', 'medium', 15),
    (4, 'Routine Review', 'Review an existing prescription.', 'low', 7);

INSERT INTO `Queue` (queue_id, service_id, status) VALUES
    (11, 1, 'open'), (12, 2, 'open'), (13, 3, 'open'), (14, 4, 'open');

