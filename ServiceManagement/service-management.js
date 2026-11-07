import { adminRequest, adminErrorMessage } from "../Admin/admin-api.js";

const form = document.getElementById("service-form");
const list = document.getElementById("service-list");
const message = document.getElementById("message");
const nameInput = document.getElementById("service-name");
const descriptionInput = document.getElementById("service-description");
const durationInput = document.getElementById("service-duration");
const priorityInput = document.getElementById("service-priority");
let services = [];
let editingServiceId = null;
let busy = false;

function setBusy(value) {
    busy = value;
    for (const control of [...form.elements, ...list.querySelectorAll("button")]) control.disabled = value;
}

function resetForm() {
    form.reset();
    editingServiceId = null;
    document.getElementById("form-title").textContent = "Create Service";
    document.getElementById("save-service").textContent = "Create Service";
    document.getElementById("cancel-edit").hidden = true;
}

function renderServices() {
    list.replaceChildren();
    if (services.length === 0) {
        const item = document.createElement("li");
        item.textContent = "No services yet. Create one above.";
        list.appendChild(item);
    }
    for (const service of services) {
        const item = document.createElement("li");
        const details = document.createElement("p");
        details.textContent = `${service.name} — ${service.description} | ${service.expectedDuration} minutes | Priority: ${service.priority} | ${service.isOpen ? "Open" : "Closed"}`;
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => {
            if (busy) return;
            editingServiceId = service.id;
            nameInput.value = service.name;
            descriptionInput.value = service.description;
            durationInput.value = service.expectedDuration;
            priorityInput.value = service.priority;
            document.getElementById("form-title").textContent = "Edit Service";
            document.getElementById("save-service").textContent = "Save Changes";
            document.getElementById("cancel-edit").hidden = false;
            message.textContent = "";
            nameInput.focus();
        });
        item.append(details, edit);
        list.appendChild(item);
    }
}

async function loadServices() {
    const data = await adminRequest("list-services.php");
    services = data.services;
    renderServices();
}

form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    const editing = editingServiceId !== null;
    const input = { name: nameInput.value, description: descriptionInput.value,
        expectedDuration: Number(durationInput.value), priority: priorityInput.value };
    if (editing) input.serviceId = editingServiceId;
    setBusy(true);
    message.textContent = "Saving…";
    try {
        const { service } = await adminRequest(editing ? "update-service.php" : "create-service.php", input);
        // Clear the form only after MySQL confirms the save.
        resetForm();
        message.textContent = `${service.name} was ${editing ? "updated" : "created"}.`;
        try { await loadServices(); }
        catch (error) { message.textContent += " Saved, but the list could not refresh: " + adminErrorMessage(error); }
    } catch (error) { message.textContent = adminErrorMessage(error); }
    finally { setBusy(false); }
});

document.getElementById("cancel-edit").addEventListener("click", () => {
    if (busy) return;
    resetForm();
    message.textContent = "Edit canceled. No changes saved.";
});

async function refreshPage() {
    if (busy) return;
    setBusy(true);
    try { await loadServices(); }
    catch (error) { list.replaceChildren(); message.textContent = adminErrorMessage(error); }
    finally { setBusy(false); }
}
window.addEventListener("focus", refreshPage);
window.addEventListener("pageshow", event => { if (event.persisted) refreshPage(); });
refreshPage();
