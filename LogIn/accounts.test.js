import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

const ACCOUNTS_PATH = path.resolve("LogIn/accounts.js");
const source = fs.readFileSync(ACCOUNTS_PATH, "utf8");

// A fake DOM element that records what the script does to it
function makeElement(props = {}) {
    return {
        value: "", textContent: "", innerHTML: "", listeners: {},
        addEventListener(type, fn) { this.listeners[type] = fn; },
        ...props,
    };
}

// Runs accounts.js in a fresh sandbox with a fake page, fake accountStorage and fake sessionStorage.
// `elements` maps element ids to props; ids not listed return null, like a page without that element.
function loadPage({ elements = {}, session = {}, accounts = {}, admins = [] } = {}) {
    const els = {};
    for (const [id, props] of Object.entries(elements)) els[id] = makeElement(props);

    const sessionStore = new Map(Object.entries(session));
    const users = new Map(Object.entries(accounts));
    const adminSet = new Set(admins);

    // Stand-in for AccountManager (already tested separately)
    const storage = {
        current: null,
        hasAccount: u => users.has(u),
        setAccount: (u, p) => users.set(u, p),
        checkAccount: (u, p) => users.has(u) && users.get(u) === p,
        isAdmin: u => adminSet.has(u),
        setCurrentUser(u) { this.current = u; },
    };

    const window = { location: { href: "" } };
    const ctx = vm.createContext({
        document: { getElementById: id => els[id] ?? null },
        window,
        sessionStorage: {
        getItem: k => (sessionStore.has(k) ? sessionStore.get(k) : null),
        setItem: (k, v) => sessionStore.set(k, String(v)),
        removeItem: k => sessionStore.delete(k),
        },
        accountStorage: storage,
    });
    new vm.Script(source, { filename: ACCOUNTS_PATH }).runInContext(ctx);

    return {
        ctx, els, window, storage,
        session: sessionStore,
        accounts: users,
        emails: vm.runInContext("emails", ctx), // top-level const isn't a property of ctx
    };
}

const signupFields = (email, pw, rpw) => ({
    signemail: { value: email }, spassword: { value: pw }, srpassword: { value: rpw }, signError: {},
});
const loginFields = (email, pw) => ({
    logemail: { value: email }, lpassword: { value: pw }, logError: {},
});

// Calls a handler with a fake event and reports whether preventDefault was called
function submit(handler) {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    handler(event);
    return event;
}

describe("ConfirmPassword", () => {
    it("is true when both passwords match", () => {
        const { ctx } = loadPage();
        assert.equal(ctx.ConfirmPassword("abc123", "abc123"), true);
    });

    it("is false when the passwords differ", () => {
        const { ctx } = loadPage();
        assert.equal(ctx.ConfirmPassword("abc123", "abc124"), false);
    });

    it("is case sensitive", () => {
        const { ctx } = loadPage();
        assert.equal(ctx.ConfirmPassword("abc", "ABC"), false);
    });
    });

    describe("CheckEmail", () => {
    it("accepts an address with a listed domain", () => {
        const { ctx, emails } = loadPage();
        assert.equal(ctx.CheckEmail("a@gmail.com", emails), true);
    });

    it("rejects an address with an unlisted domain", () => {
        const { ctx, emails } = loadPage();
        assert.equal(ctx.CheckEmail("a@nowhere.test", emails), false);
    });

    it("rejects text with no @", () => {
        const { ctx, emails } = loadPage();
        assert.equal(ctx.CheckEmail("not-an-email", emails), false);
    });

    it("uses the list it is given", () => {
        const { ctx } = loadPage();
        assert.equal(ctx.CheckEmail("a@custom.test", ["custom.test"]), true);
    });

    // Documents current behaviour: the domain comparison is case sensitive
    it("rejects an uppercase domain", () => {
        const { ctx, emails } = loadPage();
        assert.equal(ctx.CheckEmail("a@GMAIL.COM", emails), false);
    });
});

