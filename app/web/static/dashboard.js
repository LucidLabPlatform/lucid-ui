// Fleet dashboard — two-panel layout
const sidebarList = document.getElementById('sidebar-list');
const fleetCount  = document.getElementById('fleet-count');
const fleetEmpty  = document.getElementById('fleet-empty');
const agentPanel  = document.getElementById('agent-panel');
const agentScroll = document.getElementById('agent-scroll');
const advChk      = document.getElementById('adv-chk');

let agents = {};      // agent_id → data
let catalogs = {};    // agent_id → command catalog
let selectedId = null;
let advancedOn = false;

// ── Helpers ──────────────────────────────────────────────────────────
function agentState(a) { return a.status?.state ?? 'unknown'; }

function fmtTs(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function fmtUptime(status) {
  const up = status?.uptime_s;
  if (up == null) return '—';
  const d = Math.floor(up/86400), h = Math.floor((up%86400)/3600), m = Math.floor((up%3600)/60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function esc(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

// ── Component summary ────────────────────────────────────────────────
// Generate a human-readable one-liner from component state
function compSummary(compId, comp) {
  const s = comp.state?.payload || comp.state || {};
  const status = comp.status?.state || 'unknown';

  if (compId === 'exec') {
    const active = s.active_runs ?? s['active runs'] ?? 0;
    return active > 0 ? `${active} active run(s)` : 'No active runs';
  }
  if (compId === 'ros_bridge') {
    const rl = s.roslaunch ?? s.roslaunch_state ?? '';
    const pubs = s.publishers ?? '';
    const subs = s.subscriptions ?? '';
    if (status === 'error') return 'ROS master not reachable';
    const parts = [];
    if (rl) parts.push(`roslaunch: ${rl}`);
    if (pubs !== '') parts.push(`${pubs} pub`);
    if (subs !== '') parts.push(`${subs} sub`);
    return parts.join(' · ') || status;
  }
  if (compId === 'led_strip') {
    const count = s.led_count ?? s['led count'] ?? '';
    const bright = s.brightness ?? '';
    const effect = s.current_effect ?? s['current effect'] ?? '';
    const parts = [];
    if (count) parts.push(`${count} LEDs`);
    if (bright !== '') parts.push(`Brightness: ${bright}`);
    if (effect) parts.push(`Effect: ${effect}`);
    return parts.join(' · ') || status;
  }
  if (compId === 'ndi') {
    const rx = s.receive_active ?? s['receive active'] ?? 'false';
    const tx = s.send_active ?? s['send active'] ?? 'false';
    if (rx === 'true' || tx === 'true') {
      const parts = [];
      if (rx === 'true') parts.push('receiving');
      if (tx === 'true') parts.push('sending');
      return parts.join(' + ');
    }
    return 'Idle — not receiving or sending';
  }
  if (compId === 'projector') {
    const conn = s.connected ?? '';
    const port = s.serial_port ?? s['serial port'] ?? '';
    if (conn === 'true') return `Connected${port ? ' · ' + port : ''}`;
    return 'Not connected';
  }
  if (compId === 'viz') {
    const arena = s.arena ?? 'unknown';
    const td = s.touchdesigner ?? 'unknown';
    return `Arena: ${arena} · TD: ${td}`;
  }
  // Fallback: show status
  return status;
}

// ── Component icon ───────────────────────────────────────────────────
function compIcon(compId) {
  const map = {
    exec: '⚙️', ros_bridge: '🔗', led_strip: '💡',
    ndi: '📡', projector: '🎥', viz: '🖥️',
  };
  return map[compId] || '📦';
}

// ── Sidebar ──────────────────────────────────────────────────────────
function renderSidebar() {
  const list = Object.values(agents);
  const online = list.filter(a => agentState(a) === 'online');
  const stale  = list.filter(a => agentState(a) !== 'online');

  let html = '';
  // Online agents first, sorted by id
  online.sort((a,b) => a.agent_id.localeCompare(b.agent_id)).forEach(a => {
    const hasErr = Object.values(a.components||{}).some(c => c.status?.state === 'error');
    const dotCls = hasErr ? 'sd-warn' : 'sd-ok';
    const active = a.agent_id === selectedId ? ' on' : '';
    html += `<div class="si${active}" data-id="${esc(a.agent_id)}">
      <div class="sd ${dotCls}"></div>
      <span class="sn">${esc(a.agent_id)}</span>
    </div>`;
  });

  if (stale.length) {
    html += '<hr class="sb-sep">';
    stale.sort((a,b) => a.agent_id.localeCompare(b.agent_id)).forEach(a => {
      const active = a.agent_id === selectedId ? ' on' : '';
      html += `<div class="si stale${active}" data-id="${esc(a.agent_id)}">
        <div class="sd sd-off"></div>
        <span class="sn">${esc(a.agent_id)}</span>
      </div>`;
    });
    html += `<button class="sb-clean" id="clean-stale-btn">✕ Clean up stale (${stale.length})</button>`;
  }

  sidebarList.innerHTML = html;
  fleetCount.textContent = `${online.length} online`;

  // Click handlers
  sidebarList.querySelectorAll('.si[data-id]').forEach(el => {
    el.addEventListener('click', () => selectAgent(el.dataset.id));
  });
  document.getElementById('clean-stale-btn')?.addEventListener('click', cleanStale);
}

// ── Select agent ─────────────────────────────────────────────────────
async function selectAgent(id) {
  selectedId = id;
  renderSidebar();

  const a = agents[id];
  if (!a) return;

  fleetEmpty.style.display = 'none';
  agentPanel.style.display = 'flex';

  // Header
  document.getElementById('h-name').textContent = a.agent_id;
  const badge = document.getElementById('h-badge');
  const state = agentState(a);
  badge.textContent = state;
  badge.className = `status-badge status-${state}`;
  document.getElementById('h-meta').innerHTML =
    `uptime ${fmtUptime(a.status)} · <span class="last-seen-warn">${fmtTs(a.last_seen_ts)}</span>`;

  // Fetch command catalog if not cached
  if (!catalogs[id]) {
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(id)}/command-catalog`);
      if (r.ok) catalogs[id] = await r.json();
    } catch { /* fallback to capabilities */ }
  }

  renderPanel(a);
}

// ── Render panel ─────────────────────────────────────────────────────
function renderPanel(a) {
  const catalog = catalogs[a.agent_id] || {};
  let html = '';

  // Agent info card (advanced only)
  const meta = a.metadata || {};
  const cfg = a.cfg || {};
  html += `<div class="ainfo${advancedOn ? ' show' : ''}">
    <div class="ainfo-title">Agent</div>
    <table class="kv-tbl">
      <tr><td class="kk">platform</td><td class="kvl">${esc(meta.platform || '—')} / ${esc(meta.architecture || '—')}</td></tr>
      <tr><td class="kk">version</td><td class="kvl">${esc(meta.version || '—')}</td></tr>
      <tr><td class="kk">heartbeat</td><td class="kvl">${cfg.heartbeat_s || '—'}s</td></tr>
      <tr><td class="kk">first seen</td><td class="kvl">${a.first_seen_ts ? new Date(a.first_seen_ts).toLocaleDateString() : '—'}</td></tr>
    </table>
  </div>`;

  // Component cards
  const comps = Object.values(a.components || {});
  comps.forEach(comp => {
    const cid = comp.component_id;
    const cState = comp.status?.state || 'unknown';
    const isErr = cState === 'error';
    const summary = compSummary(cid, comp);
    const summaryWarn = isErr;
    const icon = compIcon(cid);
    const iconCls = isErr ? 'er' : (cState === 'running' ? 'ok' : 'dim');

    // Action buttons from catalog or capabilities
    const compCmds = catalog.components?.[cid] || [];
    let actionsHtml = '';
    if (compCmds.length) {
      actionsHtml = compCmds.map((cmd, i) => {
        const cls = i === 0 ? ' primary' : (cmd.category === 'danger' ? ' danger' : '');
        const hb = cmd.has_body ? ' data-has-body="1"' : '';
        const tpl = cmd.template ? ` data-template="${esc(JSON.stringify(cmd.template))}"` : '';
        return `<button class="act${cls}" data-agent="${esc(a.agent_id)}" data-comp="${esc(cid)}" data-action="${esc(cmd.action)}"${hb}${tpl}>${esc(cmd.label || cmd.action)}</button>`;
      }).join('');
    } else {
      // Fallback: use capabilities from metadata
      const caps = comp.metadata?.capabilities || [];
      actionsHtml = caps.map((cap, i) => {
        const cls = i === 0 ? ' primary' : '';
        return `<button class="act${cls}" data-agent="${esc(a.agent_id)}" data-comp="${esc(cid)}" data-action="${esc(cap)}">${esc(cap)}</button>`;
      }).join('');
    }

    // Advanced: state KV grid
    const statePayload = comp.state?.payload || comp.state || {};
    const kvHtml = Object.entries(statePayload).map(([k, v]) => {
      return `<div class="sg-kv"><div class="sg-k">${esc(String(k))}</div><div class="sg-v">${esc(String(v ?? '—'))}</div></div>`;
    }).join('');

    // Advanced: capability pills
    const caps = comp.metadata?.capabilities || [];
    const pillsHtml = caps.map(c => `<span class="pill">${esc(c)}</span>`).join('');

    // Advanced: data age
    const stateTs = comp.state?.ts || comp.state?.last_seen_ts;
    let ageHtml = '';
    if (stateTs) {
      const ageStr = fmtTs(stateTs);
      const ageS = Math.floor((Date.now() - new Date(stateTs)) / 1000);
      if (ageS > 3600) {
        ageHtml = `<div class="data-age">state last updated ${ageStr}</div>`;
      }
    }

    html += `<div class="cc${isErr ? ' err' : ''}">
      <div class="cc-row">
        <div class="cc-icon ${iconCls}">${icon}</div>
        <div class="cc-txt">
          <div class="cc-name">${esc(cid)}</div>
          <div class="cc-sub${summaryWarn ? ' warn' : ''}">${esc(summary)}</div>
        </div>
        <span class="status-badge status-${cState}">${cState}</span>
      </div>
      ${actionsHtml ? `<div class="cc-acts">${actionsHtml}</div>` : ''}
      <div class="cc-adv${advancedOn ? ' show' : ''}">
        ${kvHtml ? `<div class="sg">${kvHtml}</div>` : ''}
        ${pillsHtml ? `<div class="pills">${pillsHtml}</div>` : ''}
        ${ageHtml}
      </div>
    </div>`;
  });

  // Logs section (advanced only)
  html += `<div class="logs-section${advancedOn ? ' show' : ''}" id="logs-section">
    <div class="logs-hdr">
      <span class="logs-hdr-title">Logs</span>
      <button class="btn-sm" id="logs-clear-btn">Clear</button>
    </div>
    <div class="lf-wrap"><div class="lf" id="log-feed"></div></div>
  </div>`;

  agentScroll.innerHTML = html;

  // Wire up action buttons
  agentScroll.querySelectorAll('.act[data-action]').forEach(btn => {
    btn.addEventListener('click', () => sendCmd(btn));
  });

  // Wire up logs clear
  document.getElementById('logs-clear-btn')?.addEventListener('click', () => {
    const feed = document.getElementById('log-feed');
    if (feed) feed.innerHTML = '';
  });
}

// ── Send command ─────────────────────────────────────────────────────
function sendCmd(btn) {
  const hasBody = btn.dataset.hasBody === '1';
  if (hasBody) {
    showPayloadEditor(btn);
    return;
  }
  fireCmd(btn, '{}');
}

async function fireCmd(btn, body) {
  const agentId = btn.dataset.agent;
  const compId  = btn.dataset.comp;
  const action  = btn.dataset.action;

  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';

  try {
    const url = compId
      ? `/api/agents/${encodeURIComponent(agentId)}/components/${encodeURIComponent(compId)}/cmd/${encodeURIComponent(action)}`
      : `/api/agents/${encodeURIComponent(agentId)}/cmd/${encodeURIComponent(action)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });
    btn.textContent = res.ok ? '✓' : '✗';
    btn.style.color = res.ok ? 'var(--green)' : 'var(--red)';
  } catch {
    btn.textContent = '✗';
    btn.style.color = 'var(--red)';
  }

  setTimeout(() => {
    btn.textContent = origText;
    btn.style.color = '';
    btn.disabled = false;
  }, 2000);
}

// ── Payload editor popup ─────────────────────────────────────────────
function showPayloadEditor(btn) {
  // Remove any existing popup
  document.querySelector('.cmd-popup')?.remove();

  let template = '{}';
  try { template = JSON.stringify(JSON.parse(btn.dataset.template || '{}'), null, 2); }
  catch { template = btn.dataset.template || '{}'; }

  const popup = document.createElement('div');
  popup.className = 'cmd-popup';
  popup.innerHTML = `
    <div class="cmd-popup-header">
      <span class="cmd-popup-title">${esc(btn.dataset.action)}</span>
      <span class="cmd-popup-target">${esc(btn.dataset.comp || btn.dataset.agent)}</span>
      <button class="cmd-popup-close">✕</button>
    </div>
    <textarea class="cmd-popup-body" spellcheck="false">${esc(template)}</textarea>
    <div class="cmd-popup-footer">
      <button class="cmd-popup-send">Send</button>
      <span class="cmd-popup-hint">Ctrl+Enter to send</span>
    </div>`;

  // Position near the button
  const card = btn.closest('.cc') || btn.parentElement;
  card.style.position = 'relative';
  card.appendChild(popup);

  const textarea = popup.querySelector('.cmd-popup-body');
  const sendBtn = popup.querySelector('.cmd-popup-send');
  const closeBtn = popup.querySelector('.cmd-popup-close');

  textarea.focus();
  // Select all text for easy replacement
  textarea.select();

  function doSend() {
    let body = textarea.value.trim() || '{}';
    try { JSON.parse(body); } catch {
      textarea.style.borderColor = 'var(--red)';
      return;
    }
    popup.remove();
    fireCmd(btn, body);
  }

  sendBtn.addEventListener('click', doSend);
  closeBtn.addEventListener('click', () => popup.remove());
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doSend();
    }
    if (e.key === 'Escape') popup.remove();
  });
}

