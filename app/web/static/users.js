// Users management page
document.querySelector('a[href="/users"]')?.classList.add('active');

const tableWrap    = document.getElementById('users-table-wrap');
const reveal       = document.getElementById('password-reveal');
const pwValue      = document.getElementById('password-value');
const pwMeta       = document.getElementById('password-user');
const btnCopyPw    = document.getElementById('btn-copy-pw');
const roleSelect   = document.getElementById('user-role');
const usernameInput = document.getElementById('username-input');
const btnAddUser   = document.getElementById('btn-add-user');
const syncHealth   = document.getElementById('users-sync-health');

// CC doesn't need a username input
roleSelect.addEventListener('change', () => {
  if (roleSelect.value === 'central-command') {
    usernameInput.style.display = 'none';
    usernameInput.value = '';
  } else {
    usernameInput.style.display = '';
    usernameInput.placeholder = roleSelect.value === 'observer'
      ? 'Username (e.g. dashboard)'
      : 'Agent ID (e.g. nikandros)';
  }
});

function fmtTs(ts) {
  return ts ? new Date(ts).toLocaleString([], { hour12: false }) : '—';
}

function roleBadge(role) {
  const cls = role === 'central-command' ? 'badge-cc'
            : role === 'observer' ? 'badge-observer'
            : 'badge-agent';
  return `<span class="badge ${cls}">${role}</span>`;
}

function syncBadge(status) {
  if (status === 'synced') return '<span class="status-badge status-online">synced</span>';
  if (status === 'error') return '<span class="status-badge status-offline">error</span>';
  return `<span class="status-badge status-offline">${status || 'pending'}</span>`;
}

function showPassword(username, password) {
  pwValue.textContent = password;
  pwMeta.textContent = `for ${username}`;
  reveal.style.display = 'block';
  reveal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

btnCopyPw.addEventListener('click', async () => {
  const text = pwValue.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
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
        <tr><th>Username</th><th>Role</th><th>Sync</th><th>Created</th><th></th></tr>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td style="font-family:var(--font-mono);font-size:0.8rem">${u.username}</td>
            <td>${roleBadge(u.role)}</td>
            <td>
              ${syncBadge(u.sync_status)}
              <div style="color:var(--muted);font-size:0.72rem;margin-top:0.2rem">${fmtTs(u.last_synced_at)}</div>
            </td>
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

async function loadSyncHealth() {
  const res = await fetch('/api/sync-state');
  const state = await res.json();
  const users = state['mqtt-users'];
  if (!users) {
    syncHealth.innerHTML = '<div class="empty">No sync state yet</div>';
    return;
  }
  const status = users.status || 'pending';
  const cls = status === 'synced' ? 'status-online' : 'status-offline';
  const err = users.last_error ? `<div style="color:#ff8f8f;margin-top:0.35rem">${users.last_error}</div>` : '';
  syncHealth.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
      <strong>MQTT user mirror</strong>
      <span class="status-badge ${cls}">${status}</span>
      <span style="color:var(--muted)">Last sync: ${fmtTs(users.last_synced_at)}</span>
    </div>
    ${err}
  `;
}

window.removeUser = async function(username) {
  if (!confirm(`Remove user "${username}"?`)) return;
  const res = await fetch(`/api/users/${username}`, { method: 'DELETE' });
  if (res.ok) {
    loadUsers();
    loadSyncHealth();
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
    loadSyncHealth();
  } else {
    const err = await res.json();
    alert(err.detail || 'Failed to rotate password');
  }
};

btnAddUser.addEventListener('click', async () => {
  const role = roleSelect.value;
  let url, body;

  if (role === 'central-command') {
    url = '/api/users/cc';
    body = null;
  } else if (role === 'observer') {
    const username = usernameInput.value.trim();
    if (!username) { usernameInput.focus(); return; }
    url = '/api/users/observer';
    body = JSON.stringify({ agent_id: username });
  } else {
    const agentId = usernameInput.value.trim();
    if (!agentId) { usernameInput.focus(); return; }
    url = '/api/users/agent';
    body = JSON.stringify({ agent_id: agentId });
  }

  btnAddUser.disabled = true;
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body,
  });
  btnAddUser.disabled = false;

  if (res.ok) {
    const data = await res.json();
    usernameInput.value = '';
    showPassword(data.username, data.password);
    loadUsers();
    loadSyncHealth();
  } else {
    const err = await res.json();
    alert(err.detail || 'Failed to create user');
  }
});

// ── Auth Log ─────────────────────────────────────────────────────────────────
const authLogWrap = document.getElementById('auth-log-wrap');
let _authLogFilter = 'all';
let _authLogEntries = [];

function authTypeBadge(type) {
  return type === 'authn'
    ? '<span class="badge badge-agent">auth</span>'
    : '<span class="badge badge-observer">topic</span>';
}

function actionBadge(action) {
  if (!action) return '';
  const cls = action === 'subscribe' ? 'badge-observer' : 'badge-cc';
  return `<span class="badge ${cls}">${action}</span>`;
}

function renderAuthLog() {
  const entries = _authLogEntries.filter(e => _authLogFilter === 'all' || e.type === _authLogFilter);
  if (!entries.length) {
    authLogWrap.innerHTML = '<div class="empty">No entries</div>';
    return;
  }
  authLogWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Time</th><th>Type</th><th>Username</th><th>Client ID</th><th>Topic / Action</th><th>Result</th></tr>
      </thead>
      <tbody>
        ${entries.map(e => `
          <tr>
            <td style="color:var(--muted);font-size:0.72rem;white-space:nowrap">${fmtTs(e.ts)}</td>
            <td>${authTypeBadge(e.type)}</td>
            <td style="font-family:var(--font-mono);font-size:0.78rem">${e.username || '—'}</td>
            <td style="font-family:var(--font-mono);font-size:0.72rem;color:var(--muted)">${e.clientid || '—'}</td>
            <td style="font-family:var(--font-mono);font-size:0.72rem;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${e.topic ? `<span title="${e.topic}">${e.topic}</span>` : '—'}
              ${e.action ? actionBadge(e.action) : ''}
            </td>
            <td style="color:#ff8f8f;font-size:0.75rem">${e.result || '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function loadAuthLog() {
  authLogWrap.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const res = await fetch('/api/auth-log?limit=200');
    if (!res.ok) throw new Error(res.status);
    _authLogEntries = await res.json();
    renderAuthLog();
  } catch (e) {
    authLogWrap.innerHTML = `<div class="empty" style="color:#ff8f8f">Failed to load: ${e.message}</div>`;
  }
}

document.querySelectorAll('[data-logfilter]').forEach(btn => {
  btn.addEventListener('click', () => {
    _authLogFilter = btn.dataset.logfilter;
    document.querySelectorAll('[data-logfilter]').forEach(b => b.classList.toggle('active', b === btn));
    renderAuthLog();
  });
});

document.getElementById('btn-refresh-log').addEventListener('click', loadAuthLog);

loadUsers();
loadSyncHealth();
loadAuthLog();
