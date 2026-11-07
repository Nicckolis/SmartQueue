class AccountManager
{
    #endpoint;
 
    //message from the most recent failed request, handy for showing errors in the UI
    lastError = null;
 
    //the default admin account is now created by accounts.php on first run
    constructor(endpoint = "accounts.php")
    {
        this.#endpoint = endpoint;
    }
 
    //helper function that replaces the localStorage read/save helpers; all server calls go through here
    async #call(action, body = null)
    {
        try {
            const options = { credentials: "same-origin" };
            if(body !== null)
            {
                options.method = "POST";
                options.headers = { "Content-Type": "application/json" };
                options.body = JSON.stringify(body);
            }
            const response = await fetch(`${this.#endpoint}?action=${action}`, options);
            const data = await response.json();
            this.lastError = data.error ?? (data.ok ? null : "Request failed.");
            return data;
        } catch (err) {
            console.error(`AccountManager: request to ${this.#endpoint}?action=${action} failed`, err);
            this.lastError = "Could not reach the server.";
            return { ok: false, error: this.lastError };
}
    }
 
    //registers an account. profile is optional: { email, first_name, last_name, phone }
    async setAccount(username, password, profile = {}) 
    {
        const res = await this.#call("register", { ...profile, username, password });
        return res.ok === true;
    }
 
    async addAdmin(username)
    {
        const res = await this.#call("addAdmin", { username });
        return res.ok === true && res.result === true;
    }
 
    async removeAccount(username)
    {
        const res = await this.#call("removeAccount", { username });
        return res.ok === true && res.result === true;
    }
    
    async removeAdmin(username)
    {
        const res = await this.#call("removeAdmin", { username });
        return res.ok === true && res.result === true;
    }
 
    //verifies the credentials; on success the server also starts the login session
    async checkAccount(username, password) 
    {
        const res = await this.#call("login", { username, password });
        return res.ok === true;
    }
 
    //admin only on the server; non-admins always get false
    async hasAccount(username) 
    {
        const res = await this.#call("hasAccount", { username });
        return res.ok === true && res.result === true;
    }
 
    //works for admins, or when checking your own username
    async isAdmin(username)
    {
        const res = await this.#call("isAdmin", { username });
        return res.ok === true && res.result === true;
    }
 
    async getCurrentUser()
    {
        const res = await this.#call("currentUser");
        return res.ok === true ? (res.username ?? null) : null;
    }
 
    //checkAccount already started the session, so this confirms it belongs to username
    async setCurrentUser(username)
    {
        const current = await this.getCurrentUser();
        return current !== null && current.toLowerCase() === String(username).toLowerCase();
    }
 
    //ends the server session
    async removeCurrentUser()
    {
        await this.#call("logout", {});
    }
 
    async isCurrentUserAdmin()
    {
        const res = await this.#call("isCurrentUserAdmin");
        return res.ok === true && res.isAdmin === true;
    }
 
    //returns false for non-admins, otherwise an iterator of usernames (like Map.keys() did)
    async getUserList()
    {
        const res = await this.#call("getUserList", {});
        if(res.ok !== true) return false;
        return res.users.values();
    }
 
    async logout()
    {
        await this.removeCurrentUser();
        window.location.replace("LogIn/queue-login.html")
    }
}
 
const accountStorage = new AccountManager(new URL("accounts.php", document.currentScript.src).href);