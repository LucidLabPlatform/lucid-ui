// Agent detail page JS
const agentId = window.LUCID_AGENT_ID;

// ── DOM refs ────────────────────────────────────────────────────────
const titleEl     = document.getElementById('agent-title');
const badgeEl     = document.getElementById('agent-badge');
const blkStatus   = document.getElementById('blk-status');
const blkState    = document.getElementById('blk-state');
const blkMetadata = document.getElementById('blk-metadata');
const blkCfg      = document.getElementById('blk-cfg');
const compsList   = document.getElementById('components-list');
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

const MAX_LOGS = 500;

let agentData = null;

// ── Quick commands config ────────────────────────────────────────────
const QUICK_CMDS = {
  agent: [
    { action: 'ping',       noBody: true },
    { action: 'restart',    noBody: true },
    { action: 'reload-cfg', noBody: true },
    { action: 'update-cfg', noBody: false },
  ],
  component: [
    { action: 'ping',       noBody: true },
    { action: 'start',      noBody: true },
    { action: 'stop',       noBody: true },
    { action: 'enable',     noBody: true },
    { action: 'disable',    noBody: true },
    { action: 'reload-cfg', noBody: true },
  ],
};

// ── Session state ────────────────────────────────────────────────────
// Tracks commands sent this session so we can display result payloads
const sessionCmds = new Map(); // request_id → {action, componentId, body, resultOk, resultPayload}
let recentActions = [];        // MRU list, max 10

// ── Helpers ──────────────────────────────────────────────────────────
function fmtJson(obj) {
  if (obj === null || obj === undefined) return '—';
  return JSON.stringify(obj, null, 2);
}

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

function setBadge(state) {
  badgeEl.className = `status-badge status-${state || 'unknown'}`;
  badgeEl.textContent = state || 'unknown';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Quick commands ───────────────────────────────────────────────────
function renderQuickCmds() {
  const isComponent = !!cmdTarget.value;
  const list = isComponent ? QUICK_CMDS.component : QUICK_CMDS.agent;
  quickCmdsEl.innerHTML = list.map(c =>
    `<button class="quick-cmd-btn" data-action="${c.action}" data-nobody="${c.noBody}">${c.action}</button>`
  ).join('');
}

function updateDatalist() {
  const isComponent = !!cmdTarget.value;
  const known = (isComponent ? QUICK_CMDS.component : QUICK_CMDS.agent).map(c => c.action);
  const all = [...new Set([...recentActions, ...known])];
  cmdDatalist.innerHTML = all.map(a => `<option value="${a}">`).join('');
}

quickCmdsEl.addEventListener('click', e => {
  const btn = e.target.closest('.quick-cmd-btn');
  if (!btn) return;
  const action = btn.dataset.action;
  const noBody = btn.dataset.nobody === 'true';
  if (noBody) {
    doSend(action, {});
  } else {
    cmdAction.value = action;
    cmdBody.focus();
  }
});

cmdTarget.addEventListener('change', () => {
  renderQuickCmds();
  updateDatalist();
  cmdAction.focus();
});

// ── Keyboard shortcuts ───────────────────────────────────────────────
cmdAction.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    handleSend();
  }
});

cmdBody.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    handleSend();
  }
});

// ── Send logic ───────────────────────────────────────────────────────
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
  if (!action) {
    cmdStatus.textContent = 'Enter an action';
    cmdStatus.className = 'cmd-status err';
    cmdAction.focus();
    return;
  }

  let body = {};
  const raw = cmdBody.value.trim();
  if (raw) {
    try { body = JSON.parse(raw); }
    catch {
      cmdStatus.textContent = 'Invalid JSON body';
      cmdStatus.className = 'cmd-status err';
      cmdBody.focus();
      return;
    }
  }

  await doSend(action, body);
}

cmdSend.addEventListener('click', handleSend);

