# LUCID UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the fleet dashboard (table view) and agent detail page (sidebar + tabs) with a visual polish pass.

**Architecture:** Replace the dashboard card grid with a sortable table. Replace the agent detail 3-column layout with a left sidebar (agent list) + tabbed main content (Overview, Logs, Commands, Raw JSON). Apply CSS polish across both pages.

**Tech Stack:** Vanilla JS, Jinja2 templates, custom CSS (no new dependencies)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `app/web/static/styles.css` | All styling — CSS variables, fleet table, agent sidebar, tabs, info cards, polish |
| `app/web/templates/dashboard.html` | Fleet dashboard markup — table structure, filters |
| `app/web/static/dashboard.js` | Fleet table rendering, sorting, WebSocket updates, actions |
| `app/web/templates/agent.html` | Agent detail markup — sidebar, tab bar, tab content areas |
| `app/web/static/agent.js` | Sidebar fetch/render, tab switching, pushState navigation, existing logs/commands logic |

No new files. No backend changes.

---

### Task 1: CSS Polish — Variables & Base Styles

**Files:**
- Modify: `app/web/static/styles.css:1-17` (`:root` variables)
- Modify: `app/web/static/styles.css:19-25` (body)
- Modify: `app/web/static/styles.css:74-87` (main, page-header)

- [ ] **Step 1: Update CSS variables in `:root`**

Replace lines 1-17 of `styles.css`:

```css
/* ── Reset & base ─────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:       #0d1017;
  --surface:  #1a2036;
  --surface-hover: #1e2744;
  --border:   #283044;
  --text:     #e2e8f0;
  --muted:    #8494ab;
  --subtle:   #94a3b8;
  --accent:   #60a5fa;
  --accent-dim: rgba(96, 165, 250, 0.10);
  --green:    #4ade80;
  --red:      #f87171;
  --yellow:   #facc15;
  --radius:   10px;
  --radius-sm: 6px;
  --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  --transition: 150ms ease;
}
```

- [ ] **Step 2: Update body styles**

Replace lines 19-25:

```css
body {
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.55;
}

a { color: var(--accent); text-decoration: none; transition: color var(--transition); }
a:hover { text-decoration: underline; }
```

- [ ] **Step 3: Update page-header styles**

Replace the `.page-header` block (lines 77-87):

```css
.page-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}
.page-header h1 { font-size: 1.4rem; font-weight: 700; }
.subtitle { color: var(--muted); font-size: 0.85rem; }
.back-link { color: var(--muted); font-size: 0.85rem; transition: color var(--transition); }
.back-link:hover { color: var(--text); text-decoration: none; }
```

- [ ] **Step 4: Update button styles**

Replace `.btn-primary` (lines 258-268), `.btn-sm` (lines 270-279), and `.btn-danger` (lines 394-403):

```css
.btn-primary {
  background: var(--accent);
  color: #0f1117;
  border: none;
  border-radius: var(--radius-sm);
  padding: 0.5rem 1.1rem;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: filter var(--transition), transform var(--transition);
}
.btn-primary:hover { filter: brightness(1.12); transform: translateY(-1px); }
.btn-primary:active { transform: translateY(0); }

.btn-sm {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.6rem;
  font-size: 0.72rem;
  cursor: pointer;
  transition: border-color var(--transition), color var(--transition);
}
.btn-sm:hover { border-color: var(--subtle); color: var(--text); }

.btn-danger {
  background: transparent;
  border: 1px solid #450a0a;
  color: var(--red);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.55rem;
  font-size: 0.72rem;
  cursor: pointer;
  transition: background var(--transition);
}
.btn-danger:hover { background: #450a0a; }
```

- [ ] **Step 5: Update status badge styles**

Replace `.status-badge` block (lines 128-141):

```css
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.6rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  transition: background var(--transition);
}
.status-online   { background: #14532d88; color: var(--green); }
.status-offline  { background: #1c191788; color: var(--muted); }
.status-error    { background: #450a0a88; color: var(--red); }
.status-starting { background: #1c191788; color: var(--yellow); }
.status-unknown  { background: #1e243388; color: var(--muted); }
```

- [ ] **Step 6: Add page fade-in animation**

Add at the end of the reset/base section (after the `a:hover` rule):

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

main { padding: 1.5rem; animation: fadeIn 200ms ease-out; }
```

- [ ] **Step 7: Verify changes load correctly**

Run: `cd /Users/farahorfaly/Desktop/LUCID/lucid-central-command/lucid-ui && python -c "import app.main; print('OK')"`
Expected: `OK` (no import errors)

- [ ] **Step 8: Commit**

```bash
git add app/web/static/styles.css
git commit -m "style: polish CSS variables, buttons, badges, and add page transitions"
```

---

### Task 2: Fleet Dashboard — Table HTML

**Files:**
- Modify: `app/web/templates/dashboard.html`

- [ ] **Step 1: Replace dashboard.html content**

Replace the entire file with:

```html
{% extends "base.html" %}
{% block title %}Dashboard · LUCID{% endblock %}

