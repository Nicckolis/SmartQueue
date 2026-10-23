import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

const SCRIPT_PATH = path.resolve("auth.js"); 
const source = fs.readFileSync(SCRIPT_PATH, "utf8");
const DEFAULT_ADMIN = "adminDefault@gmail.com";

// Fresh sandbox per call. 
function loadShared(seed = {}) {
    const store = new Map(Object.entries(seed));
    const ctx = vm.createContext({
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
        },
        btoa, // vm sucks so i have to manually pass btoa
    });
    new vm.Script(source, { filename: SCRIPT_PATH }).runInContext(ctx);
    return {
        store,
        accountStorage: vm.runInContext("accountStorage", ctx),
        newManager: () => vm.runInContext("new AccountManager()", ctx), // simulates page refresh
    };
}

// Read saved in local sotrage
const savedAdmins = store => JSON.parse(store.get("admins"));
const savedAccounts = store => new Map(JSON.parse(store.get("accounts")));

// Second admin to enable admin deletion
function addSecondAdmin(accountStorage, name = "admin2@test.com") {
  accountStorage.setAccount(name, "pw");
  accountStorage.addAdmin(name);
  return name;
}

let store, accountStorage, newManager;
beforeEach(() => {
    ({ store, accountStorage, newManager } = loadShared());
});

describe("constructor", () => {
    it("creates the default account and makes it an admin", () => {
        assert.equal(accountStorage.hasAccount(DEFAULT_ADMIN), true);
        assert.equal(accountStorage.checkAccount(DEFAULT_ADMIN, "12345"), true);
        assert.equal(accountStorage.isAdmin(DEFAULT_ADMIN), true);
    });

    it("does not duplicate the admin when constructed again", () => {
        newManager();
        newManager();
        assert.deepEqual(savedAdmins(store), [DEFAULT_ADMIN]);
    });

    it("keeps existing accounts when constructed again", () => {
        accountStorage.setAccount("a@test.com", "pw");
        newManager();
        assert.equal(accountStorage.hasAccount("a@test.com"), true);
    });

    it("re-creates the default admin if it was removed", () => {
        addSecondAdmin(accountStorage);
        accountStorage.removeAccount(DEFAULT_ADMIN);
        assert.equal(accountStorage.hasAccount(DEFAULT_ADMIN), false);
        newManager();
        assert.equal(accountStorage.isAdmin(DEFAULT_ADMIN), true);
    });
});

describe("AccountManager.setAccount", () => {
    let store, accountStorage;

    beforeEach(() => {
        ({ store, accountStorage } = loadShared());
    });

    it("creates a new account", () => {
        assert.strictEqual(accountStorage.hasAccount("a@test.com"), false);
        accountStorage.setAccount("a@test.com", "pass1");
        assert.strictEqual(accountStorage.hasAccount("a@test.com"), true);
    });

    it("stores the password encoded, not as plain text", () => {
        accountStorage.setAccount("a@test.com", "pass1");
        const saved = new Map(JSON.parse(store.get("accounts")));
        assert.notStrictEqual(saved.get("a@test.com"), "pass1");
        assert.strictEqual(accountStorage.checkAccount("a@test.com", "pass1"), true);
        assert.strictEqual(accountStorage.checkAccount("a@test.com", "wrong"), false);
    });

    it("keeps existing accounts when adding another", () => {
        accountStorage.setAccount("a@test.com", "pass1");
        accountStorage.setAccount("b@test.com", "pass2");
        assert.strictEqual(accountStorage.hasAccount("a@test.com"), true);
        assert.strictEqual(accountStorage.hasAccount("b@test.com"), true);
    });

    it("does not make the new account an admin", () => {
        accountStorage.setAccount("a@test.com", "pass1");
        assert.strictEqual(accountStorage.isAdmin("a@test.com"), false);
    });
});

