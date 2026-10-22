// Create an application error with a code
// These codes describe errors that are not HTTP responses
function serviceError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

// Use existing account manager to check the current session
function requireServiceAdmin(accounts) {
    if (!accounts.getCurrentUser()) {
        throw serviceError(401, "Please log in first.");
    }

    if (!accounts.isCurrentUserAdmin()) {
        throw serviceError(403, "Only administrators can manage services.");
    }
}

// Validate and return only the fields the caller may supply.
function validateServiceInput(input) {
    if (input === null ||
        typeof input !== "object" ||
        Array.isArray(input)) {
        throw serviceError(400, "Service details must be an object.");
    }

    if (typeof input.name !== "string") {
        throw serviceError(400, "Service name must be text.");
    }

    const name = input.name.trim();

    if (name.length === 0 || name.length > 100) {
        throw serviceError(
            400,
            "Service name must contain 1–100 characters."
        );
    }

    if (typeof input.description !== "string") {
        throw serviceError(400, "Description must be text.");
    }

    const description = input.description.trim();

    if (description.length === 0 || description.length > 1000) {
        throw serviceError(
            400,
            "Description must contain 1–1000 characters."
        );
    }

    if (!Number.isSafeInteger(input.expectedDuration) ||
        input.expectedDuration < 1) {
        throw serviceError(
            400,
            "Expected duration must be a positive whole number."
        );
    }

    if (!["low", "medium", "high"].includes(input.priority)) {
        throw serviceError(400, "Priority must be low, medium, or high.");
    }

    return {
        name: name,
        description: description,
        expectedDuration: input.expectedDuration,
        priority: input.priority
    };
}

// Check the admin and input first, then add the new service to the store.
function createService(store, accounts, input) {
    requireServiceAdmin(accounts);

    const details = validateServiceInput(input);

    const service = {
        id: crypto.randomUUID(),
        ...details,
        isOpen: true
    };

    store.services.push(service);

    return { ...service };
}

// Change the service details but keep its ID and open/closed setting.
function updateService(store, accounts, serviceId, input) {
    requireServiceAdmin(accounts);

    if (typeof serviceId !== "string" || serviceId.trim() === "") {
        throw serviceError(400, "A service ID is required.");
    }

    const index = store.services.findIndex(
        service => service.id === serviceId
    );

    if (index === -1) {
        throw serviceError(404, "Service not found.");
    }

    const details = validateServiceInput(input);

    const updatedService = {
        ...store.services[index],
        ...details
    };

    store.services[index] = updatedService;

    return { ...updatedService };
}

// Return copies so changing the results does not change the saved service fields.
function listServices(store, accounts) {
    requireServiceAdmin(accounts);

    return store.services.map(service => ({ ...service }));
}

export { createService, updateService, listServices };