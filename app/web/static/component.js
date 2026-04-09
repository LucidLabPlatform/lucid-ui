// Component detail page JS
const agentId = window.LUCID_AGENT_ID;
let componentId = window.LUCID_COMPONENT_ID;

// ── DOM refs ────────────────────────────────────────────────────────
const sidebarList   = document.getElementById('sidebar-list');
const titleEl       = document.getElementById('comp-title');
const badgeEl       = document.getElementById('comp-badge');
const versionEl     = document.getElementById('comp-version');
const lastSeenEl    = document.getElementById('comp-last-seen');
const logFeed       = document.getElementById('log-feed');
const cmdAction     = document.getElementById('cmd-action');
const cmdBody       = document.getElementById('cmd-body');
const cmdSend       = document.getElementById('cmd-send');
const cmdStatus     = document.getElementById('cmd-status');
const cmdHistory    = document.getElementById('cmd-history');
const quickCmdsEl   = document.getElementById('quick-cmds');
const cmdDatalist   = document.getElementById('cmd-datalist');
const btnClearLogs  = document.getElementById('btn-clear-logs');

// Overview cards
const cardStatus       = document.getElementById('card-status');
const cardMetadata     = document.getElementById('card-metadata');
const cardState        = document.getElementById('card-state');
const cardConfig       = document.getElementById('card-config');
const cardCapabilities = document.getElementById('card-capabilities');

// Raw JSON
const rawStatus   = document.getElementById('raw-status');
const rawState    = document.getElementById('raw-state');
const rawMetadata = document.getElementById('raw-metadata');
const rawCfg      = document.getElementById('raw-cfg');

const MAX_LOGS = 500;

let compData = null;
let agentData = null;

// ── Command catalog ─────────────────────────────────────────────────
let commandCatalog = [];
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
function renderSidebar(components) {
  if (!components || !Object.keys(components).length) {
    sidebarList.innerHTML = '<div style="color:var(--muted);font-size:.78rem;padding:.5rem">No components</div>';
    return;
  }
  sidebarList.innerHTML = Object.values(components).map(c => {
    const state = c.status?.state || 'unknown';
    const isActive = c.component_id === componentId;
    return `
      <a class="sidebar-agent${isActive ? ' is-active' : ''}"
         href="/agent/${agentId}/component/${encodeURIComponent(c.component_id)}">
        <span class="sidebar-dot sidebar-dot-${state}"></span>
        ${escHtml(c.component_id)}
      </a>`;
  }).join('');
}

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

  history.replaceState(null, '', `#${tab}`);
});

function restoreTab() {
  const hash = location.hash.replace('#', '');
  if (hash) {
    const btn = tabBar.querySelector(`[data-tab="${hash}"]`);
    if (btn) btn.click();
  }
}

// ── Overview rendering ──────────────────────────────────────────────
function renderOverview(comp) {
  // Status card
  const status = comp.status || {};
  let statusRows = '';
  statusRows += kvRow('state', status.state, status.state === 'online' ? 'var(--green)' : status.state === 'error' ? 'var(--red)' : null);
  for (const [k, v] of Object.entries(status)) {
    if (k === 'state' || k === 'received_ts') continue;
    if (typeof v !== 'object') statusRows += kvRow(k, v);
  }
  if (comp.first_seen_ts) statusRows += kvRow('first seen', new Date(comp.first_seen_ts).toLocaleString());
  if (comp.last_seen_ts) statusRows += kvRow('last seen', new Date(comp.last_seen_ts).toLocaleString());
  cardStatus.innerHTML = kvTable(statusRows) || '<span style="color:var(--muted);font-size:0.78rem">No data</span>';

  // Metadata card
  const meta = comp.metadata || {};
  let metaRows = '';
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'capabilities' || k === 'received_ts') continue;
    if (typeof v === 'object') {
      metaRows += kvRow(k, JSON.stringify(v));
    } else {
      metaRows += kvRow(k, v);
    }
  }
  cardMetadata.innerHTML = kvTable(metaRows) || '<span style="color:var(--muted);font-size:0.78rem">No data</span>';

  // Version in header
  if (meta.version) {
    versionEl.textContent = `v${meta.version}`;
  }

  // State card
  const stateObj = comp.state || {};
  const statePayload = stateObj.payload || stateObj;
  let stateRows = '';
  if (typeof statePayload === 'object') {
    for (const [k, v] of Object.entries(statePayload)) {
      if (k === 'received_ts') continue;
      stateRows += kvRow(k, typeof v === 'object' ? JSON.stringify(v) : v);
    }
  }
  cardState.innerHTML = kvTable(stateRows) || '<span style="color:var(--muted);font-size:0.78rem">No data</span>';

  // Config card — expand logging and telemetry sub-objects fully
  const cfg = comp.cfg || {};
  let cfgRows = '';
  const cfgRoot = cfg.payload || cfg;
  for (const [section, val] of Object.entries(cfgRoot)) {
    if (section === 'received_ts') continue;
    if (section === 'logging' && typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) {
        if (k === 'received_ts') continue;
        cfgRows += kvRow(`logging.${k}`, v);
      }
    } else if (section === 'telemetry' && typeof val === 'object') {
      for (const [metric, mcfg] of Object.entries(val)) {
        if (typeof mcfg === 'object') {
          const detail = mcfg.enabled ? `✓ on · every ${mcfg.interval_s}s` : '✗ off';
          cfgRows += kvRow(`telemetry.${metric}`, detail, mcfg.enabled ? null : 'var(--muted)');
        } else {
          cfgRows += kvRow(`telemetry.${metric}`, mcfg);
        }
      }
    } else if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) {
        if (k === 'received_ts') continue;
        cfgRows += kvRow(`${section}.${k}`, typeof v === 'object' ? JSON.stringify(v) : v);
      }
    } else {
      cfgRows += kvRow(section, val);
    }
  }
  cardConfig.innerHTML = kvTable(cfgRows) || '<span style="color:var(--muted);font-size:0.78rem">No data</span>';

  // Capabilities card
  const caps = meta.capabilities || [];
  if (caps.length) {
    cardCapabilities.innerHTML = `<div class="comp-caps">${caps.map(cap => `<span class="comp-cap-tag">${escHtml(cap)}</span>`).join('')}</div>`;
  } else {
    cardCapabilities.innerHTML = '<span style="color:var(--muted);font-size:0.78rem">No capabilities reported</span>';
  }

  // Update badge
  setBadge(status.state);
  lastSeenEl.textContent = fmtRelative(comp.last_seen_ts);

  // Raw JSON tab
  rawStatus.textContent   = fmtJson(comp.status);
  rawState.textContent    = fmtJson(comp.state);
  rawMetadata.textContent = fmtJson(comp.metadata);
  rawCfg.textContent      = fmtJson(comp.cfg);
}

