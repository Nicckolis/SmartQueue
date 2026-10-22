import { joinQueue, leaveQueue } from "../Backend/queue-actions.js";
import {
    getOrderedQueue,
    getQueuePosition,
    estimateWait
} from "../Backend/queue-helpers.js";

import {
    recordJoin,
    completeEntry
} from "../Kaylee Backend/history-actions.js";

import {
    notifyJoined,
    notifyLeft,
    getNotifications,
    getQueueStatus
} from "../Kaylee Backend/notification-actions.js";

import {
    notifyQueueMovement
} from "../Kaylee Backend/queue-status-actions.js";

// Shows the shared popup if notifications.js loaded.
function notify(message, type)
{
    if (typeof window.showNotification === "function")
    {
        window.showNotification(message, type);
    }
}

// ---------- Shared store, saved in localStorage ----------

const STORE_STORAGE_KEY = "queueSmart.store";
const QUEUE_STORAGE_KEY = "queueSmart.currentQueue";

function createDefaultStore()
{
    return {
        services: [
            {
                id: "service-1",
                name: "Prescription Pickup",
                expectedDuration: 5,
                isOpen: true
            },
            {
                id: "service-2",
                name: "New Prescription Fill",
                expectedDuration: 15,
                isOpen: true
            },
            {
                id: "service-3",
                name: "Vaccine / Injection",
                expectedDuration: 20,
                isOpen: true
            },
            {
                id: "service-4",
                name: "Pharmacist Consultation",
                expectedDuration: 10,
                isOpen: true
            }
        ],
        queueEntries: [],
        nextArrivalOrder: 1
    };
}

function loadStore()
{
    try
    {
        const savedData = localStorage.getItem(STORE_STORAGE_KEY);

        if (savedData === null)
        {
            return createDefaultStore();
        }

        const store = JSON.parse(savedData);

        if (!store ||
            !Array.isArray(store.services) ||
            !Array.isArray(store.queueEntries))
        {
            return createDefaultStore();
        }

        const defaults = createDefaultStore();

        for (const service of defaults.services)
        {
            if (!store.services.some(item => item.id === service.id))
            {
                store.services.push(service);
            }
        }

        return store;
    }
    catch
    {
        // Start fresh if the saved data cannot be read.
        return createDefaultStore();
    }
}

function saveStore(store)
{
    localStorage.setItem(STORE_STORAGE_KEY, JSON.stringify(store));
}

function getCurrentUserId()
{
    // accountStorage is created by auth.js, which must load first.
    if (typeof accountStorage === "undefined")
    {
        return null;
    }

    return accountStorage.getCurrentUser();
}


// ---------- Calculations from the store ----------

// The signed-in user's current queue, recalculated from the store
// so position and wait are never out of date.
function getCurrentQueue(store, userId)
{
    const entry = store.queueEntries.find(
        item => item.userId === userId
    );

    if (!entry)
    {
        return null;
    }

    const service = store.services.find(
        item => item.id === entry.serviceId
    );

    if (!service)
    {
        return null;
    }

    const orderedQueue = getOrderedQueue(
        store.queueEntries,
        entry.serviceId
    );

    const position = getQueuePosition(orderedQueue, userId);

    return {
        entryId: entry.id,
        serviceId: service.id,
        serviceName: service.name,
        status: getQueueStatus(position),
        position: position,
        waitMinutes: estimateWait(position, service.expectedDuration)
    };
}

// Wait a new medium-priority arrival would get right now.
function previewWait(store, serviceId)
{
    const service = store.services.find(
        item => item.id === serviceId
    );

    if (!service)
    {
        return null;
    }

    const previewEntry = {
        userId: "__preview__",
        serviceId: serviceId,
        priorityLevel: "medium",
        arrivalOrder: store.nextArrivalOrder
    };

    const orderedQueue = getOrderedQueue(
        [...store.queueEntries, previewEntry],
        serviceId
    );

    const position = getQueuePosition(orderedQueue, "__preview__");

    return estimateWait(position, service.expectedDuration);
}

