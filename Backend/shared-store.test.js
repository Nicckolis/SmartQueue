import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
    STORE_STORAGE_KEY,
    createDefaultStore,
    loadStore,
    saveStore
} from "./shared-store.js";

let memory;
let originalStorageDescriptor;

// Use a fresh fake localStorage for each test so real browser data is not touched.
beforeEach(() => {
    memory = new Map();

    originalStorageDescriptor =
        Object.getOwnPropertyDescriptor(globalThis, "localStorage");

    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem(key) {
                return memory.has(key) ? memory.get(key) : null;
            },

            setItem(key, value) {
                memory.set(key, String(value));
            }
        }
    });
});

// Put the original localStorage property back after each test.
afterEach(() => {
    if (originalStorageDescriptor) {
        Object.defineProperty(
            globalThis,
            "localStorage",
            originalStorageDescriptor
        );
    } else {
        delete globalThis.localStorage;
    }
});

function seed(value)
{
    const text = JSON.stringify(value);
    memory.set(STORE_STORAGE_KEY, text);
    return text;
}

test("default stores do not share mutable data", () => {
    const first = createDefaultStore();
    const second = createDefaultStore();

    first.services[0].name = "Changed";
    first.queueEntries.push({ id: "test-entry" });
    first.nextArrivalOrder = 99;

    assert.notEqual(first.services[0].name, second.services[0].name);
    assert.deepEqual(second.queueEntries, []);
    assert.equal(second.nextArrivalOrder, 1);
});

test("missing saved data returns and saves defaults", () => {
    const result = loadStore();

    assert.deepEqual(result, createDefaultStore());
    assert.deepEqual(
        JSON.parse(memory.get(STORE_STORAGE_KEY)),
        result
    );
});

// Check that saving and loading keeps the services and the other shared fields.
test("saving and loading preserves services and other shared data", () => {
    const store = createDefaultStore();

    store.services[0].name = "Updated Service";

    store.queueEntries = [{
        id: "entry-1",
        userId: "test-user",
        serviceId: "service-1",
        arrivalOrder: 1,
        joinedAt: 123
    }];

    store.nextArrivalOrder = 2;

    store.history = [{
        id: 1,
        userId: "test-user",
        serviceId: "service-1",
        outcome: "waiting"
    }];

    store.notifications = [{
        id: 1,
        userId: "test-user",
        type: "joined",
        message: "You joined the queue."
    }];

    store.nextHistoryId = 2;
    store.nextNotificationId = 2;

    // A separate key must remain untouched.
    memory.set("accounts", "account-data-placeholder");

    const before = structuredClone(store);

    saveStore(store);
    const loaded = loadStore();

    assert.equal(typeof memory.get(STORE_STORAGE_KEY), "string");
    assert.deepEqual(loaded, before);
    assert.deepEqual(store, before);
    assert.equal(memory.get("accounts"), "account-data-placeholder");

    // Editing the loaded object must not silently update saved data.
    loaded.services[0].name = "Not saved";
    loaded.queueEntries.pop();

    assert.deepEqual(loadStore(), before);
});

test("empty service and queue arrays are valid saved data", () => {
    const emptyStore = {
    services: [],
    queueEntries: [],
    nextArrivalOrder: 1,
    history: [],
    nextHistoryId: 1,
    notifications: [],
    nextNotificationId: 1
    };

    saveStore(emptyStore);

    assert.deepEqual(loadStore(), emptyStore);
});

test("malformed JSON throws without replacing saved data", () => {
    const brokenText = "{this is not valid JSON";

    memory.set(STORE_STORAGE_KEY, brokenText);

    assert.throws(
        () => loadStore(),
        SyntaxError
    );

    assert.equal(memory.get(STORE_STORAGE_KEY), brokenText);
});

// These values can be parsed as JSON, but they are missing valid store data.
for (const [label, value] of [
    ["null store", null],

    ["services is not an array", {
        services: {},
        queueEntries: [],
        nextArrivalOrder: 1
    }],

    ["queueEntries is not an array", {
        services: [],
        queueEntries: {},
        nextArrivalOrder: 1
    }],

    
]) {
    test(`rejects ${label} without overwriting storage`, () => {
        const savedText = JSON.stringify(value);

        memory.set(STORE_STORAGE_KEY, savedText);

        assert.throws(
            () => loadStore(),
            /saved queue store has an invalid format/i
        );

        assert.equal(memory.get(STORE_STORAGE_KEY), savedText);
    });
}

test("a storage read failure is reported to the caller", () => {
    const failure = new Error("Storage access denied");

    localStorage.getItem = () => {
        throw failure;
    };

    assert.throws(
        () => loadStore(),
        error => error === failure
    );

    assert.equal(memory.size, 0);
});

// Make saving throw an error and check that the previous data is still there.
test("a failed save preserves previous data and the supplied store", () => {
    const original = createDefaultStore();
    saveStore(original);

    const originalText = memory.get(STORE_STORAGE_KEY);

    const changed = structuredClone(original);
    changed.services[0].name = "Attempted update";

    const changedBefore = structuredClone(changed);
    const failure = new Error("Storage is full");

    localStorage.setItem = () => {
        throw failure;
    };

    assert.throws(
        () => saveStore(changed),
        error => error === failure
    );

    assert.equal(memory.get(STORE_STORAGE_KEY), originalText);
    assert.deepEqual(changed, changedBefore);
});

