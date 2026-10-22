// One shared waiting queue for all services.
// Priority comes from the service, not from the individual queue entry.
const priorityRank = {
    low: 1,
    medium: 2,
    high: 3
};


function configurationError(message)
{
    const error = new Error(message);
    error.status = 500;
    return error;
}


function getServicesById(services)
{
    if (!Array.isArray(services))
    {
        throw configurationError(
            "The service list is not configured correctly."
        );
    }

    const servicesById = new Map();

    for (const service of services)
    {
        if (!service || typeof service.id !== "string" ||
            service.id.trim() === "" || servicesById.has(service.id))
        {
            throw configurationError(
                "Each service must have a unique, non-empty ID."
            );
        }

        servicesById.set(service.id, service);
    }

    return servicesById;
}


// Return all active waiting entries, ordered by service priority and arrival.
// services is the full service array, not a service ID.
function getOrderedQueue(queueEntries, services)
{
    if (!Array.isArray(queueEntries))
    {
        throw configurationError(
            "The queue entries are not configured correctly."
        );
    }

    const servicesById = getServicesById(services);

    // Validate before sorting, including when there is only one entry.
    for (const entry of queueEntries)
    {
        const service = servicesById.get(entry?.serviceId);

        if (!service)
        {
            throw configurationError(
                "A queued service could not be found."
            );
        }

        if (typeof service.priority !== "string" ||
            !Object.hasOwn(priorityRank, service.priority))
        {
            throw configurationError(
                "The service priority must be low, medium, or high."
            );
        }

        if (!Number.isSafeInteger(entry.arrivalOrder) ||
            entry.arrivalOrder < 1)
        {
            throw configurationError(
                "A queue entry has an invalid arrival order."
            );
        }
    }

    // Sort a new array. Keep the entry objects so notification code can
    // update fields such as lastNotifiedPosition on the original entries.
    return [...queueEntries].sort((a, b) =>
    {
        const serviceA = servicesById.get(a.serviceId);
        const serviceB = servicesById.get(b.serviceId);

        const priorityDifference =
            priorityRank[serviceB.priority] -
            priorityRank[serviceA.priority];

        if (priorityDifference !== 0)
        {
            return priorityDifference;
        }

        // Same priority: earlier arrival goes first, across all services.
        return a.arrivalOrder - b.arrivalOrder;
    });
}


// Return the user's position in the shared queue, starting at 1.
// Return null if the user is not waiting in this queue.
function getQueuePosition(orderedQueue, userId)
{
    const index = orderedQueue.findIndex(
        entry => entry.userId === userId
    );

    return index === -1 ? null : index + 1;
}


// Estimate minutes until service starts:
// add the service durations of everyone ahead.
//
// The first person waits 0 minutes.
// The user's own service time is excluded.
//
// This is a simple single-server simulation
// with no in-progress job tracked.
function estimateWait(orderedQueue, position, services)
{
    if (!Array.isArray(orderedQueue))
    {
        throw configurationError(
            "The ordered queue is not configured correctly."
        );
    }

    if (position === null)
    {
        return null;
    }

    if (!Number.isInteger(position) || position < 1 ||
        position > orderedQueue.length)
    {
        throw new RangeError(
            "Position must be between 1 and the queue length."
        );
    }

    const servicesById = getServicesById(services);
    let waitMinutes = 0;

    for (let index = 0; index < position - 1; index += 1)
    {
        const service = servicesById.get(
            orderedQueue[index]?.serviceId
        );

        if (!service)
        {
            throw configurationError(
                "A queued service could not be found."
            );
        }

        if (!Number.isFinite(service.expectedDuration) ||
            service.expectedDuration <= 0)
        {
            throw configurationError(
                "The service duration is not configured correctly."
            );
        }

        waitMinutes += service.expectedDuration;
    }

    return waitMinutes;
}


export {
    getOrderedQueue,
    getQueuePosition,
    estimateWait
};