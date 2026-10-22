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


const STORE_STORAGE_KEY = "queueSmart.store";
const QUEUE_STORAGE_KEY = "queueSmart.currentQueue";

const serviceSelect = document.getElementById("service");
const waitDisplay = document.getElementById("estimated-wait");
const joinForm = document.getElementById("join-queue-form");
const joinButton = document.getElementById("join-queue");
const leaveButton = document.getElementById("leave-queue");
const queueMessage = document.getElementById("queue-message");


// Show a popup if the shared notifications script is available.
function notify(message, type)
{
    if (typeof window.showNotification === "function")
    {
        window.showNotification(message, type);
    }
}

function showError(error)
{
    const message = error.message || "The queue could not be updated.";

    if (queueMessage)
    {
        queueMessage.textContent = message;
    }

    const status = document.getElementById("current-status");

    if (status)
    {
        status.textContent = message;
    }

    notify(message, "warning");
    console.error(error);
}


// Sample data is used only when no shared store exists.
// All services initially have medium priority.
function createDefaultStore()
{
    return {
        services: [
            {
                id: "service-1",
                name: "Prescription Pickup",
                description: "Pick up a prepared prescription.",
                expectedDuration: 5,
                priority: "medium",
                isOpen: true
            },
            {
                id: "service-2",
                name: "New Prescription Fill",
                description: "Request a new prescription fill.",
                expectedDuration: 15,
                priority: "medium",
                isOpen: true
            },
            {
                id: "service-3",
                name: "Vaccine / Injection",
                description: "Visit the vaccine and injection service.",
                expectedDuration: 20,
                priority: "medium",
                isOpen: true
            },
            {
                id: "service-4",
                name: "Pharmacist Consultation",
                description: "Speak with a pharmacist.",
                expectedDuration: 10,
                priority: "medium",
                isOpen: true
            }
        ],

        queueEntries: [],
        nextArrivalOrder: 1,

        history: [],
        nextHistoryId: 1,

        notifications: [],
        nextNotificationId: 1
    };
}

function saveStore(store)
{
    localStorage.setItem(
        STORE_STORAGE_KEY,
        JSON.stringify(store)
    );
}


// Keep counters ahead of existing entries when loading older data.
function repairCounter(store, counterName, items, fieldName)
{
    let largest = 0;

    for (const item of items)
    {
        const value = item?.[fieldName];

        if (!Number.isSafeInteger(value) ||
            value < 1 ||
            value >= Number.MAX_SAFE_INTEGER)
        {
            throw new Error(
                "Saved queue data contains an invalid " + fieldName + "."
            );
        }

        largest = Math.max(largest, value);
    }

    if (!Number.isSafeInteger(store[counterName]) ||
        store[counterName] <= largest)
    {
        store[counterName] = largest + 1;
    }
}

function loadStore()
{
    const saved = localStorage.getItem(STORE_STORAGE_KEY);

    if (saved === null)
    {
        const store = createDefaultStore();
        saveStore(store);
        return store;
    }

    // Report invalid data without overwriting it with sample data.
    const store = JSON.parse(saved);

    if (!store ||
        !Array.isArray(store.services) ||
        !Array.isArray(store.queueEntries))
    {
        throw new Error("The saved queue store has an invalid format.");
    }

    const before = JSON.stringify(store);

    // Preserve any priority that an administrator already assigned.
    for (const service of store.services)
    {
        if (!service)
        {
            throw new Error("A saved service is invalid.");
        }

        if (service.priority === undefined)
        {
            service.priority = "medium";
        }
    }

    store.history ??= [];
    store.notifications ??= [];

    if (!Array.isArray(store.history) ||
        !Array.isArray(store.notifications))
    {
        throw new Error(
            "Saved history or notifications have an invalid format."
        );
    }

    repairCounter(
        store, "nextArrivalOrder", store.queueEntries, "arrivalOrder"
    );

    repairCounter(
        store, "nextHistoryId", store.history, "id"
    );

    repairCounter(
        store, "nextNotificationId", store.notifications, "id"
    );

    // Older queue entries may have been created before history was added.
    const orderedQueue = getOrderedQueue(
        store.queueEntries,
        store.services
    );

    for (const entry of orderedQueue)
    {
        const visit = store.history.find(
            item =>
                item.userId === entry.userId &&
                item.outcome === "waiting"
        );

        if (visit && visit.serviceId !== entry.serviceId)
        {
            throw new Error(
                "The saved queue and active history do not match."
            );
        }

        if (!visit)
        {
            const service = store.services.find(
                item => item.id === entry.serviceId
            );

            const restored = recordJoin(
                store,
                entry.userId,
                service.id,
                service.name
            );

            if (Number.isFinite(entry.joinedAt) && entry.joinedAt >= 0)
            {
                store.history.find(
                    item => item.id === restored.id
                ).joinedAt = entry.joinedAt;
            }
        }
    }

    if (JSON.stringify(store) !== before)
    {
        saveStore(store);
    }

    return store;
}


