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