{% block content %}
<div class="page-header">
  <h1>Fleet Dashboard</h1>
  <span class="subtitle" id="agent-count">Loading…</span>
  <div class="dashboard-filters" role="group" aria-label="Fleet filter">
    <button id="filter-all" class="btn-sm filter-btn is-active" type="button">All</button>
    <button id="filter-online" class="btn-sm filter-btn" type="button">Online</button>
    <button id="filter-offline" class="btn-sm filter-btn" type="button">Offline</button>
  </div>
</div>
<div class="table-wrap">
  <table class="fleet-table" id="fleet-table">
    <thead>
      <tr>
        <th class="sortable" data-sort="agent_id">Agent</th>
        <th class="sortable" data-sort="status">Status</th>
        <th class="sortable" data-sort="host">Host / IP</th>
        <th class="sortable" data-sort="uptime">Uptime</th>
        <th class="sortable" data-sort="last_seen">Last Seen</th>
        <th>Components</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody id="fleet-body"></tbody>
  </table>
</div>
<div id="fleet-empty" class="empty" style="display:none">No agents found</div>
{% endblock %}

{% block scripts %}
<script src="/static/dashboard.js"></script>
{% endblock %}
```

- [ ] **Step 2: Commit**

```bash
git add app/web/templates/dashboard.html
git commit -m "feat: replace fleet dashboard card grid with table markup"
```

---

### Task 3: Fleet Dashboard — Table CSS

**Files:**
- Modify: `app/web/static/styles.css` (replace agent-grid/agent-card block, lines 101-125)

- [ ] **Step 1: Replace dashboard card CSS with fleet table CSS**

Replace the entire `/* ── Agent grid (dashboard) */` section (lines 101-125) with:

```css
/* ── Fleet table (dashboard) ─────────────────────────────────────── */
.fleet-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.82rem;
}

.fleet-table thead th {
  text-align: left;
  padding: 0.6rem 1rem;
  background: var(--surface);
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 1;
  user-select: none;
}

.fleet-table thead th.sortable {
  cursor: pointer;
  transition: color var(--transition);
}
.fleet-table thead th.sortable:hover { color: var(--text); }
.fleet-table thead th.sort-asc::after  { content: " ▲"; font-size: 0.6rem; }
.fleet-table thead th.sort-desc::after { content: " ▼"; font-size: 0.6rem; }

.fleet-table tbody tr {
  cursor: pointer;
  transition: background var(--transition);
}
.fleet-table tbody tr:hover { background: var(--surface-hover); }
.fleet-table tbody tr.is-offline { opacity: 0.55; }

.fleet-table tbody td {
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.fleet-agent-id {
  font-weight: 600;
  color: var(--accent);
  font-size: 0.85rem;
}

.fleet-host { font-size: 0.8rem; }
.fleet-ip   { font-size: 0.72rem; color: var(--muted); }

.fleet-comp-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.comp-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.68rem;
  font-family: var(--font-mono);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}
