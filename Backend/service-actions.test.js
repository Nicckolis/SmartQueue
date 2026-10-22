import { test } from "node:test";
import assert from "node:assert/strict";
import { 
    createService, 
    updateService, 
    listServices 
} from "./service-actions.js";

// Use fresh input for each test. The extra spaces let the tests check trimming.
function makeInput() {
    return {
        name: "  Consultation  ",
        description: "  Meet with a staff member.  ",
        expectedDuration: 15,
        priority: "medium"
    };
}

// simulated account managers used only by these tests
const admin = {
    getCurrentUser: () => "admin@example.com",
    isCurrentUserAdmin: () => true
};

const regularUser = {
    getCurrentUser: () => "user@example.com",
    isCurrentUserAdmin: () => false
};

const signedOut = {
    getCurrentUser: () => null,
    isCurrentUserAdmin: () => false
};

test("an admin can create a service", () => {
    const store = { services: [] };
    const created = createService(store, admin, makeInput());

    assert.equal(store.services.length, 1);
    assert.equal(created.name, "Consultation");
    assert.equal(created.description, "Meet with a staff member.");
    assert.equal(created.expectedDuration, 15);
    assert.equal(created.priority, "medium");
    assert.equal(created.isOpen, true);
    assert.equal(typeof created.id, "string");
    assert.ok(created.id.length > 0);
    assert.deepEqual(store.services[0], created);

    created.name = "Changed outside the store";
    assert.equal(store.services[0].name, "Consultation");
});

test("created services have different IDs", () => {
    const store = { services: [] };

    const first = createService(store, admin, makeInput());
    const second = createService(store, admin, makeInput());

    assert.notEqual(first.id, second.id);
    assert.equal(store.services.length, 2);
});

for (const [label, accounts, status] of [
    ["regular user", regularUser, 403],
    ["signed-out visitor", signedOut, 401]
]) {
    test(`${label} cannot create a service`, () => {
        const store = { services: [] };

        assert.throws(
            () => createService(store, accounts, makeInput()),
            error => error.status === status
        );

        assert.deepEqual(store.services, []);
    });
}

// Each row tries one invalid value. The store should stay the same when it is rejected.
for (const [label, changes] of [
    ["blank name", { name: "   " }],
    ["non-text name", { name: 42 }],
    ["long name", { name: "x".repeat(101) }],
    ["blank description", { description: " " }],
    ["non-text description", { description: null }],
    ["long description", { description: "x".repeat(1001) }],
    ["zero duration", { expectedDuration: 0 }],
    ["negative duration", { expectedDuration: -1 }],
    ["fractional duration", { expectedDuration: 1.5 }],
    ["text duration", { expectedDuration: "15" }],
    ["invalid priority", { priority: "urgent" }]
]) {
    test(`rejects ${label} without changing existing data`, () => {
        const store = { services: [] };
        createService(store, admin, makeInput());
        const before = structuredClone(store);

        assert.throws(
            () => createService(
                store,
                admin,
                { ...makeInput(), ...changes }
            ),
            error => error.status === 400
        );

        assert.deepEqual(store, before);
    });
}

test("rejects missing service details", () => {
    const store = { services: [] };

    assert.throws(
        () => createService(store, admin, undefined),
        error => error.status === 400
    );

    assert.deepEqual(store.services, []);
});

// Updating details should not change queue references, other services, or open/closed status.
test("an admin can update details without changing identity or queues", () => {
    const store = {
        services: [],
        queueEntries: []
    };

    const created = createService(store, admin, makeInput());
    const other = createService(store, admin, makeInput());

    store.services[0].isOpen = false;

    store.queueEntries.push({
        id: "entry-1",
        userId: "user-1",
        serviceId: created.id
    });

    const queuesBefore = structuredClone(store.queueEntries);

    const updated = updateService(store, admin, created.id, {
        name: "  Extended Consultation  ",
        description: "  A longer appointment.  ",
        expectedDuration: 25,
        priority: "high",

        // These fields must not override the existing service.
        id: "replacement-id",
        isOpen: true
    });

    assert.equal(store.services.length, 2);
    assert.equal(updated.id, created.id);
    assert.equal(updated.name, "Extended Consultation");
    assert.equal(updated.description, "A longer appointment.");
    assert.equal(updated.expectedDuration, 25);
    assert.equal(updated.priority, "high");
    assert.equal(updated.isOpen, false);

    assert.deepEqual(store.services[0], updated);
    assert.deepEqual(store.services[1], other);
    assert.deepEqual(store.queueEntries, queuesBefore);

    updated.name = "Changed outside the store";
    assert.equal(store.services[0].name, "Extended Consultation");
});