// Keeps the old saved-queue key up to date for any page that reads it.
function syncQueueSnapshot(currentQueue)
{
    if (currentQueue === null)
    {
        localStorage.removeItem(QUEUE_STORAGE_KEY);
    }
    else
    {
        localStorage.setItem(
            QUEUE_STORAGE_KEY,
            JSON.stringify(currentQueue)
        );
    }
}


// ---------- Page elements ----------

const serviceSelect = document.getElementById("service");
const waitDisplay = document.getElementById("estimated-wait");
const joinForm = document.getElementById("join-queue-form");
const joinButton = document.getElementById("join-queue");
const leaveButton = document.getElementById("leave-queue");
const queueMessage = document.getElementById("queue-message");

function updateEstimatedWait()
{
    const minutes = previewWait(loadStore(), serviceSelect.value);

    waitDisplay.textContent =
        minutes === null ? "—" : minutes + " minutes";
}

// Only run this on a page containing these elements.
if (serviceSelect && waitDisplay)
{
    serviceSelect.addEventListener("change", updateEstimatedWait);
    updateEstimatedWait();
}


// ---------- Join and leave handlers ----------

function handleJoin(event)
{
    // Keep the form from reloading the page.
    event.preventDefault();

    const store = loadStore();
    const userId = getCurrentUserId();

    try
    {
        const result = joinQueue(store, userId, serviceSelect.value);
        const queue = result.currentQueue;

        recordJoin(
            store, userId, queue.serviceId, queue.serviceName
        );

        notifyJoined(
            store,
            userId,
            queue.serviceId,
            queue.serviceName,
            queue.position,
            queue.waitMinutes
        );

        notifyQueueMovement(store, queue.serviceId);

        saveStore(store);
    }
    catch (error)
    {
        // joinQueue throws before changing the store, so nothing to save.
        queueMessage.textContent = error.message;
        notify(error.message, "warning");
        return;
    }


    const currentQueue = getCurrentQueue(store, userId);
    syncQueueSnapshot(currentQueue);

    queueMessage.textContent =
        `You joined the ${currentQueue.serviceName} queue. ` +
        `Position: ${currentQueue.position}. ` +
        `Estimated wait: ${currentQueue.waitMinutes} minutes.`;

    
    notify(queueMessage.textContent, "success");

    // Keep the selected service fixed while joined.
    serviceSelect.disabled = true;
    joinButton.disabled = true;
    leaveButton.disabled = false;
}

function handleLeave()
{
    const store = loadStore();
    const userId = getCurrentUserId();
    let result;

    try
    {
        result = leaveQueue(store, userId);

        if (result.entry === null)
        {
            return;
        }

        const visit = completeEntry(store, userId, "left");

        notifyLeft(
            store,
            userId,
            result.entry.serviceId,
            visit.serviceName
        );

        notifyQueueMovement(store, result.entry.serviceId);

        saveStore(store);
    }
    catch (error)
    {
        queueMessage.textContent = error.message;
        notify(error.message, "warning");
        return;
    }


    
    syncQueueSnapshot(null);

    const service = store.services.find(
        item => item.id === result.entry.serviceId
    );
    const serviceName = service ? service.name + " " : "";

    serviceSelect.disabled = false;
    joinButton.disabled = false;
    leaveButton.disabled = true;

    queueMessage.textContent = `You left the ${serviceName}queue.`;

    
    notify(queueMessage.textContent, "info");

    updateEstimatedWait();
}

// Only attach these handlers on the Join Queue page.
if (joinForm && joinButton && leaveButton &&
    queueMessage && serviceSelect)
{
    joinForm.addEventListener("submit", handleJoin);
    leaveButton.addEventListener("click", handleLeave);
}


// ---------- Redraw the pages from the store ----------

