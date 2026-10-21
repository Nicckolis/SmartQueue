class AccountManager 
{
    #storageKey = "accounts";
    #adminKey = "admins";
    #currentKey = "currentUser";

    //constructor function sets default admin account
    constructor()
    {
        this.setAccount("adminDefault@gmail.com","12345");
        this.addAdmin("adminDefault@gmail.com");
    }

    //helper function to handle local storage check for admins and regular accounts together
    #readList(key) 
    {
        try {
            const data = JSON.parse(localStorage.getItem(key));
            return Array.isArray(data) ? data : [];
        } catch {
            return [];
        }
    }

    #load() 
    {
        return new Map(this.#readList(this.#storageKey));
    }

    #adminLoad()
    {
        return new Set(this.#readList(this.#adminKey));
    }

    //function to save regular account
    #saveAccounts(accounts)
    {
        localStorage.setItem(this.#storageKey, JSON.stringify([...accounts]));
    }

    //function to save admins in local storage becuase JSON sucks and doesnt handle sets
    #saveAdmins(admins) 
    {
        localStorage.setItem(this.#adminKey, JSON.stringify([...admins]));
    }

    setAccount(username, password) 
    {
        const accounts = this.#load();
        accounts.set(username, btoa(password));
        this.#saveAccounts(accounts);
    }

    addAdmin(username)
    {
        const adminAccounts = this.#adminLoad();
        if(this.hasAccount(username) && !this.isAdmin(username))
        {
            adminAccounts.add(username);
            this.#saveAdmins(adminAccounts);
            return true;
        }
        else
        {
            return false;
        }    
    }

    removeAccount(username)
    {
        const accounts = this.#load()
        if(this.hasAccount(username))
        {
            if(this.isAdmin(username))
            {
                if(!this.removeAdmin(username)) return false;
            }
            accounts.delete(username)
            this.#saveAccounts(accounts);
            return true;
        }
        else
        {
            return false;
        }
    }
    
    removeAdmin(username)
    {
        const adminAccounts = this.#adminLoad();
        if(this.hasAccount(username) && this.isAdmin(username) && adminAccounts.size > 1)
        {
            adminAccounts.delete(username);
            this.#saveAdmins(adminAccounts);
            return true;
        }
        else
        {
            return false;
        }
    }

    checkAccount(username, password) 
    {
        const accounts = this.#load();
        return accounts.has(username) && accounts.get(username) === btoa(password);
    }

    hasAccount(username) 
    {
        return this.#load().has(username);
    }

    isAdmin(username)
    {
        return this.hasAccount(username) && this.#adminLoad().has(username);
    }

    getCurrentUser()
    {
        const username = localStorage.getItem(this.#currentKey);
        if(username == null)
        {
            return null;
        }
        //handle deleted accounts
        if(!this.hasAccount(username))
        {
            this.removeCurrentUser();
            return null;
        }
        return username;
    }

    setCurrentUser(username)
    {
        localStorage.setItem(this.#currentKey,username);
    }

    removeCurrentUser()
    {
        localStorage.removeItem(this.#currentKey);
    }

    isCurrentUserAdmin()
    {
        const username = localStorage.getItem(this.#currentKey);
        if(this.isAdmin(username))
        {
            return true;
        }
        else
        {
            return false;
        }
    }

    getUserList()
    {
        if(!this.isCurrentUserAdmin()) return false;
        else
        {
            const accounts = this.#load();
            return accounts.keys();
        }
    }

}

const accountStorage = new AccountManager();