// ── State rendering ──────────────────────────────────────────────────
function renderRetained(agent) {
  blkStatus.textContent   = fmtJson(agent.status);
  blkState.textContent    = fmtJson(agent.state);
  blkMetadata.textContent = fmtJson(agent.metadata);
  blkCfg.textContent      = fmtJson(agent.cfg);
  setBadge(agent.status?.state);

  const comps = Object.values(agent.components || {});
  if (!comps.length) {
    compsList.innerHTML = '<div class="empty" style="padding:.5rem 0;font-size:.75rem">No components</div>';
  } else {
    // Preserve expanded state across re-renders
    const expanded = new Set(
      [...compsList.querySelectorAll('.comp-row.comp-expanded')].map(el => el.dataset.cid)
    );

    compsList.innerHTML = comps.map(c => {
      const cid = c.component_id;
      const hasState = c.state !== undefined && c.state !== null;
      const isExpanded = expanded.has(cid);
      const stateHtml = hasState
        ? `<div class="comp-state-detail${isExpanded ? '' : ' hidden'}">
             <pre class="json-pre" style="margin-top:.35rem;max-height:120px">${escHtml(fmtJson(c.state))}</pre>
           </div>`
        : '';
      return `
        <div class="comp-row comp-row-clickable${isExpanded ? ' comp-expanded' : ''}" data-cid="${escHtml(cid)}">
          <div class="comp-row-main" onclick="handleCompClick('${escHtml(cid)}')">
            <span class="comp-id">${escHtml(cid)}</span>
            <span class="status-badge status-${c.status?.state || 'unknown'}" style="font-size:.65rem">
              ${c.status?.state || '?'}
            </span>
          </div>
          ${stateHtml}
        </div>`;
    }).join('');

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
}

// ── Component click handler ──────────────────────────────────────────
window.handleCompClick = function(cid) {
  const row = compsList.querySelector(`.comp-row[data-cid="${cid}"]`);
  if (!row) return;

  const detail = row.querySelector('.comp-state-detail');
  if (detail) {
    detail.classList.toggle('hidden');
    row.classList.toggle('comp-expanded');
  }

  // Select this component as the command target
  cmdTarget.value = cid;
  renderQuickCmds();
  updateDatalist();
  cmdAction.focus();
};

// ── Log feed ──────────────────────────────────────────────────────────
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

  while (logFeed.children.length > MAX_LOGS) {
    logFeed.removeChild(logFeed.firstChild);
  }
  logFeed.scrollTop = logFeed.scrollHeight;
}

// ── Command history ───────────────────────────────────────────────────
function renderCmdHistory(cmds) {
  if (!cmds.length) {
    cmdHistory.innerHTML = '<div class="empty" style="padding:.5rem 0;font-size:.75rem">No commands yet</div>';
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
      ? `<div class="cmd-row-payload">
           <pre class="json-pre" style="max-height:80px;margin-top:.3rem">${escHtml(fmtJson(payload))}</pre>
         </div>`
      : '';

    return `
      <div class="cmd-row" data-rid="${c.request_id}">
        <div class="cmd-row-header">
          <span class="cmd-action">${target}${escHtml(c.action)}</span>
          <span class="${resultCls}">${resultTxt}</span>
        </div>
        <div class="cmd-rid">${c.request_id.slice(0, 8)}… · ${fmtTs(c.sent_ts)}</div>
        ${payloadHtml}
      </div>`;
  }).join('');
}

// ── Load initial data ─────────────────────────────────────────────────
async function loadAgent() {
  try {
    const res = await fetch(`/api/agents/${agentId}`);
    if (res.ok) {
      agentData = await res.json();
      renderRetained(agentData);
    }
  } catch { /* not online yet */ }
}

async function loadCommands() {
  try {
    const res = await fetch(`/api/agents/${agentId}/commands?limit=20`);
    if (res.ok) renderCmdHistory(await res.json());
  } catch { /* ignore */ }
}

// ── WebSocket live updates ────────────────────────────────────────────
onWsEvent(evt => {
  if (evt.type !== 'mqtt' || evt.agent_id !== agentId) return;

  if (!agentData) agentData = { agent_id: agentId, status: null, state: null,
                                metadata: null, cfg: null, components: {}, last_seen_ts: evt.ts };
  agentData.last_seen_ts = evt.ts;

  const cid = evt.component_id;
  const tt  = evt.topic_type;

  if (!cid) {
    if (tt === 'status')   { agentData.status   = evt.payload; blkStatus.textContent   = fmtJson(evt.payload); setBadge(evt.payload?.state); }
    if (tt === 'state')    { agentData.state    = evt.payload; blkState.textContent    = fmtJson(evt.payload); }
    if (tt === 'metadata') { agentData.metadata = evt.payload; blkMetadata.textContent = fmtJson(evt.payload); }
    if (tt === 'cfg')      { agentData.cfg      = evt.payload; blkCfg.textContent      = fmtJson(evt.payload); }

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
    if (tt === 'metadata') comp.metadata = evt.payload;
    if (tt === 'cfg')      comp.cfg      = evt.payload;
    renderRetained(agentData);

    if (tt === 'logs' && evt.payload?.lines) {
      evt.payload.lines.forEach(l => appendLog({ ...l, message: `[${cid}] ${l.message}` }));
    }
  }

  // Capture result payload for session commands
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

btnClearLogs.addEventListener('click', () => { logFeed.innerHTML = ''; });

// ── Boot ───────────────────────────────────────────────────────────────
renderQuickCmds();
updateDatalist();
loadAgent();
loadCommands();
