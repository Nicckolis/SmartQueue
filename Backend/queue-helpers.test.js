import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getOrderedQueue, getQueuePosition, estimateWait } from "./queue-helpers.js";

function makeEntry(id, serviceId, priorityLevel, arrivalOrder)
{
    return { id, userId: id, serviceId, priorityLevel, arrivalOrder };
}

describe("estimateWait", () =>
{
    test("multiplies position by expected duration", () =>
    {
        assert.equal(estimateWait(3, 10), 30);
    });
    
    test("first in line waits one expected duration", () =>
{
    assert.equal(estimateWait(1, 15), 15);
});
});

describe("getOrderedQueue", () =>
{
    test("orders by priority, then by arrival", () =>
    {
        const entries = [
            makeEntry("a", "s1", "low", 1),
            makeEntry("b", "s1", "high", 2),
            makeEntry("c", "s1", "high", 3),
            makeEntry("d", "s2", "high", 4)
        ];

        const result = getOrderedQueue(entries, "s1");

        assert.deepEqual(result.map(entry => entry.id), ["b", "c", "a"]);
    });

    test("ranks high before medium before low", () =>
    {
        const entries = [
            makeEntry("a", "s1", "low", 1),
            makeEntry("b", "s1", "medium", 2),
            makeEntry("c", "s1", "high", 3)
        ];

        const result = getOrderedQueue(entries, "s1");

        assert.deepEqual(result.map(entry => entry.id), ["c", "b", "a"]);
    });

    test("returns an empty array when no entries match the service", () =>
    {
        const entries = [makeEntry("a", "s1", "low", 1)];

        assert.deepEqual(getOrderedQueue(entries, "s2"), []);
    });

    test("does not rearrange the original entries array", () =>
    {
        const entries = [
            makeEntry("a", "s1", "low", 1),
            makeEntry("b", "s1", "high", 2)
        ];

        getOrderedQueue(entries, "s1");

        assert.deepEqual(entries.map(entry => entry.id), ["a", "b"]);
    });

    describe("getQueuePosition", () =>
    {
        const queue = [
            makeEntry("b", "s1", "high", 2),
            makeEntry("a", "s1", "low", 1)
        ];

        test("returns a 1-based position", () =>
        {
            assert.equal(getQueuePosition(queue, "b"), 1);
            assert.equal(getQueuePosition(queue, "a"), 2);
        });

        test("returns null when the user is not in the queue", () =>
        {
            assert.equal(getQueuePosition(queue, "zzz"), null);
            assert.equal(getQueuePosition([], "a"), null);
        });
    });
    });