for (const [label, accounts, status] of [
    ["regular user", regularUser, 403],
    ["signed-out visitor", signedOut, 401]
]) {
    test(`${label} cannot update a service`, () => {
        const store = { services: [] };
        const created = createService(store, admin, makeInput());
        const before = structuredClone(store);

        assert.throws(
            () => updateService(store, accounts, created.id, {
                ...makeInput(),
                expectedDuration: 25
            }),
            error => error.status === status
        );

        assert.deepEqual(store, before);
    });
}

for (const [label, serviceId, status] of [
    ["missing ID", undefined, 400],
    ["blank ID", "   ", 400],
    ["non-text ID", 42, 400],
    ["unknown ID", "does-not-exist", 404]
]) {
    test(`update rejects ${label}`, () => {
        const store = { services: [] };
        createService(store, admin, makeInput());
        const before = structuredClone(store);

        assert.throws(
            () => updateService(store, admin, serviceId, makeInput()),
            error => error.status === status
        );

        assert.deepEqual(store, before);
    });
}

test("invalid update details leave the original service unchanged", () => {
    const store = { services: [] };
    const created = createService(store, admin, makeInput());
    const before = structuredClone(store);

    assert.throws(
        () => updateService(store, admin, created.id, {
            ...makeInput(),
            name: "This change must not be saved",
            expectedDuration: 0
        }),
        error => error.status === 400
    );

    assert.deepEqual(store, before);
});

test("update requires complete service details", () => {
    const store = { services: [] };
    const created = createService(store, admin, makeInput());
    const before = structuredClone(store);

    assert.throws(
        () => updateService(store, admin, created.id, {
            expectedDuration: 25
        }),
        error => error.status === 400
    );

    assert.deepEqual(store, before);
});

test("an admin can list services, including closed services", () => {
    const store = { services: [] };

    createService(store, admin, makeInput());

    createService(store, admin, {
        ...makeInput(),
        name: "Prescription Pickup",
        expectedDuration: 3
    });

    store.services[1].isOpen = false;

    const before = structuredClone(store);
    const result = listServices(store, admin);

    assert.deepEqual(result, before.services);
    assert.equal(result.length, 2);
    assert.equal(result[1].isOpen, false);
    assert.deepEqual(store, before);
});

test("listing an empty store returns an empty array", () => {
    const store = { services: [] };

    const result = listServices(store, admin);

    assert.deepEqual(result, []);
    assert.deepEqual(store.services, []);
});

// Change the returned results to check that they are separate from the stored records.
test("changing the returned list does not change stored services", () => {
    const store = { services: [] };

    createService(store, admin, makeInput());

    createService(store, admin, {
        ...makeInput(),
        name: "Prescription Pickup"
    });

    const before = structuredClone(store);
    const result = listServices(store, admin);

    result[0].name = "Changed outside the store";
    result[1].expectedDuration = 999;
    result.pop();

    assert.deepEqual(store, before);
});

for (const [label, accounts, status] of [
    ["regular user", regularUser, 403],
    ["signed-out visitor", signedOut, 401]
]) {
    test(`${label} cannot list management services`, () => {
        const store = { services: [] };
        createService(store, admin, makeInput());
        const before = structuredClone(store);

        assert.throws(
            () => listServices(store, accounts),
            error => error.status === status
        );

        assert.deepEqual(store, before);
    });
}