// Restores the Join page's controls and fills the Dashboard's spans.
function refreshQueueDisplay()
{
    const store = loadStore();
    const currentQueue = getCurrentQueue(store, getCurrentUserId());

    syncQueueSnapshot(currentQueue);
    renderAvailableServices(store);
    renderNotifications();

    // Restore the Join Queue page.
    if (joinForm && serviceSelect && waitDisplay &&
        joinButton && leaveButton && queueMessage)
    {
        const isJoined = currentQueue !== null;

        serviceSelect.disabled = isJoined;
        joinButton.disabled = isJoined;
        leaveButton.disabled = !isJoined;

        if (isJoined)
        {
            serviceSelect.value = currentQueue.serviceId;

            waitDisplay.textContent =
                currentQueue.waitMinutes + " minutes";

            queueMessage.textContent =
                `You are in the ${currentQueue.serviceName} queue. ` +
                `Position: ${currentQueue.position}. ` +
                `Estimated wait: ${currentQueue.waitMinutes} minutes.`;
        }
        else
        {
            queueMessage.textContent = "";
            updateEstimatedWait();
        }
    }

    // Find the Dashboard's current-queue fields.
    const serviceDisplay = document.getElementById("current-service");
    const statusDisplay = document.getElementById("current-status");
    const positionDisplay = document.getElementById("current-position");
    const currentWaitDisplay = document.getElementById("current-wait");

    // Skip this section when we are not on the Dashboard.
    if (!serviceDisplay || !statusDisplay ||
        !positionDisplay || !currentWaitDisplay)
    {
        return;
    }

    if (currentQueue === null)
    {
        serviceDisplay.textContent = "—";
        statusDisplay.textContent = "Not in a queue";
        positionDisplay.textContent = "—";
        currentWaitDisplay.textContent = "—";
    }
    else
    {
        const statusLabels = {
            waiting: "Waiting",
            almost_ready: "Almost ready"
        };

        serviceDisplay.textContent = currentQueue.serviceName;

        statusDisplay.textContent =
            statusLabels[currentQueue.status];

        positionDisplay.textContent = currentQueue.position;

        currentWaitDisplay.textContent =
            currentQueue.waitMinutes + " minutes";
    }
}

// Also refresh when returning through the browser's Back button.
window.addEventListener("pageshow", refreshQueueDisplay);

function renderAvailableServices(store)
{
    const list = document.getElementById("available-services-list");

    if (!list)
    {
        return;
    }

    // Remove placeholders or previously displayed items.
    list.textContent = "";

    for (const service of store.services)
    {
        const item = document.createElement("li");

        item.textContent = service.isOpen
            ? `${service.name} — estimated wait: ` +
              `${previewWait(store, service.id)} minutes`
            : `${service.name} — closed`;

        list.appendChild(item);
    }
}
/*
const NOTIFICATION_STORAGE_KEY = "queueSmart.notifications";

function loadNotifications()
{
    try
    {
        const savedData = localStorage.getItem(NOTIFICATION_STORAGE_KEY);

        if (savedData === null)
        {
            return [];
        }

        const notifications = JSON.parse(savedData);

        if (!Array.isArray(notifications))
        {
            return [];
        }

        // Only keep text messages.
        return notifications.filter(
            message => typeof message === "string"
        );
    }
    catch
    {
        return [];
    }
}
*/

function addNotification(message)
{
    const notifications = loadNotifications();

    // Put the newest message first.
    notifications.unshift(message);

    // Save only the five most recent messages.
    localStorage.setItem(
        NOTIFICATION_STORAGE_KEY,
        JSON.stringify(notifications.slice(0, 5))
    );

    renderNotifications();
}

function renderNotifications()
{
    const list = document.getElementById("notification-list");

    if (!list)
    {
        return;
    }

    list.textContent = "";

    const store = loadStore();
    const userId = getCurrentUserId();

    const notifications = userId
        ? getNotifications(store, userId).slice(0, 5)
        : [];

    if (notifications.length === 0)
    {
        const item = document.createElement("li");
        item.textContent = "No notifications yet.";
        list.appendChild(item);
        return;
    }

    for (const notification of notifications)
    {
        const item = document.createElement("li");
        item.textContent = notification.message;
        list.appendChild(item);
    }
}
