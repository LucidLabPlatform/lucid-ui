// Dashboard page JS — fleet table view
const fleetBody  = document.getElementById('fleet-body');
const fleetEmpty = document.getElementById('fleet-empty');
const countEl    = document.getElementById('agent-count');
const filterButtons = {
  all:     document.getElementById('filter-all'),
  online:  document.getElementById('filter-online'),
  offline: document.getElementById('filter-offline'),
};

let agents = {};       // agent_id → data
let activeFilter = 'all';
let sortCol = 'agent_id';
let sortAsc = true;

// ── Helpers ──────────────────────────────────────────────────────────
function agentState(agent) {
  return agent.status?.state ?? 'unknown';
}

function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const diffS = Math.floor((Date.now() - d) / 1000);
  if (diffS < 60)   return `${diffS}s ago`;
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  return `${Math.floor(diffS / 86400)}d ago`;
}

function fmtUptime(status) {
  const up = status?.uptime_s;
  if (up == null) return '—';
  const d = Math.floor(up / 86400);
  const h = Math.floor((up % 86400) / 3600);
  const m = Math.floor((up % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function metaField(agent, ...keys) {
  const m = agent.metadata || agent.status || {};
  for (const k of keys) {
    if (m[k] != null) return m[k];
  }
  return '—';
}

// ── Sorting ──────────────────────────────────────────────────────────
function sortValue(agent, col) {
  switch (col) {
    case 'agent_id':  return agent.agent_id;
    case 'status':    return agentState(agent);
    case 'host':      return metaField(agent, 'hostname', 'host');
    case 'uptime':    return agent.status?.uptime_s ?? -1;
    case 'last_seen': return agent.last_seen_ts ? new Date(agent.last_seen_ts).getTime() : 0;
    default:          return '';
  }
}

function sortAgents(list) {
  return list.sort((a, b) => {
    let va = sortValue(a, sortCol);
    let vb = sortValue(b, sortCol);
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });
}

// ── Render ───────────────────────────────────────────────────────────
function renderRow(agent) {
  const id = agent.agent_id;
  const state = agentState(agent);
  const isOnline = state === 'online';
  const host = metaField(agent, 'hostname', 'host');
  const ip = metaField(agent, 'ip', 'ip_address');
  const comps = Object.values(agent.components || {});

  const compBadges = comps.map(c => {
    const cs = c.status?.state || 'unknown';
    return `<span class="comp-badge comp-badge-${cs}">● ${c.component_id}</span>`;
  }).join('');

  const pingBtn = isOnline
    ? `<button class="btn-sm" id="ping-${id}" onclick="quickPing(event,'${id}')">Ping</button>`
    : '';

  return `
    <tr class="${isOnline ? '' : 'is-offline'}" data-agent="${id}" onclick="navAgent(event, '${id}')">
      <td><span class="fleet-agent-id">${id}</span></td>
      <td><span class="status-badge status-${state}">${state}</span></td>
      <td>
        <div class="fleet-host">${host}</div>
        <div class="fleet-ip">${ip}</div>
      </td>
      <td>${fmtUptime(agent.status)}</td>
      <td>${fmtTs(agent.last_seen_ts)}</td>
      <td><div class="fleet-comp-badges">${compBadges || '<span style="color:var(--muted)">—</span>'}</div></td>
      <td>
        <div class="fleet-actions" onclick="event.stopPropagation()">
          ${pingBtn}
          <button class="btn-danger" onclick="deleteAgent(event, '${id}')">Delete</button>
        </div>
      </td>
    </tr>`;
}

function renderTable() {
  const allAgents = Object.values(agents);
  const filtered = allAgents.filter(agent => {
    const state = agentState(agent);
    if (activeFilter === 'online')  return state === 'online';
    if (activeFilter === 'offline') return state !== 'online';
    return true;
  });

  const sorted = sortAgents(filtered);

  if (!sorted.length) {
    fleetBody.innerHTML = '';
    fleetEmpty.style.display = '';
    fleetEmpty.textContent = `No ${activeFilter === 'all' ? '' : activeFilter + ' '}agents found`;
  } else {
    fleetEmpty.style.display = 'none';
    fleetBody.innerHTML = sorted.map(renderRow).join('');
  }

  const onlineCount = allAgents.filter(a => agentState(a) === 'online').length;
  countEl.textContent = `${allAgents.length} agent${allAgents.length !== 1 ? 's' : ''}, ${onlineCount} online`;
}

// ── Navigation ───────────────────────────────────────────────────────
window.navAgent = function(e, id) {
  if (e.target.closest('.fleet-actions')) return;
  location.href = `/agent/${id}`;
};

// ── In-place row patch (avoids detaching rows mid-click) ──────────────
function patchRow(id) {
  const agent = agents[id];
  const existing = fleetBody.querySelector(`tr[data-agent="${CSS.escape(id)}"]`);

  if (!existing) {
    // New agent — fall back to full render to insert in sorted position
    renderTable();
    return;
  }

  const state = agentState(agent);
  const isOnline = state === 'online';
  const host = metaField(agent, 'hostname', 'host');
  const ip   = metaField(agent, 'ip', 'ip_address');
  const comps = Object.values(agent.components || {});
  const compBadges = comps.map(c => {
    const cs = c.status?.state || 'unknown';
    return `<span class="comp-badge comp-badge-${cs}">● ${c.component_id}</span>`;
  }).join('');

  existing.className = isOnline ? '' : 'is-offline';

  const cells = existing.querySelectorAll('td');
  // td[0] agent_id — never changes
  cells[1].innerHTML = `<span class="status-badge status-${state}">${state}</span>`;
  cells[2].innerHTML = `<div class="fleet-host">${host}</div><div class="fleet-ip">${ip}</div>`;
  cells[3].textContent = fmtUptime(agent.status);
  cells[4].textContent = fmtTs(agent.last_seen_ts);
  cells[5].innerHTML   = `<div class="fleet-comp-badges">${compBadges || '<span style="color:var(--muted)">—</span>'}</div>`;

  const pingBtn = isOnline
    ? `<button class="btn-sm" id="ping-${id}" onclick="quickPing(event,'${id}')">Ping</button>`
    : '';
  const actionsDiv = cells[6].querySelector('.fleet-actions');
  if (actionsDiv) {
    actionsDiv.innerHTML = `${pingBtn}<button class="btn-danger" onclick="deleteAgent(event, '${id}')">Delete</button>`;
  }
}

// ── Actions ──────────────────────────────────────────────────────────
window.quickPing = async function(e, id) {
  e.stopPropagation();
  const btn = document.getElementById(`ping-${id}`);
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(id)}/cmd/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    btn.textContent = res.ok ? '✓' : '✗';
    btn.style.color = res.ok ? 'var(--green)' : 'var(--red)';
  } catch {
    btn.textContent = '✗';
    btn.style.color = 'var(--red)';
  }
  setTimeout(() => {
    btn.textContent = 'Ping';
    btn.style.color = '';
    btn.disabled = false;
  }, 2000);
};

window.deleteAgent = async function(e, id) {
  e.stopPropagation();
  if (!confirm(`Delete agent "${id}" and all its data?`)) return;
  const r = await fetch(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    alert('Delete failed: ' + (d.detail || r.status));
    return;
  }
  delete agents[id];
  renderTable();
};

// ── Filters ──────────────────────────────────────────────────────────
function setFilter(filter) {
  activeFilter = filter;
  Object.entries(filterButtons).forEach(([name, button]) => {
    if (!button) return;
    button.classList.toggle('is-active', name === filter);
  });
  renderTable();
}

Object.entries(filterButtons).forEach(([name, button]) => {
  if (!button) return;
  button.addEventListener('click', () => setFilter(name));
});

// ── Column sorting ───────────────────────────────────────────────────
document.querySelectorAll('.fleet-table thead th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = true;
    }
    document.querySelectorAll('.fleet-table thead th').forEach(h => {
      h.classList.remove('sort-asc', 'sort-desc');
    });
    th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
    renderTable();
  });
});