.comp-badge-online  { background: #14532d44; color: var(--green); }
.comp-badge-offline { background: #1c191744; color: var(--muted); }
.comp-badge-error   { background: #450a0a44; color: var(--red); }
.comp-badge-unknown { background: #1e243344; color: var(--muted); }

.fleet-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

/* Flash highlight for WebSocket updates */
@keyframes rowFlash {
  0%   { background: var(--accent-dim); }
  100% { background: transparent; }
}
.fleet-table tbody tr.row-flash {
  animation: rowFlash 600ms ease-out;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/web/static/styles.css
git commit -m "style: add fleet table CSS replacing card grid styles"
```

---

### Task 4: Fleet Dashboard — JavaScript

**Files:**
- Modify: `app/web/static/dashboard.js` (full rewrite)

- [ ] **Step 1: Rewrite dashboard.js**

Replace the entire file with:

```js
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

  renderTable();

  // Flash the updated row
  const row = fleetBody.querySelector(`tr[data-agent="${id}"]`);
  if (row) {
    row.classList.remove('row-flash');
    void row.offsetWidth; // reflow to restart animation
    row.classList.add('row-flash');
  }
});

loadAgents();
setInterval(renderTable, 30_000);
```

- [ ] **Step 2: Verify no JS syntax errors**

Run: `cd /Users/farahorfaly/Desktop/LUCID/lucid-central-command/lucid-ui && node --check app/web/static/dashboard.js`
Expected: No output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add app/web/static/dashboard.js
git commit -m "feat: rewrite fleet dashboard JS for table view with sorting and flash updates"
```

---

### Task 5: Agent Detail — HTML Template

**Files:**
- Modify: `app/web/templates/agent.html` (full rewrite)

- [ ] **Step 1: Rewrite agent.html**

Replace the entire file with:

```html
{% extends "base.html" %}
{% block title %}{{ agent_id }} · LUCID{% endblock %}

{% block content %}
<div class="agent-page">
  <!-- Sidebar: agent list -->
  <aside class="agent-sidebar" id="agent-sidebar">
    <div class="sidebar-header">Agents</div>
    <div class="sidebar-list" id="sidebar-list"></div>
  </aside>

  <!-- Main content -->
  <div class="agent-main">
    <!-- Header -->
    <div class="agent-header">
      <div class="agent-header-left">
        <h1 id="agent-title">{{ agent_id }}</h1>
        <span id="agent-badge" class="status-badge">…</span>
      </div>
      <div class="agent-header-right">
        <span class="agent-last-seen" id="agent-last-seen"></span>
      </div>
    </div>

    <!-- Tab bar -->
    <div class="tab-bar" id="tab-bar">
      <button class="tab-btn is-active" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="logs">Logs</button>
      <button class="tab-btn" data-tab="commands">Commands</button>
      <button class="tab-btn" data-tab="raw">Raw JSON</button>
    </div>

    <!-- Tab: Overview -->
    <div class="tab-content is-active" id="tab-overview">
      <div class="overview-grid">
        <div class="info-card">
          <div class="info-card-title">Status & State</div>
          <div class="info-card-body" id="card-status"></div>
        </div>
        <div class="info-card">
          <div class="info-card-title">Metadata</div>
          <div class="info-card-body" id="card-metadata"></div>
        </div>
        <div class="info-card">
          <div class="info-card-title">Components</div>
          <div class="info-card-body" id="card-components"></div>
        </div>
        <div class="info-card">
          <div class="info-card-title">Config</div>
          <div class="info-card-body" id="card-config"></div>
        </div>
      </div>
    </div>

    <!-- Tab: Logs -->
    <div class="tab-content" id="tab-logs">
      <div class="tab-content-header">
        <button id="btn-clear-logs" class="btn-sm">Clear</button>
      </div>
      <div id="log-feed" class="log-feed"></div>
    </div>

    <!-- Tab: Commands -->
    <div class="tab-content" id="tab-commands">
      <div class="cmd-form">
        <select id="cmd-target" class="cmd-select">
          <option value="">Agent</option>
        </select>
        <div id="quick-cmds" class="quick-cmds"></div>
        <input id="cmd-action" placeholder="action  (Enter to send)" class="cmd-input" autocomplete="off" list="cmd-datalist">
        <datalist id="cmd-datalist"></datalist>
        <textarea id="cmd-body" placeholder='{"key":"value"}  (optional · Ctrl+Enter to send)' class="cmd-textarea" rows="3"></textarea>
        <div class="cmd-send-row">
          <button id="cmd-send" class="btn-primary">Send</button>
          <div id="cmd-status" class="cmd-status"></div>
        </div>
      </div>
      <div class="cmd-history-section">
        <div class="info-card-title" style="padding:0.75rem 0 0.5rem">History</div>
        <div id="cmd-history" class="cmd-history"></div>
      </div>
    </div>

    <!-- Tab: Raw JSON -->
    <div class="tab-content" id="tab-raw">
      <div class="raw-sections">
        <details class="raw-section" open>
          <summary>Status</summary>
          <pre id="raw-status" class="json-pre">—</pre>
        </details>
        <details class="raw-section" open>
          <summary>State</summary>
          <pre id="raw-state" class="json-pre">—</pre>
        </details>
        <details class="raw-section">
          <summary>Metadata</summary>
          <pre id="raw-metadata" class="json-pre">—</pre>
        </details>
        <details class="raw-section">
          <summary>Config</summary>
          <pre id="raw-cfg" class="json-pre">—</pre>
        </details>
      </div>
    </div>
  </div>
</div>
{% endblock %}

{% block scripts %}
<script>
  window.LUCID_AGENT_ID = {{ agent_id | tojson }};
</script>
<script src="/static/agent.js"></script>
{% endblock %}
```

- [ ] **Step 2: Commit**

```bash
git add app/web/templates/agent.html
git commit -m "feat: rewrite agent detail template with sidebar and tabbed layout"
```

---

### Task 6: Agent Detail — CSS

**Files:**
- Modify: `app/web/static/styles.css` (replace agent-layout section, lines 143-203, and log/cmd sections)

- [ ] **Step 1: Replace the agent detail layout CSS**

Replace everything from `/* ── Agent detail layout */` (line 143) through the end of the `/* ── Command history */` block (line 300) with:

```css
/* ── Agent page layout ───────────────────────────────────────────── */
.agent-page {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 0;
  height: calc(100vh - 60px);
  margin: -1.5rem;
}

/* ── Agent sidebar ───────────────────────────────────────────────── */
.agent-sidebar {
  background: var(--surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  padding: 1rem 1rem 0.5rem;
}

.sidebar-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 0.5rem 1rem;
}

.sidebar-agent {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  font-family: var(--font-mono);
  color: var(--subtle);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
  text-decoration: none;
}
.sidebar-agent:hover { background: var(--surface-hover); color: var(--text); text-decoration: none; }
.sidebar-agent.is-active {
  background: var(--accent-dim);
  color: var(--accent);
  border-left: 3px solid var(--accent);
  padding-left: calc(0.75rem - 3px);
}

.sidebar-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sidebar-dot-online  { background: var(--green); }
.sidebar-dot-offline { background: var(--muted); }
.sidebar-dot-error   { background: var(--red); }
.sidebar-dot-unknown { background: var(--muted); }

/* ── Agent main content ──────────────────────────────────────────── */
.agent-main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 1.25rem 1.5rem;
}

.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.agent-header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.agent-header-left h1 {
  font-size: 1.4rem;
  font-weight: 700;
}

.agent-last-seen {
  font-size: 0.78rem;
  color: var(--muted);
}

/* ── Tab bar ─────────────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1.25rem;
}

.tab-btn {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  padding: 0.6rem 1.1rem;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--transition), border-color var(--transition);
}
.tab-btn:hover { color: var(--text); }
.tab-btn.is-active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

/* ── Tab content ─────────────────────────────────────────────────── */
.tab-content {
  display: none;
  flex: 1;
  overflow-y: auto;
  animation: fadeIn 150ms ease-out;
}
.tab-content.is-active { display: flex; flex-direction: column; }

/* ── Overview grid ───────────────────────────────────────────────── */
.overview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.info-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: border-color var(--transition);
}
.info-card:hover { border-color: var(--accent); }

.info-card-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  padding: 0.75rem 1rem 0.5rem;
}

.info-card-body {
  padding: 0 1rem 0.75rem;
}

/* ── Key-value table inside info cards ───────────────────────────── */
.kv-table {
  width: 100%;
  font-size: 0.8rem;
  border-collapse: collapse;
}
.kv-table td {
  padding: 0.25rem 0;
  vertical-align: top;
}
.kv-table td:first-child {
  color: var(--muted);
  font-size: 0.75rem;
  width: 40%;
  padding-right: 0.75rem;
}
.kv-table td:last-child {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text);
}

/* ── Component rows inside overview ──────────────────────────────── */
.overview-comp {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.8rem;
}
.overview-comp:last-child { border-bottom: none; }
.overview-comp-id {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--subtle);
}

/* ── Log feed (tab) ──────────────────────────────────────────────── */
.tab-content-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.5rem;
}

.log-feed {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  line-height: 1.55;
}

.log-line { padding: 0.1rem 0; }
.log-ts   { color: var(--muted); margin-right: 0.4rem; }
.log-level-DEBUG { color: var(--muted); }
.log-level-INFO  { color: var(--subtle); }
.log-level-WARNING, .log-level-WARN { color: var(--yellow); }
.log-level-ERROR, .log-level-CRITICAL { color: var(--red); font-weight: 600; }

/* ── Command form (tab) ──────────────────────────────────────────── */
.cmd-form { display: flex; flex-direction: column; gap: 0.6rem; max-width: 600px; }

.cmd-select, .cmd-input, .cmd-textarea {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 0.45rem 0.7rem;
  font-size: 0.82rem;
  width: 100%;
  transition: border-color var(--transition);
}
.cmd-textarea { font-family: var(--font-mono); resize: vertical; }
.cmd-select:focus, .cmd-input:focus, .cmd-textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.cmd-send-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.cmd-status { font-size: 0.75rem; color: var(--muted); min-height: 1.2rem; }
.cmd-status.ok  { color: var(--green); }
.cmd-status.err { color: var(--red); }

/* ── Command history ─────────────────────────────────────────────── */
.cmd-history-section { margin-top: 1rem; max-width: 600px; }
.cmd-history { }

.cmd-row {
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.78rem;
}
.cmd-row:last-child { border-bottom: none; }
.cmd-row-header { display: flex; justify-content: space-between; align-items: center; }
.cmd-action { font-family: var(--font-mono); color: var(--accent); }
.cmd-target-id { color: var(--muted); }
.cmd-result-ok   { color: var(--green); font-weight: 600; }
.cmd-result-fail { color: var(--red); font-weight: 600; }
.cmd-result-pending { color: var(--muted); }
.cmd-rid { color: var(--muted); font-size: 0.65rem; font-family: var(--font-mono); }

/* ── Quick commands ──────────────────────────────────────────────── */
.quick-cmds { display: flex; flex-direction: column; gap: 0.4rem; }
.cmd-category-group { }
.cmd-category-label { font-size: 0.68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.2rem; }
.cmd-category-buttons { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 0.4rem; }
.quick-cmd-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--subtle);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.6rem;
  font-size: 0.72rem;
  cursor: pointer;
  transition: border-color var(--transition), color var(--transition);
}
.quick-cmd-btn:hover { border-color: var(--accent); color: var(--accent); }

/* ── Raw JSON tab ────────────────────────────────────────────────── */
.raw-sections {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.raw-section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.raw-section summary {
  padding: 0.65rem 1rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--subtle);
  cursor: pointer;
  user-select: none;
  transition: background var(--transition);
}
.raw-section summary:hover { background: var(--surface-hover); }

.raw-section .json-pre {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--subtle);
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--bg);
  border-radius: 0;
  padding: 0.75rem 1rem;
  margin: 0;
  max-height: 300px;
  overflow-y: auto;
  border-top: 1px solid var(--border);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/web/static/styles.css
git commit -m "style: add agent sidebar, tab bar, overview grid, and raw JSON CSS"
```

---

### Task 7: Agent Detail — JavaScript

**Files:**
- Modify: `app/web/static/agent.js` (full rewrite)

- [ ] **Step 1: Rewrite agent.js**

Replace the entire file with:

```js
// Agent detail page JS — sidebar + tabs
let agentId = window.LUCID_AGENT_ID;

// ── DOM refs ────────────────────────────────────────────────────────
const sidebarList = document.getElementById('sidebar-list');
const titleEl     = document.getElementById('agent-title');
const badgeEl     = document.getElementById('agent-badge');
const lastSeenEl  = document.getElementById('agent-last-seen');
const logFeed     = document.getElementById('log-feed');
const cmdTarget   = document.getElementById('cmd-target');
const cmdAction   = document.getElementById('cmd-action');
const cmdBody     = document.getElementById('cmd-body');
const cmdSend     = document.getElementById('cmd-send');
const cmdStatus   = document.getElementById('cmd-status');
const cmdHistory  = document.getElementById('cmd-history');
const quickCmdsEl = document.getElementById('quick-cmds');
const cmdDatalist = document.getElementById('cmd-datalist');
const btnClearLogs = document.getElementById('btn-clear-logs');

// Overview cards
const cardStatus     = document.getElementById('card-status');
const cardMetadata   = document.getElementById('card-metadata');
const cardComponents = document.getElementById('card-components');
const cardConfig     = document.getElementById('card-config');

// Raw JSON
const rawStatus   = document.getElementById('raw-status');
const rawState    = document.getElementById('raw-state');
const rawMetadata = document.getElementById('raw-metadata');
const rawCfg      = document.getElementById('raw-cfg');

const MAX_LOGS = 500;

let agentData = null;
let allAgents = [];

// ── Command catalog ─────────────────────────────────────────────────
let commandCatalog = { agent: [], components: {} };
let catalogDebounce = null;
const sessionCmds = new Map();
let recentActions = [];
const templateMap = new Map();

// ── Helpers ──────────────────────────────────────────────────────────
function fmtJson(obj) {
  if (obj === null || obj === undefined) return '—';
  return JSON.stringify(obj, null, 2);
}

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

function fmtRelative(ts) {
  if (!ts) return '';
  const diffS = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diffS < 60)   return `seen ${diffS}s ago`;
  if (diffS < 3600) return `seen ${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `seen ${Math.floor(diffS / 3600)}h ago`;
  return `seen ${Math.floor(diffS / 86400)}d ago`;
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setBadge(state) {
  badgeEl.className = `status-badge status-${state || 'unknown'}`;
  badgeEl.textContent = state || 'unknown';
}

function kvRow(label, value, valueColor) {
  const style = valueColor ? ` style="color:${valueColor}"` : '';
  return `<tr><td>${escHtml(label)}</td><td${style}>${escHtml(value ?? '—')}</td></tr>`;
}

function kvTable(rows) {
  return `<table class="kv-table">${rows}</table>`;
}

// ── Sidebar ─────────────────────────────────────────────────────────
async function loadSidebar() {
  try {
    const res = await fetch('/api/agents');
    if (res.ok) {
      allAgents = await res.json();
      renderSidebar();
    }
  } catch {}
}

function renderSidebar() {
  sidebarList.innerHTML = allAgents.map(a => {
    const state = a.status?.state || 'unknown';
    const isActive = a.agent_id === agentId;
    return `
      <a class="sidebar-agent${isActive ? ' is-active' : ''}"
         href="/agent/${a.agent_id}"
         onclick="switchAgent(event, '${escHtml(a.agent_id)}')">
        <span class="sidebar-dot sidebar-dot-${state}"></span>
        ${escHtml(a.agent_id)}
      </a>`;
  }).join('');
}

window.switchAgent = function(e, newId) {
  e.preventDefault();
  if (newId === agentId) return;
  agentId = newId;
  agentData = null;
  history.pushState(null, '', `/agent/${newId}`);
  titleEl.textContent = newId;
  setBadge('unknown');
  lastSeenEl.textContent = '';
  logFeed.innerHTML = '';
  cmdHistory.innerHTML = '';
  sessionCmds.clear();
  recentActions = [];
  renderSidebar();
  loadAgent();
  loadCommands();
  loadCommandCatalog();
};

// Handle browser back/forward
window.addEventListener('popstate', () => {
  const match = location.pathname.match(/^\/agent\/(.+)$/);
  if (match) {
    const newId = decodeURIComponent(match[1]);
    if (newId !== agentId) {
      agentId = newId;
      agentData = null;
      titleEl.textContent = newId;
      logFeed.innerHTML = '';
      renderSidebar();
      loadAgent();
      loadCommands();
      loadCommandCatalog();
    }
  }
});

// ── Tabs ─────────────────────────────────────────────────────────────
const tabBar = document.getElementById('tab-bar');

tabBar.addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  const tab = btn.dataset.tab;

  tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('is-active'));
  btn.classList.add('is-active');

  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('is-active'));
  const target = document.getElementById(`tab-${tab}`);
  if (target) target.classList.add('is-active');

  // Update URL hash
  history.replaceState(null, '', `#${tab}`);
});

