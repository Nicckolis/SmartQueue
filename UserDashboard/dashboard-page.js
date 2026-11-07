const serviceDisplay = document.getElementById("current-service");
const statusDisplay = document.getElementById("current-status");
const positionDisplay = document.getElementById("current-position");
const waitDisplay = document.getElementById("current-wait");
let loading = false;

async function refreshCurrentQueue() {
    if (loading) return;
    loading = true;
    serviceDisplay.textContent = "—";
    positionDisplay.textContent = "—";
    waitDisplay.textContent = "—";
    statusDisplay.textContent = "Loading…";

    try {
        const response = await fetch("../Backend/current-queue.php", {
            method: "GET", credentials: "same-origin", cache: "no-store"
        });
        if (!response.headers.get("content-type")?.includes("application/json")) {
            throw new Error(`HTTP ${response.status}: the endpoint did not return JSON.`);
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `Queue request failed (HTTP ${response.status}).`);
        }
        if (!data || !Object.hasOwn(data, "currentQueue")) {
            throw new Error("The endpoint did not return a currentQueue field.");
        }
        const queue = data.currentQueue;
        if (queue === null) {
            statusDisplay.textContent = "Not in a queue";
            return;
        }
        serviceDisplay.textContent = queue.serviceName;
        statusDisplay.textContent = "Waiting";
        positionDisplay.textContent = queue.position;
        waitDisplay.textContent = `${queue.waitMinutes} minutes`;
    } catch (error) {
        statusDisplay.textContent = `${error.message} Refresh the page to check again.`;
    } finally {
        loading = false;
    }
}

window.addEventListener("focus", refreshCurrentQueue);
window.addEventListener("pageshow", event => {
    if (event.persisted) refreshCurrentQueue();
});
refreshCurrentQueue();

const notificationList = document.getElementById("notification-list");
const markAllButton = document.getElementById("mark-all-notifications");

function showNotificationMessage(text) {
    notificationList.replaceChildren();
    const item = document.createElement("li");
    item.textContent = text;
    notificationList.append(item);
    if (markAllButton) markAllButton.disabled = true;
}

function renderNotificationList(notes) {
    if (!Array.isArray(notes)) {
        showNotificationMessage("The endpoint did not return a notifications list.");
        return;
    }

    notificationList.replaceChildren();
    let unread = 0;

    for (const note of notes) {
        if (!note || typeof note.message !== "string" || !Number.isSafeInteger(note.id)) {
            continue;
        }

        const item = document.createElement("li");
        if (note.read === true) {
            item.className = "is-read";
            item.textContent = note.message;
        } else {
            unread += 1;
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.id = String(note.id);
            button.textContent = note.message;
            button.title = "Mark as read";
            item.append(button);
        }
        notificationList.append(item);
    }

    if (notificationList.children.length === 0) {
        const item = document.createElement("li");
        item.textContent = "No notifications yet.";
        notificationList.append(item);
    }

    if (markAllButton) markAllButton.disabled = unread === 0;
}

if (notificationList) {
    window.addEventListener("queue-notifications", event => {
        renderNotificationList(event.detail);
    });
    window.addEventListener("queue-notifications-error", event => {
        showNotificationMessage(event.detail || "Could not load your notifications.");
    });

    notificationList.addEventListener("click", async event => {
        const button = event.target.closest("button[data-id]");
        if (!button || typeof window.markQueueNotificationRead !== "function") return;
        const id = Number(button.dataset.id);
        button.disabled = true;
        try {
            await window.markQueueNotificationRead(id);
        } catch (error) {
            button.disabled = false;
            showNotificationMessage(error.message || "Could not update that notification.");
        }
    });
}

if (markAllButton) {
    markAllButton.addEventListener("click", async () => {
        if (typeof window.markAllQueueNotificationsRead !== "function") return;
        markAllButton.disabled = true;
        try {
            await window.markAllQueueNotificationsRead();
        } catch (error) {
            showNotificationMessage(error.message || "Could not update your notifications.");
            markAllButton.disabled = false;
        }
    });
}
