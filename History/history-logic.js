// History screen logic
// Static mock history for now — swap for real/shared data once the team
// agrees on a format.

const mockHistory = [
  {
    service: "Prescription Pickup",
    date: "2026-09-28",
    outcome: "served",
  },
  {
    service: "New Prescription Fill",
    date: "2026-09-21",
    outcome: "served",
  },
  {
    service: "Vaccine / Injection",
    date: "2026-09-14",
    outcome: "served",
  },
  {
    service: "Pharmacist Consultation",
    date: "2026-09-10",
    outcome: "no_show",
  },
  {
    service: "Prescription Pickup",
    date: "2026-08-30",
    outcome: "cancelled",
  },
];

const outcomeLabels = {
  served: "Picked up",
  cancelled: "Cancelled",
  removed: "Removed",
  no_show: "No-show",
};

function formatDate(isoDate) {
  const date = new Date(isoDate + "T00:00:00");
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderHistory(entries) {
  const list = document.getElementById("history-list");
  const emptyMessage = document.getElementById("history-empty");

  list.innerHTML = "";

  if (entries.length === 0) {
    list.hidden = true;
    emptyMessage.hidden = false;
    return;
  }

  list.hidden = false;
  emptyMessage.hidden = true;

  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "history-entry";
    item.innerHTML = `
      <div class="history-entry-main">
        <span class="history-entry-service">${entry.service}</span>
        <span class="history-entry-date">${formatDate(entry.date)}</span>
      </div>
      <span class="history-outcome" data-outcome="${entry.outcome}">
        ${outcomeLabels[entry.outcome]}
      </span>
    `;
    list.appendChild(item);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderHistory(mockHistory);

  document.getElementById("history-filter").addEventListener("change", (e) => {
    const selected = e.target.value;
    const filtered =
      selected === "all"
        ? mockHistory
        : mockHistory.filter((entry) => entry.service === selected);
    renderHistory(filtered);
  });
});