// ── Advanced toggle ──────────────────────────────────────────────────
advChk.addEventListener('change', () => {
  advancedOn = advChk.checked;
  document.querySelectorAll('.cc-adv').forEach(el => el.classList.toggle('show', advancedOn));
  document.querySelectorAll('.ainfo').forEach(el => el.classList.toggle('show', advancedOn));
  document.querySelectorAll('.logs-section').forEach(el => el.classList.toggle('show', advancedOn));
});

// ── Clean up stale agents ────────────────────────────────────────────
async function cleanStale() {
  const stale = Object.values(agents).filter(a => agentState(a) !== 'online');
  if (!stale.length) return;
  if (!confirm(`Delete ${stale.length} stale agent(s) and all their data?`)) return;

  for (const a of stale) {
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(a.agent_id)}`, { method: 'DELETE' });
      if (r.ok) delete agents[a.agent_id];
    } catch { /* skip */ }
  }

  if (selectedId && !agents[selectedId]) {
    selectedId = null;
    agentPanel.style.display = 'none';
    fleetEmpty.style.display = '';
  }
  renderSidebar();
}

// ── Log appending ────────────────────────────────────────────────────
function appendLog(evt) {
  if (!advancedOn) return;
  const feed = document.getElementById('log-feed');
  if (!feed) return;

  const p = evt.payload || {};
  const ts = evt.ts ? new Date(evt.ts).toLocaleTimeString() : '';
  const level = p.level || p.levelname || 'INFO';
  const comp = evt.component_id || 'agent';
  const msg = p.message || p.msg || JSON.stringify(p);

  const line = document.createElement('div');
  line.className = 'll';
  line.innerHTML = `<span class="lt">${esc(ts)}</span><span class="lv ${esc(level)}">${esc(level)}</span><span class="lc">${esc(comp)}</span><span class="lm">${esc(msg)}</span>`;
  feed.prepend(line);

  // Keep max 200 lines
  while (feed.children.length > 200) feed.lastChild.remove();
}

// ── Load data ────────────────────────────────────────────────────────
async function loadAgents() {
  try {
    const res = await fetch('/api/agents');
    const data = await res.json();
    agents = {};
    data.forEach(a => { agents[a.agent_id] = a; });
    renderSidebar();
    // Auto-select first agent if nothing selected
    if (!selectedId && data.length) {
      const online = data.filter(a => agentState(a) === 'online');
      if (online.length) selectAgent(online[0].agent_id);
    } else if (selectedId && agents[selectedId]) {
      selectAgent(selectedId);
    }
  } catch (e) {
    console.error('Failed to load agents:', e);
  }
}

// ── WebSocket live updates ───────────────────────────────────────────
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
    if (evt.topic_type === 'cfg')      a.cfg      = evt.payload;
  }
  if (evt.scope === 'component' && evt.component_id) {
    if (!a.components[evt.component_id]) {
      a.components[evt.component_id] = { component_id: evt.component_id };
    }
    const comp = a.components[evt.component_id];
    if (evt.topic_type === 'status')   comp.status   = evt.payload;
    if (evt.topic_type === 'state')    comp.state    = evt.payload;
    if (evt.topic_type === 'metadata') comp.metadata = evt.payload;
    if (evt.topic_type === 'cfg')      comp.cfg      = evt.payload;
  }

  // Logs go to the log feed if this is the selected agent
  if (evt.topic_type === 'logs' && id === selectedId) {
    appendLog(evt);
  }

  renderSidebar();

  // Re-render panel if this is the selected agent
  if (id === selectedId) {
    // Update header meta live
    document.getElementById('h-meta').innerHTML =
      `uptime ${fmtUptime(a.status)} · <span class="last-seen-warn">${fmtTs(a.last_seen_ts)}</span>`;
    const badge = document.getElementById('h-badge');
    const state = agentState(a);
    badge.textContent = state;
    badge.className = `status-badge status-${state}`;
    renderPanel(a);
  }
});

// ── Boot ─────────────────────────────────────────────────────────────
loadAgents();
// Refresh relative timestamps every 30s
setInterval(() => {
  if (selectedId && agents[selectedId]) {
    document.getElementById('h-meta').innerHTML =
      `uptime ${fmtUptime(agents[selectedId].status)} · <span class="last-seen-warn">${fmtTs(agents[selectedId].last_seen_ts)}</span>`;
  }
}, 30_000);
