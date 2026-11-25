import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    getOrderedQueue,
    getQueuePosition,
    estimateWait
} from "./queue-helpers.js";


function makeServices()
{
    return [
        {
            id: "s1",
            priority: "low",
            expectedDuration: 5,
            isOpen: true
        },
        {
            id: "s2",
            priority: "medium",
            expectedDuration: 15,
            isOpen: true
        },
        {
            id: "s3",
            priority: "high",
            expectedDuration: 20,
            isOpen: true
        }
    ];
}


// Priority belongs to the service, not the individual entry.
function makeEntry(userId, serviceId, arrivalOrder)
{
    return {
        id: `entry-${userId}`,
        userId,
        serviceId,
        arrivalOrder
    };
}

function assertConfigurationError(action)
{
    assert.throws(action, { status: 500 });
}


describe("getOrderedQueue", () =>
{
    test("combines all services and orders by priority, then arrival", () =>
    {
        const entries = [
            makeEntry("a", "s1", 1),
            makeEntry("d", "s3", 4),
            makeEntry("b", "s2", 2),
            makeEntry("c", "s3", 3)
        ];

        const result = getOrderedQueue(entries, makeServices());

        // High: c, d. Medium: b. Low: a.
        assert.deepEqual(
            result.map(entry => entry.userId),
            ["c", "d", "b", "a"]
        );
    });

    test("uses arrival order across different services with equal priority", () =>
    {
        const services = makeServices();

        services.forEach(service => service.priority = "medium");

        const entries = [
            makeEntry("c", "s3", 3),
            makeEntry("a", "s1", 1),
            makeEntry("b", "s2", 2)
        ];

        const result = getOrderedQueue(entries, services);

        assert.deepEqual(
            result.map(entry => entry.userId),
            ["a", "b", "c"]
        );
    });

    test("uses service priority instead of a legacy entry priority", () =>
    {
        const entries = [
            {
                ...makeEntry("a", "s1", 1),
                priorityLevel: "high"
            },
            {
                ...makeEntry("b", "s3", 2),
                priorityLevel: "low"
            }
        ];

        const result = getOrderedQueue(entries, makeServices());

        // s3 is high priority; s1 is low priority.
        // The old priorityLevel fields must not affect the result.
        assert.deepEqual(
            result.map(entry => entry.userId),
            ["b", "a"]
        );
    });

    test("recalculates order after an administrator changes service priority", () =>
    {
        const services = makeServices();

        const entries = [
            makeEntry("a", "s1", 1),
            makeEntry("b", "s3", 2)
        ];

        assert.equal(
            getOrderedQueue(entries, services)[0].userId,
            "b"
        );

        services[0].priority = "high";

        // Both services are now high priority.
        // The earlier arrival should move first.
        assert.equal(
            getOrderedQueue(entries, services)[0].userId,
            "a"
        );
    });

    test("preserves existing entries when their service is closed", () =>
    {
        const services = makeServices();

        services[2].isOpen = false;

        const entries = [
            makeEntry("a", "s1", 1),
            makeEntry("b", "s3", 2)
        ];

        const result = getOrderedQueue(entries, services);

        assert.deepEqual(
            result.map(entry => entry.userId),
            ["b", "a"]
        );
    });

    test("returns a new array without changing the original entries", () =>
    {
        const entries = [
            makeEntry("a", "s1", 1),
            makeEntry("b", "s3", 2)
        ];

        const before = structuredClone(entries);

        const result = getOrderedQueue(entries, makeServices());

        assert.deepEqual(entries, before);
        assert.notStrictEqual(result, entries);

        // Notification code needs the same entry objects
        // so it can update lastNotifiedPosition.
        assert.strictEqual(result[0], entries[1]);
        assert.strictEqual(result[1], entries[0]);
    });

    test("returns an empty array for an empty queue", () =>
    {
        assert.deepEqual(
            getOrderedQueue([], makeServices()),
            []
        );
    });

    test("rejects a queue that is not an array", () =>
    {
        assertConfigurationError(
            () => getOrderedQueue(null, makeServices())
        );
    });

    test("rejects malformed service lists and duplicate service IDs", () =>
    {
        const invalidLists = [
            null,
            [null],
            [{ id: "" }],
            [{ id: "   " }],
            [{ id: 123 }],
            [{ id: "s1" }, { id: "s1" }]
        ];

        for (const services of invalidLists)
        {
            assertConfigurationError(
                () => getOrderedQueue([], services)
            );
        }
    });

    test("rejects an entry whose service does not exist", () =>
    {
        const entries = [
            makeEntry("a", "missing-service", 1)
        ];

        assertConfigurationError(
            () => getOrderedQueue(entries, makeServices())
        );
    });

    test("rejects invalid service priorities", () =>
    {
        for (const priority of ["urgent", null, undefined])
        {
            const services = makeServices();

            services[0].priority = priority;

            assertConfigurationError(() =>
                getOrderedQueue(
                    [makeEntry("a", "s1", 1)],
                    services
                )
            );
        }
    });

    test("rejects invalid arrival orders", () =>
    {
        const invalidArrivals = [
            0,
            -1,
            1.5,
            "1",
            NaN,
            Number.MAX_SAFE_INTEGER + 1
        ];

        for (const arrival of invalidArrivals)
        {
            assertConfigurationError(() =>
                getOrderedQueue(
                    [makeEntry("a", "s1", arrival)],
                    makeServices()
                )
            );
        }
    });
});


