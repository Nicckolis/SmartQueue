// Queue Status screen logic
// Static mock snapshot for now — will be replaced once the team agrees on a
// shared mock-data format. Swap `mockQueueEntry` for real/shared data later.

const mockQueueEntry = {
  service: "New Prescription Fill",
  status: "waiting", // "waiting" | "almost-ready" | "served"
  position: 4,
  estimatedWaitMinutes: 18,
};

const statusLabels = {
  waiting: "Waiting",
  "almost-ready": "Almost ready",
  served: "Served",
};

const statusNotes = {
  waiting: "We'll notify you when you're almost up.",
  "almost-ready": "You're almost up — please head to the counter.",
  served: "You've been served. Thanks for waiting!",
};

function renderQueueStatus(entry) {
  document.getElementById("status-service-name").textContent = entry.service;

  const badge = document.getElementById("status-badge");
  badge.dataset.status = entry.status;
  badge.textContent = statusLabels[entry.status];

  document.getElementById("status-position").textContent =
    entry.status === "served" ? "—" : entry.position;
  document.getElementById("status-wait").textContent =
    entry.status === "served" ? "—" : `${entry.estimatedWaitMinutes} min`;

  document.getElementById("status-note").textContent = statusNotes[entry.status];

  const leaveBtn = document.getElementById("leave-queue");
  leaveBtn.disabled = entry.status === "served";
}

document.addEventListener("DOMContentLoaded", () => {
  renderQueueStatus(mockQueueEntry);

  // Notify the user when a status change needs their attention.
  if (mockQueueEntry.status === "almost-ready") {
    showNotification("You're almost up — please head to the counter.", "success");
  }

  document.getElementById("leave-queue").addEventListener("click", () => {
    document.getElementById("status-message").textContent =
      "You've left the queue.";
    document.getElementById("leave-queue").disabled = true;
    showNotification("You've left the queue.", "info");
  });
});