// accountStorage is supplied by auth.js.
function getCurrentUserId()
{
    return typeof accountStorage === "undefined"
        ? null
        : accountStorage.getCurrentUser();
}


// Calculate the signed-in user's position in the entire shared queue.
function getCurrentQueue(store, userId)
{
    if (!userId)
    {
        return null;
    }

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

    const orderedQueue = getOrderedQueue(
        store.queueEntries,
        store.services
    );

    const position = getQueuePosition(orderedQueue, userId);

    return {
        entryId: entry.id,
        serviceId: service.id,
        serviceName: service.name,
        status: getQueueStatus(position),
        position: position,
        waitMinutes: estimateWait(
            orderedQueue,
            position,
            store.services
        )
    };
}


// Preview where a new arrival would go based on the service's priority.
// This does not add anything to the saved queue.
function previewWait(store, serviceId)
{
    const service = store.services.find(
        item => item.id === serviceId
    );

    if (!service || service.isOpen !== true)
    {
        return null;
    }

    const previewEntry = {
        serviceId: serviceId,
        arrivalOrder: store.nextArrivalOrder
    };

    const orderedQueue = getOrderedQueue(
        [...store.queueEntries, previewEntry],
        store.services
    );

    const position = orderedQueue.indexOf(previewEntry) + 1;

    return estimateWait(
        orderedQueue,
        position,
        store.services
    );
}


// Compatibility for older pages that still read this snapshot.
// queueSmart.store remains the main source of queue data.
function syncQueueSnapshot(currentQueue)
{
    try
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
    catch (error)
    {
        console.warn("Could not update the older queue snapshot.", error);
    }
}


// Populate the dropdown from saved services instead of hardcoded options.
function renderServiceOptions(store, currentQueue)
{
    if (!serviceSelect)
    {
        return;
    }

    const selectedId = currentQueue?.serviceId || serviceSelect.value;

    serviceSelect.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a service";
    serviceSelect.appendChild(placeholder);

    for (const service of store.services)
    {
        const option = document.createElement("option");

        option.value = service.id;
        option.textContent =
            service.name +
            (service.isOpen === true ? "" : " (closed)");

        option.disabled = service.isOpen !== true;

        serviceSelect.appendChild(option);
    }

    serviceSelect.value = store.services.some(
        item => item.id === selectedId
    ) ? selectedId : "";
}

function updateEstimatedWait(store)
{
    if (!serviceSelect || !waitDisplay)
    {
        return;
    }

    const currentQueue = getCurrentQueue(
        store,
        getCurrentUserId()
    );

    const selected = store.services.find(
        item => item.id === serviceSelect.value
    );

    const isClosed = selected && selected.isOpen !== true;

    const minutes = currentQueue
        ? currentQueue.waitMinutes
        : previewWait(store, serviceSelect.value);

    waitDisplay.textContent = currentQueue || !isClosed
        ? (minutes === null ? "—" : minutes + " minutes")
        : "Closed";

    if (joinButton)
    {
        joinButton.disabled =
            currentQueue !== null || Boolean(isClosed);
    }
}


// Display estimates for someone considering joining each service.
function renderAvailableServices(store)
{
    const list = document.getElementById("available-services-list");

    if (!list)
    {
        return;
    }

    list.replaceChildren();

    for (const service of store.services)
    {
        const item = document.createElement("li");

        item.textContent = service.isOpen === true
            ? `${service.name} — ${service.priority} priority — ` +
              `estimated wait for a new arrival: ` +
              `${previewWait(store, service.id)} minutes`
            : `${service.name} — closed`;

        list.appendChild(item);
    }

    if (store.services.length === 0)
    {
        const item = document.createElement("li");
        item.textContent = "No services available.";
        list.appendChild(item);
    }
}

