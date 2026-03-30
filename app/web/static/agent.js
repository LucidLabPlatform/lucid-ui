// Agent detail page JS
const agentId = window.LUCID_AGENT_ID;

// ── DOM refs ────────────────────────────────────────────────────────
const titleEl   = document.getElementById('agent-title');
const badgeEl   = document.getElementById('agent-badge');
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
const btnClearLogs = document.getElementById('btn-clear-logs');

const MAX_LOGS = 500;

let agentData = null;

// ── Helpers ─────────────────────────────────────────────────────────
function fmtJson(obj) {
  if (obj === null || obj === undefined) return '—';
  return JSON.stringify(obj, null, 2);
}

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

function stateCls(state) {
  return `status-${state || 'unknown'}`;
}

function setBadge(state) {
  badgeEl.className = `status-badge status-${state || 'unknown'}`;
  badgeEl.textContent = state || 'unknown';
}

// ── State rendering ──────────────────────────────────────────────────
function renderRetained(agent) {
  blkStatus.textContent   = fmtJson(agent.status);
  blkState.textContent    = fmtJson(agent.state);
  blkMetadata.textContent = fmtJson(agent.metadata);
  blkCfg.textContent      = fmtJson(agent.cfg);
  setBadge(agent.status?.state);

  // Components
  const comps = Object.values(agent.components || {});
  if (!comps.length) {
    compsList.innerHTML = '<div class="empty" style="padding:.5rem 0;font-size:.75rem">No components</div>';
  } else {
    compsList.innerHTML = comps.map(c => `
      <div class="comp-row">
        <span class="comp-id">${c.component_id}</span>
        <span class="status-badge status-${c.status?.state || 'unknown'}" style="font-size:.65rem">
          ${c.status?.state || '?'}
        </span>
      </div>`).join('');

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

// ── Log feed ─────────────────────────────────────────────────────────
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

  // Trim old lines
  while (logFeed.children.length > MAX_LOGS) {
    logFeed.removeChild(logFeed.firstChild);
  }

  // Auto-scroll
  logFeed.scrollTop = logFeed.scrollHeight;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Command history ───────────────────────────────────────────────────
function renderCmdHistory(cmds) {
  if (!cmds.length) {
    cmdHistory.innerHTML = '<div class="empty" style="padding:.5rem 0;font-size:.75rem">No commands</div>';
    return;
  }
  cmdHistory.innerHTML = cmds.map(c => {
    let resultCls = 'cmd-result-pending', resultTxt = 'pending';
    if (c.result_ok === true)  { resultCls = 'cmd-result-ok';   resultTxt = '✓ ok'; }
    if (c.result_ok === false) { resultCls = 'cmd-result-fail'; resultTxt = '✗ fail'; }
    const target = c.component_id ? `${c.component_id}/` : '';
    return `
      <div class="cmd-row">
        <div class="cmd-row-header">
          <span class="cmd-action">${target}${c.action}</span>
          <span class="${resultCls}">${resultTxt}</span>
        </div>
        <div class="cmd-rid">${c.request_id.slice(0,8)}… · ${fmtTs(c.sent_ts)}</div>
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
  } catch (e) { /* not online yet */ }
}

async function loadCommands() {
  try {
    const res = await fetch(`/api/agents/${agentId}/commands?limit=20`);
    if (res.ok) renderCmdHistory(await res.json());
  } catch {}
}

// ── WebSocket live updates ────────────────────────────────────────────
onWsEvent(evt => {
  if (evt.type !== 'mqtt' || evt.agent_id !== agentId) return;

  // Update in-memory snapshot
  if (!agentData) agentData = { agent_id: agentId, status: null, state: null,
                                metadata: null, cfg: null, components: {}, last_seen_ts: evt.ts };
  agentData.last_seen_ts = evt.ts;

  const cid = evt.component_id;
  const tt  = evt.topic_type;

  if (!cid) {
    // Agent-level
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
    // Component-level
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

  // Refresh cmd history on evt (result arrived)
  if (tt.startsWith('evt/')) loadCommands();
});

// ── Send command ──────────────────────────────────────────────────────
cmdSend.addEventListener('click', async () => {
  const action = cmdAction.value.trim();
  if (!action) { cmdStatus.textContent = 'Enter an action'; cmdStatus.className = 'cmd-status err'; return; }

  let body = {};
  const raw = cmdBody.value.trim();
  if (raw) {
    try { body = JSON.parse(raw); }
    catch { cmdStatus.textContent = 'Invalid JSON body'; cmdStatus.className = 'cmd-status err'; return; }
  }

  const cid = cmdTarget.value;
  const url = cid
    ? `/api/agents/${agentId}/components/${cid}/cmd/${action}`
    : `/api/agents/${agentId}/cmd/${action}`;

  cmdSend.disabled = true;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      cmdStatus.textContent = `Sent · ${data.request_id.slice(0,8)}…`;
      cmdStatus.className = 'cmd-status ok';
      loadCommands();
    } else {
      cmdStatus.textContent = `Error ${res.status}`;
      cmdStatus.className = 'cmd-status err';
    }
  } catch (e) {
    cmdStatus.textContent = String(e);
    cmdStatus.className = 'cmd-status err';
  } finally {
    cmdSend.disabled = false;
  }
});

btnClearLogs.addEventListener('click', () => { logFeed.innerHTML = ''; });

// ── Boot ───────────────────────────────────────────────────────────────
loadAgent();
loadCommands();