// Restore tab from URL hash on load
function restoreTab() {
  const hash = location.hash.replace('#', '');
  if (hash) {
    const btn = tabBar.querySelector(`[data-tab="${hash}"]`);
    if (btn) btn.click();
  }
}

// ── Overview rendering ──────────────────────────────────────────────
function renderOverview(agent) {
  // Status & State card
  const status = agent.status || {};
  const state = agent.state || {};
  let statusRows = '';
  statusRows += kvRow('state', status.state, status.state === 'online' ? 'var(--green)' : status.state === 'error' ? 'var(--red)' : null);
  if (status.uptime_s != null) {
    const d = Math.floor(status.uptime_s / 86400);
    const h = Math.floor((status.uptime_s % 86400) / 3600);
    statusRows += kvRow('uptime', d > 0 ? `${d}d ${h}h` : `${h}h`);
  }
  // Include state fields
  for (const [k, v] of Object.entries(state)) {
    if (typeof v !== 'object') statusRows += kvRow(k, v);
  }
  // Include remaining status fields
  for (const [k, v] of Object.entries(status)) {
    if (k === 'state' || k === 'uptime_s') continue;
    if (typeof v !== 'object') statusRows += kvRow(k, v);
  }
  cardStatus.innerHTML = kvTable(statusRows) || '<span style="color:var(--muted);font-size:0.78rem">No data</span>';

  // Metadata card
  const meta = agent.metadata || {};
  let metaRows = '';
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v !== 'object') metaRows += kvRow(k, v);
  }
  cardMetadata.innerHTML = kvTable(metaRows) || '<span style="color:var(--muted);font-size:0.78rem">No data</span>';

  // Components card
  const comps = Object.values(agent.components || {});
  if (!comps.length) {
    cardComponents.innerHTML = '<span style="color:var(--muted);font-size:0.78rem">No components</span>';
  } else {
    cardComponents.innerHTML = comps.map(c => {
      const cs = c.status?.state || 'unknown';
      return `<div class="overview-comp">
        <span class="overview-comp-id">${escHtml(c.component_id)}</span>
        <span class="status-badge status-${cs}" style="font-size:.65rem">${cs}</span>
      </div>`;
    }).join('');
  }

  // Config card
  const cfg = agent.cfg || {};
  let cfgRows = '';
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === 'object') {
      cfgRows += kvRow(k, JSON.stringify(v));
    } else {
      cfgRows += kvRow(k, v);
    }
  }
  cardConfig.innerHTML = kvTable(cfgRows) || '<span style="color:var(--muted);font-size:0.78rem">No data</span>';

  // Update badge and last seen
  setBadge(status.state);
  lastSeenEl.textContent = fmtRelative(agent.last_seen_ts);

  // Raw JSON tab
  rawStatus.textContent   = fmtJson(agent.status);
  rawState.textContent    = fmtJson(agent.state);
  rawMetadata.textContent = fmtJson(agent.metadata);
  rawCfg.textContent      = fmtJson(agent.cfg);

  // Populate command target dropdown
  const current = cmdTarget.value;
  while (cmdTarget.options.length > 1) cmdTarget.remove(1);
  comps.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.component_id;
    opt.textContent = c.component_id;
    cmdTarget.appendChild(opt);
  });
  if (current) cmdTarget.value = current;
}