function renderNotifications(store, userId)
{
    const list = document.getElementById("notification-list");

    if (!list)
    {
        return;
    }

    list.replaceChildren();

    const notifications = userId
        ? getNotifications(store, userId).slice(0, 5)
        : [];

    if (notifications.length === 0)
    {
        const item = document.createElement("li");

        item.textContent = userId
            ? "No notifications yet."
            : "Log in to view notifications.";

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


// This script runs on both the Join Queue page and the Dashboard.
function renderPage(store)
{
    const userId = getCurrentUserId();
    const currentQueue = getCurrentQueue(store, userId);

    renderServiceOptions(store, currentQueue);

    if (joinForm && serviceSelect &&
        joinButton && leaveButton && queueMessage)
    {
        const isJoined = currentQueue !== null;

        serviceSelect.disabled = isJoined;
        leaveButton.disabled = !isJoined;

        updateEstimatedWait(store);

        queueMessage.textContent = isJoined
            ? `You are in the shared queue for ${currentQueue.serviceName}. ` +
              `Position: ${currentQueue.position}. ` +
              `Estimated wait: ${currentQueue.waitMinutes} minutes.`
            : (userId ? "" : "Please log in before joining a queue.");
    }

    const service = document.getElementById("current-service");
    const status = document.getElementById("current-status");
    const position = document.getElementById("current-position");
    const wait = document.getElementById("current-wait");

    if (service && status && position && wait)
    {
        const labels = {
            waiting: "Waiting",
            almost_ready: "Almost ready"
        };

        service.textContent = currentQueue
            ? currentQueue.serviceName
            : "—";

        status.textContent = currentQueue
            ? labels[currentQueue.status]
            : "Not in a queue";

        position.textContent = currentQueue
            ? currentQueue.position
            : "—";

        wait.textContent = currentQueue
            ? currentQueue.waitMinutes + " minutes"
            : "—";
    }

    renderAvailableServices(store);
    renderNotifications(store, userId);
    syncQueueSnapshot(currentQueue);
}

function refreshQueueDisplay()
{
    try
    {
        renderPage(loadStore());
    }
    catch (error)
    {
        showError(error);
    }
}


function handleJoin(event)
{
    event.preventDefault();

    try
    {
        const store = loadStore();
        const userId = getCurrentUserId();

        const { currentQueue: queue } = joinQueue(
            store,
            userId,
            serviceSelect.value
        );

        recordJoin(
            store,
            userId,
            queue.serviceId,
            queue.serviceName
        );

        notifyJoined(
            store,
            userId,
            queue.serviceId,
            queue.serviceName,
            queue.position,
            queue.waitMinutes
        );

        // Joining can move users of other services backward.
        notifyQueueMovement(store);

        saveStore(store);
        renderPage(store);

        const message =
            `You joined the shared queue for ${queue.serviceName}. ` +
            `Position: ${queue.position}. ` +
            `Estimated wait: ${queue.waitMinutes} minutes.`;

        queueMessage.textContent = message;
        notify(message, "success");
    }
    catch (error)
    {
        showError(error);
    }
}

function handleLeave()
{
    try
    {
        const store = loadStore();
        const userId = getCurrentUserId();

        const result = leaveQueue(store, userId);

        if (result.entry === null)
        {
            renderPage(store);
            queueMessage.textContent =
                "You are not currently in a queue.";
            return;
        }

        const visit = completeEntry(store, userId, "left");

        notifyLeft(
            store,
            userId,
            result.entry.serviceId,
            visit.serviceName
        );

        // Leaving can move users of other services forward.
        notifyQueueMovement(store);

        saveStore(store);
        renderPage(store);

        const message =
            `You left the shared queue for ${visit.serviceName}.`;

        queueMessage.textContent = message;
        notify(message, "info");
    }
    catch (error)
    {
        showError(error);
    }
}


// Attach handlers before reading saved data.
// A loading error should not leave the form reloading the page on submit.
if (joinForm && serviceSelect && waitDisplay &&
    joinButton && leaveButton && queueMessage)
{
    joinForm.addEventListener("submit", handleJoin);
    leaveButton.addEventListener("click", handleLeave);

    serviceSelect.addEventListener("change", () =>
    {
        try
        {
            updateEstimatedWait(loadStore());
        }
        catch (error)
        {
            showError(error);
        }
    });
}


// Refresh when returning to the page or changing data in another tab.
window.addEventListener("pageshow", refreshQueueDisplay);
window.addEventListener("focus", refreshQueueDisplay);

window.addEventListener("storage", event =>
{
    if (event.key === null ||
        [STORE_STORAGE_KEY, "currentUser", "accounts"].includes(event.key))
    {
        refreshQueueDisplay();
    }
});

refreshQueueDisplay();