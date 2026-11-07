import { adminRequest, adminErrorMessage } from "./admin-api.js";

const message = document.getElementById("message");
const dashboardBody = document.getElementById("dashboard-services");
const queueBody = document.getElementById("queue-list");
const serveButton = document.getElementById("serve-next");
let busy = false;
let queue = [];

function addCell(row, text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    row.appendChild(cell);
    return cell;
}

function setBusy(value) {
    busy = value;
    if (serveButton) serveButton.disabled = value || queue.length === 0;
    for (const button of dashboardBody?.querySelectorAll("button") || []) button.disabled = value;
}

function renderDashboard(services) {
    dashboardBody.replaceChildren();
    if (!services.length) {
        const row = document.createElement("tr");
        addCell(row, "No services available.").colSpan = 4;
        dashboardBody.appendChild(row);
    }
    for (const service of services) {
        const row = document.createElement("tr");
        addCell(row, service.name);
        addCell(row, queue.filter(entry => entry.serviceId === service.id).length);
        addCell(row, service.isOpen ? "Open" : "Closed");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = service.isOpen ? "Close Queue" : "Open Queue";
        button.addEventListener("click", () => changeQueue("set-service-open.php",
            { serviceId: service.id, isOpen: !service.isOpen },
            () => `${service.name} is now ${service.isOpen ? "closed" : "open"}.`));
        addCell(row, "").appendChild(button);
        dashboardBody.appendChild(row);
    }
}

function renderQueue() {
    queueBody.replaceChildren();
    document.getElementById("queue-status").textContent = `Shared queue | People waiting: ${queue.length}`;
    document.getElementById("empty-queue").hidden = queue.length !== 0;
    for (const entry of queue) {
        const row = document.createElement("tr");
        for (const value of [entry.position, entry.userId, entry.serviceName, `${entry.waitMinutes} minutes`]) addCell(row, value);
        queueBody.appendChild(row);
    }
}

async function loadPage() {
    const result = await adminRequest("admin-queue.php");
    queue = result.queue;
    if (dashboardBody) {
        const data = await adminRequest("list-services.php");
        renderDashboard(data.services);
    }
    if (queueBody) renderQueue();
}

async function changeQueue(file, data, successMessage) {
    if (busy) return;
    setBusy(true);
    message.textContent = "Saving…";
    try {
        const result = await adminRequest(file, data);
        message.textContent = successMessage(result);
        // A refresh failure does not mean the saved operation failed.
        try { await loadPage(); }
        catch (error) { queue = []; message.textContent += " Refresh failed: " + adminErrorMessage(error); }
    } catch (error) { message.textContent = adminErrorMessage(error); }
    finally { setBusy(false); }
}

serveButton?.addEventListener("click", () => changeQueue("serve-next.php", {},
    result => result.served ? `User ${result.served.userId} was served.` : "No users are waiting."));

async function refreshPage() {
    if (busy) return;
    setBusy(true);
    try { await loadPage(); }
    catch (error) {
        queue = [];
        dashboardBody?.replaceChildren();
        queueBody?.replaceChildren();
        message.textContent = adminErrorMessage(error);
    } finally { setBusy(false); }
}
window.addEventListener("focus", refreshPage);
window.addEventListener("pageshow", event => { if (event.persisted) refreshPage(); });
refreshPage();
