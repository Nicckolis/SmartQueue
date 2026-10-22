// Return the active waiting entries for one service,
// ordered by priority and then arrival.
function getOrderedQueue(queueEntries, serviceId)
{
    const priorityRank = {
        low: 1,
        medium: 2,
        high: 3
    };

    // filter() creates a new array, so sorting it does not
    // rearrange the original array in the shared store.
    const serviceQueue = queueEntries.filter(
        entry => entry.serviceId === serviceId
    );

    serviceQueue.sort((a, b) =>
    {
        const priorityDifference =
            priorityRank[b.priorityLevel] -
            priorityRank[a.priorityLevel];

        if (priorityDifference !== 0)
        {
            return priorityDifference;
        }

        // Same priority: earlier arrival goes first.
        return a.arrivalOrder - b.arrivalOrder;
    });

    return serviceQueue;
}


// Return a position starting at 1.
// Return null if the user is not in this queue.
function getQueuePosition(orderedQueue, userId)
{
    const index = orderedQueue.findIndex(
        entry => entry.userId === userId
    );

    if (index === -1)
    {
        return null;
    }

    return index + 1;
}


// expectedDuration is measured in minutes.
function estimateWait(position, expectedDuration)
{
    return position * expectedDuration;
}

/*
// Allow other backend files to import these functions.
module.exports = {
    getOrderedQueue,
    getQueuePosition,
    estimateWait
};
*/

// ES modules
export { getOrderedQueue, getQueuePosition, estimateWait };