// ── Load & live updates ──────────────────────────────────────────────
async function loadAgents() {
  const res = await fetch('/api/agents');
  const data = await res.json();
  agents = {};
  data.forEach(a => { agents[a.agent_id] = a; });
  renderTable();
}

onWsEvent(evt => {
  if (evt.type !== 'mqtt') return;
  const id = evt.agent_id;
  if (!agents[id]) {
    agents[id] = { agent_id: id, status: null, metadata: null, components: {}, last_seen_ts: evt.ts };
  }
  const a = agents[id];
  a.last_seen_ts = evt.ts;

  if (evt.scope === 'agent') {
    if (evt.topic_type === 'status')   a.status   = evt.payload;
    if (evt.topic_type === 'metadata') a.metadata = evt.payload;
    if (evt.topic_type === 'state')    a.state    = evt.payload;
  }
  if (evt.scope === 'component' && evt.component_id) {
    if (!a.components[evt.component_id]) {
      a.components[evt.component_id] = { component_id: evt.component_id };
    }
    const comp = a.components[evt.component_id];
    if (evt.topic_type === 'status') comp.status = evt.payload;
  }

  const isNew = !fleetBody.querySelector(`tr[data-agent="${CSS.escape(id)}"]`);
  patchRow(id);

  const onlineCount = Object.values(agents).filter(a => agentState(a) === 'online').length;
  countEl.textContent = `${Object.keys(agents).length} agent${Object.keys(agents).length !== 1 ? 's' : ''}, ${onlineCount} online`;

  if (!isNew) {
    // Flash the updated row (only if it was patched in-place, not a full re-render)
    const row = fleetBody.querySelector(`tr[data-agent="${CSS.escape(id)}"]`);
    if (row) {
      row.classList.remove('row-flash');
      void row.offsetWidth; // reflow to restart animation
      row.classList.add('row-flash');
    }
  }
});

loadAgents();
setInterval(renderTable, 30_000);
