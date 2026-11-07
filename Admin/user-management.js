const container = document.querySelector('#user-box');
const tpl = document.querySelector('#user-card');
const errorElement = document.getElementById("userManageError");
const LOGIN_PAGE = "../LogIn/queue-login.html";

function denyAccess()
{
    console.log("Permission denied, get off my webpage!");
    window.location.replace(LOGIN_PAGE);
}

async function renderUsers()
{
    const userList = await accountStorage.getUserList();
    if (userList === false) return denyAccess();   // not an admin (or session ended)

    const users = [...userList];
    // look up every role in parallel instead of one request per check
    const adminFlags = await Promise.all(users.map(user => accountStorage.isAdmin(user)));

    const frag = document.createDocumentFragment();

    users.forEach((user, i) =>
    {
        const isAdmin = adminFlags[i];
        const node = tpl.content.cloneNode(true);

        node.querySelector('.user').dataset.username = user;

        node.querySelector('.username').textContent = user;
        node.querySelector('.role').textContent = isAdmin ? 'admin' : 'user';

        node.querySelector('[data-action="promote"]').hidden = isAdmin;
        node.querySelector('[data-action="demote"]').hidden = !isAdmin;

        frag.appendChild(node);
    });

    container.replaceChildren(frag);
}

const actions = {
    delete: async user => {
        if (!confirm(`Delete ${user}?`)) return;

        if (await accountStorage.removeAccount(user))
        {
            await renderUsers();
        }
        else
        {
            // the server explains some failures (e.g. the account has queue history)
            errorElement.textContent = accountStorage.lastError
                || "Cannot delete user, if user is admin, ensure there is more than one admin";
        }
    },
    promote: async user => {
        if (await accountStorage.addAdmin(user))
        {
            await renderUsers();
        }
        else
        {
            errorElement.textContent = accountStorage.lastError || "Could not promote user.";
        }
    },
    demote: async user => {
        if (await accountStorage.removeAdmin(user))
        {
            await renderUsers();
        }
        else
        {
            errorElement.textContent = accountStorage.lastError
                || "Cannot demote admin, please ensure there is more than one admin before demoting";
        }
    },
};

(async () =>
{
    if (!(await accountStorage.isCurrentUserAdmin()))
    {
        return denyAccess();
    }

    container.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn || btn.disabled) return;

        if (!(await accountStorage.isCurrentUserAdmin()))
        {
            return denyAccess();
        }

        const username = btn.closest('.user').dataset.username;

        errorElement.textContent = "";
        btn.disabled = true;           // prevent double-clicks while the request runs
        try
        {
            await actions[btn.dataset.action]?.(username);
        }
        finally
        {
            btn.disabled = false;      // no effect if renderUsers already replaced the buttons
        }
    });

    await renderUsers();
})();