describe("checkAccount", () => {
    it("accepts the correct password", () => {
        accountStorage.setAccount("a@test.com", "pass1");
        assert.equal(accountStorage.checkAccount("a@test.com", "pass1"), true);
    });

    it("rejects a wrong password", () => {
        accountStorage.setAccount("a@test.com", "pass1");
        assert.equal(accountStorage.checkAccount("a@test.com", "nope"), false);
    });

    it("rejects an unknown user", () => {
        assert.equal(accountStorage.checkAccount("ghost@test.com", "pass1"), false);
    });
});

describe("hasAccount", () => {
    it("is true for an existing account", () => {
        accountStorage.setAccount("a@test.com", "pw");
        assert.equal(accountStorage.hasAccount("a@test.com"), true);
    });

    it("is false for an unknown username", () => {
        assert.equal(accountStorage.hasAccount("ghost@test.com"), false);
    });

    it("is false for null and undefined", () => {
        assert.equal(accountStorage.hasAccount(null), false);
        assert.equal(accountStorage.hasAccount(undefined), false);
    });

    it("is case sensitive", () => {
        accountStorage.setAccount("a@test.com", "pw");
        assert.equal(accountStorage.hasAccount("A@test.com"), false);
    });
});

describe("isAdmin", () => {
    it("is true for an admin", () => {
        assert.equal(accountStorage.isAdmin(DEFAULT_ADMIN), true);
    });

    it("is false for a regular user", () => {
        accountStorage.setAccount("a@test.com", "pw");
        assert.equal(accountStorage.isAdmin("a@test.com"), false);
    });

    it("is false for a nonexistent user and for null", () => {
        assert.equal(accountStorage.isAdmin("ghost@test.com"), false);
        assert.equal(accountStorage.isAdmin(null), false);
    });

    it("is false for a stale admin entry whose account does not exist", () => {
        const s = loadShared({ admins: JSON.stringify([DEFAULT_ADMIN, "ghost@test.com"]) });
        assert.equal(s.accountStorage.isAdmin("ghost@test.com"), false);
    });
});

describe("addAdmin", () => {
    it("promotes an existing account", () => {
        accountStorage.setAccount("a@test.com", "pw");
        assert.equal(accountStorage.addAdmin("a@test.com"), true);
        assert.equal(accountStorage.isAdmin("a@test.com"), true);
        assert.ok(savedAdmins(store).includes("a@test.com"));
    });

    it("refuses a nonexistent account", () => {
        assert.equal(accountStorage.addAdmin("ghost@test.com"), false);
        assert.equal(savedAdmins(store).includes("ghost@test.com"), false);
    });

    it("refuses someone who is already an admin and adds no duplicate", () => {
        assert.equal(accountStorage.addAdmin(DEFAULT_ADMIN), false);
        assert.deepEqual(savedAdmins(store), [DEFAULT_ADMIN]);
    });
});

describe("removeAdmin", () => {
    it("demotes an admin when others remain", () => {
        const second = addSecondAdmin(accountStorage);
        assert.equal(accountStorage.removeAdmin(second), true);
        assert.equal(accountStorage.isAdmin(second), false);
        assert.equal(accountStorage.hasAccount(second), true); // the account itself stays
    });

    it("refuses to remove the last admin", () => {
        assert.equal(accountStorage.removeAdmin(DEFAULT_ADMIN), false);
        assert.equal(accountStorage.isAdmin(DEFAULT_ADMIN), true);
    });

    it("refuses a user who is not an admin", () => {
        accountStorage.setAccount("a@test.com", "pw");
        addSecondAdmin(accountStorage);
        assert.equal(accountStorage.removeAdmin("a@test.com"), false);
    });

    it("refuses a nonexistent account", () => {
        addSecondAdmin(accountStorage);
        assert.equal(accountStorage.removeAdmin("ghost@test.com"), false);
    });
});

