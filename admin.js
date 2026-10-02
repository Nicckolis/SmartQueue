//shared sample data for the three admin pages
const storageKey = "queueSmart.simpleAdmin.v1";

let services = [
    {
        name: "Prescription Pickup",
        description: "Pick up a prepared prescription.",
        durationMinutes: 3,
        priority: "low",
        isOpen: true,
        queue: ["Alex", "Sam", "Jordan"]
    },
    {
        name: "Consultation",
        description: "Meet with a staff member.",
        durationMinutes: 15,
        priority: "medium",
        isOpen: true,
        queue: ["Casey", "Riley"]
    }
];

// load previously saved services if theyre available
try {
    const savedServices = localStorage.getItem(storageKey);

    if (savedServices !== null) {
        const saved = JSON.parse(savedServices);

        if (!Array.isArray(saved) || saved.length === 0) {
            throw new Error("Invalid saved services.");
        }

        const valid = saved.every(function (service) {
            return service &&
                typeof service.name === "string" &&
                typeof service.description === "string" &&
                Number.isInteger(service.durationMinutes) &&
                service.durationMinutes > 0 &&
                ["low", "medium", "high"].includes(service.priority) &&
                typeof service.isOpen === "boolean" &&
                Array.isArray(service.queue) &&
                service.queue.every(function (name) {
                    return typeof name === "string";
                });
        });

        if (!valid) {
            throw new Error("Invalid saved services.");
        }

        services = saved;
    }
} catch {
    showMessage("Saved data could not be loaded. Using sample data.");
}

function showMessage(text) {
    document.getElementById("message").textContent = text;
}

function saveServices() {
    try {
        localStorage.setItem(storageKey, JSON.stringify(services));
        return true;
    } catch {
        showMessage(
            "Browser storage is unavailable. Changes cannot be saved."
        );
        return false;
    }
}

//small helpers for building tables and buttons
function addCell(row, text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    row.appendChild(cell);
    return cell;
}

function makeButton(text, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", action);
    return button;
}


// the admin dashboard

const dashboardBody = document.getElementById("dashboard-services");

function displayDashboard() {
    dashboardBody.textContent = "";

    services.forEach(function (service, index) {
        const row = document.createElement("tr");

        addCell(row, service.name);
        addCell(row, service.queue.length);
        addCell(row, service.isOpen ? "Open" : "Closed");

        const actionCell = addCell(row, "");

        const button = makeButton(
            service.isOpen ? "Close Queue" : "Open Queue",
            function () {
                services[index].isOpen = !services[index].isOpen;

                const saved = saveServices();
                displayDashboard();

                if (saved) {
                    showMessage(
                        service.name + " is now " +
                        (service.isOpen ? "open." : "closed.")
                    );
                }
            }
        );

        actionCell.appendChild(button);
        dashboardBody.appendChild(row);
    });
}

if (dashboardBody) {
    displayDashboard();
}


// the service management

const serviceForm = document.getElementById("service-form");
let editingIndex = null;

function displayServices() {
    const list = document.getElementById("service-list");
    list.textContent = "";

    services.forEach(function (service, index) {
        const item = document.createElement("li");
        const details = document.createElement("p");

        details.textContent =
            service.name + " — " + service.description +
            " | " + service.durationMinutes + " minutes" +
            " | Priority: " + service.priority;

        const editButton = makeButton("Edit", function () {
            editService(index);
        });

        item.appendChild(details);
        item.appendChild(editButton);
        list.appendChild(item);
    });
}

function editService(index) {
    const service = services[index];

    document.getElementById("service-name").value = service.name;
    document.getElementById("service-description").value =
        service.description;
    document.getElementById("service-duration").value =
        service.durationMinutes;
    document.getElementById("service-priority").value =
        service.priority;

    editingIndex = index;

    document.getElementById("form-title").textContent = "Edit Service";
    document.getElementById("save-service").textContent = "Save Changes";
    document.getElementById("cancel-edit").hidden = false;

    showMessage("");
    document.getElementById("service-name").focus();
}

function resetServiceForm() {
    serviceForm.reset();
    editingIndex = null;

    document.getElementById("form-title").textContent = "Create Service";
    document.getElementById("save-service").textContent = "Create Service";
    document.getElementById("cancel-edit").hidden = true;
}

