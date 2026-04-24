// fleet.js — Central data store, direct WebSocket, render loop
// Depends on: fleet-utils.js (LUCID namespace already initialized)

(function (L) {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────
  L.agents = {};                 // agent_id → agent data
  L.catalogs = {};               // agent_id → command catalog
  L.schemas = {};                // agent_id → { publishes, subscribes, components: { compId → schema } }
  L.telemetryCache = {};         // agent_id → { metric → [{ts, value}, ...] }
  L.expandedAgents = new Set();  // set of agent IDs currently expanded
  L.dirty = new Set();           // agent IDs that changed since last render
  L.fullRenderNeeded = false;    // true when agent list changed (added/removed)
  L.commandHistory = [];         // recent commands sent from this session
  L.activeFilter = 'all';       // 'all' | 'online' | 'offline'
  L.searchQuery = '';            // current search filter

  // ── Page renderer callbacks ───────────────────────────────────────
  L._pageRenderFull = null;      // function(): called on full re-render
  L._pageRenderDirty = null;     // function(agentIds[]): called for dirty updates
  L._pageRenderStats = null;     // function(): called to update stats

  L.registerPageRenderer = function (opts) {
    L._pageRenderFull = opts.renderFull || null;
    L._pageRenderDirty = opts.renderDirty || null;
    L._pageRenderStats = opts.renderStats || null;
    // If agents already loaded, do initial render
    if (Object.keys(L.agents).length > 0 && L._pageRenderFull) {
      L._pageRenderFull();
    } else if (L._pageRenderFull) {
      L.fullRenderNeeded = true;
    }
  };

  var TELEMETRY_BUFFER_SIZE = 3600; // ~60min at 1 sample/sec
  var RENDER_INTERVAL_MS = 1000;
  var CACHE_KEY = 'lucid_agents';
  var CATALOG_CACHE_KEY = 'lucid_catalogs';

  // ── Restore from cache for instant render ─────────────────────────
  try {
    var cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      var parsed = JSON.parse(cached);
      Object.keys(parsed).forEach(function (k) { L.agents[k] = parsed[k]; });
    }
    var cachedCatalogs = sessionStorage.getItem(CATALOG_CACHE_KEY);
    if (cachedCatalogs) L.catalogs = JSON.parse(cachedCatalogs);
  } catch (e) { /* ignore corrupt cache */ }

  // ── API functions ──────────────────────────────────────────────────

  L.loadAgents = async function () {
    try {
      var res = await L.apiFetch('/api/agents');
      var data = await res.json();
      L.agents = {};
      data.forEach(function (a) { L.agents[a.agent_id] = a; });
      L.fullRenderNeeded = true;
      // Cache for instant render on next page load
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(L.agents)); } catch (e) {}
    } catch (e) {
      console.error('Failed to load agents:', e);
      L.fullRenderNeeded = true;
    }
  };

  L.loadCatalog = async function (agentId) {
    if (L.catalogs[agentId]) return L.catalogs[agentId];
    try {
      var res = await L.apiFetch('/api/agents/' + encodeURIComponent(agentId) + '/command-catalog');
      if (res.ok) {
        L.catalogs[agentId] = await res.json();
        try { sessionStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(L.catalogs)); } catch (e) {}
        return L.catalogs[agentId];
      }
    } catch (e) { /* fallback to capabilities */ }
    return null;
  };

  L.loadCommands = async function (agentId, limit) {
    try {
      var res = await L.apiFetch('/api/agents/' + encodeURIComponent(agentId) + '/commands?limit=' + (limit || 10));
      if (res.ok) return await res.json();
    } catch (e) { /* ignore */ }
    return [];
  };

  L.loadLogs = async function (agentId, limit) {
    try {
      var res = await L.apiFetch('/api/agents/' + encodeURIComponent(agentId) + '/logs?limit=' + (limit || 50));
      if (res.ok) return await res.json();
    } catch (e) { /* ignore */ }
    return [];
  };

  // ── Send command ───────────────────────────────────────────────────

  L.fireCmd = async function (agentId, componentId, action, payload) {
    var url = componentId
      ? '/api/agents/' + encodeURIComponent(agentId) + '/components/' + encodeURIComponent(componentId) + '/cmd/' + encodeURIComponent(action)
      : '/api/agents/' + encodeURIComponent(agentId) + '/cmd/' + encodeURIComponent(action);

    var startTime = Date.now();
    try {
      var res = await L.apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
      var elapsed = Date.now() - startTime;
      var ok = res.ok;
      var result = null;
      try { result = await res.json(); } catch (e) { /* no body */ }

      var entry = {
        agentId: agentId,
        componentId: componentId,
        action: action,
        payload: payload,
        ok: ok,
        result: result,
        request_id: (result && result.request_id) || null,
        elapsed: elapsed,
        ts: new Date().toISOString(),
        result_received: false,
        result_ok: null,
        result_payload: null,
        result_elapsed: null,
        result_ts: null,
      };
      L.commandHistory.unshift(entry);
      if (L.commandHistory.length > 50) L.commandHistory.length = 50;

      var target = agentId + (componentId ? '/' + componentId : '');

      if (!ok) {
        // HTTP dispatch failed — show error toast immediately (no WS result will arrive)
        var errMsg = (result && result.error) || (result && result.detail) || 'failed';
        L.toast({ message: action + ' \u2717 ' + errMsg, type: 'error',
                  details: { target: target, request: payload, response: result } });
      }
      // If ok: suppress dispatch toast — the WS evt/*/result handler shows the single result toast

      return entry;
    } catch (e) {
      var entry2 = {
        agentId: agentId,
        componentId: componentId,
        action: action,
        payload: payload,
        ok: false,
        result: { error: e.message },
        request_id: null,
        elapsed: Date.now() - startTime,
        ts: new Date().toISOString(),
        result_received: false,
        result_ok: null,
        result_payload: null,
        result_elapsed: null,
        result_ts: null,
      };
      L.commandHistory.unshift(entry2);
      L.toast({ message: action + ' \u2717 ' + e.message, type: 'error' });
      return entry2;
    }
  };

  // ── Direct WebSocket ───────────────────────────────────────────────

  var ws = null;
  var wsReconnectTimeout = null;

  function wsUrl() {
    if (L.apiBase) {
      var base = L.apiBase.replace(/\/+$/, '');
      return base.replace(/^http/, 'ws') + '/api/ws';
    }
    // Same-origin: derive from page location
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/api/ws';
  }

  function wsConnect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

    ws = new WebSocket(wsUrl());

    ws.onopen = function () {
      var el = document.getElementById('ws-status');
      if (el) { el.className = 'ws-dot ws-dot-connected'; }
    };

    ws.onclose = function () {
      var el = document.getElementById('ws-status');
      if (el) { el.className = 'ws-dot ws-dot-disconnected'; }
      clearTimeout(wsReconnectTimeout);
      wsReconnectTimeout = setTimeout(wsConnect, 3000);
    };

    ws.onerror = function () {
      ws.close();
    };

    ws.onmessage = function (e) {
      var evt;
      try { evt = JSON.parse(e.data); } catch (_) { return; }
      handleWsEvent(evt);
    };
  }

  // ── Experiment event store ──────────────────────────────────────
  L.experimentEvents = [];
  L._experimentListeners = [];

  L.onExperimentEvent = function (fn) {
    L._experimentListeners.push(fn);
  };

  // ── General WS event listeners ──────────────────────────────────
  L._wsListeners = [];

  L.onWsEvent = function (fn) {
    L._wsListeners.push(fn);
  };

  // Expose as global for convenience
  window.onWsEvent = L.onWsEvent.bind(L);

  // ── Live log buffer ───────────────────────────────────────────────
  L.logBuffer = [];          // [{agent_id, component_id, level, message, ts, received_ts}]
  L._logListeners = [];
  var LOG_BUFFER_MAX = 2000;

  L.onLog = function (fn) {
    L._logListeners.push(fn);
    return function () {
      var idx = L._logListeners.indexOf(fn);
      if (idx !== -1) L._logListeners.splice(idx, 1);
    };
  };

  // ── Command result listeners ─────────────────────────────────────
  // Each listener is called with (entry, evt) when an evt/*/result WS message
  // arrives. Returns an unsubscribe function for cleanup.
  L._cmdResultListeners = [];
  L._panelWatchingRequestId = null;

  L.onCmdResult = function (fn) {
    L._cmdResultListeners.push(fn);
    return function () {
      var idx = L._cmdResultListeners.indexOf(fn);
      if (idx !== -1) L._cmdResultListeners.splice(idx, 1);
    };
  };

  function handleWsEvent(evt) {
    L._wsListeners.forEach(function (fn) { try { fn(evt); } catch (_) {} });
    // Experiment engine events (non-mqtt)
    if (evt.type === 'experiment_started' || evt.type === 'experiment_completed' ||
        evt.type === 'step_started' || evt.type === 'step_completed' ||
        evt.type === 'step_failed' || evt.type === 'approval_required') {
      L.experimentEvents.push(evt);
      if (L.experimentEvents.length > 200) L.experimentEvents.shift();
      L._experimentListeners.forEach(function (fn) { fn(evt); });
      return;
    }

    if (evt.type !== 'mqtt') return;
    var id = evt.agent_id;
    if (!id) return;

    // Ensure agent exists in store
    if (!L.agents[id]) {
      L.agents[id] = { agent_id: id, status: null, metadata: null, components: {}, last_seen_ts: evt.ts };
      L.fullRenderNeeded = true;
    }
    var a = L.agents[id];
    a.last_seen_ts = evt.ts;

    // Live log events
    if (evt.topic_type === 'logs') {
      var logPayload = evt.payload || {};
      var lines = Array.isArray(logPayload.lines) ? logPayload.lines : [logPayload];
      lines.forEach(function (line) {
        var entry = {
          agent_id: id,
          component_id: evt.component_id || null,
          level: (line.level || line.levelname || 'INFO').toUpperCase(),
          message: line.message || line.msg || JSON.stringify(line),
          ts: line.ts || evt.ts,
          received_ts: evt.ts,
        };
        L.logBuffer.push(entry);
        if (L.logBuffer.length > LOG_BUFFER_MAX) L.logBuffer.shift();
        L._logListeners.forEach(function (fn) { try { fn(entry); } catch (_) {} });
      });
    }

    if (evt.scope === 'agent') {
      if (evt.topic_type === 'status') a.status = evt.payload;
      else if (evt.topic_type === 'metadata') a.metadata = evt.payload;
      else if (evt.topic_type === 'state') a.state = evt.payload;
      else if (evt.topic_type === 'cfg') a.cfg = Object.assign({}, a.cfg, evt.payload);
      else if (evt.topic_type === 'cfg/logging') a.cfg = Object.assign({}, a.cfg, { logging: evt.payload });
      else if (evt.topic_type === 'cfg/telemetry') a.cfg = Object.assign({}, a.cfg, { telemetry: evt.payload });
      else if (evt.topic_type === 'schema') {
        if (!L.schemas[id]) L.schemas[id] = { components: {} };
        L.schemas[id].publishes = evt.payload.publishes;
        L.schemas[id].subscribes = evt.payload.subscribes;
      }
      else if (evt.topic_type && evt.topic_type.startsWith('telemetry/')) {
        bufferTelemetry(id, null, evt.topic_type.substring(10), evt.payload, evt.ts);
      }
    }

    if (evt.scope === 'component' && evt.component_id) {
      var cid = evt.component_id;
      if (!a.components[cid]) {
        a.components[cid] = { component_id: cid };
      }
      var comp = a.components[cid];
      if (evt.topic_type === 'status') comp.status = evt.payload;
      else if (evt.topic_type === 'state') comp.state = evt.payload;
      else if (evt.topic_type === 'metadata') comp.metadata = evt.payload;
      else if (evt.topic_type === 'cfg') comp.cfg = Object.assign({}, comp.cfg, evt.payload);
      else if (evt.topic_type === 'cfg/logging') comp.cfg = Object.assign({}, comp.cfg, { logging: evt.payload });
      else if (evt.topic_type === 'cfg/telemetry') comp.cfg = Object.assign({}, comp.cfg, { telemetry: evt.payload });
      else if (evt.topic_type === 'schema') {
        if (!L.schemas[id]) L.schemas[id] = { components: {} };
        L.schemas[id].components[cid] = evt.payload;
      }
      else if (evt.topic_type && evt.topic_type.startsWith('telemetry/')) {
        bufferTelemetry(id, cid, evt.topic_type.substring(10), evt.payload, evt.ts);
      }
    }

    // Handle command result events (evt/*/result)
    if (evt.topic_type && evt.topic_type.startsWith('evt/') && evt.topic_type.endsWith('/result')) {
      var reqId = evt.payload && evt.payload.request_id;
      if (reqId) {
        var matchEntry = null;
        for (var hi = 0; hi < L.commandHistory.length; hi++) {
          if (L.commandHistory[hi].request_id === reqId) { matchEntry = L.commandHistory[hi]; break; }
        }
        if (matchEntry) {
          matchEntry.result_received = true;
          matchEntry.result_ok = evt.payload.ok;
          matchEntry.result_payload = evt.payload;
          matchEntry.result_ts = evt.ts;
          matchEntry.result_elapsed = matchEntry.ts
            ? (new Date(evt.ts) - new Date(matchEntry.ts)) : null;
        }
        L._cmdResultListeners.forEach(function (fn) {
          try { fn(matchEntry, evt); } catch (_) {}
        });
        // Show result toast only when command panel is not watching this request_id
        if (L._panelWatchingRequestId !== reqId) {
          var resAction = matchEntry ? matchEntry.action : (evt.topic_type.split('/')[1] || evt.topic_type);
          var resTarget = matchEntry
            ? matchEntry.agentId + (matchEntry.componentId ? '/' + matchEntry.componentId : '')
            : evt.agent_id;
          var resDetails = {
            target: resTarget,
            request: matchEntry ? matchEntry.payload : null,
            response: evt.payload,
          };
          if (evt.payload && evt.payload.ok) {
            L.toast({ message: resAction + ' \u2713 ' + L.fmtDuration(matchEntry ? matchEntry.result_elapsed : null),
                      type: 'success', details: resDetails });
          } else {
            var resErrMsg = (evt.payload && evt.payload.error) || 'agent error';
            L.toast({ message: resAction + ' \u2717 ' + resErrMsg, type: 'error', details: resDetails });
          }
        }
      }
    }

    // Mark dirty — NO DOM work here
    L.dirty.add(id);
  }

  // ── Telemetry ring buffer ──────────────────────────────────────────

  function bufferTelemetry(agentId, componentId, metric, payload, ts) {
    var key = componentId ? agentId + '/' + componentId : agentId;
    if (!L.telemetryCache[key]) L.telemetryCache[key] = {};
    if (!L.telemetryCache[key][metric]) L.telemetryCache[key][metric] = [];

    var buf = L.telemetryCache[key][metric];
    var value = typeof payload === 'number' ? payload : (payload && payload.value);
    if (value == null) return;

    buf.push({ ts: new Date(ts).getTime() / 1000, value: value });
    if (buf.length > TELEMETRY_BUFFER_SIZE) buf.shift();
  }

  // ── Render loop (1 second interval) ────────────────────────────────
  // This is the ONLY place that touches the DOM for data updates.

  function renderLoop() {
    if (L.fullRenderNeeded) {
      L.fullRenderNeeded = false;
      L.dirty.clear();
      if (L._pageRenderFull) L._pageRenderFull();
      return;
    }

    if (L.dirty.size === 0) return;

    var dirtyIds = Array.from(L.dirty);
    L.dirty.clear();

    if (L._pageRenderDirty) L._pageRenderDirty(dirtyIds);
    if (L._pageRenderStats) L._pageRenderStats();
  }

  // ── Relative timestamp refresh ─────────────────────────────────────
  function refreshTimestamps() {
    var els = document.querySelectorAll('[data-ts]');
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = L.fmtTs(els[i].dataset.ts);
    }
  }

  // ── Avatar dropdown ────────────────────────────────────────────────
  (function () {
    var avatarBtn = document.getElementById('nav-avatar');
    var dropdown = document.getElementById('nav-avatar-dropdown');
    if (!avatarBtn || !dropdown) return;
    avatarBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', function () {
      dropdown.classList.add('hidden');
    });
  })();

  // ── Boot ───────────────────────────────────────────────────────────
  // Page-specific JS registers its renderer, then the render loop picks it up.
  L.loadAgents();

  wsConnect();
  setInterval(renderLoop, RENDER_INTERVAL_MS);
  setInterval(refreshTimestamps, 30000);

})(window.LUCID);
