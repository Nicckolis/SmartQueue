import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { joinQueue, leaveQueue } from "../Backend/queue-actions.js";
import { recordJoin, completeEntry } from "../History/history-actions.js";
import { getNotifications } from "../Notifications/notification-actions.js";
import {
    STATUS_NOTES,
    getUserQueueStatus,
    notifyQueueMovement
} from "./queue-status-actions.js";

function makeStore()
{
    return {
        services: [
            { id: "s1", name: "Advising", expectedDuration: 10, priority: "medium", isOpen: true },
            { id: "s2", name: "Registrar", expectedDuration: 5, priority: "medium", isOpen: true }
        ],
        queueEntries: [],
        nextArrivalOrder: 1
    };
}

// Fill a queue with u1..uN in order.
function fillQueue(store, count)
{
    for (let i = 1; i <= count; i++)
    {
        joinQueue(store, `u${i}`, "s1");
    }
}

describe("getUserQueueStatus", () =>
{
    test("waiting user far from the front", () =>
    {
        const store = makeStore();
        fillQueue(store, 4);

        assert.deepEqual(getUserQueueStatus(store, "u4"), {
            entryId: store.queueEntries[3].id,
            serviceId: "s1",
            serviceName: "Advising",
            status: "waiting",
            position: 4,
            peopleAhead: 3,
            waitMinutes: 30,
            note: STATUS_NOTES.waiting
        });
    });

    test("user near the front is almost_ready", () =>
    {
        const store = makeStore();
        fillQueue(store, 2);

        const status = getUserQueueStatus(store, "u2");

        assert.equal(status.status, "almost_ready");
        assert.equal(status.note, STATUS_NOTES.almost_ready);
    });

    test("status updates after someone ahead leaves", () =>
    {
        const store = makeStore();
        fillQueue(store, 4);
        leaveQueue(store, "u1");

        const status = getUserQueueStatus(store, "u4");

        assert.equal(status.position, 3);
        assert.equal(status.waitMinutes, 20);
    });

    test("uses arrival order and mixed durations across services", () =>
    {
        const store = makeStore();
        joinQueue(store, "u1", "s2");
        joinQueue(store, "u2", "s1");
        joinQueue(store, "u3", "s2");

        assert.equal(getUserQueueStatus(store, "u1").waitMinutes, 0);
        const status = getUserQueueStatus(store, "u3");
        assert.equal(status.position, 3);
        assert.equal(status.peopleAhead, 2);
        // The people ahead need 5 + 10 minutes; exclude u3's own service time.
        assert.equal(status.waitMinutes, 15);
    });

    test("a later high-priority service moves ahead of a lower-priority service", () =>
    {
        const store = makeStore();
        store.services[0].priority = "low";
        store.services[1].priority = "high";
        joinQueue(store, "u1", "s1");
        joinQueue(store, "u2", "s2");

        assert.equal(getUserQueueStatus(store, "u2").position, 1);
        assert.equal(getUserQueueStatus(store, "u2").waitMinutes, 0);
        assert.equal(getUserQueueStatus(store, "u1").position, 2);
        assert.equal(getUserQueueStatus(store, "u1").waitMinutes, 5);
    });

    test("not in a queue and no history returns null", () =>
    {
        assert.equal(getUserQueueStatus(makeStore(), "u1"), null);
    });

    test("shows served after the user's visit ended as served", () =>
    {
        const store = makeStore();
        recordJoin(store, "u1", "s1", "Advising");
        completeEntry(store, "u1", "served");

        assert.deepEqual(getUserQueueStatus(store, "u1"), {
            entryId: null,
            serviceId: "s1",
            serviceName: "Advising",
            status: "served",
            position: null,
            peopleAhead: null,
            waitMinutes: null,
            note: STATUS_NOTES.served
        });
    });

    test("returns null if the latest visit was cancelled", () =>
    {
        const store = makeStore();
        recordJoin(store, "u1", "s1", "Advising");
        completeEntry(store, "u1", "cancelled");

        assert.equal(getUserQueueStatus(store, "u1"), null);
    });

    test("rejects a missing user with 401", () =>
    {
        assert.throws(() => getUserQueueStatus(makeStore(), ""), error =>
        {
            assert.equal(error.status, 401);
            return true;
        });
    });

    test("rejects an entry whose service is missing with 404", () =>
    {
        const store = makeStore();
        joinQueue(store, "u1", "s1");
        store.services = [];

        assert.throws(() => getUserQueueStatus(store, "u1"), error =>
        {
            assert.equal(error.status, 404);
            return true;
        });
    });
});

describe("notifyQueueMovement", () =>
{
    test("first check stays quiet for users far from the front", () =>
    {
        const store = makeStore();
        fillQueue(store, 4);

        const created = notifyQueueMovement(store, "s1");

        // Only the two users at the front are alerted.
        assert.deepEqual(created.map(item => item.userId), ["u1", "u2"]);
        assert.deepEqual(getNotifications(store, "u4"), []);
        assert.equal(store.queueEntries[3].lastNotifiedPosition, 4);
    });

    test("first check alerts users who are already almost ready", () =>
    {
        const store = makeStore();
        fillQueue(store, 3);

        const created = notifyQueueMovement(store, "s1");

        assert.deepEqual(
            created.map(item => [item.userId, item.type]),
            [["u1", "almost_ready"], ["u2", "almost_ready"]]
        );
    });

    test("notifies users whose position changed, once", () =>
    {
        const store = makeStore();
        fillQueue(store, 5);
        notifyQueueMovement(store, "s1");

        leaveQueue(store, "u1");
        const created = notifyQueueMovement(store, "s1");

        // u2 and u3 are now positions 1 and 2 (almost ready), u4 moved
        // 4 -> 3 (position_update), u5 moved 5 -> 4 (position_update).
        const types = Object.fromEntries(
            created.map(item => [item.userId, item.type])
        );

        assert.equal(types.u4, "position_update");
        assert.equal(types.u5, "position_update");
        assert.equal(types.u2, undefined); // already alerted at the first check
        assert.deepEqual(notifyQueueMovement(store, "s1"), []);
    });

    test("does not duplicate almost_ready when moving closer", () =>
    {
        const store = makeStore();
        fillQueue(store, 3);
        notifyQueueMovement(store, "s1");

        leaveQueue(store, "u1");
        notifyQueueMovement(store, "s1");

        const u3 = getNotifications(store, "u3")
            .filter(item => item.type === "almost_ready");

        assert.equal(u3.length, 1);
    });

    test("updates users across services in the shared queue", () =>
    {
        const store = makeStore();
        joinQueue(store, "u1", "s1");
        joinQueue(store, "u2", "s1");
        joinQueue(store, "u3", "s2");
        notifyQueueMovement(store, "s1");
        assert.equal(store.queueEntries[2].lastNotifiedPosition, 3);
        assert.deepEqual(getNotifications(store, "u3"), []);

        leaveQueue(store, "u1");
        const created = notifyQueueMovement(store, "s1");
        const note = created.find(item => item.userId === "u3");

        assert.equal(note.type, "almost_ready");
        assert.equal(note.serviceId, "s2");
        assert.equal(store.queueEntries.find(item => item.userId === "u3").lastNotifiedPosition, 2);
        assert.deepEqual(notifyQueueMovement(store, "s1"), []);
    });

    test("rejects an unknown service with 404", () =>
    {
        assert.throws(() => notifyQueueMovement(makeStore(), "nope"), error =>
        {
            assert.equal(error.status, 404);
            return true;
        });
    });
});