// ── Command catalog ─────────────────────────────────────────────────
async function loadCommandCatalog() {
  try {
    const res = await fetch(`/api/agents/${agentId}/command-catalog`);
    if (res.ok) commandCatalog = await res.json();
  } catch {}
  renderQuickCmds();
  updateDatalist();
}

function getCurrentCommands() {
  const cid = cmdTarget.value;
  if (cid && commandCatalog.components[cid]) return commandCatalog.components[cid];
  return cid ? [] : commandCatalog.agent;
}

function renderQuickCmds() {
  const cmds = getCurrentCommands();
  templateMap.clear();
  if (!cmds.length) { quickCmdsEl.innerHTML = ''; return; }
  const groups = {};
  for (const cmd of cmds) {
    const cat = cmd.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(cmd);
    if (cmd.template != null) templateMap.set(cmd.action, cmd.template);
  }
  let html = '';
  for (const [category, items] of Object.entries(groups)) {
    html += `<div class="cmd-category-group"><div class="cmd-category-label">${escHtml(category)}</div><div class="cmd-category-buttons">`;
    for (const cmd of items) {
      html += `<button class="quick-cmd-btn" data-action="${escHtml(cmd.action)}" data-has-body="${cmd.has_body}">${escHtml(cmd.label || cmd.action)}</button>`;
    }
    html += `</div></div>`;
  }
  quickCmdsEl.innerHTML = html;
}

