import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { joinQueue, leaveQueue } from "./queue-actions.js";

function makeStore()
{
    return {
        services: [
            { id: "s1", name: "Advising", expectedDuration: 10, isOpen: true },
            { id: "s2", name: "Registrar", expectedDuration: 5, isOpen: true },
            { id: "s3", name: "Closed Desk", expectedDuration: 5, isOpen: false }
        ],
        queueEntries: [],
        nextArrivalOrder: 1
    };
}

// Adds an entry directly, bypassing joinQueue, so a test can set up
// a specific priority or arrival order.
function seedEntry(store, userId, serviceId, priorityLevel, arrivalOrder)
{
    store.queueEntries.push({
        id: `seed-${userId}`,
        userId,
        serviceId,
        priorityLevel,
        arrivalOrder,
        joinedAt: 0
    });
}

// Expects the action to throw the given status and message, and
// checks that the store was left exactly as it was.
function assertRejected(store, action, status, message)
{
    const storeBefore = structuredClone(store);

    assert.throws(action, error =>
    {
        assert.equal(error.status, status);
        assert.equal(error.message, message);
        return true;
    });

    assert.deepEqual(store, storeBefore);
}

const LOGIN_MESSAGE = "Please log in first.";
const SERVICE_MESSAGE = "Please select a service.";
const CLOSED_MESSAGE = "This queue is closed to new arrivals.";
const ALREADY_JOINED_MESSAGE =
    "Leave your current queue before joining another.";
const DURATION_MESSAGE = "The service duration is not configured correctly.";
const COUNTER_MESSAGE =
    "The queue arrival counter is not configured correctly.";

describe("joinQueue: successful joins", () =>
{
    test("returns the new entry and the user's current queue", () =>
    {
        const store = makeStore();

        const result = joinQueue(store, "u1", "s1");

        assert.equal(result.entry.userId, "u1");
        assert.equal(result.entry.serviceId, "s1");
        assert.equal(result.entry.priorityLevel, "medium");
        assert.equal(result.entry.arrivalOrder, 1);
        assert.equal(typeof result.entry.id, "string");
        assert.equal(typeof result.entry.joinedAt, "number");

        assert.deepEqual(result.currentQueue, {
            entryId: result.entry.id,
            serviceId: "s1",
            serviceName: "Advising",
            status: "waiting",
            position: 1,
            waitMinutes: 10
        });
    });

    test("saves entries and advances the arrival counter", () =>
    {
        const store = makeStore();

        const first = joinQueue(store, "u1", "s1");
        const second = joinQueue(store, "u2", "s1");

        assert.deepEqual(store.queueEntries, [first.entry, second.entry]);
        assert.equal(first.entry.arrivalOrder, 1);
        assert.equal(second.entry.arrivalOrder, 2);
        assert.equal(store.nextArrivalOrder, 3);
    });

    test("third person in line waits three expected durations", () =>
    {
        const store = makeStore();
        joinQueue(store, "u1", "s1");
        joinQueue(store, "u2", "s1");

        const result = joinQueue(store, "u3", "s1");

        assert.equal(result.currentQueue.position, 3);
        assert.equal(result.currentQueue.waitMinutes, 30);
    });

    test("position accounts for priority, not just arrival", () =>
    {
        const store = makeStore();
        seedEntry(store, "h1", "s1", "high", 1);
        seedEntry(store, "l1", "s1", "low", 2);
        store.nextArrivalOrder = 3;

        const result = joinQueue(store, "u1", "s1");

        // high first, then the new medium entry, then low
        assert.equal(result.currentQueue.position, 2);
        assert.equal(result.currentQueue.waitMinutes, 20);
    });
});

describe("joinQueue: validation rules", () =>
{
    test("rejects a missing user with 401", () =>
    {
        const store = makeStore();

        assertRejected(
            store,
            () => joinQueue(store, undefined, "s1"),
            401,
            LOGIN_MESSAGE
        );
    });

    test("rejects an empty service id with 400", () =>
    {
        const store = makeStore();

        assertRejected(
            store,
            () => joinQueue(store, "u1", ""),
            400,
            SERVICE_MESSAGE
        );
    });

    test("rejects an unknown service with 404", () =>
    {
        const store = makeStore();

        assertRejected(
            store,
            () => joinQueue(store, "u1", "nope"),
            404,
            "Service not found."
        );
    });

    test("rejects a closed service with 409", () =>
    {
        const store = makeStore();

        assertRejected(
            store,
            () => joinQueue(store, "u1", "s3"),
            409,
            CLOSED_MESSAGE
        );
    });

    test("rejects joining a second queue with 409", () =>
    {
        const store = makeStore();
        joinQueue(store, "u1", "s1");

        assertRejected(
            store,
            () => joinQueue(store, "u1", "s2"),
            409,
            ALREADY_JOINED_MESSAGE
        );
    });

    test("rejects an invalid service duration with 500", () =>
    {
        const store = makeStore();
        store.services[0].expectedDuration = 0;

        assertRejected(
            store,
            () => joinQueue(store, "u1", "s1"),
            500,
            DURATION_MESSAGE
        );
    });

    test("rejects an invalid arrival counter with 500", () =>
    {
        const store = makeStore();
        store.nextArrivalOrder = 0;

        assertRejected(
            store,
            () => joinQueue(store, "u1", "s1"),
            500,
            COUNTER_MESSAGE
        );
    });
});

describe("leaveQueue", () =>
{
    test("removes only the leaving user's entry and returns it", () =>
    {
        const store = makeStore();
        const joined = joinQueue(store, "u1", "s1");
        joinQueue(store, "u2", "s1");

        const result = leaveQueue(store, "u1");

        assert.deepEqual(result.entry, joined.entry);
        assert.equal(result.currentQueue, null);
        assert.deepEqual(
            store.queueEntries.map(entry => entry.userId),
            ["u2"]
        );
    });

    test("returns nulls and changes nothing when not in a queue", () =>
    {
        const store = makeStore();
        joinQueue(store, "u1", "s1");

        const storeBefore = structuredClone(store);

        const result = leaveQueue(store, "u2");

        assert.deepEqual(result, {
            entry: null,
            currentQueue: null
        });

        assert.deepEqual(store, storeBefore);
    });

    test("lets a user leave after the service has closed", () =>
    {
        const store = makeStore();
        joinQueue(store, "u1", "s1");
        store.services[0].isOpen = false;

        const result = leaveQueue(store, "u1");

        assert.equal(result.entry.userId, "u1");
        assert.equal(store.queueEntries.length, 0);
    });

    test("lets a user join a different service after leaving", () =>
    {
        const store = makeStore();
        joinQueue(store, "u1", "s1");
        leaveQueue(store, "u1");

        const result = joinQueue(store, "u1", "s2");

        assert.equal(result.currentQueue.serviceId, "s2");
        assert.equal(store.queueEntries.length, 1);
    });

    test("rejects an empty user id with 401", () =>
    {
        const store = makeStore();
        joinQueue(store, "u1", "s1");

        assertRejected(
            store,
            () => leaveQueue(store, ""),
            401,
            LOGIN_MESSAGE
        );
    });
});