if (serviceForm) {
    displayServices();

    serviceForm.addEventListener("submit", function (event) {
        event.preventDefault();

        const name =
            document.getElementById("service-name").value.trim();
        const description =
            document.getElementById("service-description").value.trim();
        const duration =
            Number(document.getElementById("service-duration").value);
        const priority =
            document.getElementById("service-priority").value;

        if (name === "" || name.length > 100 || description === "") {
            showMessage(
                "Enter a name of 1–100 characters and a description."
            );
            return;
        }

        if (!Number.isSafeInteger(duration) || duration < 1) {
            showMessage("Enter a positive whole number of minutes.");
            return;
        }

        if (!["low", "medium", "high"].includes(priority)) {
            showMessage("Choose low, medium, or high priority.");
            return;
        }

        let action;

        if (editingIndex === null) {
            services.push({
                name: name,
                description: description,
                durationMinutes: duration,
                priority: priority,
                isOpen: true,
                queue: []
            });

            action = "created";
        } else {
            // Update the details without changing the existing queue.
            const service = services[editingIndex];

            service.name = name;
            service.description = description;
            service.durationMinutes = duration;
            service.priority = priority;

            action = "updated";
        }

        const saved = saveServices();

        displayServices();
        resetServiceForm();

        if (saved) {
            showMessage(name + " was " + action + ".");
        }
    });

    document.getElementById("cancel-edit").addEventListener(
        "click",
        function () {
            resetServiceForm();
            showMessage("Edit canceled. No changes saved.");
        }
    );
}


// the queue management

const queueSelect = document.getElementById("queue-service");

function displayQueue() {
    const serviceIndex = Number(queueSelect.value);
    const service = services[serviceIndex];
    const queueBody = document.getElementById("queue-list");

    queueBody.textContent = "";

    document.getElementById("queue-status").textContent =
        "Queue status: " + (service.isOpen ? "Open" : "Closed") +
        " | People waiting: " + service.queue.length;

    document.getElementById("serve-next").disabled =
        service.queue.length === 0;

    document.getElementById("empty-queue").hidden =
        service.queue.length !== 0;

    service.queue.forEach(function (name, index) {
        const row = document.createElement("tr");

        addCell(row, index + 1);
        addCell(row, name);
        addCell(row, index * service.durationMinutes + " minutes");

        const actions = addCell(row, "");

        const upButton = makeButton("Move Up", function () {
            moveUser(index, -1);
        });
        upButton.disabled = index === 0;

        const downButton = makeButton("Move Down", function () {
            moveUser(index, 1);
        });
        downButton.disabled = index === service.queue.length - 1;

        const removeButton = makeButton("Remove", function () {
            removeUser(index);
        });

        actions.appendChild(upButton);
        actions.appendChild(downButton);
        actions.appendChild(removeButton);

        queueBody.appendChild(row);
    });
}

function moveUser(index, direction) {
    const service = services[Number(queueSelect.value)];
    const newIndex = index + direction;

    if (newIndex < 0 || newIndex >= service.queue.length) {
        return;
    }

    const name = service.queue[index];

    service.queue[index] = service.queue[newIndex];
    service.queue[newIndex] = name;

    const saved = saveServices();
    displayQueue();

    if (saved) {
        showMessage(name + " moved to position " + (newIndex + 1) + ".");
    }
}

function removeUser(index) {
    const service = services[Number(queueSelect.value)];
    const name = service.queue[index];

    if (!window.confirm("Remove " + name + " from this queue?")) {
        return;
    }

    service.queue.splice(index, 1);

    const saved = saveServices();
    displayQueue();

    if (saved) {
        showMessage(name + " was removed from the queue.");
    }
}

if (queueSelect) {
    services.forEach(function (service, index) {
        const option = document.createElement("option");
        option.value = index;
        option.textContent = service.name;
        queueSelect.appendChild(option);
    });

    queueSelect.addEventListener("change", function () {
        showMessage("");
        displayQueue();
    });

    document.getElementById("serve-next").addEventListener(
        "click",
        function () {
            const service = services[Number(queueSelect.value)];

            if (service.queue.length === 0) {
                return;
            }

            const name = service.queue.shift();

            const saved = saveServices();
            displayQueue();

            if (saved) {
                showMessage(name + " was served.");
            }
        }
    );

    displayQueue();
}