describe("onSignup", () => {
    it("calls preventDefault", () => {
        const page = loadPage({ elements: signupFields("a@gmail.com", "pw", "pw") });
        assert.equal(submit(page.ctx.onSignup).prevented, true);
    });

    it("asks for all fields when the email is blank or whitespace", () => {
        const page = loadPage({ elements: signupFields("   ", "pw", "pw") });
        submit(page.ctx.onSignup);
        assert.equal(page.els.signError.textContent, "Please fill in all fields.");
    });

    it("asks for all fields when a password is missing", () => {
        const page = loadPage({ elements: signupFields("a@gmail.com", "", "pw") });
        submit(page.ctx.onSignup);
        assert.equal(page.els.signError.textContent, "Please fill in all fields.");
    });

    it("reports both problems when the email is invalid and the passwords differ", () => {
        const page = loadPage({ elements: signupFields("a@nowhere.test", "pw1", "pw2") });
        submit(page.ctx.onSignup);
        assert.equal(page.els.signError.textContent, "Invalid email and passwords do not match.");
    });

    it("reports an invalid email", () => {
        const page = loadPage({ elements: signupFields("a@nowhere.test", "pw", "pw") });
        submit(page.ctx.onSignup);
        assert.equal(page.els.signError.textContent, "Please input a valid email.");
    });

    it("reports mismatched passwords", () => {
        const page = loadPage({ elements: signupFields("a@gmail.com", "pw1", "pw2") });
        submit(page.ctx.onSignup);
        assert.equal(page.els.signError.textContent, "Passwords do not match.");
    });

    it("points an existing account to the login page", () => {
        const page = loadPage({
        elements: signupFields("a@gmail.com", "pw", "pw"),
        accounts: { "a@gmail.com": "old" },
        });
        submit(page.ctx.onSignup);
        assert.ok(page.els.signError.innerHTML.includes("already exists"));
        assert.ok(page.els.signError.innerHTML.includes("queue-login.html"));
        assert.equal(page.accounts.get("a@gmail.com"), "old"); // not overwritten
    });

    it("creates the account, sets the message and redirects on success", () => {
        const page = loadPage({ elements: signupFields("a@gmail.com", "pw1", "pw1") });
        submit(page.ctx.onSignup);
        assert.equal(page.accounts.get("a@gmail.com"), "pw1");
        assert.equal(page.session.get("accountCreated"), "Account Created!");
        assert.equal(page.window.location.href, "queue-login.html");
    });

    it("clears an earlier error message on a valid submit", () => {
        const fields = signupFields("a@gmail.com", "pw", "pw");
        fields.signError = { textContent: "old error" };
        const page = loadPage({ elements: fields });
        submit(page.ctx.onSignup);
        assert.equal(page.els.signError.textContent, "");
    });

    it("creates nothing and does not redirect when validation fails", () => {
        const page = loadPage({ elements: signupFields("a@gmail.com", "pw1", "pw2") });
        submit(page.ctx.onSignup);
        assert.equal(page.accounts.size, 0);
        assert.equal(page.window.location.href, "");
        assert.equal(page.session.has("accountCreated"), false);
    });
});

describe("onLogin", () => {
    it("calls preventDefault", () => {
        const page = loadPage({ elements: loginFields("a@gmail.com", "pw") });
        assert.equal(submit(page.ctx.onLogin).prevented, true);
    });

    it("asks for all fields when the email is blank", () => {
        const page = loadPage({ elements: loginFields("  ", "pw") });
        submit(page.ctx.onLogin);
        assert.equal(page.els.logError.textContent, "Please fill in all fields.");
    });

    it("asks for all fields when the password is blank", () => {
        const page = loadPage({ elements: loginFields("a@gmail.com", "") });
        submit(page.ctx.onLogin);
        assert.equal(page.els.logError.textContent, "Please fill in all fields.");
    });

    it("rejects a wrong password without logging in or redirecting", () => {
        const page = loadPage({
        elements: loginFields("a@gmail.com", "wrong"),
        accounts: { "a@gmail.com": "pw" },
        });
        submit(page.ctx.onLogin);
        assert.ok(page.els.logError.innerHTML.includes("Incorrect Login"));
        assert.ok(page.els.logError.innerHTML.includes("queue-signup.html"));
        assert.equal(page.storage.current, null);
        assert.equal(page.window.location.href, "");
    });

    it("rejects an unknown user", () => {
        const page = loadPage({ elements: loginFields("ghost@gmail.com", "pw") });
        submit(page.ctx.onLogin);
        assert.ok(page.els.logError.innerHTML.includes("Incorrect Login"));
    });

    it("logs in an admin and redirects to the admin dashboard", () => {
        const page = loadPage({
        elements: loginFields("boss@gmail.com", "pw"),
        accounts: { "boss@gmail.com": "pw" },
        admins: ["boss@gmail.com"],
        });
        submit(page.ctx.onLogin);
        assert.equal(page.storage.current, "boss@gmail.com");
        assert.equal(page.window.location.href, "../Admin/admin-dashboard.html");
    });

    it("logs in a regular user and redirects to the user dashboard", () => {
        const page = loadPage({
        elements: loginFields("a@gmail.com", "pw"),
        accounts: { "a@gmail.com": "pw" },
        });
        submit(page.ctx.onLogin);
        assert.equal(page.storage.current, "a@gmail.com");
        assert.equal(page.window.location.href, "../UserDashboard/dashboard.html");
    });
});

describe("page wiring", () => {
    it("attaches onSignup to the signup form's submit event", () => {
        const page = loadPage({ elements: { signupForm: {} } });
        assert.equal(page.els.signupForm.listeners.submit, page.ctx.onSignup);
    });

    it("attaches onLogin to the login form's submit event", () => {
        const page = loadPage({ elements: { loginForm: {} } });
        assert.equal(page.els.loginForm.listeners.submit, page.ctx.onLogin);
    });

    it("does not throw on a page with neither form", () => {
        assert.doesNotThrow(() => loadPage());
    });

    it("shows the account-created message once and removes it", () => {
        const page = loadPage({
        elements: { createdAccount: {} },
        session: { accountCreated: "Account Created!" },
        });
        assert.equal(page.els.createdAccount.textContent, "Account Created!");
        assert.equal(page.session.has("accountCreated"), false);
    });

    it("leaves the element empty when there is no message", () => {
        const page = loadPage({ elements: { createdAccount: {} } });
        assert.equal(page.els.createdAccount.textContent, "");
    });
});