function updateDatalist() {
  const catalogActions = getCurrentCommands().map(c => c.action);
  const all = [...new Set([...recentActions, ...catalogActions])];
  cmdDatalist.innerHTML = all.map(a => `<option value="${a}">`).join('');
}

quickCmdsEl.addEventListener('click', e => {
  const btn = e.target.closest('.quick-cmd-btn');
  if (!btn) return;
  const action = btn.dataset.action;
  if (btn.dataset.hasBody !== 'true') {
    doSend(action, {});
  } else {
    cmdAction.value = action;
    const tpl = templateMap.get(action);
    cmdBody.value = tpl != null ? JSON.stringify(tpl, null, 2) : '';
    cmdBody.focus();
  }
});

cmdTarget.addEventListener('change', () => { renderQuickCmds(); updateDatalist(); cmdAction.focus(); });

// ── Keyboard shortcuts ──────────────────────────────────────────────
cmdAction.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); handleSend(); }
});
cmdBody.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); }
});

// ── Send logic ──────────────────────────────────────────────────────
async function doSend(action, body) {
  const cid = cmdTarget.value;
  const url = cid
    ? `/api/agents/${agentId}/components/${encodeURIComponent(cid)}/cmd/${encodeURIComponent(action)}`
    : `/api/agents/${agentId}/cmd/${encodeURIComponent(action)}`;
  cmdSend.disabled = true;
  cmdStatus.textContent = 'Sending…';
  cmdStatus.className = 'cmd-status';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      const rid = data.request_id;
      sessionCmds.set(rid, { action, componentId: cid, body, resultOk: null, resultPayload: null });
      recentActions = [action, ...recentActions.filter(a => a !== action)].slice(0, 10);
      updateDatalist();
      cmdStatus.textContent = `Sent · ${rid.slice(0, 8)}…`;
      cmdStatus.className = 'cmd-status ok';
      loadCommands();
    } else {
      const d = await res.json().catch(() => ({}));
      cmdStatus.textContent = `Error ${res.status}${d.detail ? ': ' + d.detail : ''}`;
      cmdStatus.className = 'cmd-status err';
    }
  } catch (e) {
    cmdStatus.textContent = String(e);
    cmdStatus.className = 'cmd-status err';
  } finally {
    cmdSend.disabled = false;
  }
}

