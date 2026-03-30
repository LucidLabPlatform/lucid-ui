// Dashboard page JS — live fleet overview
const grid = document.getElementById('agent-grid');
const countEl = document.getElementById('agent-count');

let agents = {};  // agent_id → data

function stateBadge(agent) {
  const state = agent.status?.state ?? 'unknown';
  return `<span class="status-badge status-${state}">${state}</span>`;
}

function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const diffS = Math.floor((now - d) / 1000);
  if (diffS < 60) return `${diffS}s ago`;
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  return d.toLocaleTimeString([], { hour12: false });
}

function renderCard(agent) {
  const id = agent.agent_id;
  const compCount = Object.keys(agent.components || {}).length;
  return `
    <div class="agent-card" onclick="location.href='/agent/${id}'">
      <div class="agent-card-header">
        <span class="agent-card-name">${id}</span>
        ${stateBadge(agent)}
      </div>
      <div class="agent-card-meta">
        ${compCount} component${compCount !== 1 ? 's' : ''}
        · last seen ${fmtTs(agent.last_seen_ts)}
      </div>
      <div class="agent-card-actions">
        <button class="btn-danger" onclick="deleteAgent(event, '${id}')">Delete</button>
      </div>
    </div>`;
}

async function deleteAgent(e, id) {
  e.stopPropagation();
  if (!confirm(`Delete agent "${id}" and all its data?`)) return;
  const r = await fetch(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    alert('Delete failed: ' + (d.detail || r.status));
    return;
  }
  delete agents[id];
  renderGrid();
}

function renderGrid() {
  const list = Object.values(agents);
  if (!list.length) {
    grid.innerHTML = '<div class="empty">No agents seen yet</div>';
    countEl.textContent = '0 agents';
    return;
  }
  grid.innerHTML = list.map(renderCard).join('');
  countEl.textContent = `${list.length} agent${list.length !== 1 ? 's' : ''}`;
}

async function loadAgents() {
  const res = await fetch('/api/agents');
  const data = await res.json();
  agents = {};
  data.forEach(a => { agents[a.agent_id] = a; });
  renderGrid();
}

// Live updates via WebSocket
onWsEvent(evt => {
  if (evt.type !== 'mqtt') return;
  const id = evt.agent_id;
  if (!agents[id]) {
    agents[id] = { agent_id: id, status: null, components: {}, last_seen_ts: evt.ts };
  }
  const a = agents[id];
  a.last_seen_ts = evt.ts;
  if (evt.scope === 'agent' && evt.topic_type === 'status') {
    a.status = evt.payload;
  }
  if (evt.scope === 'component' && evt.component_id) {
    if (!a.components[evt.component_id]) {
      a.components[evt.component_id] = {};
    }
  }
  renderGrid();
});

loadAgents();
// Periodic refresh for last-seen timestamps
setInterval(renderGrid, 30_000);