// ── Command catalog ─────────────────────────────────────────────────
async function loadCommandCatalog() {
  try {
    const res = await fetch(`/api/agents/${agentId}/command-catalog`);
    if (res.ok) {
      const catalog = await res.json();
      commandCatalog = catalog.components[componentId] || [];
    }
  } catch {}
  renderQuickCmds();
  updateDatalist();
}

function renderQuickCmds() {
  templateMap.clear();
  if (!commandCatalog.length) { quickCmdsEl.innerHTML = ''; return; }
  const groups = {};
  for (const cmd of commandCatalog) {
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
  const catalogActions = commandCatalog.map(c => c.action);
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

// ── Keyboard shortcuts ──────────────────────────────────────────────
cmdAction.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); handleSend(); }
});
cmdBody.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); }
});

// ── Send logic ──────────────────────────────────────────────────────
async function doSend(action, body) {
  const url = `/api/agents/${agentId}/components/${encodeURIComponent(componentId)}/cmd/${encodeURIComponent(action)}`;
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
      sessionCmds.set(rid, { action, componentId, body, resultOk: null, resultPayload: null });
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
  // Filter to this component only
  const filtered = cmds.filter(c => c.component_id === componentId);
  if (!filtered.length) {
    cmdHistory.innerHTML = '<div style="color:var(--muted);font-size:0.78rem;padding:0.5rem 0">No commands yet</div>';
    return;
  }
  cmdHistory.innerHTML = filtered.map(c => {
    const session = sessionCmds.get(c.request_id);
    const resultOk = session?.resultOk ?? c.result_ok;
    const payload  = session?.resultPayload;
    let resultCls = 'cmd-result-pending', resultTxt = '…';
    if (resultOk === true)  { resultCls = 'cmd-result-ok';   resultTxt = '✓ ok'; }
    if (resultOk === false) { resultCls = 'cmd-result-fail'; resultTxt = '✗ fail'; }
    const payloadHtml = payload
      ? `<div class="cmd-row-payload"><pre class="json-pre" style="max-height:80px;margin-top:.3rem">${escHtml(fmtJson(payload))}</pre></div>`
      : '';
    return `<div class="cmd-row" data-rid="${c.request_id}">
      <div class="cmd-row-header"><span class="cmd-action">${escHtml(c.action)}</span><span class="${resultCls}">${resultTxt}</span></div>
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
      renderSidebar(agentData.components);
      compData = (agentData.components || {})[componentId];
      if (compData) renderOverview(compData);
    }
  } catch {}
}

async function loadCommands() {
  try {
    const res = await fetch(`/api/agents/${agentId}/commands?limit=50`);
    if (res.ok) renderCmdHistory(await res.json());
  } catch {}
}

// ── WebSocket live updates ──────────────────────────────────────────
onWsEvent(evt => {
  if (evt.type !== 'mqtt') return;
  if (evt.agent_id !== agentId) return;

  // Update sidebar for all components of this agent
  if (!agentData) agentData = { agent_id: agentId, components: {} };

  const cid = evt.component_id;
  const tt  = evt.topic_type;

  if (cid) {
    if (!agentData.components[cid]) agentData.components[cid] = { component_id: cid };
    const comp = agentData.components[cid];
    if (tt === 'status')   comp.status   = evt.payload;
    if (tt === 'state')    comp.state    = evt.payload;
    if (tt === 'metadata') { comp.metadata = evt.payload; debouncedCatalogRefresh(); }
    if (tt === 'cfg')      comp.cfg      = evt.payload;

    renderSidebar(agentData.components);

    // Only render detail and logs for current component
    if (cid === componentId) {
      comp.last_seen_ts = evt.ts;
      compData = comp;
      renderOverview(compData);

      if (tt === 'logs' && evt.payload?.lines) {
        evt.payload.lines.forEach(l => appendLog(l));
      } else if (tt === 'logs' && typeof evt.payload === 'object') {
        appendLog(evt.payload);
      }
    }
  }

  if (tt.startsWith('evt/') && cid === componentId) {
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
loadAgent();
loadCommandCatalog();
loadCommands();
restoreTab();

// Refresh last-seen timestamp
setInterval(() => {
  if (compData) lastSeenEl.textContent = fmtRelative(compData.last_seen_ts);
}, 30_000);
