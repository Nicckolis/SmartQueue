// History screen. Loads this user's visits from history.php.

const outcomeLabels = {
  waiting: "Waiting",
  served: "Picked up",
  left: "Cancelled",
  cancelled: "Cancelled",
  removed: "Removed",
  no_show: "No-show",
};

let serviceNames = [];
let loadToken = 0;

function formatDate(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "—";
  }

  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function showHistoryMessage(text) {
  const list = document.getElementById("history-list");
  const emptyMessage = document.getElementById("history-empty");
  list.replaceChildren();
  list.hidden = true;
  emptyMessage.hidden = false;
  emptyMessage.textContent = text;
}

function renderHistory(entries) {
  const list = document.getElementById("history-list");
  const emptyMessage = document.getElementById("history-empty");
  list.replaceChildren();

  if (entries.length === 0) {
    list.hidden = true;
    emptyMessage.hidden = false;
    emptyMessage.textContent = "No visits match this filter yet.";
    return;
  }

  list.hidden = false;
  emptyMessage.hidden = true;

  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = "history-entry";

    const main = document.createElement("div");
    main.className = "history-entry-main";

    const service = document.createElement("span");
    service.className = "history-entry-service";
    service.textContent = entry.serviceName;

    const date = document.createElement("span");
    date.className = "history-entry-date";
    date.textContent = formatDate(entry.joinedAt);

    const outcome = document.createElement("span");
    outcome.className = "history-outcome";
    outcome.dataset.outcome = entry.outcome;
    outcome.textContent = outcomeLabels[entry.outcome] || entry.outcome;

    main.append(service, date);
    item.append(main, outcome);
    list.append(item);
  }
}

function uniqueServiceNames(rows) {
  const names = [];
  for (const row of rows) {
    if (!names.includes(row.serviceName)) {
      names.push(row.serviceName);
    }
  }
  return names;
}

function fillFilter(selected) {
  const filter = document.getElementById("history-filter");
  const previous = filter.disabled;
  filter.replaceChildren(new Option("All services", "all"));
  for (const name of serviceNames) {
    filter.append(new Option(name, name));
  }
  filter.value = selected === "all" || serviceNames.includes(selected) ? selected : "all";
  filter.disabled = previous;
}

async function requestJson(url) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
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
    throw new Error(data?.error || `Could not load your history (HTTP ${response.status}).`);
  }
  return data;
}

async function fetchHistory(serviceName) {
  const params = new URLSearchParams();
  if (serviceName && serviceName !== "all") {
    params.set("serviceName", serviceName);
  }
  const query = params.toString();
  const data = await requestJson("../Backend/history.php" + (query ? `?${query}` : ""));

  if (!data || !Array.isArray(data.history)) {
    throw new Error("The endpoint did not return a history list.");
  }

  for (const row of data.history) {
    if (!row || typeof row.serviceName !== "string" || typeof row.outcome !== "string") {
      throw new Error("The endpoint returned an invalid history record.");
    }
  }

  return data.history;
}

async function loadHistory(serviceName) {
  const token = ++loadToken;
  const filter = document.getElementById("history-filter");
  filter.disabled = true;
  showHistoryMessage("Loading your history…");

  try {
    const rows = await fetchHistory(serviceName);
    if (token !== loadToken) return;
    if (serviceName === "all") {
      serviceNames = uniqueServiceNames(rows);
    }
    fillFilter(serviceName);
    renderHistory(rows);
  } catch (error) {
    if (token !== loadToken) return;
    fillFilter(serviceName);
    const message = error instanceof Error ? error.message : "Could not load your history.";
    showHistoryMessage(`${message} Refresh the page to try again.`);
  } finally {
    if (token === loadToken) filter.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const filter = document.getElementById("history-filter");
  filter.addEventListener("change", (event) => {
    loadHistory(event.target.value);
  });
  loadHistory("all");
});
