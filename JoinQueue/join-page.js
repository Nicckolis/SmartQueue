const form = document.getElementById("join-queue-form");
const service = document.getElementById("service");
const joinButton = document.getElementById("join-queue");
const leaveButton = document.getElementById("leave-queue");
const wait = document.getElementById("estimated-wait");
const message = document.getElementById("queue-message");

let currentQueue = null;
let known = false;
let busy = false;
let offers = new Map(); // Numeric database IDs are strings only inside the <select>.

async function request(file, payload) {
    const options = { method: "GET", credentials: "same-origin", cache: "no-store" };
    if (payload !== undefined) {
        options.method = "POST";
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(payload);
    }
    const response = await fetch(`../Backend/${file}`, options);
    if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error(`HTTP ${response.status}: the endpoint did not return JSON.`);
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || `Queue request failed (HTTP ${response.status}).`);
    return data;
}

function queueFrom(data) {
    if (!data || !Object.hasOwn(data, "currentQueue")) {
        throw new Error("The endpoint did not return a currentQueue field.");
    }
    const q = data.currentQueue;
    if (q !== null && !(q && Number.isSafeInteger(q.serviceId) && q.serviceId > 0 &&
        typeof q.serviceName === "string" && Number.isSafeInteger(q.position) && q.position > 0 &&
        Number.isSafeInteger(q.waitMinutes) && q.waitMinutes >= 0)) {
        throw new Error("The endpoint returned an invalid visit.");
    }
    return q;
}

function option(value, label) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = label;
    return item;
}

function minutes(n) { return `${n} ${n === 1 ? "minute" : "minutes"}`; }

function clearChoices(label) {
    offers = new Map();
    service.replaceChildren(option("", label));
    service.value = "";
    wait.textContent = "—";
}

function updateControls() {
    const canChoose = !busy && known && currentQueue === null && offers.size > 0;
    service.disabled = !canChoose;
    joinButton.disabled = !canChoose || !offers.has(service.value);
    leaveButton.disabled = busy || !known || currentQueue === null;
}

function showPreview() {
    if (currentQueue !== null) return; // An active visit has its own confirmed wait.
    const selected = offers.get(service.value);
    wait.textContent = selected ? minutes(selected.estimatedWaitMinutes) : "—";
}

function choiceHint() {
    if (!offers.size) return "No services are open right now.";
    return offers.has(service.value) ? "Select Join queue to confirm." : "Choose a service to see its estimated wait.";
}

function showVisit(q) {
    currentQueue = q;
    known = true;
    clearChoices("Choose a service");
    if (q === null) return;
    // Even if its service has closed, an existing visit must remain visible and leaveable.
    const item = option(String(q.serviceId), q.serviceName);
    item.disabled = true;
    service.appendChild(item);
    service.value = item.value;
    wait.textContent = minutes(q.waitMinutes);
    message.textContent = `You are in the queue for ${q.serviceName}. Position: ${q.position}.`;
}

async function loadChoices(preferred = "", confirmation = "") {
    clearChoices("Loading services…");
    message.textContent = confirmation || "Loading available services…";
    try {
        const data = await request("available-services.php");
        if (!Array.isArray(data?.services)) throw new Error("The service list was not returned.");

        const choices = new Map();
        for (const row of data.services) {
            if (!row || !Number.isSafeInteger(row.id) || row.id < 1 ||
                typeof row.name !== "string" || !row.name.trim() ||
                !Number.isSafeInteger(row.estimatedWaitMinutes) || row.estimatedWaitMinutes < 0 ||
                choices.has(String(row.id))) throw new Error("The endpoint returned an invalid service.");
            choices.set(String(row.id), row);
        }
        clearChoices(choices.size ? "Choose a service" : "No open services");
        offers = choices;
        for (const [id, row] of offers) service.appendChild(option(id, row.name));
        service.value = offers.has(preferred) ? preferred : "";
        showPreview();
        const hint = choiceHint();
        message.textContent = confirmation ? (offers.size ? confirmation : `${confirmation} ${hint}`) : hint;
    } catch (error) {
        clearChoices("Services unavailable");
        message.textContent = `${confirmation ? confirmation + " " : ""}${error.message} Refresh the page to try again.`;
    }
}

async function refreshPage() {
    if (busy) return;
    const preferred = currentQueue === null ? service.value : "";
    busy = true;
    known = false;
    clearChoices("Choose a service");
    updateControls();
    message.textContent = "Loading your queue…";
    try {
        const q = queueFrom(await request("current-queue.php"));
        showVisit(q);
        // A catalogue outage must never stop someone from leaving their current visit.
        if (q === null) await loadChoices(preferred);
    } catch (error) {
        currentQueue = null;
        message.textContent = `${error.message} Refresh the page to check again.`;
    } finally {
        busy = false;
        updateControls();
    }
}

service.addEventListener("change", () => {
    showPreview();
    updateControls();
    if (!busy && known && currentQueue === null && offers.size) message.textContent = choiceHint();
});

form.addEventListener("submit", async event => {
    event.preventDefault();
    const selected = offers.get(service.value);
    if (busy || !known || currentQueue !== null || !selected) return;
    busy = true;
    updateControls();
    message.textContent = "Joining…";
    try {
        const q = queueFrom(await request("join-queue.php", { serviceId: selected.id }));
        if (q === null) throw new Error("The joined visit was not returned.");
        showVisit(q); // Use the actual position/wait at insertion, not the old preview.
        message.textContent = `You joined ${q.serviceName}. Position: ${q.position}.`;
    } catch (error) {
        known = false;
        clearChoices("Choose a service");
        message.textContent = `${error.message} Refresh the page to check your queue before trying again.`;
    } finally {
        busy = false;
        updateControls();
    }
});

leaveButton.addEventListener("click", async () => {
    if (busy || !known || currentQueue === null) return;
    busy = true;
    updateControls();
    message.textContent = "Leaving…";
    try {
        const data = await request("leave-queue.php", {});
        if (queueFrom(data) !== null || typeof data.left !== "boolean") {
            throw new Error("The endpoint did not confirm the leave result.");
        }
        showVisit(null);
        await loadChoices("", data.left ? "You left the queue." : "You are no longer in a queue.");
    } catch (error) {
        // The leave could have committed even if its response was lost.
        known = false;
        message.textContent = `${error.message} Refresh the page to check your queue before trying again.`;
    } finally {
        busy = false;
        updateControls();
    }
});

window.addEventListener("focus", refreshPage);
window.addEventListener("pageshow", event => { if (event.persisted) refreshPage(); });
refreshPage();