describe("removeAccount", () => {
    it("refuses a nonexistent account", () => {
        assert.equal(accountStorage.removeAccount("ghost@test.com"), false);
    });

    it("deletes a regular account", () => {
        accountStorage.setAccount("a@test.com", "pw");
        assert.equal(accountStorage.removeAccount("a@test.com"), true);
        assert.equal(accountStorage.hasAccount("a@test.com"), false);
    });

    it("deletes an admin account and removes it from the admin list", () => {
        const second = addSecondAdmin(accountStorage);
        assert.equal(accountStorage.removeAccount(second), true);
        assert.equal(accountStorage.hasAccount(second), false);
        assert.equal(savedAdmins(store).includes(second), false);
    });

    it("refuses to delete the last admin and leaves everything intact", () => {
        assert.equal(accountStorage.removeAccount(DEFAULT_ADMIN), false);
        assert.equal(accountStorage.hasAccount(DEFAULT_ADMIN), true);
        assert.equal(accountStorage.isAdmin(DEFAULT_ADMIN), true);
    });

    it("does not make a re-created account an admin if its name belonged to a deleted admin", () => {
        const second = addSecondAdmin(accountStorage);
        accountStorage.removeAccount(second);
        accountStorage.setAccount(second, "new-pw");
        assert.equal(accountStorage.isAdmin(second), false);
    });
});

describe("current user", () => {
    it("is null when nobody is logged in", () => {
        assert.equal(accountStorage.getCurrentUser(), null);
    });

    it("returns the user after setCurrentUser", () => {
        accountStorage.setAccount("a@test.com", "pw");
        accountStorage.setCurrentUser("a@test.com");
        assert.equal(accountStorage.getCurrentUser(), "a@test.com");
    });

    it("clears a stale login when the account was deleted", () => {
        accountStorage.setAccount("a@test.com", "pw");
        accountStorage.setCurrentUser("a@test.com");
        accountStorage.removeAccount("a@test.com");
        assert.equal(accountStorage.getCurrentUser(), null);
        assert.equal(store.has("currentUser"), false);
    });

    it("removeCurrentUser logs the user out", () => {
        accountStorage.setCurrentUser(DEFAULT_ADMIN);
        accountStorage.removeCurrentUser();
        assert.equal(accountStorage.getCurrentUser(), null);
        assert.equal(store.has("currentUser"), false);
    });

    it("removeCurrentUser is harmless when nobody is logged in", () => {
        assert.doesNotThrow(() => accountStorage.removeCurrentUser());
    });
});

describe("isCurrentUserAdmin", () => {
    it("is true when an admin is logged in", () => {
        accountStorage.setCurrentUser(DEFAULT_ADMIN);
        assert.equal(accountStorage.isCurrentUserAdmin(), true);
    });

    it("is false when a regular user is logged in", () => {
        accountStorage.setAccount("a@test.com", "pw");
        accountStorage.setCurrentUser("a@test.com");
        assert.equal(accountStorage.isCurrentUserAdmin(), false);
    });

    it("is false when nobody is logged in", () => {
        assert.equal(accountStorage.isCurrentUserAdmin(), false);
    });

    it("is false when the logged-in account no longer exists", () => {
        accountStorage.setCurrentUser("ghost@test.com");
        assert.equal(accountStorage.isCurrentUserAdmin(), false);
    });
});

describe("getUserList", () => {
    it("returns false when nobody is logged in", () => {
        assert.equal(accountStorage.getUserList(), false);
    });

    it("returns false for a regular user", () => {
        accountStorage.setAccount("a@test.com", "pw");
        accountStorage.setCurrentUser("a@test.com");
        assert.equal(accountStorage.getUserList(), false);
    });

    it("returns every username for an admin", () => {
        accountStorage.setAccount("a@test.com", "pw");
        accountStorage.setCurrentUser(DEFAULT_ADMIN);
        const names = [...accountStorage.getUserList()];
        assert.deepEqual(names.sort(), [DEFAULT_ADMIN, "a@test.com"].sort());
    });
});

