import { queueError } from "../errors.js";

// Same values as QueueEntry.status in database/queue-entries.sql.
// The History screen shows served as "Picked up" and cancelled as "Cancelled".
const HISTORY_OUTCOMES = ["waiting", "served", "cancelled", "removed", "no_show"];


function requireText(value, fieldName, maxLength)
{
    if (typeof value !== "string" || value.trim() === "")
    {
        throw queueError(400, `${fieldName} is required.`);
    }

    if (value.trim().length > maxLength)
    {
        throw queueError(
            400,
            `${fieldName} must be at most ${maxLength} characters.`
        );
    }

    return value.trim();
}


function ensureHistoryFields(store)
{
    if (!Array.isArray(store.history))
    {
        store.history = [];
    }

    if (!Number.isSafeInteger(store.nextHistoryId) ||
        store.nextHistoryId < 1)
    {
        store.nextHistoryId = 1;
    }
}


// Call when a user joins a queue.
function recordJoin(store, userId, serviceId, serviceName)
{
    const user = requireText(userId, "userId", 100);
    const service = requireText(serviceId, "serviceId", 100);
    const name = requireText(serviceName, "serviceName", 100);

    ensureHistoryFields(store);

    // Same rule as joinQueue: one active queue per user.
    const alreadyWaiting = store.history.some(
        item => item.userId === user && item.outcome === "waiting"
    );

    if (alreadyWaiting)
    {
        throw queueError(
            409,
            "Leave your current queue before joining another."
        );
    }

    const entry = {
        id: store.nextHistoryId,
        userId: user,
        serviceId: service,
        serviceName: name,
        joinedAt: Date.now(),
        completedAt: null,
        outcome: "waiting"
    };

    store.nextHistoryId += 1;
    store.history.push(entry);

    return { ...entry };
}


// Call when the user is served, cancels, is removed, or no-shows.
function completeEntry(store, userId, outcome)
{
    const user = requireText(userId, "userId", 100);

    if (!HISTORY_OUTCOMES.includes(outcome) || outcome === "waiting")
    {
        throw queueError(
            400,
            "outcome must be one of: " +
            HISTORY_OUTCOMES.filter(item => item !== "waiting").join(", ") +
            "."
        );
    }

    ensureHistoryFields(store);

    const entry = store.history.find(
        item => item.userId === user && item.outcome === "waiting"
    );

    if (!entry)
    {
        throw queueError(404, "No active queue entry found.");
    }

    entry.outcome = outcome;
    entry.completedAt = Date.now();

    return { ...entry };
}


// Newest first, optionally filtered by outcome and/or service name.
function getHistory(store, userId, options = {})
{
    const user = requireText(userId, "userId", 100);

    if (options.outcome !== undefined &&
        !HISTORY_OUTCOMES.includes(options.outcome))
    {
        throw queueError(
            400,
            `outcome must be one of: ${HISTORY_OUTCOMES.join(", ")}.`
        );
    }

    ensureHistoryFields(store);

    return store.history
        .filter(item =>
            item.userId === user &&
            (options.outcome === undefined || item.outcome === options.outcome) &&
            (options.serviceName === undefined ||
             item.serviceName === options.serviceName))
        .map(item => ({ ...item }))
        .sort((a, b) => b.id - a.id);
}


export { HISTORY_OUTCOMES, recordJoin, completeEntry, getHistory };