describe("getQueuePosition", () =>
{
    test("returns a 1-based global position using the user ID", () =>
    {
        const queue = getOrderedQueue(
            [
                makeEntry("a", "s1", 1),
                makeEntry("b", "s3", 3),
                makeEntry("c", "s2", 2)
            ],
            makeServices()
        );

        assert.equal(getQueuePosition(queue, "b"), 1);
        assert.equal(getQueuePosition(queue, "c"), 2);
        assert.equal(getQueuePosition(queue, "a"), 3);
    });

    test("returns null when the user is absent or the queue is empty", () =>
    {
        const queue = [
            makeEntry("a", "s1", 1)
        ];

        assert.equal(
            getQueuePosition(queue, "missing-user"),
            null
        );

        assert.equal(
            getQueuePosition([], "a"),
            null
        );
    });
});


describe("estimateWait", () =>
{
    // Already ordered: high, medium, low.
    // Service durations: 20, 15, and 5 minutes.
    const queue = [
        makeEntry("a", "s3", 3),
        makeEntry("b", "s2", 2),
        makeEntry("c", "s1", 1)
    ];

    test("first in line waits zero minutes", () =>
    {
        assert.equal(
            estimateWait(queue, 1, makeServices()),
            0
        );
    });

    test("adds the different service durations ahead and excludes the user's own", () =>
    {
        const services = makeServices();

        // Second user waits for the first user's 20-minute service.
        assert.equal(
            estimateWait(queue, 2, services),
            20
        );

        // Third user waits 20 + 15 minutes.
        assert.equal(
            estimateWait(queue, 3, services),
            35
        );

        // Changing the third user's own duration does not change their wait.
        services[0].expectedDuration = 90;

        assert.equal(
            estimateWait(queue, 3, services),
            35
        );
    });

    test("counts people ahead when everyone uses the same service", () =>
    {
        const sameServiceQueue = [
            makeEntry("a", "s1", 1),
            makeEntry("b", "s1", 2),
            makeEntry("c", "s1", 3)
        ];

        // Two people ahead, each requiring 5 minutes.
        assert.equal(
            estimateWait(sameServiceQueue, 3, makeServices()),
            10
        );
    });

    test("returns null when there is no queue position", () =>
    {
        assert.equal(
            estimateWait([], null, makeServices()),
            null
        );
    });

    test("rejects invalid positions", () =>
    {
        const invalidPositions = [
            0,
            -1,
            1.5,
            4,
            "2",
            undefined,
            NaN
        ];

        for (const position of invalidPositions)
        {
            assert.throws(
                () => estimateWait(queue, position, makeServices()),
                RangeError
            );
        }

        // An empty queue cannot have someone at position 1.
        assert.throws(
            () => estimateWait([], 1, makeServices()),
            RangeError
        );
    });

    test("rejects queue or service arguments that are not arrays", () =>
    {
        assertConfigurationError(
            () => estimateWait(null, 1, makeServices())
        );

        assertConfigurationError(
            () => estimateWait(queue, 1, null)
        );
    });

    test("rejects a missing service for someone ahead", () =>
    {
        const entries = [
            makeEntry("a", "missing-service", 1),
            makeEntry("b", "s1", 2)
        ];

        assertConfigurationError(
            () => estimateWait(entries, 2, makeServices())
        );
    });

    test("rejects invalid service durations for someone ahead", () =>
    {
        const invalidDurations = [
            0,
            -5,
            NaN,
            Infinity,
            "20",
            undefined
        ];

        for (const duration of invalidDurations)
        {
            const services = makeServices();

            // The first person uses s3.
            services[2].expectedDuration = duration;

            assertConfigurationError(
                () => estimateWait(queue, 2, services)
            );
        }
    });
});