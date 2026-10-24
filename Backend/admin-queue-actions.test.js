import { test } from "node:test";
import assert from "node:assert/strict";

import { serveNextUser } from "./admin-queue-actions.js";
import { createDefaultStore } from "./shared-store.js";
import { joinQueue } from "./queue-actions.js";
import { getOrderedQueue, estimateWait } from "./queue-helpers.js";
import { recordJoin } from "../History/history-actions.js";

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

// Alex joins first with low priority. Blair and Casey have high priority, so Blair goes first.
function makeWaitingStore() {
    const store = createDefaultStore();

    store.services[0].priority = "low";
    store.services[1].priority = "high";

    const arrivals = [
        ["test-alex", "service-1"],
        ["test-blair", "service-2"],
        ["test-casey", "service-2"]
    ];

    for (const [userId, serviceId] of arrivals) {
        joinQueue(store, userId, serviceId);

        const service = store.services.find(
            item => item.id === serviceId
        );

        recordJoin(store, userId, serviceId, service.name);
    }

    return store;
}

test("serves by priority then arrival and recalculates waiting times", () => {
    const store = makeWaitingStore();
    const servicesBefore = structuredClone(store.services);
    const counterBefore = store.nextArrivalOrder;

    const served = serveNextUser(store, admin);

    assert.equal(served.userId, "test-blair");
    assert.equal(store.queueEntries.length, 2);

    const remaining = getOrderedQueue(
        store.queueEntries,
        store.services
    );

    assert.deepEqual(
        remaining.map(entry => entry.userId),
        ["test-casey", "test-alex"]
    );

    assert.equal(estimateWait(remaining, 1, store.services), 0);
    assert.equal(estimateWait(remaining, 2, store.services), 15);

    assert.deepEqual(store.services, servicesBefore);
    assert.equal(store.nextArrivalOrder, counterBefore);
});

test("completes history and creates served and movement notifications", () => {
    const store = makeWaitingStore();
    // The completion time should fall between the times just before and after serving.
    const before = Date.now();

    serveNextUser(store, admin);

    const after = Date.now();

    const history = store.history.find(
        item => item.userId === "test-blair"
    );

    assert.equal(history.outcome, "served");
    assert.ok(history.completedAt >= before);
    assert.ok(history.completedAt <= after);

    assert.ok(store.notifications.some(
        item =>
            item.userId === "test-blair" &&
            item.serviceId === "service-2" &&
            item.type === "served"
    ));

    for (const userId of ["test-casey", "test-alex"]) {
        assert.equal(
            store.history.find(item => item.userId === userId).outcome,
            "waiting"
        );

        assert.ok(store.notifications.some(
            item =>
                item.userId === userId &&
                item.type === "almost_ready"
        ));
    }
});

// Try both non-admin cases and check that neither one changes the store.
for (const [label, accounts, status] of [
    ["regular user", regularUser, 403],
    ["signed-out visitor", signedOut, 401]
]) {
    test(`${label} cannot serve users`, () => {
        const store = makeWaitingStore();
        const before = structuredClone(store);

        assert.throws(
            () => serveNextUser(store, accounts),
            error => error.status === status
        );

        assert.deepEqual(store, before);
    });
}

test("an empty queue returns null without changing the store", () => {
    const store = createDefaultStore();
    const before = structuredClone(store);

    assert.equal(serveNextUser(store, admin), null);
    assert.deepEqual(store, before);
});

test("can serve a queued user when no history record exists", () => {
    const store = createDefaultStore();

    joinQueue(store, "test-alex", "service-1");

    const served = serveNextUser(store, admin);

    assert.equal(served.userId, "test-alex");
    assert.equal(store.queueEntries.length, 0);
    // No history record was created for this visit.
    assert.deepEqual(store.history, []);

    assert.ok(store.notifications.some(
        item => item.type === "served"
    ));
});

// If notifications fail, none of the changes should reach the original store.
test("a notification failure leaves the original store unchanged", () => {
    const store = makeWaitingStore();

    // Simulate malformed stored data that the notification module rejects.
    const invalidUserId = "x".repeat(101);

    store.queueEntries.find(
        item => item.userId === "test-blair"
    ).userId = invalidUserId;

    const before = structuredClone(store);

    assert.throws(
        () => serveNextUser(store, admin),
        error => error.status === 400 && /userId/.test(error.message)
    );

    assert.deepEqual(store, before);
});

// Serve all three people and check that another call does nothing when the queue is empty.
test("serves everyone once and then returns null", () => {
    const store = makeWaitingStore();

    const servedUsers = [
        serveNextUser(store, admin).userId,
        serveNextUser(store, admin).userId,
        serveNextUser(store, admin).userId
    ];

    assert.deepEqual(
        servedUsers,
        ["test-blair", "test-casey", "test-alex"]
    );

    assert.equal(store.queueEntries.length, 0);

    assert.equal(
        store.history.filter(item => item.outcome === "served").length,
        3
    );

    assert.equal(
        store.notifications.filter(item => item.type === "served").length,
        3
    );

    const before = structuredClone(store);

    assert.equal(serveNextUser(store, admin), null);
    assert.deepEqual(store, before);
});