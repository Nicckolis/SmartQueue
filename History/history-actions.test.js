import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { recordJoin, completeEntry, getHistory } from "./history-actions.js";

function makeStore()
{
    return { services: [], queueEntries: [], nextArrivalOrder: 1 };
}

function assertRejected(action, status, message)
{
    assert.throws(action, error =>
    {
        assert.equal(error.status, status);
        assert.match(error.message, message);
        return true;
    });
}

describe("recordJoin", () =>
{
    test("creates a waiting entry and adds fields to the store", () =>
    {
        const store = makeStore();

        const entry = recordJoin(store, "u1", "s1", "Advising");

        assert.equal(entry.userId, "u1");
        assert.equal(entry.serviceName, "Advising");
        assert.equal(entry.outcome, "waiting");
        assert.equal(entry.completedAt, null);
        assert.equal(typeof entry.joinedAt, "number");
        assert.equal(store.history.length, 1);
        assert.equal(store.nextHistoryId, 2);
    });

    test("rejects a second active queue with 409", () =>
    {
        const store = makeStore();
        recordJoin(store, "u1", "s1", "Advising");

        assertRejected(
            () => recordJoin(store, "u1", "s2", "Registrar"),
            409,
            /Leave your current queue/
        );
        assert.equal(store.history.length, 1);
    });

    test("rejects bad fields with 400", () =>
    {
        const store = makeStore();

        assertRejected(() => recordJoin(store, "", "s1", "A"), 400, /userId/);
        assertRejected(() => recordJoin(store, "u1", "", "A"), 400, /serviceId/);
        assertRejected(() => recordJoin(store, "u1", "s1", "x".repeat(101)), 400, /at most 100/);
        assert.equal(store.history, undefined);
    });

    test("repairs a bad history counter", () =>
    {
        const store = makeStore();
        store.history = null;
        store.nextHistoryId = -4;

        assert.equal(recordJoin(store, "u1", "s1", "A").id, 1);
    });
});

describe("completeEntry", () =>
{
    test("sets the outcome and completion time", () =>
    {
        const store = makeStore();
        recordJoin(store, "u1", "s1", "Advising");

        const entry = completeEntry(store, "u1", "served");

        assert.equal(entry.outcome, "served");
        assert.equal(typeof entry.completedAt, "number");
        assert.equal(store.history[0].outcome, "served");
    });

    test("only completes the requested user's entry", () =>
    {
        const store = makeStore();
        recordJoin(store, "u1", "s1", "A");
        recordJoin(store, "u2", "s1", "A");

        completeEntry(store, "u2", "left");

        assert.equal(store.history[0].outcome, "waiting");
        assert.equal(store.history[1].outcome, "left");
    });

    test("rejects when there is no active entry with 404", () =>
    {
        const store = makeStore();

        assertRejected(() => completeEntry(store, "u1", "left"), 404, /No active queue entry/);

        recordJoin(store, "u1", "s1", "A");
        completeEntry(store, "u1", "served");

        assertRejected(() => completeEntry(store, "u1", "left"), 404, /No active queue entry/);
    });

    test("rejects waiting or unknown outcomes with 400", () =>
    {
        const store = makeStore();
        recordJoin(store, "u1", "s1", "A");

        assertRejected(() => completeEntry(store, "u1", "waiting"), 400, /outcome must be one of/);
        assertRejected(() => completeEntry(store, "u1", "bogus"), 400, /outcome must be one of/);
        assertRejected(() => completeEntry(store, "", "left"), 400, /userId/);
        assert.equal(store.history[0].outcome, "waiting");
    });

    test("lets a user rejoin after completing", () =>
    {
        const store = makeStore();
        recordJoin(store, "u1", "s1", "A");
        completeEntry(store, "u1", "no_show");

        assert.equal(recordJoin(store, "u1", "s2", "B").outcome, "waiting");
        assert.equal(store.history.length, 2);
    });
});

describe("getHistory", () =>
{
    function seed()
    {
        const store = makeStore();

        recordJoin(store, "u1", "s1", "Advising");
        completeEntry(store, "u1", "served");
        recordJoin(store, "u1", "s2", "Registrar");
        completeEntry(store, "u1", "left");
        recordJoin(store, "u1", "s1", "Advising");
        recordJoin(store, "u2", "s1", "Advising");

        return store;
    }

    test("returns one user's entries newest first", () =>
    {
        const result = getHistory(seed(), "u1");

        assert.deepEqual(
            result.map(item => item.outcome),
            ["waiting", "left", "served"]
        );
    });

    test("filters by outcome and service name", () =>
    {
        const store = seed();

        assert.equal(getHistory(store, "u1", { outcome: "served" }).length, 1);
        assert.equal(getHistory(store, "u1", { serviceName: "Advising" }).length, 2);
        assert.equal(
            getHistory(store, "u1", { outcome: "served", serviceName: "Registrar" }).length,
            0
        );
    });

    test("returns an empty array for a user with no history", () =>
    {
        assert.deepEqual(getHistory(makeStore(), "nobody"), []);
    });

    test("rejects a bad user or outcome with 400", () =>
    {
        const store = seed();

        assertRejected(() => getHistory(store, ""), 400, /userId/);
        assertRejected(() => getHistory(store, "u1", { outcome: "zzz" }), 400, /outcome must be one of/);
    });

    test("returns copies, not stored entries", () =>
    {
        const store = seed();

        getHistory(store, "u1")[0].outcome = "served";

        assert.equal(store.history[2].outcome, "waiting");
    });
});