test("adds medium priority to older services but keeps assigned priorities", () => {
    const store = createDefaultStore();
    delete store.services[0].priority;
    store.services[1].priority = "high";
    seed(store);

    const loaded = loadStore();

    assert.equal(loaded.services[0].priority, "medium");
    assert.equal(loaded.services[1].priority, "high");
});

test("moves a counter that is behind existing entries past them", () => {
    const store = createDefaultStore();
    store.queueEntries = [{ id: "e1", userId: "u1", serviceId: "service-1", arrivalOrder: 5, joinedAt: 100 }];
    store.history = [{ id: 1, userId: "u1", serviceId: "service-1", outcome: "waiting" }];
    store.nextArrivalOrder = 3;
    store.nextHistoryId = 2;
    seed(store);

    assert.equal(loadStore().nextArrivalOrder, 6);
});

for (const [label, change, message] of [
    ["service", s => { s.services = [null]; }, "A saved service is invalid."],
    ["history", s => { s.history = {}; }, "Saved history or notifications have an invalid format."],
    ["entry arrival order", s => { s.queueEntries = [{ id: "e1", userId: "u1", serviceId: "service-1", arrivalOrder: 0 }]; }, "Saved queue data contains an invalid arrivalOrder."],
    ["history id", s => { s.history = [{ id: "x" }]; }, "Saved queue data contains an invalid id."],
    ["notification id", s => { s.notifications = [{ id: 0 }]; }, "Saved queue data contains an invalid id."]
]) {
    test(`rejects an invalid saved ${label} without changing storage`, () => {
        const store = createDefaultStore();
        change(store);
        const savedText = seed(store);

        assert.throws(() => loadStore(), { message });
        assert.equal(memory.get(STORE_STORAGE_KEY), savedText);
    });
}

test("rejects a queued entry whose service no longer exists", () => {
    const store = createDefaultStore();
    store.queueEntries = [{ id: "e1", userId: "u1", serviceId: "gone", arrivalOrder: 1, joinedAt: 1 }];
    store.nextArrivalOrder = 2;
    const savedText = seed(store);

    assert.throws(() => loadStore(), { status: 500 });
    assert.equal(memory.get(STORE_STORAGE_KEY), savedText);
});

test("restores missing waiting history and keeps the original join time", () => {
    const store = createDefaultStore();
    store.queueEntries = [{ id: "e1", userId: "u1", serviceId: "service-2", arrivalOrder: 1, joinedAt: 1234 }];
    store.nextArrivalOrder = 2;
    seed(store);

    const loaded = loadStore();
    const visit = loaded.history.find(
        item => item.userId === "u1" && item.outcome === "waiting"
    );

    assert.ok(visit);
    assert.equal(visit.serviceId, "service-2");
    assert.equal(visit.joinedAt, 1234);
});

test("rejects saved history that disagrees with the queue", () => {
    const store = createDefaultStore();
    store.queueEntries = [{ id: "e1", userId: "u1", serviceId: "service-1", arrivalOrder: 1, joinedAt: 1 }];
    store.history = [{ id: 1, userId: "u1", serviceId: "service-2", outcome: "waiting" }];
    store.nextArrivalOrder = 2;
    store.nextHistoryId = 2;
    const savedText = seed(store);

    assert.throws(
        () => loadStore(),
        { message: "The saved queue and active history do not match." }
    );
    assert.equal(memory.get(STORE_STORAGE_KEY), savedText);
});

test("does not rewrite storage when nothing needs repair", () => {
    seed(createDefaultStore());

    let writes = 0;
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = (key, value) => {
        writes += 1;
        originalSetItem(key, value);
    };

    loadStore();

    assert.equal(writes, 0);
});

for (const [label, counter] of [
    ["missing", undefined],
    ["zero", 0],
    ["fractional", 1.5],
    ["text", "1"]
]) {
    test("repairs a " + label + " arrival counter", () => {
        const store = createDefaultStore();
        store.nextArrivalOrder = counter;

        saveStore(store);
        const loaded = loadStore();

        assert.equal(loaded.nextArrivalOrder, 1);
        assert.deepEqual(
            JSON.parse(memory.get(STORE_STORAGE_KEY)),
            loaded
        );
    });
}
test("older queue data gains missing fields and history without duplication", () => {
    const store = createDefaultStore();

    delete store.services[0].priority;
    store.services[1].priority = "high";
    store.services[1].isOpen = false;

    store.queueEntries = [{
        id: "entry-1",
        userId: "test-user",
        serviceId: "service-1",
        arrivalOrder: 7,
        joinedAt: 123
    }];

    delete store.history;
    delete store.nextHistoryId;
    delete store.notifications;
    delete store.nextNotificationId;

    saveStore(store);
    const loaded = loadStore();

    assert.equal(loaded.services[0].priority, "medium");
    assert.equal(loaded.services[1].priority, "high");
    assert.equal(loaded.services[1].isOpen, false);
    assert.deepEqual(loaded.queueEntries, store.queueEntries);
    assert.equal(loaded.nextArrivalOrder, 8);

    assert.deepEqual(loaded.history, [{
        id: 1,
        userId: "test-user",
        serviceId: "service-1",
        serviceName: store.services[0].name,
        joinedAt: 123,
        completedAt: null,
        outcome: "waiting"
    }]);

    assert.equal(loaded.nextHistoryId, 2);
    assert.deepEqual(loaded.notifications, []);
    assert.equal(loaded.nextNotificationId, 1);

    assert.deepEqual(
        JSON.parse(memory.get(STORE_STORAGE_KEY)),
        loaded
    );

    // Reloading must not create another history record.
    assert.deepEqual(loadStore(), loaded);
});