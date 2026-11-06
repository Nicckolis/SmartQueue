const form = document.getElementById("join-queue-form");
const service = document.getElementById("service");
const joinButton = document.getElementById("join-queue");
const leaveButton = document.getElementById("leave-queue");
const wait = document.getElementById("estimated-wait");
const message = document.getElementById("queue-message");

async function postQueue(url, payload) {
    const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error(`HTTP ${response.status}: the endpoint did not return JSON.`);
    }
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || `Queue request failed (HTTP ${response.status}).`);
    }
    return data;
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (joinButton.disabled) return;

    const serviceId = Number(service.value);
    if (!Number.isSafeInteger(serviceId) || serviceId < 1) {
        message.textContent = "Choose a service with a valid database ID.";
        return;
    }

    joinButton.disabled = true;
    service.disabled = true;
    message.textContent = "Joining…";
    try {
        const { currentQueue: queue } = await postQueue("../Backend/join-queue.php", { serviceId });
        wait.textContent = `${queue.waitMinutes} minutes`;
        message.textContent = `You joined ${queue.serviceName}. Position: ${queue.position}.`;
        leaveButton.disabled = false;
    } catch (error) {
        message.textContent = error.message;
        joinButton.disabled = false;
        service.disabled = false;
    }
});

leaveButton.addEventListener("click", async () => {
    if (leaveButton.disabled) return;
    leaveButton.disabled = true;
    message.textContent = "Leaving…";

    try {
        const result = await postQueue("../Backend/leave-queue.php", {});
        wait.textContent = "—";
        service.value = "";
        service.disabled = false;
        joinButton.disabled = false;
        message.textContent = result.left
            ? "You left the queue."
            : "You are no longer in a queue.";
    } catch (error) {
        // Keep the last known state in case the user needs to try again.
        message.textContent = error.message;
        leaveButton.disabled = false;
    }
});