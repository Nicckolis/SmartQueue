import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

const SCRIPT_PATH = path.resolve("Admin/user-management.js"); 
const source = fs.readFileSync(SCRIPT_PATH, "utf8");

const LOGIN_URL = "../Login/queue-login.html";
const DENIED_MESSAGE = "Permission denied, get off my webpage!";

// A fake user card built from the template: just records what the script sets on it
function makeCard() {
    const parts = {
        ".user": { dataset: {} },
        ".username": { textContent: "" },
        ".role": { textContent: "" },
        '[data-action="promote"]': { hidden: false },
        '[data-action="demote"]': { hidden: false },
    };
    return { parts, querySelector: sel => parts[sel] };
}

// Runs the script in a fresh sandbox with a fake page, fake accountStorage, confirm and console.
function loadPanel({
    users = ["boss@gmail.com", "a@gmail.com", "b@gmail.com"],
    admins = ["boss@gmail.com"],
    currentIsAdmin = true,
    confirmAnswer = true,
} = {}) {
    const userSet = new Set(users);
    const adminSet = new Set(admins);

    // Stand-in for AccountManager with the same rules, plus a log of calls
    const storage = {
        calls: [],
        currentIsAdmin,
        getUserList: () => [...userSet].values(),
        isAdmin: u => adminSet.has(u),
        isCurrentUserAdmin() { return this.currentIsAdmin; },
        removeAccount(u) {
        this.calls.push(["removeAccount", u]);
        if (!userSet.has(u)) return false;
        if (adminSet.has(u)) {
            if (adminSet.size <= 1) return false;
            adminSet.delete(u);
        }
        userSet.delete(u);
        return true;
        },
        addAdmin(u) {
        this.calls.push(["addAdmin", u]);
        if (!userSet.has(u) || adminSet.has(u)) return false;
        adminSet.add(u);
        return true;
        },
        removeAdmin(u) {
        this.calls.push(["removeAdmin", u]);
        if (!adminSet.has(u) || adminSet.size <= 1) return false;
        adminSet.delete(u);
        return true;
        },
    };

    const container = {
        cards: [],
        listeners: {},
        addEventListener(type, fn) { this.listeners[type] = fn; },
        replaceChildren(frag) { this.cards = frag.children; },
    };
    const tpl = { content: { cloneNode: () => makeCard() } };
    const errorElement = { textContent: "" };

    const state = { confirmAnswer, prompts: [], logs: [], replaced: [] };

    const ctx = vm.createContext({
        document: {
        createDocumentFragment: () => ({ children: [], appendChild(n) { this.children.push(n); } }),
        querySelector: sel => ({ "#user-box": container, "#user-card": tpl })[sel] ?? null,
        getElementById: id => (id === "userManageError" ? errorElement : null),
        },
        window: { location: { replace: url => state.replaced.push(url) } },
        confirm: msg => { state.prompts.push(msg); return state.confirmAnswer; },
        console: { log: msg => state.logs.push(msg) },
        accountStorage: storage,
    });
    new vm.Script(source, { filename: SCRIPT_PATH }).runInContext(ctx);

    // Simulates a click on an action button inside the card for `username`
    function click(action, username) {
        const btn = {
        dataset: { action },
        closest: sel => (sel === ".user" ? { dataset: { username } } : null),
        };
        container.listeners.click({
        target: { closest: sel => (sel === "button[data-action]" ? btn : null) },
        });
    }

    // Simulates a click on something that isn't an action button
    function clickElsewhere() {
        container.listeners.click({ target: { closest: () => null } });
    }

    const card = username =>
        container.cards.find(c => c.parts[".user"].dataset.username === username);

    return { ctx, storage, container, errorElement, state, users: userSet, admins: adminSet, click, clickElsewhere, card };
}

describe("access check on load", () => {
    it("sends a non-admin to the login page", () => {
        const page = loadPanel({ currentIsAdmin: false });
        assert.deepEqual(page.state.replaced, [LOGIN_URL]);
    });

    it("logs the permission denied message for a non-admin", () => {
        const page = loadPanel({ currentIsAdmin: false });
        assert.deepEqual(page.state.logs, [DENIED_MESSAGE]);
    });

    it("renders nothing and attaches no click handler for a non-admin", () => {
        const page = loadPanel({ currentIsAdmin: false });
        assert.equal(page.container.cards.length, 0);
        assert.equal(page.container.listeners.click, undefined);
    });

    it("does not redirect an admin", () => {
        const page = loadPanel();
        assert.deepEqual(page.state.replaced, []);
        assert.deepEqual(page.state.logs, []);
    });

    it("renders the users and attaches the click handler for an admin", () => {
        const page = loadPanel();
        assert.equal(page.container.cards.length, 3);
        assert.equal(typeof page.container.listeners.click, "function");
    });
});

