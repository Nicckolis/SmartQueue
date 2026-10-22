import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { joinQueue, leaveQueue } from "./queue-actions.js";

import {
    getOrderedQueue,
    getQueuePosition,
    estimateWait
} from "./queue-helpers.js";


function makeStore()
{
    return {
        services: [
            {
                id: "s1",
                name: "Advising",
                expectedDuration: 10,
                priority: "medium",
                isOpen: true
            },
            {
                id: "s2",
                name: "Registrar",
                expectedDuration: 5,
                priority: "medium",
                isOpen: true
            },
            {
                id: "s3",
                name: "Priority Desk",
                expectedDuration: 20,
                priority: "high",
                isOpen: true
            },
            {
                id: "s4",
                name: "Closed Desk",
                expectedDuration: 5,
                priority: "low",
                isOpen: false
            }
        ],

        queueEntries: [],
        nextArrivalOrder: 1
    };
}


// Rejected actions must leave the entire supplied store unchanged.
function assertRejected(store, action, status, message)
{
    const before = structuredClone(store);

    assert.throws(action, error =>
    {
        assert.equal(error.status, status);
        assert.equal(error.message, message);
        return true;
    });

    assert.deepEqual(store, before);
}


const LOGIN_MESSAGE = "Please log in first.";
const SERVICE_MESSAGE = "Please select a service.";
const CLOSED_MESSAGE = "This queue is closed to new arrivals.";

const ALREADY_JOINED_MESSAGE =
    "Leave your current queue before joining another.";

const DURATION_MESSAGE =
    "The service duration is not configured correctly.";

const COUNTER_MESSAGE =
    "The queue arrival counter is not configured correctly.";


describe("joinQueue: successful joins", () =>
{
    test("returns the new entry and a zero wait for the first user", () =>
    {
        const store = makeStore();

        const result = joinQueue(store, "u1", "s1");

        assert.equal(result.entry.userId, "u1");
        assert.equal(result.entry.serviceId, "s1");
        assert.equal(result.entry.arrivalOrder, 1);

        assert.equal(typeof result.entry.id, "string");
        assert.ok(result.entry.id.length > 0);
        assert.ok(Number.isFinite(result.entry.joinedAt));

        assert.deepEqual(result.currentQueue, {
            entryId: result.entry.id,
            serviceId: "s1",
            serviceName: "Advising",
            status: "waiting",
            position: 1,
            waitMinutes: 0
        });
    });

    test("saves unique entries with one arrival counter across services", () =>
    {
        const store = makeStore();

        const first = joinQueue(store, "u1", "s1");
        const second = joinQueue(store, "u2", "s2");

        assert.deepEqual(
            store.queueEntries,
            [first.entry, second.entry]
        );

        assert.notEqual(first.entry.id, second.entry.id);
        assert.equal(first.entry.arrivalOrder, 1);
        assert.equal(second.entry.arrivalOrder, 2);
        assert.equal(store.nextArrivalOrder, 3);
    });

    test("third user of the same service waits for two people ahead", () =>
    {
        const store = makeStore();

        joinQueue(store, "u1", "s1");
        joinQueue(store, "u2", "s1");

        const result = joinQueue(store, "u3", "s1");

        assert.equal(result.currentQueue.position, 3);

        // Two people ahead, each requiring 10 minutes.
        assert.equal(result.currentQueue.waitMinutes, 20);
    });

    test("equal-priority services share arrival order and combined wait time", () =>
    {
        const store = makeStore();

        joinQueue(store, "u1", "s1");

        const second = joinQueue(store, "u2", "s2");
        const third = joinQueue(store, "u3", "s1");

        assert.equal(second.currentQueue.position, 2);
        assert.equal(second.currentQueue.waitMinutes, 10);

        assert.equal(third.currentQueue.position, 3);

        // Advising takes 10 minutes; Registrar takes 5.
        assert.equal(third.currentQueue.waitMinutes, 15);
    });

    test("a later arrival for a high-priority service moves to the front", () =>
    {
        const store = makeStore();

        joinQueue(store, "u1", "s1");
        joinQueue(store, "u2", "s2");

        const result = joinQueue(store, "u3", "s3");

        assert.equal(result.currentQueue.position, 1);
        assert.equal(result.currentQueue.waitMinutes, 0);
    });

    test("a medium-priority arrival goes after high and before low", () =>
    {
        const store = makeStore();

        store.services[1].priority = "low";

        joinQueue(store, "low-user", "s2");
        joinQueue(store, "high-user", "s3");

        const result = joinQueue(store, "medium-user", "s1");

        const ordered = getOrderedQueue(
            store.queueEntries,
            store.services
        );

        assert.equal(result.currentQueue.position, 2);
        assert.equal(result.currentQueue.waitMinutes, 20);

        assert.deepEqual(
            ordered.map(entry => entry.userId),
            ["high-user", "medium-user", "low-user"]
        );
    });

    test("returns an entry copy that cannot change the stored entry", () =>
    {
        const store = makeStore();

        const result = joinQueue(store, "u1", "s1");

        assert.notStrictEqual(
            result.entry,
            store.queueEntries[0]
        );

        result.entry.serviceId = "changed";

        assert.equal(
            store.queueEntries[0].serviceId,
            "s1"
        );
    });
});


