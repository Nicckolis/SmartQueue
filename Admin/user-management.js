function renderUsers()
{
    const frag = document.createDocumentFragment();
    const users = accountStorage.getUserList();

    for(const user of users)
    {
        const node = tpl.content.cloneNode(true);

        node.querySelector('.user').dataset.username = user;

        node.querySelector('.username').textContent = user;
        node.querySelector('.role').textContent = accountStorage.isAdmin(user) ? 'admin':'user';

        node.querySelector('[data-action="promote"]').hidden = accountStorage.isAdmin(user);
        node.querySelector('[data-action="demote"]').hidden = !accountStorage.isAdmin(user);

        frag.appendChild(node);
    }

    container.replaceChildren(frag);
}

const container = document.querySelector('#user-box');
const tpl = document.querySelector('#user-card');

if (!accountStorage.isCurrentUserAdmin()) 
{
    console.log("Permission denied, get off my webpage!");
    window.location.replace("../Login/queue-login.html"); 
}
else
{
    const errorElement = document.getElementById("userManageError");

    const actions = {
        delete: user => {
            if (confirm(`Delete ${user}?`)) {
                if(accountStorage.removeAccount(user))
                { 
                    renderUsers();
                }
                else
                {
                    errorElement.textContent = "Cannot delete user, if user is admin, ensure there is more than one admin"
                }
            }
        },
        promote: user => {
            accountStorage.addAdmin(user);
            renderUsers();
        },
        demote: user => {
            if(accountStorage.removeAdmin(user))
                { 
                    renderUsers();
                }
                else
                {
                    errorElement.textContent = "Cannot demote admin, please ensure there is more than one admin before demoting"
                }
        },
    };

    container.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;

        if (!accountStorage.isCurrentUserAdmin()) 
        {
            console.log("Permission denied, get off my webpage!");
            window.location.replace("../Login/queue-login.html");
            return; 
        }

        const username = btn.closest('.user').dataset.username;

        actions[btn.dataset.action]?.(username);
    });
    renderUsers();
}

