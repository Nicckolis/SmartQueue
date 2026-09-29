const services =
{
    "service-1":
    {
        name: "Prescription Pickup", durationMinutes: 3
    },
    "service-2":
    {
        name: "Consultation", durationMinutes: 15
    }
};

function estimateWait(serviceId, peopleAhead)
{
    return peopleAhead * services[serviceId].durationMinutes;
}

// Temporary sample numbers of people ahead in each queue.
const mockPeopleAhead = {
    "service-1": 3,
    "service-2": 2
};

const serviceSelect = document.getElementById("service");
const waitDisplay = document.getElementById("estimated-wait");

function updateEstimatedWait()
{
    const serviceId = serviceSelect.value;

    // No service selected.
    if (!services[serviceId])
    {
        waitDisplay.textContent = "—";
        return;
    }

    const minutes = estimateWait(
        serviceId,
        mockPeopleAhead[serviceId]
    );

    waitDisplay.textContent = minutes + " minutes";
}

// Only run this on a page containing these elements.
if (serviceSelect && waitDisplay)
{
    serviceSelect.addEventListener("change", updateEstimatedWait);
    updateEstimatedWait();
}

const joinForm = document.getElementById("join-queue-form");
const joinButton = document.getElementById("join-queue");
const leaveButton = document.getElementById("leave-queue");
const queueMessage = document.getElementById("queue-message");


const QUEUE_STORAGE_KEY = "queueSmart.currentQueue";

function loadQueue()
{
    try
    {
        const savedData = localStorage.getItem(QUEUE_STORAGE_KEY);

        if (savedData === null)
        {
            return null;
        }

        const savedQueue = JSON.parse(savedData);

        // Only restore a queue for a service we recognize.
        if (!savedQueue || !services[savedQueue.serviceId])
        {
            return null;
        }

        return savedQueue;
    }
    catch
    {
        // Start without a queue if the saved data cannot be read.
        return null;
    }
}

function saveQueue()
{
    if (currentQueue === null)
    {
        localStorage.removeItem(QUEUE_STORAGE_KEY);
    }
    else
    {
        localStorage.setItem(
            QUEUE_STORAGE_KEY,
            JSON.stringify(currentQueue)
        );
    }
}

let currentQueue = loadQueue();


function joinQueue(event)
{
    // Keep the form from reloading the page.
    event.preventDefault();

    // Prevent joining a second queue.
    if (currentQueue !== null)
    {
        queueMessage.textContent =
            "Please leave your current queue before joining another.";
        return;
    }

    const serviceId = serviceSelect.value;
    const selectedService = services[serviceId];

    if (!selectedService)
    {
        queueMessage.textContent = "Please select a service.";
        return;
    }

    const peopleAhead = mockPeopleAhead[serviceId];

    currentQueue = {
        serviceId: serviceId,
        status: "Waiting",
        position: peopleAhead + 1,
        waitMinutes: estimateWait(serviceId, peopleAhead)
    };
    saveQueue();

    queueMessage.textContent =
        `You joined the ${selectedService.name} queue. ` +
        `Position: ${currentQueue.position}. ` +
        `Estimated wait: ${currentQueue.waitMinutes} minutes.`;

    addNotification(queueMessage.textContent);

    // Keep the selected service fixed while joined.
    serviceSelect.disabled = true;
    joinButton.disabled = true;
    leaveButton.disabled = false;
}

function leaveQueue()
{
    if (currentQueue === null)
    {
        return;
    }

    // Remember the name before clearing the queue.
    const serviceName = services[currentQueue.serviceId].name;

    currentQueue = null;

    saveQueue();

    serviceSelect.disabled = false;
    joinButton.disabled = false;
    leaveButton.disabled = true;

    queueMessage.textContent =
        `You left the ${serviceName} queue.`;

    addNotification(queueMessage.textContent);
}

// Only attach these handlers on the Join Queue page.
if (joinForm && joinButton && leaveButton &&
    queueMessage && serviceSelect)
{
    joinForm.addEventListener("submit", joinQueue);
    leaveButton.addEventListener("click", leaveQueue);
}

