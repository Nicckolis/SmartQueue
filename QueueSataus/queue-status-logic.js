// Queue Status screen. Reads queue-status.php and leaves through leave-queue.php.

const STATUS_REFRESH_MS = 5000;

const statusLabels = {
  waiting: "Waiting",
  almost_ready: "Almost ready",
  served: "Served",
};

let busy = false;
let hasLoaded = false;
// "left" keeps the leave confirmation up while the page keeps refreshing.
let messageMode = "loading";

function setMessage(text) {
  document.getElementById("status-message").textContent = text;
}

function renderQueueStatus(entry) {
  const badge = document.getElementById("status-badge");
  const leaveBtn = document.getElementById("leave-queue");

  if (entry === null) {
    document.getElementById("status-service-name").textContent = "—";
    badge.dataset.status = "";
    badge.textContent = "Not in a queue";
    document.getElementById("status-position").textContent = "—";
    document.getElementById("status-wait").textContent = "—";
    document.getElementById("status-note").textContent = "You are not currently in a queue.";
    leaveBtn.disabled = true;
    return;
  }

  document.getElementById("status-service-name").textContent = entry.serviceName;
  badge.dataset.status = entry.status;
  badge.textContent = statusLabels[entry.status] || entry.status;

  const finished = entry.status === "served" || entry.position == null;
  document.getElementById("status-position").textContent = finished ? "—" : String(entry.position);
  document.getElementById("status-wait").textContent =
    finished || entry.waitMinutes == null ? "—" : `${entry.waitMinutes} min`;
  document.getElementById("status-note").textContent =
    typeof entry.note === "string" && entry.note !== "" ? entry.note : "";
  leaveBtn.disabled = entry.status === "served";
}

function readQueueStatus(data) {
  if (!data || !Object.hasOwn(data, "queueStatus")) {
    throw new Error("The endpoint did not return a queueStatus field.");
  }

  const entry = data.queueStatus;
  if (entry === null) return null;

  const statuses = ["waiting", "almost_ready", "served"];
  if (!entry || typeof entry.serviceName !== "string" || entry.serviceName.trim() === "" ||
      !statuses.includes(entry.status)) {
    throw new Error("The endpoint returned an invalid queue status.");
  }

  if (entry.status !== "served") {
    if (!Number.isSafeInteger(entry.position) || entry.position < 1 ||
        !Number.isSafeInteger(entry.waitMinutes) || entry.waitMinutes < 0) {
      throw new Error("The endpoint returned an invalid queue status.");
    }
  }

  return entry;
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      ...options,
    });
  } catch (error) {
    throw new Error("Could not reach the server.");
  }

  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw new Error(`HTTP ${response.status}: the endpoint did not return JSON.`);
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || `Queue request failed (HTTP ${response.status}).`);
  }
  return data;
}

async function loadStatus() {
  return readQueueStatus(await requestJson("../Backend/queue-status.php"));
}

async function refreshStatus() {
  if (busy) return;
  busy = true;
  if (!hasLoaded) setMessage("Loading your queue status…");

  try {
    const entry = await loadStatus();
    renderQueueStatus(entry);
    hasLoaded = true;
    const backInLine = entry !== null && entry.status !== "served";
    if (backInLine || messageMode !== "left") {
      messageMode = "ready";
      setMessage("");
    }
  } catch (error) {
    messageMode = "error";
    setMessage(error.message);
    if (!hasLoaded) {
      document.getElementById("status-badge").textContent = "Unavailable";
      document.getElementById("status-note").textContent = "Queue status is unavailable.";
    }
  } finally {
    busy = false;
  }
}

async function leaveCurrentQueue() {
  const data = await requestJson("../Backend/leave-queue.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (typeof data.left !== "boolean") {
    throw new Error("The endpoint did not confirm the leave result.");
  }

  return data;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("leave-queue").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    document.getElementById("leave-queue").disabled = true;
    messageMode = "leaving";
    setMessage("Leaving the queue…");

    try {
      const data = await leaveCurrentQueue();
      renderQueueStatus(await loadStatus());
      hasLoaded = true;
      messageMode = "left";
      setMessage(data.left ? "You've left the queue." : "You are not currently in a queue.");
      if (typeof window.refreshQueueNotifications === "function") {
        await window.refreshQueueNotifications();
      }
    } catch (error) {
      messageMode = "error";
      setMessage(`${error.message} Refresh the page to check your queue.`);
      document.getElementById("leave-queue").disabled = false;
    } finally {
      busy = false;
    }
  });

  window.addEventListener("focus", refreshStatus);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refreshStatus();
  });
  window.setInterval(refreshStatus, STATUS_REFRESH_MS);
  refreshStatus();
});
