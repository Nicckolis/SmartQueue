
import {
    getOrderedQueue,
    getQueuePosition,
    estimateWait
} from "./queue-helpers.js";


// Attach an application error code; no HTTP response is sent.
function queueError(status, message)
{
    const error = new Error(message);
    error.status = status;
    return error;
}


// Checks that a user ID was supplied.
// This does not verify credentials or permissions.
function requireUserId(userId)
{
    if (typeof userId !== "string" || userId.trim() === "")
    {
        throw queueError(401, "Please log in first.");
    }
}


function joinQueue(store, userId, serviceId)
{
    requireUserId(userId);

    if (typeof serviceId !== "string" || serviceId.trim() === "")
    {
        throw queueError(400, "Please select a service.");
    }

    const service = store.services.find(
        item => item.id === serviceId
    );

    if (!service)
    {
        throw queueError(404, "Service not found.");
    }

    if (service.isOpen !== true)
    {
        throw queueError(409, "This queue is closed to new arrivals.");
    }

    // Enforce one active queue per user across all services.
    const alreadyJoined = store.queueEntries.some(
        entry => entry.userId === userId
    );

    if (alreadyJoined)
    {
        throw queueError(
            409,
            "Leave your current queue before joining another."
        );
    }

    if (!Number.isFinite(service.expectedDuration) ||
        service.expectedDuration <= 0)
    {
        throw queueError(
            500,
            "The service duration is not configured correctly."
        );
    }

    const arrivalOrder = store.nextArrivalOrder;

    if (!Number.isSafeInteger(arrivalOrder) ||
        arrivalOrder < 1 ||
        arrivalOrder >= Number.MAX_SAFE_INTEGER)
    {
        throw queueError(
            500,
            "The queue arrival counter is not configured correctly."
        );
    }

    const entry = {
        id: crypto.randomUUID(),
        userId: userId,
        serviceId: serviceId,
        priorityLevel: "medium",
        arrivalOrder: arrivalOrder,
        joinedAt: Date.now()
    };

    // Calculate the result before changing the shared store.
    const orderedQueue = getOrderedQueue(
        [...store.queueEntries, entry],
        serviceId
    );

    const position = getQueuePosition(orderedQueue, userId);

    const waitMinutes = estimateWait(
        position,
        service.expectedDuration
    );

    // Update the supplied store in memory.
    store.queueEntries.push(entry);
    store.nextArrivalOrder += 1;

    return {
        entry: { ...entry },

        currentQueue: {
            entryId: entry.id,
            serviceId: service.id,
            serviceName: service.name,
            status: "waiting",
            position: position,
            waitMinutes: waitMinutes
        }
    };
}


function leaveQueue(store, userId)
{
    requireUserId(userId);

    const index = store.queueEntries.findIndex(
        entry => entry.userId === userId
    );

    if (index === -1)
    {
        return {
            entry: null,
            currentQueue: null
        };
    }

    // Leaving remains possible when a service is closed.
    const [removedEntry] = store.queueEntries.splice(index, 1);

    // Return the departed entry for history/notifications.
    return {
        entry: { ...removedEntry },
        currentQueue: null
    };
}


export { joinQueue, leaveQueue };