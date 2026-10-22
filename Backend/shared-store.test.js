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

test("missing saved data returns defaults without writing storage", () => {
    const result = loadStore();

    assert.deepEqual(result, createDefaultStore());
    assert.equal(memory.has(STORE_STORAGE_KEY), false);
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
        nextArrivalOrder: 1
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

    ["missing arrival counter", {
        services: [],
        queueEntries: []
    }],

    ["zero arrival counter", {
        services: [],
        queueEntries: [],
        nextArrivalOrder: 0
    }],

    ["fractional arrival counter", {
        services: [],
        queueEntries: [],
        nextArrivalOrder: 1.5
    }],

    ["text arrival counter", {
        services: [],
        queueEntries: [],
        nextArrivalOrder: "1"
    }]
]) {
    test(`rejects ${label} without overwriting storage`, () => {
        const savedText = JSON.stringify(value);

        memory.set(STORE_STORAGE_KEY, savedText);

        assert.throws(
            () => loadStore(),
            /Saved store is invalid/
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