async function handleSend() {
  const action = cmdAction.value.trim();
  if (!action) { cmdStatus.textContent = 'Enter an action'; cmdStatus.className = 'cmd-status err'; cmdAction.focus(); return; }
  let body = {};
  const raw = cmdBody.value.trim();
  if (raw) {
    try { body = JSON.parse(raw); }
    catch { cmdStatus.textContent = 'Invalid JSON body'; cmdStatus.className = 'cmd-status err'; cmdBody.focus(); return; }
  }
  await doSend(action, body);
}

cmdSend.addEventListener('click', handleSend);

// ── Log feed ────────────────────────────────────────────────────────
function appendLog(line) {
  const level = (line.level || 'INFO').toUpperCase();
  const ts = fmtTs(line.ts || line.received_ts);
  const div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML =
    `<span class="log-ts">${ts}</span>` +
    `<span class="log-level-${level}">[${level}]</span> ` +
    `<span>${escHtml(line.message || '')}</span>`;
  logFeed.appendChild(div);
  while (logFeed.children.length > MAX_LOGS) logFeed.removeChild(logFeed.firstChild);
  logFeed.scrollTop = logFeed.scrollHeight;
}

btnClearLogs.addEventListener('click', () => { logFeed.innerHTML = ''; });

// ── Command history ─────────────────────────────────────────────────
function renderCmdHistory(cmds) {
  if (!cmds.length) {
    cmdHistory.innerHTML = '<div style="color:var(--muted);font-size:0.78rem;padding:0.5rem 0">No commands yet</div>';
    return;
  }
  cmdHistory.innerHTML = cmds.map(c => {
    const session = sessionCmds.get(c.request_id);
    const resultOk = session?.resultOk ?? c.result_ok;
    const payload  = session?.resultPayload;
    let resultCls = 'cmd-result-pending', resultTxt = '…';
    if (resultOk === true)  { resultCls = 'cmd-result-ok';   resultTxt = '✓ ok'; }
    if (resultOk === false) { resultCls = 'cmd-result-fail'; resultTxt = '✗ fail'; }
    const target = c.component_id ? `<span class="cmd-target-id">${escHtml(c.component_id)}/</span>` : '';
    const payloadHtml = payload
      ? `<div class="cmd-row-payload"><pre class="json-pre" style="max-height:80px;margin-top:.3rem">${escHtml(fmtJson(payload))}</pre></div>`
      : '';
    return `<div class="cmd-row" data-rid="${c.request_id}">
      <div class="cmd-row-header"><span class="cmd-action">${target}${escHtml(c.action)}</span><span class="${resultCls}">${resultTxt}</span></div>
      <div class="cmd-rid">${c.request_id.slice(0, 8)}… · ${fmtTs(c.sent_ts)}</div>
      ${payloadHtml}
    </div>`;
  }).join('');
}

// ── Load initial data ───────────────────────────────────────────────
async function loadAgent() {
  try {
    const res = await fetch(`/api/agents/${agentId}`);
    if (res.ok) {
      agentData = await res.json();
      renderOverview(agentData);
    }
  } catch {}
}

async function loadCommands() {
  try {
    const res = await fetch(`/api/agents/${agentId}/commands?limit=20`);
    if (res.ok) renderCmdHistory(await res.json());
  } catch {}
}

