import {
    createService,
    updateService,
    listServices
} from "../Backend/service-actions.js";

import {
    STORE_STORAGE_KEY,
    loadStore,
    saveStore
} from "../Backend/shared-store.js";

const form = document.getElementById("service-form");
const list = document.getElementById("service-list");
const message = document.getElementById("message");

const nameInput = document.getElementById("service-name");
const descriptionInput = document.getElementById("service-description");
const durationInput = document.getElementById("service-duration");
const priorityInput = document.getElementById("service-priority");

// null means create a service. Otherwise, this holds the ID of the service being edited.
let editingServiceId = null;

function requireAdminPage() {
    if (!accountStorage.isCurrentUserAdmin()) {
        window.location.replace("../LogIn/queue-login.html");
        return false;
    }

    return true;
}

function showError(error) {
    if (error.status === 401 || error.status === 403) {
        window.location.replace("../LogIn/queue-login.html");
        return;
    }

    message.textContent = error.message || "The operation failed.";
}

// Clear the form and switch back to creating a service. Nothing is saved here.
function resetForm() {
    form.reset();
    editingServiceId = null;

    document.getElementById("form-title").textContent = "Create Service";
    document.getElementById("save-service").textContent = "Create Service";
    document.getElementById("cancel-edit").hidden = true;
}

// Read the current services and rebuild the list on the page.
function renderServices() {
    const store = loadStore();
    const services = listServices(store, accountStorage);

    list.replaceChildren();

    if (services.length === 0) {
        const item = document.createElement("li");
        item.textContent = "No services yet. Create one above.";
        list.appendChild(item);
        return;
    }

    for (const service of services) {
        const item = document.createElement("li");
        const details = document.createElement("p");
        const editButton = document.createElement("button");

        details.textContent =
            service.name + " — " + service.description +
            " | " + service.expectedDuration + " minutes" +
            " | Priority: " + service.priority +
            " | " + (service.isOpen ? "Open" : "Closed");

        editButton.type = "button";
        editButton.textContent = "Edit";

        editButton.addEventListener("click", function () {
            editService(service.id);
        });

        item.appendChild(details);
        item.appendChild(editButton);
        list.appendChild(item);
    }
}

// Put the selected service into the form so the admin can change its details.
function editService(serviceId) {
    if (!requireAdminPage()) {
        return;
    }

    try {
        const store = loadStore();
        const services = listServices(store, accountStorage);
        const service = services.find(item => item.id === serviceId);

        if (!service) {
            throw new Error("That service no longer exists.");
        }

        nameInput.value = service.name;
        descriptionInput.value = service.description;
        durationInput.value = service.expectedDuration;
        priorityInput.value = service.priority;

        editingServiceId = service.id;

        document.getElementById("form-title").textContent = "Edit Service";
        document.getElementById("save-service").textContent = "Save Changes";
        document.getElementById("cancel-edit").hidden = false;

        message.textContent = "";
        nameInput.focus();
    } catch (error) {
        showError(error);
    }
}

function handleSubmit(event) {
    // Keep the browser from reloading the page when the form is submitted.
    event.preventDefault();

    if (!requireAdminPage()) {
        return;
    }

    message.textContent = "";

    const input = {
        name: nameInput.value,
        description: descriptionInput.value,
        expectedDuration: Number(durationInput.value),
        priority: priorityInput.value
    };

    try {
        // Read the latest saved data before making a change
        const store = loadStore();

        let result;
        let action;

        if (editingServiceId === null) {
            result = createService(store, accountStorage, input);
            action = "created";
        } else {
            result = updateService(
                store,
                accountStorage,
                editingServiceId,
                input
            );
            action = "updated";
        }

        // Save before clearing the form, so a failed save leaves the entered values in place.
        saveStore(store);

        resetForm();
        renderServices();
        message.textContent = result.name + " was " + action + ".";
    } catch (error) {
        showError(error);
    }
}

function refreshPage() {
    if (!requireAdminPage()) {
        return;
    }

    try {
        renderServices();
    } catch (error) {
        showError(error);
    }
}

form.addEventListener("submit", handleSubmit);

document.getElementById("cancel-edit").addEventListener(
    "click",
    function () {
        resetForm();
        message.textContent = "Edit canceled. No changes saved.";
    }
);

// Refresh the list after another tab saves changes.
window.addEventListener("storage", function (event) {
    if (event.key === STORE_STORAGE_KEY || event.key === null) {
        refreshPage();
    }
});

// Also recheck access when returning through browser navigation
window.addEventListener("pageshow", refreshPage);

refreshPage();