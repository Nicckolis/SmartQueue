// These pages use the same localStorage key to read and save their shared data.
import { getOrderedQueue } from "./queue-helpers.js";
import { recordJoin } from "../History/history-actions.js";

const STORE_STORAGE_KEY = "queueSmart.store";

// Start with demo services and an empty queue when there is no saved data.
function createDefaultStore() {
    return {
        services: [
            {
                id: "service-1",
                name: "Prescription Pickup",
                description: "Pick up a prepared prescription.",
                expectedDuration: 5,
                priority: "medium",
                isOpen: true
            },
            {
                id: "service-2",
                name: "New Prescription Fill",
                description: "Have a new prescription prepared.",
                expectedDuration: 15,
                priority: "medium",
                isOpen: true
            },
            {
                id: "service-3",
                name: "Vaccine / Injection",
                description: "Receive a vaccine or injection.",
                expectedDuration: 20,
                priority: "medium",
                isOpen: true
            },
            {
                id: "service-4",
                name: "Pharmacist Consultation",
                description: "Speak with a pharmacist.",
                expectedDuration: 10,
                priority: "medium",
                isOpen: true
            }
        ],
        queueEntries: [],
        nextArrivalOrder: 1,

        history: [],
        nextHistoryId: 1,

        notifications: [],
        nextNotificationId: 1
    };
}

// Save the entire store, preserving every module's data.
function saveStore(store)
{
    localStorage.setItem(STORE_STORAGE_KEY, JSON.stringify(store));
}

// Keep counters ahead of existing records when loading older data.
function repairCounter(store, counterName, items, fieldName)
{
    let largest = 0;

    for (const item of items)
    {
        const value = item?.[fieldName];

        if (!Number.isSafeInteger(value) ||
            value < 1 ||
            value >= Number.MAX_SAFE_INTEGER)
        {
            throw new Error(
                "Saved queue data contains an invalid " + fieldName + "."
            );
        }

        largest = Math.max(largest, value);
    }

    if (!Number.isSafeInteger(store[counterName]) ||
        store[counterName] <= largest)
    {
        store[counterName] = largest + 1;
    }
}

function loadStore()
{
    const saved = localStorage.getItem(STORE_STORAGE_KEY);

    if (saved === null)
    {
        const store = createDefaultStore();
        saveStore(store);
        return store;
    }

    // Invalid saved data should produce an error.
    // Do not replace it with sample data.
    const store = JSON.parse(saved);

    if (!store ||
        !Array.isArray(store.services) ||
        !Array.isArray(store.queueEntries))
    {
        throw new Error("The saved queue store has an invalid format.");
    }

    const before = JSON.stringify(store);

    // Older services may not have a priority yet.
    // Preserve priorities already assigned by an administrator.
    for (const service of store.services)
    {
        if (!service)
        {
            throw new Error("A saved service is invalid.");
        }

        if (service.priority === undefined)
        {
            service.priority = "medium";
        }
    }

    store.history ??= [];
    store.notifications ??= [];

    if (!Array.isArray(store.history) ||
        !Array.isArray(store.notifications))
    {
        throw new Error(
            "Saved history or notifications have an invalid format."
        );
    }

    repairCounter(
        store, "nextArrivalOrder", store.queueEntries, "arrivalOrder"
    );

    repairCounter(
        store, "nextHistoryId", store.history, "id"
    );

    repairCounter(
        store, "nextNotificationId", store.notifications, "id"
    );

    // Validate the shared queue.
    const orderedQueue = getOrderedQueue(
        store.queueEntries,
        store.services
    );

    // Restore missing history for entries created before history existed.
    for (const entry of orderedQueue)
    {
        const visit = store.history.find(
            item =>
                item.userId === entry.userId &&
                item.outcome === "waiting"
        );

        if (visit && visit.serviceId !== entry.serviceId)
        {
            throw new Error(
                "The saved queue and active history do not match."
            );
        }

        if (!visit)
        {
            const service = store.services.find(
                item => item.id === entry.serviceId
            );

            const restored = recordJoin(
                store,
                entry.userId,
                service.id,
                service.name
            );

            // Preserve the original join time when available.
            if (Number.isFinite(entry.joinedAt) && entry.joinedAt >= 0)
            {
                store.history.find(
                    item => item.id === restored.id
                ).joinedAt = entry.joinedAt;
            }
        }
    }

    // Save repairs only after all loading checks succeed.
    if (JSON.stringify(store) !== before)
    {
        saveStore(store);
    }

    return store;
}

export {
    STORE_STORAGE_KEY,
    createDefaultStore,
    loadStore,
    saveStore
};