import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    getQueueStatus,
    addNotification,
    notifyJoined,
    notifyPositionChange,
    notifyServed,
    notifyLeft,
    notifyRemoved,
    notifyNoShow,
    getNotifications,
    markRead,
    markAllRead,
    ALMOST_READY_THRESHOLD
} from "./notification-actions.js";

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

describe("getQueueStatus", () =>
{
    test("far from the front is waiting", () =>
    {
        assert.equal(getQueueStatus(ALMOST_READY_THRESHOLD + 1), "waiting");
    });

    test("at the threshold is almost_ready", () =>
    {
        assert.equal(getQueueStatus(1), "almost_ready");
        assert.equal(getQueueStatus(ALMOST_READY_THRESHOLD), "almost_ready");
    });

    test("position 0 or served flag is served", () =>
    {
        assert.equal(getQueueStatus(0), "served");
        assert.equal(getQueueStatus(5, true), "served");
    });

    test("rejects an invalid position with 400", () =>
    {
        assertRejected(() => getQueueStatus(-1), 400, /position/);
        assertRejected(() => getQueueStatus(1.5), 400, /position/);
    });
});

describe("adding notifications", () =>
{
    test("creates unread notifications and adds fields to the store", () =>
    {
        const store = makeStore();

        const first = notifyJoined(store, "u1", "s1", "Advising", 3, 30);
        const second = notifyLeft(store, "u1", "s1", "Advising");

        assert.equal(first.type, "joined");
        assert.equal(first.readAt, null);
        assert.match(first.message, /Advising.*Position: 3.*30 minutes/);
        assert.equal(first.id, 1);
        assert.equal(second.id, 2);
        assert.equal(store.nextNotificationId, 3);
        assert.equal(store.notifications.length, 2);
    });

    test("served and removed messages", () =>
    {
        const store = makeStore();

        assert.equal(notifyServed(store, "u1", "s1", "Advising").type, "served");
        assert.match(
            notifyRemoved(store, "u1", "s1", "Advising").message,
            /administrator/
        );
    });

    test("no-show message uses the no_show type", () =>
    {
        const store = makeStore();
        const note = notifyNoShow(store, "u1", "s1", "Advising");

        assert.equal(note.type, "no_show");
        assert.match(note.message, /no-show.*Advising/);
    });

    test("accepts a message of exactly 1000 characters", () =>
    {
        const store = makeStore();

        assert.equal(
            addNotification(store, "u1", "s1", "joined", "x".repeat(1000)).message.length,
            1000
        );
    });

    test("markRead keeps the first read time", () =>
    {
        const store = makeStore();
        const note = notifyJoined(store, "u1", "s1", "A", 1, 5);

        const first = markRead(store, "u1", note.id);
        const second = markRead(store, "u1", note.id);

        assert.equal(typeof first.readAt, "number");
        assert.equal(second.readAt, first.readAt);
    });

    test("returns a copy, not the stored object", () =>
    {
        const store = makeStore();
        const result = notifyJoined(store, "u1", "s1", "A", 1, 5);

        result.readAt = Date.now();

        assert.equal(store.notifications[0].readAt, null);
    });

    test("repairs a bad notification counter", () =>
    {
        const store = makeStore();
        store.notifications = "broken";
        store.nextNotificationId = 0;

        const result = notifyJoined(store, "u1", "s1", "A", 1, 5);

        assert.equal(result.id, 1);
        assert.equal(store.notifications.length, 1);
    });

    test("keeps only the 100 newest", () =>
    {
        const store = makeStore();

        for (let i = 0; i < 105; i++)
        {
            addNotification(store, "u1", "s1", "joined", `m${i}`);
        }

        assert.equal(store.notifications.length, 100);
        assert.equal(store.notifications[0].message, "m5");
    });
});

