import { queueError } from "./errors.js";

const NOTIFICATION_TYPES = [
    "joined",
    "position_update",
    "almost_ready",
    "served",
    "left",
    "removed"
];

// A user is "almost ready" when this position or closer to the front.
const ALMOST_READY_THRESHOLD = 2;

// Oldest notifications are dropped past this limit (store lives in localStorage).
const MAX_NOTIFICATIONS = 100;


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


// Adds the notification fields to a store that does not have them yet.
function ensureNotificationFields(store)
{
    if (!Array.isArray(store.notifications))
    {
        store.notifications = [];
    }

    if (!Number.isSafeInteger(store.nextNotificationId) ||
        store.nextNotificationId < 1)
    {
        store.nextNotificationId = 1;
    }
}


// Status shown on the Queue Status screen.
// position 1 = next to be served; 0 or served = true means done.
function getQueueStatus(position, served = false)
{
    if (served === true || position === 0)
    {
        return "served";
    }

    if (!Number.isInteger(position) || position < 0)
    {
        throw queueError(400, "position must be a non-negative integer.");
    }

    return position <= ALMOST_READY_THRESHOLD ? "almost_ready" : "waiting";
}


function addNotification(store, userId, serviceId, type, message)
{
    const user = requireText(userId, "userId", 100);
    const service = requireText(serviceId, "serviceId", 100);
    const text = requireText(message, "message", 255);

    if (!NOTIFICATION_TYPES.includes(type))
    {
        throw queueError(
            400,
            `type must be one of: ${NOTIFICATION_TYPES.join(", ")}.`
        );
    }

    ensureNotificationFields(store);

    const notification = {
        id: store.nextNotificationId,
        userId: user,
        serviceId: service,
        type: type,
        message: text,
        read: false,
        createdAt: Date.now()
    };

    store.nextNotificationId += 1;
    store.notifications.push(notification);

    if (store.notifications.length > MAX_NOTIFICATIONS)
    {
        store.notifications.splice(
            0,
            store.notifications.length - MAX_NOTIFICATIONS
        );
    }

    return { ...notification };
}


// ---------- Triggers: call these from the queue actions ----------

function notifyJoined(store, userId, serviceId, serviceName, position, waitMinutes)
{
    return addNotification(
        store, userId, serviceId, "joined",
        `You joined the ${serviceName} queue. Position: ${position}. ` +
        `Estimated wait: ${waitMinutes} minutes.`
    );
}


function notifyServed(store, userId, serviceId, serviceName)
{
    return addNotification(
        store, userId, serviceId, "served",
        `You have been served for ${serviceName}.`
    );
}


function notifyLeft(store, userId, serviceId, serviceName)
{
    return addNotification(
        store, userId, serviceId, "left",
        `You left the ${serviceName} queue.`
    );
}


function notifyRemoved(store, userId, serviceId, serviceName)
{
    return addNotification(
        store, userId, serviceId, "removed",
        `You were removed from the ${serviceName} queue by an administrator.`
    );
}


// Call when a user's position changes (someone ahead was served or left).
// Returns null when there is nothing new to tell the user.
function notifyPositionChange(
    store, userId, serviceId, serviceName, position, waitMinutes)
{
    const status = getQueueStatus(position);

    if (status === "served")
    {
        return notifyServed(store, userId, serviceId, serviceName);
    }

    if (status === "almost_ready")
    {
        // Send once: skip if the latest alert for this queue is already
        // "almost_ready". Joining again starts a fresh queue visit.
        ensureNotificationFields(store);

        const latest = [...store.notifications].reverse().find(
            item => item.userId === userId &&
                    item.serviceId === serviceId &&
                    item.type !== "position_update"
        );

        if (latest && latest.type === "almost_ready")
        {
            return null;
        }

        return addNotification(
            store, userId, serviceId, "almost_ready",
            `You're almost up for ${serviceName}! Position: ${position}.`
        );
    }

    return addNotification(
        store, userId, serviceId, "position_update",
        `Your position in ${serviceName} is now ${position}. ` +
        `Estimated wait: ${waitMinutes} minutes.`
    );
}


// ---------- Reads for the Dashboard / notification list ----------

// Newest first.
function getNotifications(store, userId, options = {})
{
    const user = requireText(userId, "userId", 100);
    ensureNotificationFields(store);

    return store.notifications
        .filter(item => item.userId === user &&
                        (options.unreadOnly !== true || !item.read))
        .map(item => ({ ...item }))
        .sort((a, b) => b.id - a.id);
}


function markRead(store, userId, notificationId)
{
    const user = requireText(userId, "userId", 100);
    ensureNotificationFields(store);

    const notification = store.notifications.find(
        item => item.id === notificationId && item.userId === user
    );

    if (!notification)
    {
        throw queueError(404, "Notification not found.");
    }

    notification.read = true;
    return { ...notification };
}


// Returns how many notifications were newly marked read.
function markAllRead(store, userId)
{
    const user = requireText(userId, "userId", 100);
    ensureNotificationFields(store);

    let count = 0;

    for (const item of store.notifications)
    {
        if (item.userId === user && !item.read)
        {
            item.read = true;
            count += 1;
        }
    }

    return count;
}


export {
    NOTIFICATION_TYPES,
    ALMOST_READY_THRESHOLD,
    getQueueStatus,
    addNotification,
    notifyJoined,
    notifyPositionChange,
    notifyServed,
    notifyLeft,
    notifyRemoved,
    getNotifications,
    markRead,
    markAllRead
};
