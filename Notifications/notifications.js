// Shared in-app notification component.
// Usage from any page (after this script loads):
//   showNotification("Your prescription is ready!", "success");
//
// type: "info" (default) | "success" | "warning"
// - info:    general queue/status updates
// - success: positive confirmations (e.g. "almost ready")
// - warning: cancellations, no-shows, errors

const NOTIFICATION_DURATION_MS = 5000;

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

function showNotification(message, type = "info") {
  const container = ensureNotificationContainer();

  const note = document.createElement("div");
  note.className = "notification";
  note.dataset.type = type;
  note.setAttribute("role", "status");
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

  note.querySelector(".notification-close").addEventListener("click", remove);
  const timer = setTimeout(remove, NOTIFICATION_DURATION_MS);

  // Pause auto-dismiss while hovered, so a message isn't missed mid-read.
  note.addEventListener("mouseenter", () => clearTimeout(timer));
  note.addEventListener("mouseleave", () => setTimeout(remove, NOTIFICATION_DURATION_MS));
}

// Expose globally so any page's own script can call it after this loads.
window.showNotification = showNotification;