describe("joinQueue: validation rules", () =>
{
    test("rejects missing or invalid user IDs with 401", () =>
    {
        for (const userId of [undefined, null, 123, "", "   "])
        {
            const store = makeStore();

            assertRejected(
                store,
                () => joinQueue(store, userId, "s1"),
                401,
                LOGIN_MESSAGE
            );
        }
    });

    test("rejects missing or invalid service IDs with 400", () =>
    {
        for (const serviceId of [undefined, null, 123, "", "   "])
        {
            const store = makeStore();

            assertRejected(
                store,
                () => joinQueue(store, "u1", serviceId),
                400,
                SERVICE_MESSAGE
            );
        }
    });

    test("rejects an unknown service with 404", () =>
    {
        const store = makeStore();

        assertRejected(
            store,
            () => joinQueue(store, "u1", "missing"),
            404,
            "Service not found."
        );
    });

    test("rejects a closed service or one with no open flag", () =>
    {
        const store = makeStore();

        assertRejected(
            store,
            () => joinQueue(store, "u1", "s4"),
            409,
            CLOSED_MESSAGE
        );

        delete store.services[0].isOpen;

        assertRejected(
            store,
            () => joinQueue(store, "u1", "s1"),
            409,
            CLOSED_MESSAGE
        );
    });

    test("rejects a second active entry for the same or another service", () =>
    {
        const store = makeStore();

        joinQueue(store, "u1", "s1");

        for (const serviceId of ["s1", "s2"])
        {
            assertRejected(
                store,
                () => joinQueue(store, "u1", serviceId),
                409,
                ALREADY_JOINED_MESSAGE
            );
        }
    });

    test("rejects invalid selected-service durations with 500", () =>
    {
        const invalidDurations = [
            0,
            -5,
            "10",
            NaN,
            Infinity,
            undefined
        ];

        for (const duration of invalidDurations)
        {
            const store = makeStore();

            store.services[0].expectedDuration = duration;

            assertRejected(
                store,
                () => joinQueue(store, "u1", "s1"),
                500,
                DURATION_MESSAGE
            );
        }
    });

    test("rejects invalid arrival counters with 500", () =>
    {
        const invalidCounters = [
            0,
            -1,
            1.5,
            "2",
            undefined,
            NaN,
            Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER + 1
        ];

        for (const counter of invalidCounters)
        {
            const store = makeStore();

            store.nextArrivalOrder = counter;

            assertRejected(
                store,
                () => joinQueue(store, "u1", "s1"),
                500,
                COUNTER_MESSAGE
            );
        }
    });

    test("rejects a counter equal to or behind existing arrival orders", () =>
    {
        for (const counter of [1, 2])
        {
            const store = makeStore();

            joinQueue(store, "u1", "s1");
            joinQueue(store, "u2", "s2");

            // The next arrival should be 3.
            store.nextArrivalOrder = counter;

            assertRejected(
                store,
                () => joinQueue(store, "u3", "s3"),
                500,
                COUNTER_MESSAGE
            );
        }
    });

    test("leaves the store unchanged if priority validation fails", () =>
    {
        const store = makeStore();

        store.services[0].priority = "urgent";

        assertRejected(
            store,
            () => joinQueue(store, "u1", "s1"),
            500,
            "The service priority must be low, medium, or high."
        );
    });

    test("leaves the store unchanged if a duration ahead is invalid", () =>
    {
        const store = makeStore();

        joinQueue(store, "u1", "s1");

        // The new user's selected service is valid.
        // However, calculating their wait must fail because
        // the service of someone ahead has an invalid duration.
        store.services[0].expectedDuration = 0;

        assertRejected(
            store,
            () => joinQueue(store, "u2", "s2"),
            500,
            DURATION_MESSAGE
        );
    });
});


