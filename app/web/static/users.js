// Users management page
document.querySelector('a[href="/users"]')?.classList.add('active');

const tableWrap   = document.getElementById('users-table-wrap');
const reveal      = document.getElementById('password-reveal');
const pwValue     = document.getElementById('password-value');
const pwMeta      = document.getElementById('password-user');
const btnCopyPw   = document.getElementById('btn-copy-pw');
const agentInput  = document.getElementById('agent-id-input');
const btnAddAgent = document.getElementById('btn-add-agent');
const btnAddCc    = document.getElementById('btn-add-cc');

function fmtTs(ts) {
  return ts ? new Date(ts).toLocaleString([], { hour12: false }) : '—';
}

function roleBadge(role) {
  const cls = role === 'central-command' ? 'badge-cc' : 'badge-agent';
  return `<span class="badge ${cls}">${role}</span>`;
}

function showPassword(username, password) {
  pwValue.textContent = password;
  pwMeta.textContent = `for ${username}`;
  reveal.style.display = 'block';
  reveal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

btnCopyPw.addEventListener('click', () => {
  navigator.clipboard.writeText(pwValue.textContent);
  btnCopyPw.textContent = 'Copied!';
  setTimeout(() => { btnCopyPw.textContent = 'Copy'; }, 2000);
});

async function loadUsers() {
  const res = await fetch('/api/users');
  const users = await res.json();

  if (!users.length) {
    tableWrap.innerHTML = '<div class="empty">No users yet</div>';
    return;
  }

  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Username</th><th>Role</th><th>Created</th><th></th></tr>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td style="font-family:var(--font-mono);font-size:0.8rem">${u.username}</td>
            <td>${roleBadge(u.role)}</td>
            <td style="color:var(--muted);font-size:0.75rem">${fmtTs(u.created_at)}</td>
            <td style="display:flex;gap:.4rem;justify-content:flex-end;flex-wrap:wrap">
              <button class="btn-sm" onclick="rotateUser('${u.username}')">
                Rotate Password
              </button>
              <button class="btn-sm btn-danger" onclick="removeUser('${u.username}')">
                Remove
              </button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

window.removeUser = async function(username) {
  if (!confirm(`Remove user "${username}"?`)) return;
  const res = await fetch(`/api/users/${username}`, { method: 'DELETE' });
  if (res.ok) {
    loadUsers();
  } else {
    const err = await res.json();
    alert(err.detail || 'Failed to remove user');
  }
};

window.rotateUser = async function(username) {
  const res = await fetch(`/api/users/${username}/rotate-password`, { method: 'POST' });
  if (res.ok) {
    const data = await res.json();
    showPassword(data.username, data.password);
    loadUsers();
  } else {
    const err = await res.json();
    alert(err.detail || 'Failed to rotate password');
  }
};

btnAddAgent.addEventListener('click', async () => {
  const agentId = agentInput.value.trim();
  if (!agentId) { agentInput.focus(); return; }

  btnAddAgent.disabled = true;
  const res = await fetch('/api/users/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId }),
  });
  btnAddAgent.disabled = false;

  if (res.ok) {
    const data = await res.json();
    agentInput.value = '';
    showPassword(data.username, data.password);
    loadUsers();
  } else {
    const err = await res.json();
    alert(err.detail || 'Failed to create agent');
  }
});

btnAddCc.addEventListener('click', async () => {
  btnAddCc.disabled = true;
  const res = await fetch('/api/users/cc', { method: 'POST' });
  btnAddCc.disabled = false;

  if (res.ok) {
    const data = await res.json();
    showPassword(data.username, data.password);
    loadUsers();
  } else {
    const err = await res.json();
    alert(err.detail || 'Failed to create CC user');
  }
});

loadUsers();
