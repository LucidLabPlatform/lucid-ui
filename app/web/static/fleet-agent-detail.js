// fleet-agent-detail.js — Agent detail page renderer
// Depends on: fleet-utils.js, fleet.js, fleet-components.js, fleet-sparklines.js

(function (L) {
  'use strict';

  var agentId = L.agentId;
  if (!agentId) return; // not on agent detail page

  var headerEl, bodyEl;

  // ── Full render ───────────────────────────────────────────────────

  function renderDetail() {
    var a = L.agents[agentId];
    if (!a) {
      headerEl = headerEl || document.getElementById('agent-detail-header');
      if (headerEl) headerEl.innerHTML = '<div class="fleet-empty">Agent "' + L.esc(agentId) + '" not found</div>';
      return;
    }
    renderHeader(a);
    renderBody(a);
  }

  function renderHeader(a) {
    headerEl = headerEl || document.getElementById('agent-detail-header');
    if (!headerEl) return;

    var state = L.agentState(a);
    var meta = a.metadata || {};

    var html = '<div class="detail-header">';
    html += '<span class="agent-dot dot-' + state + '"></span>';
    html += '<h1 class="detail-name">' + L.esc(a.agent_id) + '</h1>';
    html += '<span class="status-badge status-' + state + '">' + state + '</span>';
    html += '<span class="detail-meta">';
    html += 'Uptime: <span class="detail-uptime">' + L.fmtUptime(a.status) + '</span>';
    html += ' \u00B7 Last seen: <span class="detail-lastseen" data-ts="' + L.escAttr(a.last_seen_ts || '') + '">' + L.fmtTs(a.last_seen_ts) + '</span>';
    html += '</span>';
    html += '<span class="detail-meta">';
    if (meta.platform) html += L.esc(meta.platform) + ' / ' + L.esc(meta.architecture || '');
    if (meta.version) html += ' \u00B7 v' + L.esc(meta.version);
    html += '</span>';
    html += '</div>';

    headerEl.innerHTML = html;
  }

  async function renderBody(a) {
    bodyEl = bodyEl || document.getElementById('agent-detail-body');
    if (!bodyEl) return;

    await L.loadCatalog(agentId);
    var catalog = L.catalogs[agentId] || {};

    var html = '';

    // Component cards
    var comps = Object.values(a.components || {});
    if (comps.length) {
      html += '<div class="tier2-section"><div class="tier2-label"><a href="/agent/' + encodeURIComponent(agentId) + '/components">Components</a></div>';
      html += '<div class="comp-cards">';
      comps.forEach(function (c) {
        html += '<a class="comp-card-link" id="comp-' + L.escAttr(c.component_id) + '" href="/agent/' + encodeURIComponent(agentId) + '/components/' + encodeURIComponent(c.component_id) + '">';
        html += L.renderComponent(agentId, c.component_id, c, catalog);
        html += '</a>';
      });
      html += '</div></div>';
    }

    // Telemetry charts + config
    html += '<div class="tier2-section">';
    html += '<div class="tier2-label">Telemetry</div>';
    html += '<div class="chart-containers" id="telemetry-charts-' + L.escAttr(agentId) + '">';
    var agentMetrics = Object.keys(L.telemetryCache[agentId] || {});
    if (agentMetrics.length) {
      agentMetrics.forEach(function (m) {
        html += '<div class="chart-container" id="chart-container-' + L.escAttr(agentId) + '-' + L.escAttr(m) + '" data-agent="' + L.escAttr(agentId) + '" data-metric="' + L.escAttr(m) + '"></div>';
      });
    } else {
      html += '<div class="spark-empty spark-waiting">Waiting for telemetry\u2026</div>';
    }
    html += '</div>';
    var telCfg = (a.cfg || {}).telemetry;
    if (telCfg) {
      html += '<table class="telemetry-cfg-table">';
      html += '<thead><tr><th>Metric</th><th>Enabled</th><th>Interval</th><th>Threshold</th></tr></thead><tbody>';
      Object.keys(telCfg).forEach(function (metric) {
        var m = telCfg[metric] || {};
        var enabled = m.enabled != null ? (m.enabled ? '\u2713' : '\u2717') : '\u2014';
        var interval = m.interval_s != null ? m.interval_s + 's' : '\u2014';
        var threshold = m.change_threshold_percent != null ? m.change_threshold_percent + '%' : '\u2014';
        html += '<tr><td>' + L.esc(metric) + '</td><td>' + enabled + '</td><td>' + interval + '</td><td>' + threshold + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // Installed components (from agent state)
    var installedComps = (a.state || {}).components;
    if (installedComps && installedComps.length) {
      html += '<div class="tier2-section"><div class="tier2-label">Installed Components</div>';
      html += '<div class="comp-pills">';
      installedComps.forEach(function (c) {
        var cid = typeof c === 'object' ? c.component_id : c;
        html += '<span class="pill">' + L.esc(cid) + '</span>';
      });
      html += '</div></div>';
    }

    // Activity feed
    html += '<div class="tier2-section"><div class="tier2-label">Recent Activity</div>';
    html += '<div class="activity-feed" id="activity-' + L.escAttr(agentId) + '">Loading…</div>';
    html += '</div>';

    // Config + metadata
    var cfg = a.cfg || {};
    var meta = a.metadata || {};
    html += '<div class="tier2-section tier2-info-grid">';
    html += '<div class="info-block"><div class="tier2-label">Config</div>';
    html += '<div class="kv-mini">';
    var heartbeat = cfg.heartbeat_s != null ? cfg.heartbeat_s : '';
    html += kvEditable('heartbeat_s', heartbeat, 'number', 'cfg/set');
    var logging = cfg.logging || {};
    var logLevelOptions = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']; // fallback
    try {
      var agentSch = L.schemas[agentId];
      if (agentSch && agentSch.subscribes) {
        var logCmdSchema = agentSch.subscribes['cmd/cfg/logging/set'];
        var logLevelEnum =
          logCmdSchema &&
          logCmdSchema.fields &&
          logCmdSchema.fields.set &&
          logCmdSchema.fields.set.fields &&
          logCmdSchema.fields.set.fields.log_level &&
          logCmdSchema.fields.set.fields.log_level['enum'];
        if (logLevelEnum && logLevelEnum.length) logLevelOptions = logLevelEnum;
      }
    } catch (e) { /* keep fallback */ }
    html += kvEditableSelect('log_level', logging.log_level || 'INFO', logLevelOptions, 'cfg/logging/set');
    html += '</div></div>';
    html += '<div class="info-block"><div class="tier2-label">Metadata</div>';
    html += '<div class="kv-mini">';
    html += kvLine('version', meta.version || '\u2014');
    html += kvLine('platform', (meta.platform || '\u2014') + ' / ' + (meta.architecture || '\u2014'));
    html += kvLine('first seen', a.first_seen_ts ? new Date(a.first_seen_ts).toLocaleDateString() : '\u2014');
    html += '</div></div>';
    html += '</div>';

    // Agent schema
    var agentSchema = L.schemas[agentId];
    if (agentSchema && (agentSchema.publishes || agentSchema.subscribes)) {
      html += '<div class="tier2-section"><div class="tier2-label">Schema</div>';
      if (agentSchema.publishes && agentSchema.publishes.length) {
        html += '<div class="schema-group"><span class="schema-group-label">Publishes</span><div class="comp-pills">';
        agentSchema.publishes.forEach(function (t) { html += '<span class="pill pill-pub">' + L.esc(t) + '</span>'; });
        html += '</div></div>';
      }
      if (agentSchema.subscribes && agentSchema.subscribes.length) {
        html += '<div class="schema-group"><span class="schema-group-label">Subscribes</span><div class="comp-pills">';
        agentSchema.subscribes.forEach(function (t) { html += '<span class="pill pill-sub">' + L.esc(t) + '</span>'; });
        html += '</div></div>';
      }
      html += '</div>';
    }

    // Agent commands
    var agentCmds = (catalog.agent || []).filter(function (c) { return c.category !== 'config'; });
    if (agentCmds.length) {
      html += '<div class="tier2-section"><div class="tier2-label">Agent Commands</div>';
      html += '<div class="tier2-actions">';
      agentCmds.forEach(function (cmd) {
        var hb = cmd.has_body ? ' data-has-body="1"' : '';
        var tpl = cmd.template ? ' data-template="' + L.escAttr(JSON.stringify(cmd.template)) + '"' : '';
        html += '<button class="act" data-agent="' + L.escAttr(agentId) + '" data-action="' + L.escAttr(cmd.action) + '"' + hb + tpl + '>' + L.esc(cmd.label || cmd.action) + '</button>';
      });
      html += '<button class="act act-primary" data-open-panel="' + L.escAttr(agentId) + '">Full command form \u2192</button>';
      html += '</div></div>';
    }

    bodyEl.innerHTML = html;

    // Load activity feed
    loadActivityFeed();

    // Render sparklines
    L.renderSparklines(bodyEl);

    // Scroll to component if hash present
    if (location.hash && location.hash.startsWith('#comp-')) {
      var compEl = document.getElementById(location.hash.substring(1));
      if (compEl) compEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // ── Targeted update ───────────────────────────────────────────────

  function updateDetail(dirtyIds) {
    if (dirtyIds.indexOf(agentId) === -1) return;
    var a = L.agents[agentId];
    if (!a) return;

    renderHeader(a);

    // Update component cards
    var catalog = L.catalogs[agentId] || {};
    var cardsEl = bodyEl && bodyEl.querySelector('.comp-cards');
    if (cardsEl) {
      var comps = Object.values(a.components || {});
      cardsEl.innerHTML = comps.map(function (c) {
        return '<div id="comp-' + L.escAttr(c.component_id) + '">' +
          L.renderComponent(agentId, c.component_id, c, catalog) + '</div>';
      }).join('');
    }

    // Update sparklines for all cached metrics; add containers for new ones
    var currentMetrics = Object.keys(L.telemetryCache[agentId] || {});
    var chartsEl = bodyEl && document.getElementById('telemetry-charts-' + agentId);
    if (chartsEl && currentMetrics.length) {
      // Remove "waiting" placeholder if present
      var waiting = chartsEl.querySelector('.spark-waiting');
      if (waiting) waiting.remove();
      // Add containers for any new metrics
      currentMetrics.forEach(function (m) {
        var containerId = 'chart-container-' + agentId + '-' + m;
        if (!document.getElementById(containerId)) {
          var div = document.createElement('div');
          div.className = 'chart-container';
          div.id = containerId;
          div.dataset.agent = agentId;
          div.dataset.metric = m;
          chartsEl.appendChild(div);
          L.renderSparklines(chartsEl);
        } else {
          L.updateSparkline(agentId, m);
        }
      });
    }
  }

  // ── Activity feed ─────────────────────────────────────────────────

  async function loadActivityFeed() {
    var feedEl = document.getElementById('activity-' + CSS.escape(agentId));
    if (!feedEl) return;

    var cmds = await L.loadCommands(agentId, 10);
    if (!cmds || !cmds.length) {
      feedEl.innerHTML = '<div class="comp-empty">No recent commands</div>';
      return;
    }

    feedEl.innerHTML = cmds.map(function (cmd) {
      var ok = cmd.result_ok;
      var icon = ok === true ? '\u2713' : ok === false ? '\u2717' : '\u2026';
      var cls = ok === true ? 'act-ok' : ok === false ? 'act-err' : 'act-pending';
      var target = cmd.component_id ? cmd.component_id + '/' : '';
      return '<div class="activity-row"><span class="activity-icon ' + cls + '">' + icon + '</span>' +
        '<span class="activity-action">' + L.esc(target + cmd.action) + '</span>' +
        '<span class="activity-ts" data-ts="' + L.escAttr(cmd.sent_ts || cmd.received_ts || '') + '">' + L.fmtTs(cmd.sent_ts || cmd.received_ts) + '</span>' +
        '</div>';
    }).join('');
  }

  function kvLine(key, value) {
    return '<div class="kv-line"><span class="kv-k">' + L.esc(key) + '</span><span class="kv-v">' + L.esc(value) + '</span></div>';
  }

  function kvEditable(key, value, inputType, action) {
    return '<div class="kv-line kv-editable">' +
      '<span class="kv-k">' + L.esc(key) + '</span>' +
      '<span class="kv-v kv-v-edit">' +
        '<input class="kv-input" type="' + L.escAttr(inputType) + '" value="' + L.escAttr(value) + '" data-key="' + L.escAttr(key) + '" data-action="' + L.escAttr(action) + '">' +
        '<button class="kv-save-btn act act-xs" data-key="' + L.escAttr(key) + '" data-action="' + L.escAttr(action) + '">Save</button>' +
      '</span>' +
    '</div>';
  }

  function kvEditableSelect(key, value, options, action) {
    var opts = options.map(function (o) {
      return '<option value="' + L.escAttr(o) + '"' + (o === value ? ' selected' : '') + '>' + L.esc(o) + '</option>';
    }).join('');
    return '<div class="kv-line kv-editable">' +
      '<span class="kv-k">' + L.esc(key) + '</span>' +
      '<span class="kv-v kv-v-edit">' +
        '<select class="kv-input kv-select" data-key="' + L.escAttr(key) + '" data-action="' + L.escAttr(action) + '">' + opts + '</select>' +
        '<button class="kv-save-btn act act-xs" data-key="' + L.escAttr(key) + '" data-action="' + L.escAttr(action) + '">Save</button>' +
      '</span>' +
    '</div>';
  }

  // ── Event delegation ──────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    // Inline config save
    var saveBtn = e.target.closest('.kv-save-btn');
    if (saveBtn) {
      var key = saveBtn.dataset.key;
      var action = saveBtn.dataset.action;
      var inputEl = saveBtn.closest('.kv-v-edit').querySelector('.kv-input');
      if (!inputEl) return;
      var rawVal = inputEl.value;
      var val = (inputEl.type === 'number') ? Number(rawVal) : rawVal;
      var payload = { set: {} };
      payload.set[key] = val;
      var origText = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = '\u2026';
      L.fireCmd(agentId, null, action, payload).then(function (result) {
        saveBtn.textContent = result.ok ? '\u2713' : '\u2717';
        saveBtn.style.color = result.ok ? 'var(--green)' : 'var(--red)';
        setTimeout(loadActivityFeed, 500);
        setTimeout(function () {
          saveBtn.textContent = origText;
          saveBtn.style.color = '';
          saveBtn.disabled = false;
        }, 2000);
      });
      return;
    }

    // Action buttons
    var actBtn = e.target.closest('.act[data-action]');
    if (actBtn) {
      handleActionClick(actBtn);
      return;
    }

    // Open command panel
    var panelBtn = e.target.closest('[data-open-panel]');
    if (panelBtn) {
      if (typeof L.openCommandPanel === 'function') L.openCommandPanel({ agentId: panelBtn.dataset.openPanel });
      return;
    }

    // Chart range button
    var rangeBtn = e.target.closest('.chart-range-btn');
    if (rangeBtn) {
      L.handleChartRangeClick(rangeBtn);
      return;
    }

    // Sparkline click → toggle full chart
    var sparkEl = e.target.closest('.spark-canvas');
    if (sparkEl) {
      var met = sparkEl.dataset.metric;
      var chartContainer = document.getElementById('chart-container-' + CSS.escape(agentId) + '-' + CSS.escape(met));
      if (chartContainer) L.toggleFullChart(agentId, met, chartContainer);
      return;
    }
  });

  function handleActionClick(btn) {
    var aid = btn.dataset.agent;
    var compId = btn.dataset.comp || null;
    var action = btn.dataset.action;
    var hasBody = btn.dataset.hasBody === '1';

    if (hasBody) {
      var tpl = {};
      try { tpl = JSON.parse(btn.dataset.template || '{}'); } catch (e) {}
      if (typeof L.openCommandPanel === 'function') {
        L.openCommandPanel({ agentId: aid, componentId: compId, action: action, template: tpl });
        return;
      }
    }

    var origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '\u2026';

    L.fireCmd(aid, compId, action, {}).then(function (result) {
      btn.textContent = result.ok ? '\u2713' : '\u2717';
      btn.style.color = result.ok ? 'var(--green)' : 'var(--red)';
      setTimeout(loadActivityFeed, 500);
      setTimeout(function () {
        btn.textContent = origText;
        btn.style.color = '';
        btn.disabled = false;
      }, 2000);
    });
  }

  // ── Register with core render loop ────────────────────────────────

  L.registerPageRenderer({
    renderFull: renderDetail,
    renderDirty: updateDetail,
    renderStats: null,
  });

  // ── Activity feed auto-refresh via WebSocket ──────────────────────
  // When any evt/*/result arrives for this agent, reload the feed.
  // Debounced to avoid hammering the API on burst events.
  var _activityRefreshScheduled = false;
  L.onWsEvent(function (evt) {
    if (evt.type !== 'mqtt') return;
    if (evt.agent_id !== agentId) return;
    if (!evt.topic_type || !evt.topic_type.startsWith('evt/')) return;
    if (_activityRefreshScheduled) return;
    _activityRefreshScheduled = true;
    setTimeout(function () {
      _activityRefreshScheduled = false;
      loadActivityFeed();
    }, 500);
  });

})(window.LUCID);
