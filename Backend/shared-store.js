// These pages use the same localStorage key to read and save their shared data.
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
        nextArrivalOrder: 1
    };
}

function loadStore() {
    const savedText = localStorage.getItem(STORE_STORAGE_KEY);

    if (savedText === null) {
        return createDefaultStore();
    }

    // Read the saved JSON. If it is broken, report the error instead of replacing it.
    const store = JSON.parse(savedText);

    if (
        !store ||
        !Array.isArray(store.services) ||
        !Array.isArray(store.queueEntries) ||
        !Number.isSafeInteger(store.nextArrivalOrder) ||
        store.nextArrivalOrder < 1
    ) {
        throw new Error("Saved store is invalid. No data was overwritten.");
    }

    return store;
}

// Save the whole store, including any history and notifications added by other pages.
function saveStore(store) {
    localStorage.setItem(STORE_STORAGE_KEY, JSON.stringify(store));
}

export {
    STORE_STORAGE_KEY,
    createDefaultStore,
    loadStore,
    saveStore
};