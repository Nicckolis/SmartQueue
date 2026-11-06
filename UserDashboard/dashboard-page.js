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
