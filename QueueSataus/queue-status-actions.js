import { getOrderedQueue, getQueuePosition, estimateWait } from "./queue-helpers.js";
import { queueError } from "./errors.js";
import { getQueueStatus, notifyPositionChange } from "./notification-actions.js";
import { getHistory } from "./history-actions.js";

// Text shown under the status badge on the Queue Status screen.
const STATUS_NOTES = {
    "waiting": "We'll notify you when you're almost up.",
    "almost_ready": "You're almost up — please head to the counter.",
    "served": "You've been served. Thanks for waiting!"
};


// Everything the Queue Status screen shows, recalculated from the store
// so position and wait are never out of date.
// Returns null when the user has no active queue and was not just served.
function getUserQueueStatus(store, userId)
{
    if (typeof userId !== "string" || userId.trim() === "")
    {
        throw queueError(401, "Please log in first.");
    }

    const entry = store.queueEntries.find(item => item.userId === userId);

    if (entry)
    {
        const service = store.services.find(item => item.id === entry.serviceId);

        if (!service)
        {
            throw queueError(404, "Service not found.");
        }

        const orderedQueue = getOrderedQueue(store.queueEntries, entry.serviceId);
        const position = getQueuePosition(orderedQueue, userId);
        const status = getQueueStatus(position);

        return {
            entryId: entry.id,
            serviceId: service.id,
            serviceName: service.name,
            status: status,
            position: position,
            peopleAhead: position - 1,
            waitMinutes: estimateWait(position, service.expectedDuration),
            note: STATUS_NOTES[status]
        };
    }

    // No active entry: show "served" if the most recent visit ended that way.
    const [latest] = getHistory(store, userId);

    if (latest && latest.outcome === "served")
    {
        return {
            entryId: null,
            serviceId: latest.serviceId,
            serviceName: latest.serviceName,
            status: "served",
            position: null,
            peopleAhead: null,
            waitMinutes: null,
            note: STATUS_NOTES.served
        };
    }

    return null;
}


// Call after anyone is served, leaves, or is removed from a service.
// Sends each remaining user a notification when their position changed.
// Returns the notifications that were created.
function notifyQueueMovement(store, serviceId)
{
    const service = store.services.find(item => item.id === serviceId);

    if (!service)
    {
        throw queueError(404, "Service not found.");
    }

    const created = [];
    const orderedQueue = getOrderedQueue(store.queueEntries, serviceId);

    orderedQueue.forEach((entry, index) =>
    {
        const position = index + 1;
        const waitMinutes = estimateWait(position, service.expectedDuration);
        const previous = entry.lastNotifiedPosition;

        if (previous === position)
        {
            return;
        }

        entry.lastNotifiedPosition = position;

        // First check after joining: the "joined" message already covers
        // the position, so only send if they are already almost ready.
        if (previous === undefined &&
            getQueueStatus(position) !== "almost_ready")
        {
            return;
        }

        const note = notifyPositionChange(
            store, entry.userId, serviceId, service.name, position, waitMinutes
        );

        if (note !== null)
        {
            created.push(note);
        }
    });

    return created;
}


export { STATUS_NOTES, getUserQueueStatus, notifyQueueMovement };
