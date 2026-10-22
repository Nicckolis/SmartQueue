// Attach an application error code; no HTTP response is sent.
// Same shape as queueError in queue-actions.js so callers can treat
// every backend error the same way (error.status, error.message).
function queueError(status, message)
{
    const error = new Error(message);
    error.status = status;
    return error;
}

export { queueError };