describe("leaveQueue", () =>
{
    test("removes only the leaving user and preserves the arrival counter", () =>
    {
        const store = makeStore();

        joinQueue(store, "u1", "s1");
        const joined = joinQueue(store, "u2", "s3");
        joinQueue(store, "u3", "s2");

        const result = leaveQueue(store, "u2");

        assert.deepEqual(result.entry, joined.entry);
        assert.equal(result.currentQueue, null);
        assert.equal(store.nextArrivalOrder, 4);

        assert.deepEqual(
            store.queueEntries.map(entry => entry.userId),
            ["u1", "u3"]
        );
    });

    test("returns nulls and changes nothing when the user is not queued", () =>
    {
        const store = makeStore();

        joinQueue(store, "u1", "s1");

        const before = structuredClone(store);

        const result = leaveQueue(store, "u2");

        assert.deepEqual(result, {
            entry: null,
            currentQueue: null
        });

        assert.deepEqual(store, before);
    });

    test("allows leaving after the user's service closes", () =>
    {
        const store = makeStore();

        joinQueue(store, "u1", "s1");
        store.services[0].isOpen = false;

        const result = leaveQueue(store, "u1");

        assert.equal(result.entry.userId, "u1");
        assert.equal(store.queueEntries.length, 0);

        // The arrival counter must not reset when the queue becomes empty.
        assert.equal(store.nextArrivalOrder, 2);
    });

    test("rejoining another service receives a new arrival order", () =>
    {
        const store = makeStore();

        joinQueue(store, "u1", "s1");
        joinQueue(store, "u2", "s2");

        leaveQueue(store, "u1");

        const result = joinQueue(store, "u1", "s2");

        assert.equal(result.entry.arrivalOrder, 3);
        assert.equal(result.currentQueue.serviceId, "s2");

        // u2 arrived before the returning u1.
        assert.equal(result.currentQueue.position, 2);
        assert.equal(result.currentQueue.waitMinutes, 5);

        assert.equal(store.nextArrivalOrder, 4);
    });

    test("rejects missing or invalid user IDs with 401", () =>
    {
        for (const userId of [undefined, null, 123, "", "   "])
        {
            const store = makeStore();

            joinQueue(store, "u1", "s1");

            assertRejected(
                store,
                () => leaveQueue(store, userId),
                401,
                LOGIN_MESSAGE
            );
        }
    });

    test("leaving reduces the position and wait of a user of another service", () =>
    {
        const store = makeStore();

        joinQueue(store, "u1", "s1");
        const second = joinQueue(store, "u2", "s2");

        assert.equal(second.currentQueue.position, 2);
        assert.equal(second.currentQueue.waitMinutes, 10);

        leaveQueue(store, "u1");

        // Returned results are snapshots.
        // Recalculate the remaining user's position from the updated store.
        const ordered = getOrderedQueue(
            store.queueEntries,
            store.services
        );

        const position = getQueuePosition(ordered, "u2");

        assert.equal(position, 1);

        assert.equal(
            estimateWait(ordered, position, store.services),
            0
        );
    });
});