// ── WebSocket live updates ──────────────────────────────────────────
onWsEvent(evt => {
  if (evt.type !== 'mqtt') return;

  // Update sidebar for any agent
  const sidebarAgent = allAgents.find(a => a.agent_id === evt.agent_id);
  if (sidebarAgent && evt.scope === 'agent' && evt.topic_type === 'status') {
    sidebarAgent.status = evt.payload;
    renderSidebar();
  }

  // Only process detail events for the current agent
  if (evt.agent_id !== agentId) return;

  if (!agentData) agentData = { agent_id: agentId, status: null, state: null, metadata: null, cfg: null, components: {}, last_seen_ts: evt.ts };
  agentData.last_seen_ts = evt.ts;

  const cid = evt.component_id;
  const tt  = evt.topic_type;

  if (!cid) {
    if (tt === 'status')   agentData.status   = evt.payload;
    if (tt === 'state')    agentData.state    = evt.payload;
    if (tt === 'metadata') agentData.metadata = evt.payload;
    if (tt === 'cfg')      agentData.cfg      = evt.payload;

    if (tt === 'logs' && evt.payload?.lines) {
      evt.payload.lines.forEach(l => appendLog(l));
    } else if (tt === 'logs' && typeof evt.payload === 'object') {
      appendLog(evt.payload);
    }
  } else {
    if (!agentData.components[cid]) agentData.components[cid] = { component_id: cid };
    const comp = agentData.components[cid];
    if (tt === 'status')   comp.status   = evt.payload;
    if (tt === 'state')    comp.state    = evt.payload;
    if (tt === 'metadata') { comp.metadata = evt.payload; debouncedCatalogRefresh(); }
    if (tt === 'cfg')      comp.cfg      = evt.payload;

    if (tt === 'logs' && evt.payload?.lines) {
      evt.payload.lines.forEach(l => appendLog({ ...l, message: `[${cid}] ${l.message}` }));
    }
  }

  renderOverview(agentData);

  if (tt.startsWith('evt/')) {
    const rid = evt.payload?.request_id;
    if (rid && sessionCmds.has(rid)) {
      const session = sessionCmds.get(rid);
      session.resultOk      = evt.payload?.ok;
      session.resultPayload = evt.payload;
    }
    loadCommands();
  }
});

function debouncedCatalogRefresh() {
  clearTimeout(catalogDebounce);
  catalogDebounce = setTimeout(loadCommandCatalog, 2000);
}

// ── Boot ────────────────────────────────────────────────────────────
loadSidebar();
loadCommandCatalog();
loadAgent();
loadCommands();
restoreTab();

// Refresh last-seen timestamp
setInterval(() => {
  if (agentData) lastSeenEl.textContent = fmtRelative(agentData.last_seen_ts);
}, 30_000);
```

- [ ] **Step 2: Verify no JS syntax errors**

Run: `cd /Users/farahorfaly/Desktop/LUCID/lucid-central-command/lucid-ui && node --check app/web/static/agent.js`
Expected: No output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add app/web/static/agent.js
git commit -m "feat: rewrite agent detail JS with sidebar navigation and tabbed layout"
```

---

### Task 8: Remove Stale CSS & Final Cleanup

**Files:**
- Modify: `app/web/static/styles.css`

- [ ] **Step 1: Remove the old agent-card action styles**

Search for and remove `.agent-card-actions`, `.btn-ping`, `.ping-ok`, `.ping-fail` CSS rules if they still exist. Also remove the old `.comp-row-clickable`, `.comp-expanded`, `.comp-state-detail`, `.comp-row-main` rules that are no longer used.

Also remove `.hidden { display: none; }` if it exists, and the old `.panel`, `.panel h2`, `.panel-header`, `.retained-panel`, `.state-blocks`, `.state-block`, `.state-block-label` rules since the agent detail no longer uses them.

- [ ] **Step 2: Verify the app loads without errors**

Run: `cd /Users/farahorfaly/Desktop/LUCID/lucid-central-command/lucid-ui && python -c "import app.main; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add app/web/static/styles.css
git commit -m "chore: remove stale CSS rules from old card and panel layouts"
```

---

### Task 9: Manual Smoke Test

- [ ] **Step 1: Start the UI server**

Run: `cd /Users/farahorfaly/Desktop/LUCID/lucid-central-command && docker compose up -d`

Then open `http://localhost:5000` in a browser.

- [ ] **Step 2: Verify fleet dashboard**

Check:
- Table renders with column headers (Agent, Status, Host/IP, Uptime, Last Seen, Components, Actions)
- Filter buttons work (All, Online, Offline)
- Click a column header to sort
- Click a row to navigate to agent detail
- Ping and Delete buttons work

- [ ] **Step 3: Verify agent detail page**

Check:
- Sidebar shows all agents with status dots
- Clicking a sidebar agent switches without page reload
- URL updates to `/agent/{new_id}`
- Browser back/forward works
- Tabs: Overview shows 2×2 info cards with key-value pairs
- Tabs: Logs shows live log feed with Clear button
- Tabs: Commands shows form and history
- Tabs: Raw JSON shows collapsible formatted JSON
- Tab state preserved in URL hash

- [ ] **Step 4: Verify visual polish**

Check:
- Page fade-in animation on load
- Hover effects on table rows, sidebar items, info cards
- Status badges with semi-transparent backgrounds
- Consistent spacing and font sizing
- Scrollbar styling works