describe("notifyPositionChange", () =>
{
    test("far from the front sends position_update", () =>
    {
        const store = makeStore();
        const result = notifyPositionChange(store, "u1", "s1", "A", 5, 25);

        assert.equal(result.type, "position_update");
        assert.match(result.message, /now 5/);
    });

    test("almost_ready is sent only once per queue visit", () =>
    {
        const store = makeStore();

        notifyJoined(store, "u1", "s1", "A", 4, 20);

        assert.equal(
            notifyPositionChange(store, "u1", "s1", "A", 2, 10).type,
            "almost_ready"
        );
        assert.equal(notifyPositionChange(store, "u1", "s1", "A", 1, 5), null);
        assert.equal(store.notifications.length, 2);
    });

    test("a position_update in between does not hide the alert", () =>
    {
        const store = makeStore();

        notifyPositionChange(store, "u1", "s1", "A", 2, 10);
        notifyPositionChange(store, "u1", "s1", "A", 5, 25);

        assert.equal(notifyPositionChange(store, "u1", "s1", "A", 1, 5), null);
    });

    test("rejoining allows a new almost_ready alert", () =>
    {
        const store = makeStore();

        notifyPositionChange(store, "u1", "s1", "A", 1, 5);
        notifyLeft(store, "u1", "s1", "A");
        notifyJoined(store, "u1", "s1", "A", 1, 5);

        assert.equal(
            notifyPositionChange(store, "u1", "s1", "A", 1, 5).type,
            "almost_ready"
        );
    });

    test("alerts are tracked per user and per service", () =>
    {
        const store = makeStore();

        notifyPositionChange(store, "u1", "s1", "A", 1, 5);

        assert.equal(
            notifyPositionChange(store, "u2", "s1", "A", 1, 5).type,
            "almost_ready"
        );
        assert.equal(
            notifyPositionChange(store, "u1", "s2", "B", 1, 5).type,
            "almost_ready"
        );
    });

    test("position 0 sends served", () =>
    {
        const store = makeStore();

        assert.equal(
            notifyPositionChange(store, "u1", "s1", "A", 0, 0).type,
            "served"
        );
    });
});

describe("reading and marking notifications", () =>
{
    test("lists one user's notifications newest first", () =>
    {
        const store = makeStore();

        notifyJoined(store, "u1", "s1", "A", 1, 5);
        notifyJoined(store, "u2", "s1", "A", 2, 10);
        notifyLeft(store, "u1", "s1", "A");

        const result = getNotifications(store, "u1");

        assert.deepEqual(result.map(item => item.type), ["left", "joined"]);
    });

    test("unreadOnly filters out read ones", () =>
    {
        const store = makeStore();

        const first = notifyJoined(store, "u1", "s1", "A", 1, 5);
        notifyLeft(store, "u1", "s1", "A");
        markRead(store, "u1", first.id);

        assert.equal(getNotifications(store, "u1", { unreadOnly: true }).length, 1);
        assert.equal(getNotifications(store, "u1").length, 2);
    });

    test("markRead rejects an unknown or other user's notification with 404", () =>
    {
        const store = makeStore();
        const note = notifyJoined(store, "u1", "s1", "A", 1, 5);

        assertRejected(() => markRead(store, "u2", note.id), 404, /not found/);
        assertRejected(() => markRead(store, "u1", 999), 404, /not found/);
        assert.equal(store.notifications[0].readAt, null);
    });

    test("markAllRead returns how many changed", () =>
    {
        const store = makeStore();

        notifyJoined(store, "u1", "s1", "A", 1, 5);
        notifyLeft(store, "u1", "s1", "A");
        notifyJoined(store, "u2", "s1", "A", 1, 5);

        assert.equal(markAllRead(store, "u1"), 2);
        assert.equal(markAllRead(store, "u1"), 0);
        assert.equal(store.notifications[2].readAt, null);
    });
});

describe("notification validation", () =>
{
    test("rejects missing user or service with 400", () =>
    {
        const store = makeStore();

        assertRejected(() => addNotification(store, "", "s1", "joined", "x"), 400, /userId/);
        assertRejected(() => addNotification(store, "u1", " ", "joined", "x"), 400, /serviceId/);
        assertRejected(() => getNotifications(store, undefined), 400, /userId/);
        assertRejected(() => markAllRead(store, 5), 400, /userId/);
    });

    test("rejects a bad type or message with 400", () =>
    {
        const store = makeStore();

        assertRejected(() => addNotification(store, "u1", "s1", "nope", "x"), 400, /type must be one of/);
        assertRejected(() => addNotification(store, "u1", "s1", "joined", ""), 400, /message is required/);
        assertRejected(
            () => addNotification(store, "u1", "s1", "joined", "x".repeat(1001)),
            400,
            /at most 1000/
        );
    });

    test("a rejected call leaves the store unchanged", () =>
    {
        const store = makeStore();
        const before = structuredClone(store);

        assert.throws(() => addNotification(store, "", "s1", "joined", "x"));

        assert.deepEqual(store, before);
    });
});