// restores the Join page's controls
// fills the Dashboard's existing spans
function refreshQueueDisplay()
{
    currentQueue = loadQueue();

    renderAvailableServices();
    renderNotifications();

    // Restore the Join Queue page.
    if (joinForm && serviceSelect && waitDisplay &&
        joinButton && leaveButton && queueMessage)
    {
        const isJoined = currentQueue !== null;

        serviceSelect.disabled = isJoined;
        joinButton.disabled = isJoined;
        leaveButton.disabled = !isJoined;

        if (isJoined)
        {
            serviceSelect.value = currentQueue.serviceId;

            waitDisplay.textContent =
                currentQueue.waitMinutes + " minutes";

            queueMessage.textContent =
                `You are in the ${services[currentQueue.serviceId].name} queue. ` +
                `Position: ${currentQueue.position}. ` +
                `Estimated wait: ${currentQueue.waitMinutes} minutes.`;
        }
        else
        {
            queueMessage.textContent = "";
            updateEstimatedWait();
        }
    }

    // Find the Dashboard's current-queue fields.
    const serviceDisplay = document.getElementById("current-service");
    const statusDisplay = document.getElementById("current-status");
    const positionDisplay = document.getElementById("current-position");
    const currentWaitDisplay = document.getElementById("current-wait");

    // Skip this section when we are not on the Dashboard.
    if (!serviceDisplay || !statusDisplay ||
        !positionDisplay || !currentWaitDisplay)
    {
        return;
    }

    if (currentQueue === null)
    {
        serviceDisplay.textContent = "—";
        statusDisplay.textContent = "Not in a queue";
        positionDisplay.textContent = "—";
        currentWaitDisplay.textContent = "—";
    }
    else
    {
        serviceDisplay.textContent =
            services[currentQueue.serviceId].name;

        statusDisplay.textContent = currentQueue.status;
        positionDisplay.textContent = currentQueue.position;

        currentWaitDisplay.textContent =
            currentQueue.waitMinutes + " minutes";
    }
}

// Also refresh when returning through the browser's Back button.
window.addEventListener("pageshow", refreshQueueDisplay);

function renderAvailableServices()
{
    const list = document.getElementById("available-services-list");

    if (!list)
    {
        return;
    }

    // Remove placeholders or previously displayed items.
    list.textContent = "";

    for (const serviceId in services)
    {
        const service = services[serviceId];
        const minutes = estimateWait(
            serviceId,
            mockPeopleAhead[serviceId]
        );

        const item = document.createElement("li");

        item.textContent =
            `${service.name} — estimated wait: ${minutes} minutes`;

        list.appendChild(item);
    }
}

const NOTIFICATION_STORAGE_KEY = "queueSmart.notifications";

function loadNotifications()
{
    try
    {
        const savedData = localStorage.getItem(NOTIFICATION_STORAGE_KEY);

        if (savedData === null)
        {
            return [];
        }

        const notifications = JSON.parse(savedData);

        if (!Array.isArray(notifications))
        {
            return [];
        }

        // Only keep text messages.
        return notifications.filter(
            message => typeof message === "string"
        );
    }
    catch
    {
        return [];
    }
}

function addNotification(message)
{
    const notifications = loadNotifications();

    // Put the newest message first.
    notifications.unshift(message);

    // Save only the five most recent messages.
    localStorage.setItem(
        NOTIFICATION_STORAGE_KEY,
        JSON.stringify(notifications.slice(0, 5))
    );

    renderNotifications();
}

function renderNotifications()
{
    const list = document.getElementById("notification-list");

    if (!list)
    {
        return;
    }

    list.textContent = "";

    const notifications = loadNotifications();

    if (notifications.length === 0)
    {
        const item = document.createElement("li");
        item.textContent = "No notifications yet.";
        list.appendChild(item);
        return;
    }

    for (const message of notifications)
    {
        const item = document.createElement("li");
        item.textContent = message;
        list.appendChild(item);
    }
}
