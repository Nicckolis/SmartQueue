<?php
declare(strict_types=1);

// Expected failures that a future API handler can report to the user.
// Shared by every Backend/*.php module so each file can be loaded on its own.
if (!class_exists('QueueActionException', false)) {
    class QueueActionException extends RuntimeException
    {
    }
}
