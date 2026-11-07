// Shared in-app notification component.
// Usage from any page (after this script loads):
//   showNotification("Your prescription is ready!", "success");
//
// type: "info" (default) | "success" | "warning"
// - info:    general queue/status updates
// - success: positive confirmations (e.g. "almost ready")
// - warning: cancellations, no-shows, errors
//
// This file also reads the signed-in user's saved notifications,
// shows each new one once, and can mark one or all of them read.

const NOTIFICATION_DURATION_MS = 5000;
const NOTIFICATION_POLL_MS = 5000;
const SHOWN_KEY = "queuesmart-shown-notification-ids";

const notificationBackend = document.currentScript
  ? new URL("../Backend/", document.currentScript.src)
  : null;

const shownNotificationIds = loadShownIds();
let polling = false;
let pollAgain = false;

function loadShownIds() {
  const ids = new Set();
  try {
    const saved = JSON.parse(sessionStorage.getItem(SHOWN_KEY) || "[]");
    if (Array.isArray(saved)) {
      for (const id of saved) {
        if (Number.isSafeInteger(id) && id > 0) ids.add(id);
      }
    }
  } catch (error) {
    // Storage can be blocked. The in-memory set still stops duplicates.
  }
  return ids;
}

function rememberShownId(id) {
  shownNotificationIds.add(id);
  const saved = [...shownNotificationIds].slice(-100);
  shownNotificationIds.clear();
  for (const item of saved) shownNotificationIds.add(item);
  try {
    sessionStorage.setItem(SHOWN_KEY, JSON.stringify(saved));
  } catch (error) {
    // Ignore storage failures. The Set above still works on this page.
  }
}

function toastType(eventType) {
  if (eventType === "joined" || eventType === "almost_ready" || eventType === "served") {
    return "success";
  }
  if (eventType === "left" || eventType === "removed" || eventType === "no_show") {
    return "warning";
  }
  return "info";
}

function ensureNotificationContainer() {
  let container = document.getElementById("notification-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "notification-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  return container;
}

function showNotification(message, type = "info", notificationId = null) {
  const container = ensureNotificationContainer();

  const note = document.createElement("div");
  note.className = "notification";
  note.dataset.type = type;
  note.setAttribute("role", "status");
  if (Number.isSafeInteger(notificationId) && notificationId > 0) {
    note.dataset.notificationId = String(notificationId);
  }
  note.innerHTML = `
    <span class="notification-message"></span>
    <button type="button" class="notification-close" aria-label="Dismiss notification">&times;</button>
  `;
  note.querySelector(".notification-message").textContent = message;
  container.appendChild(note);

  const remove = () => {
    note.classList.add("notification-hide");
    setTimeout(() => note.remove(), 200);
  };

  note.querySelector(".notification-close").addEventListener("click", () => {
    if (Number.isSafeInteger(notificationId) && notificationId > 0) {
      markQueueNotificationRead(notificationId).catch(() => {});
    }
    remove();
  });
  const timer = setTimeout(remove, NOTIFICATION_DURATION_MS);

  // Pause auto-dismiss while hovered, so a message isn't missed mid-read.
  note.addEventListener("mouseenter", () => clearTimeout(timer));
  note.addEventListener("mouseleave", () => setTimeout(remove, NOTIFICATION_DURATION_MS));
}

async function readJsonResponse(response, fallback) {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw new Error(`HTTP ${response.status}: the endpoint did not return JSON.`);
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error((data && data.error) || fallback);
  }
  return data;
}

async function fetchNotificationList() {
  let response;
  try {
    response = await fetch(new URL("notifications.php", notificationBackend), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    throw new Error("Could not reach the server.");
  }
  const data = await readJsonResponse(response, "Could not load your notifications.");
  if (!Array.isArray(data.notifications)) {
    throw new Error("The endpoint did not return a notifications list.");
  }
  return data.notifications;
}

function showNewNotifications(notes) {
  for (const note of notes) {
    if (!note || note.read !== false || !Number.isSafeInteger(note.id) || note.id < 1 ||
        shownNotificationIds.has(note.id) || typeof note.message !== "string" || note.message === "") {
      continue;
    }
    // Remember the id before showing it, so the next refresh cannot pop it up again.
    rememberShownId(note.id);
    showNotification(note.message, toastType(note.type), note.id);
  }
}

async function pollOnce() {
  const notes = await fetchNotificationList();
  window.dispatchEvent(new CustomEvent("queue-notifications", { detail: notes }));
  showNewNotifications(notes);
}

async function refreshQueueNotifications() {
  if (!notificationBackend) return;
  if (polling) {
    pollAgain = true;
    return;
  }

  polling = true;
  try {
    do {
      pollAgain = false;
      try {
        await pollOnce();
      } catch (error) {
        const message = error instanceof Error && error.message
          ? error.message
          : "Could not load your notifications.";
        window.dispatchEvent(new CustomEvent("queue-notifications-error", { detail: message }));
      }
    } while (pollAgain);
  } finally {
    polling = false;
  }
}

async function postNotification(file, body, fallback) {
  let response;
  try {
    response = await fetch(new URL(file, notificationBackend), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error("Could not reach the server.");
  }
  return readJsonResponse(response, fallback);
}

async function markQueueNotificationRead(eventId) {
  if (!Number.isSafeInteger(eventId) || eventId < 1) {
    throw new Error("Notification not found.");
  }
  await postNotification(
    "mark-notification-read.php",
    { eventId: eventId },
    "Could not update that notification."
  );
  await refreshQueueNotifications();
}

async function markAllQueueNotificationsRead() {
  await postNotification(
    "mark-all-notifications-read.php",
    {},
    "Could not update your notifications."
  );
  await refreshQueueNotifications();
}

window.showNotification = showNotification;
window.refreshQueueNotifications = refreshQueueNotifications;
window.markQueueNotificationRead = markQueueNotificationRead;
window.markAllQueueNotificationsRead = markAllQueueNotificationsRead;

document.addEventListener("DOMContentLoaded", () => {
  refreshQueueNotifications();
  window.setInterval(refreshQueueNotifications, NOTIFICATION_POLL_MS);
});
