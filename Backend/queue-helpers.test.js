import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getOrderedQueue, estimateWait } from "./queue-helpers.js";

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
});