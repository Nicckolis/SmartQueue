import {
    STORE_STORAGE_KEY,
    loadStore,
    saveStore
} from "../Backend/shared-store.js";

import { listServices } from "../Backend/service-actions.js";

import {
    getOrderedQueue,
    estimateWait
} from "../Backend/queue-helpers.js";

import { serveNextUser } from "../Backend/admin-queue-actions.js";

const message = document.getElementById("message");
// This script is used by two pages, so some of these elements may not be present.
const dashboardBody = document.getElementById("dashboard-services");
const queueBody = document.getElementById("queue-list");
const serveButton = document.getElementById("serve-next");

function requireAdmin() {
    if (!accountStorage.isCurrentUserAdmin()) {
        window.location.replace("../LogIn/queue-login.html");
        return false;
    }

    return true;
}

function showError(error) {
    if (error.status === 401 || error.status === 403) {
        window.location.replace("../LogIn/queue-login.html");
        return;
    }

    message.textContent = error.message || "The operation failed.";
}

// Use textContent so names and other values are shown as text instead of HTML.
function addCell(row, text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    row.appendChild(cell);
    return cell;
}

function renderDashboard(store) {
    const services = listServices(store, accountStorage);

    dashboardBody.replaceChildren();

    if (services.length === 0) {
        const row = document.createElement("tr");
        const cell = addCell(row, "No services available.");
        cell.colSpan = 4;
        dashboardBody.appendChild(row);
        return;
    }

    for (const service of services) {
        const row = document.createElement("tr");

        const waitingCount = store.queueEntries.filter(
            entry => entry.serviceId === service.id
        ).length;

        addCell(row, service.name);
        addCell(row, waitingCount);
        addCell(row, service.isOpen ? "Open" : "Closed");

        const actionCell = addCell(row, "");
        const button = document.createElement("button");

        button.type = "button";
        button.textContent = service.isOpen
            ? "Close Queue"
            : "Open Queue";

        button.addEventListener("click", function () {
            setServiceOpen(service.id, !service.isOpen);
        });

        actionCell.appendChild(button);
        dashboardBody.appendChild(row);
    }
}

// Open or close the service without removing people who are already waiting.
function setServiceOpen(serviceId, isOpen) {
    if (!requireAdmin()) {
        return;
    }

    try {
        const store = loadStore();
        const service = store.services.find(
            item => item.id === serviceId
        );

        if (!service) {
            throw new Error("That service no longer exists.");
        }

        service.isOpen = isOpen;
        saveStore(store);

        refreshPage();
        message.textContent =
            service.name + (isOpen ? " is now open." : " is now closed.");
    } catch (error) {
        showError(error);
    }
}

function renderQueue(store) {
    const orderedQueue = getOrderedQueue(
        store.queueEntries,
        store.services
    );

    queueBody.replaceChildren();

    document.getElementById("queue-status").textContent =
        "Shared queue | People waiting: " + orderedQueue.length;

    document.getElementById("empty-queue").hidden =
        orderedQueue.length !== 0;

    serveButton.disabled = orderedQueue.length === 0;

    orderedQueue.forEach(function (entry, index) {
        const service = store.services.find(
            item => item.id === entry.serviceId
        );

        const row = document.createElement("tr");

        addCell(row, index + 1);
        addCell(row, entry.userId);
        addCell(row, service.name);
        addCell(
            row,
            estimateWait(
                orderedQueue,
                index + 1,
                store.services
            ) + " minutes"
        );

        queueBody.appendChild(row);
    });
}

// Load the latest store, serve the next person, and save the result.
function serveNext() {
    if (!requireAdmin()) {
        return;
    }

    try {
        const store = loadStore();
        const served = serveNextUser(store, accountStorage);

        if (served === null) {
            refreshPage();
            message.textContent = "No users are waiting.";
            return;
        }

        saveStore(store);

        refreshPage();
        message.textContent = served.userId + " was served.";
    } catch (error) {
        showError(error);
    }
}

// Check admin access and update whichever table is on this page.
function refreshPage() {
    if (!requireAdmin()) {
        return;
    }

    try {
        const store = loadStore();

        if (dashboardBody) {
            renderDashboard(store);
        }

        if (queueBody) {
            renderQueue(store);
        }
    } catch (error) {
        if (serveButton) {
            serveButton.disabled = true;
        }

        showError(error);
    }
}

if (serveButton) {
    serveButton.addEventListener("click", serveNext);
}

// Refresh when another tab changes the shared data or account information.
window.addEventListener("storage", function (event) {
    if (
        event.key === STORE_STORAGE_KEY ||
        event.key === "currentUser" ||
        event.key === "accounts" ||
        event.key === "admins" ||
        event.key === null
    ) {
        refreshPage();
    }
});

window.addEventListener("pageshow", refreshPage);

refreshPage();