describe("renderUsers", () => {
    it("renders one card per user", () => {
        const page = loadPanel();
        assert.equal(page.container.cards.length, 3);
    });

    it("renders nothing when there are no users", () => {
        const page = loadPanel({ users: [], admins: [] });
        assert.equal(page.container.cards.length, 0);
    });

    it("sets each card's data-username and visible name", () => {
        const page = loadPanel();
        const card = page.card("a@gmail.com");
        assert.equal(card.parts[".user"].dataset.username, "a@gmail.com");
        assert.equal(card.parts[".username"].textContent, "a@gmail.com");
    });

    it("labels admins as admin and everyone else as user", () => {
        const page = loadPanel();
        assert.equal(page.card("boss@gmail.com").parts[".role"].textContent, "admin");
        assert.equal(page.card("a@gmail.com").parts[".role"].textContent, "user");
    });

    it("hides promote and shows demote for an admin", () => {
        const page = loadPanel();
        const parts = page.card("boss@gmail.com").parts;
        assert.equal(parts['[data-action="promote"]'].hidden, true);
        assert.equal(parts['[data-action="demote"]'].hidden, false);
    });

    it("shows promote and hides demote for a regular user", () => {
        const page = loadPanel();
        const parts = page.card("a@gmail.com").parts;
        assert.equal(parts['[data-action="promote"]'].hidden, false);
        assert.equal(parts['[data-action="demote"]'].hidden, true);
    });

    it("replaces the old cards instead of adding to them", () => {
        const page = loadPanel();
        page.users.add("c@gmail.com");
        page.ctx.renderUsers();
        assert.equal(page.container.cards.length, 4);
        page.ctx.renderUsers();
        assert.equal(page.container.cards.length, 4);
    });
});

describe("click handling", () => {
    it("ignores clicks that are not on an action button", () => {
        const page = loadPanel();
        page.clickElsewhere();
        assert.deepEqual(page.storage.calls, []);
        assert.deepEqual(page.state.replaced, []);
    });

    it("ignores an unknown action", () => {
        const page = loadPanel();
        assert.doesNotThrow(() => page.click("explode", "a@gmail.com"));
        assert.deepEqual(page.storage.calls, []);
    });

    it("redirects and does nothing else if the user is no longer an admin", () => {
        const page = loadPanel();
        page.storage.currentIsAdmin = false;
        page.click("delete", "a@gmail.com");
        assert.deepEqual(page.state.replaced, [LOGIN_URL]);
        assert.deepEqual(page.state.logs, [DENIED_MESSAGE]);
        assert.deepEqual(page.storage.calls, []);
        assert.equal(page.state.prompts.length, 0);
    });
    });

    describe("promote action", () => {
    it("promotes the clicked user and re-renders", () => {
        const page = loadPanel();
        page.click("promote", "a@gmail.com");
        assert.deepEqual(page.storage.calls, [["addAdmin", "a@gmail.com"]]);
        assert.equal(page.card("a@gmail.com").parts[".role"].textContent, "admin");
    });
});

describe("demote action", () => {
    it("demotes an admin when others remain and re-renders", () => {
        const page = loadPanel({ admins: ["boss@gmail.com", "a@gmail.com"] });
        page.click("demote", "a@gmail.com");
        assert.deepEqual(page.storage.calls, [["removeAdmin", "a@gmail.com"]]);
        assert.equal(page.card("a@gmail.com").parts[".role"].textContent, "user");
        assert.equal(page.errorElement.textContent, "");
    });

    it("shows an error and changes nothing when it is the last admin", () => {
        const page = loadPanel();
        page.click("demote", "boss@gmail.com");
        assert.equal(
        page.errorElement.textContent,
        "Cannot demote admin, please ensure there is more than one admin before demoting"
        );
        assert.equal(page.card("boss@gmail.com").parts[".role"].textContent, "admin");
    });
});

describe("delete action", () => {
    it("asks for confirmation with the username", () => {
        const page = loadPanel();
        page.click("delete", "a@gmail.com");
        assert.deepEqual(page.state.prompts, ["Delete a@gmail.com?"]);
    });

    it("deletes the user and re-renders when confirmed", () => {
        const page = loadPanel();
        page.click("delete", "a@gmail.com");
        assert.deepEqual(page.storage.calls, [["removeAccount", "a@gmail.com"]]);
        assert.equal(page.card("a@gmail.com"), undefined);
        assert.equal(page.container.cards.length, 2);
    });

    it("does nothing when the confirmation is cancelled", () => {
        const page = loadPanel({ confirmAnswer: false });
        page.click("delete", "a@gmail.com");
        assert.deepEqual(page.storage.calls, []);
        assert.equal(page.container.cards.length, 3);
        assert.equal(page.errorElement.textContent, "");
    });

    it("shows an error and keeps the user when the account cannot be deleted", () => {
        const page = loadPanel();
        page.click("delete", "boss@gmail.com"); // last admin
        assert.equal(
        page.errorElement.textContent,
        "Cannot delete user, if user is admin, ensure there is more than one admin"
        );
        assert.ok(page.card("boss@gmail.com"));
    });

    // Documents current behaviour: an old error stays visible after a later success
    it("does not clear an earlier error after a later successful action", () => {
        const page = loadPanel();
        page.click("demote", "boss@gmail.com"); // fails, sets the error
        page.click("delete", "a@gmail.com");    // succeeds
        assert.notEqual(page.errorElement.textContent, "");
    });
});