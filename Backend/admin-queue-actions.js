import {
    getOrderedQueue,
    estimateWait
} from "./queue-helpers.js";

import { completeEntry } from "../Kaylee Backend/history-actions.js";

import {
    notifyServed,
    notifyPositionChange
} from "../Kaylee Backend/notification-actions.js";

function adminError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

// Only admins can serve the next person in the queue.
function serveNextUser(store, accounts) {
    if (!accounts.getCurrentUser()) {
        throw adminError(401, "Please log in first.");
    }

    if (!accounts.isCurrentUserAdmin()) {
        throw adminError(403, "Only administrators can serve users.");
    }

    // Work on a copy so an error cannot leave a partial update.
    const workingStore = structuredClone(store);

    // Sort by service priority first, then by arrival order for matching priorities.
    const orderedQueue = getOrderedQueue(
        workingStore.queueEntries,
        workingStore.services
    );

    const next = orderedQueue[0];

    if (!next) {
        return null;
    }

    const service = workingStore.services.find(
        item => item.id === next.serviceId
    );

    // Some older queue entries may not have a history record to update.
    const hasWaitingHistory = Array.isArray(workingStore.history) &&
        workingStore.history.some(
            item =>
                item.userId === next.userId &&
                item.outcome === "waiting"
        );

    if (hasWaitingHistory) {
        completeEntry(workingStore, next.userId, "served");
    }

    workingStore.queueEntries = workingStore.queueEntries.filter(
        entry => entry.id !== next.id
    );

    notifyServed(
        workingStore,
        next.userId,
        next.serviceId,
        service.name
    );

    // After removing this person, update the positions and wait times for everyone left
    const remainingQueue = getOrderedQueue(
        workingStore.queueEntries,
        workingStore.services
    );

    remainingQueue.forEach(function (entry, index) {
        const queuedService = workingStore.services.find(
            item => item.id === entry.serviceId
        );

        notifyPositionChange(
            workingStore,
            entry.userId,
            entry.serviceId,
            queuedService.name,
            index + 1,
            estimateWait(
                remainingQueue,
                index + 1,
                workingStore.services
            )
        );
    });

    // Commit the changes only after every operation succeeds
    Object.assign(store, workingStore);

    return { ...next };
}

export { serveNextUser };