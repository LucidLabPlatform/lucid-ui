// fleet-mqtt.js — Direct MQTT WebSocket explorer + smart publisher
// Depends on: fleet-utils.js, fleet.js, fleet-toasts.js, mqtt.js (CDN)

(function (L) {
  'use strict';

  // ── State ───────────────────────────────────────────────────────────────
  var mqttClient = null;
  var mqttConnected = false;

  // topic tree: { agentId: { 'status': {lastPayload, lastTs, qos, retained, msgCount}, ... } }
  var mqttTree = {};
  var treeOpenNodes = new Set();   // set of agentIds that are expanded
  var treeFilter = '';
  var treeRenderTimer = null;

  // viewers: [{id, agentId, topic}]
  var mqttViewers = [];
  // topic → viewerId for currently open viewers
  var viewerByTopic = {};

  // result subscriptions: topic → {timer, viewerId?}
  var resultSubs = {};

  // publisher state
  var pubCrumbs = [];

  var SESSION_KEY = 'lucid_mqtt_conn';

  // ── Helpers ─────────────────────────────────────────────────────────────

  function uid() {
    return Math.random().toString(36).substr(2, 8) + Math.random().toString(36).substr(2, 4);
  }

  function genRequestId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return uid() + '-' + uid();
  }

  function fmtTime() {
    var d = new Date();
    return d.getHours().toString().padStart(2, '0') + ':'
      + d.getMinutes().toString().padStart(2, '0') + ':'
      + d.getSeconds().toString().padStart(2, '0');
  }

  function safeJsonParse(bytes) {
    try {
      var s = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  function colorJson(obj) {
    if (obj === null || obj === undefined) return '<span class="mn">null</span>';
    var lines = [];
    Object.entries(obj).forEach(function (kv) {
      var k = kv[0], v = kv[1];
      var valHtml;
      if (v === null) valHtml = '<span class="mn">null</span>';
      else if (typeof v === 'boolean') valHtml = '<span class="mb">' + v + '</span>';
      else if (typeof v === 'number') valHtml = '<span class="mn">' + v + '</span>';
      else if (typeof v === 'string') valHtml = '<span class="ms">"' + L.esc(v) + '"</span>';
      else valHtml = '<span class="mn">' + L.esc(JSON.stringify(v)) + '</span>';
      lines.push('<span class="mk">"' + L.esc(k) + '"</span>: ' + valHtml);
    });
    return lines.join(',<br>');
  }

  function agentStatus(agentId) {
    // Check L.agents (populated by fleet.js from the main WS/REST)
    var a = L.agents && L.agents[agentId];
    if (!a) return 'unknown';
    var s = a.status;
    if (!s) return 'unknown';
    return s.state || s.status || 'unknown';
  }

  function isOnline(agentId) {
    var st = agentStatus(agentId);
    return st === 'online' || st === 'running';
  }

  // ── Connection ──────────────────────────────────────────────────────────

  function mqttDoConnect() {
    var host = document.getElementById('mqtt-host').value.trim();
    var port = document.getElementById('mqtt-port').value.trim();
    var username = document.getElementById('mqtt-username').value.trim();
    var password = document.getElementById('mqtt-password').value;

    if (!host || !port || !username || !password) {
      showConnectError('All fields are required.');
      return;
    }

    // Check mqtt.js loaded
    if (typeof mqtt === 'undefined') {
      showConnectError('mqtt.js failed to load from CDN. Check your internet connection.');
      return;
    }

    var btn = document.getElementById('mqtt-connect-btn');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    hideConnectError();

    var url = 'ws://' + host + ':' + port + '/mqtt';
    var clientId = 'lucid-ui-' + uid();

    // Clean up any previous client
    if (mqttClient) { try { mqttClient.end(true); } catch (e) {} mqttClient = null; }

    // Hard timeout — mqtt.js connectTimeout doesn't reliably fire in browser WS mode
    var connectTimer = setTimeout(function () {
      if (!mqttConnected) {
        try { mqttClient && mqttClient.end(true); } catch (e) {}
        mqttClient = null;
        btn.disabled = false;
        btn.textContent = 'Connect';
        showConnectError('Timed out connecting to ' + url + '. Check host, port, and that EMQX is running.');
      }
    }, 10000);

    try {
      mqttClient = mqtt.connect(url, {
        clientId: clientId,
        username: username,
        password: password,
        connectTimeout: 8000,
        reconnectPeriod: 0,
        keepalive: 30,
        clean: true,
        protocolVersion: 4,
      });
    } catch (e) {
      clearTimeout(connectTimer);
      btn.disabled = false;
      btn.textContent = 'Connect';
      showConnectError('Failed to create client: ' + e.message);
      return;
    }

    mqttClient.on('connect', function () {
      clearTimeout(connectTimer);
      mqttConnected = true;
      // Save connection info (no password)
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ host: host, port: port, username: username }));
      } catch (e) {}

      // Subscribe to all agent topics
      mqttClient.subscribe('lucid/agents/#', { qos: 1 }, function (err) {
        if (err) console.warn('Subscribe error:', err);
      });

      // Show workspace
      document.getElementById('mqtt-connect-screen').classList.add('hidden');
      document.getElementById('mqtt-workspace').classList.remove('hidden');

      // Seed agent list and catalogs from REST API for autocomplete
      L.loadAgents && L.loadAgents().then(function () {
        Object.keys(L.agents || {}).forEach(function (aid) {
          L.loadCatalog && L.loadCatalog(aid);
        });
      });

      renderViewers();
      renderTree();
    });

    mqttClient.on('error', function (err) {
      clearTimeout(connectTimer);
      mqttConnected = false;
      btn.disabled = false;
      btn.textContent = 'Connect';
      var msg = err && err.message ? err.message : String(err);
      showConnectError('Connection error: ' + msg);
      try { mqttClient.end(true); } catch (e) {}
      mqttClient = null;
    });

    mqttClient.on('close', function () {
      if (!mqttConnected) return; // already handled by error
      mqttConnected = false;
      L.toast && L.toast({ message: 'MQTT disconnected', type: 'error' });
    });

    mqttClient.on('message', onMqttMessage);
  }

  window.mqttDoConnect = mqttDoConnect;

  function mqttDisconnect() {
    if (mqttClient) { try { mqttClient.end(); } catch (e) {} mqttClient = null; }
    mqttConnected = false;
    mqttTree = {};
    mqttViewers = [];
    viewerByTopic = {};
    resultSubs = {};
    pubCrumbs = [];
    document.getElementById('mqtt-workspace').classList.add('hidden');
    document.getElementById('mqtt-connect-screen').classList.remove('hidden');
    document.getElementById('mqtt-connect-btn').disabled = false;
    document.getElementById('mqtt-connect-btn').textContent = 'Connect';
  }

  function showConnectError(msg) {
    var el = document.getElementById('mqtt-connect-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function hideConnectError() {
    document.getElementById('mqtt-connect-error').style.display = 'none';
  }

  // ── MQTT message handling ───────────────────────────────────────────────

  function onMqttMessage(topic, payloadBytes, packet) {
    // Parse: lucid/agents/{agentId}/{rest...}
    var prefix = 'lucid/agents/';
    if (!topic.startsWith(prefix)) return;

    var remainder = topic.slice(prefix.length);
    var slashIdx = remainder.indexOf('/');
    var agentId, subtopic;

    if (slashIdx === -1) return; // just "lucid/agents/{id}" — no subtopic, skip
    agentId = remainder.slice(0, slashIdx);
    subtopic = remainder.slice(slashIdx + 1);

    if (!agentId) return;

    var payload = safeJsonParse(payloadBytes);
    var retained = !!(packet && packet.retain);
    var qos = (packet && packet.qos) || 0;

    // Update tree
    if (!mqttTree[agentId]) mqttTree[agentId] = {};
    var entry = mqttTree[agentId][subtopic];
    if (!entry) {
      entry = { lastPayload: null, lastTs: null, qos: qos, retained: retained, msgCount: 0 };
      mqttTree[agentId][subtopic] = entry;
    }
    entry.lastPayload = payload;
    entry.lastTs = fmtTime();
    entry.qos = qos;
    entry.retained = retained;
    entry.msgCount++;

    // Throttled tree re-render
    scheduleTreeRender();

    // Push to viewer pane if open
    var fullTopic = prefix + agentId + '/' + subtopic;
    var vid = viewerByTopic[fullTopic];
    if (vid) pushMsgToViewer(vid, payload, qos, retained);

    // Check result subscriptions
    if (resultSubs[topic]) {
      var rsub = resultSubs[topic];
      if (rsub.timer) clearTimeout(rsub.timer);
      delete resultSubs[topic];
      showDrawerResult(payload);
    }
  }

  function scheduleTreeRender() {
    if (treeRenderTimer) return;
    treeRenderTimer = setTimeout(function () {
      treeRenderTimer = null;
      renderTree();
    }, 250);
  }

  // ── Topic tree rendering ────────────────────────────────────────────────

  function renderTree() {
    var body = document.getElementById('mqtt-tree-body');
    if (!body) return;

    var f = treeFilter.toLowerCase();
    var html = '';

    // Sort agents: online first, then by name
    var agentIds = Object.keys(mqttTree).sort(function (a, b) {
      var ao = isOnline(a) ? 0 : 1;
      var bo = isOnline(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return a.localeCompare(b);
    });

    agentIds.forEach(function (agentId) {
      if (f && !agentId.includes(f)) {
        // Only show if any subtopic matches
        var subtopics = Object.keys(mqttTree[agentId] || {});
        var anyMatch = subtopics.some(function (s) { return s.includes(f); });
        if (!anyMatch) return;
      }

      var online = isOnline(agentId);
      var dotCls = online ? 'mt-dot-g' : 'mt-dot-d';
      var isOpen = treeOpenNodes.has(agentId);

      html += '<div class="mt-row mt-open mt-l1" onclick="mqttToggleAgent(\'' + L.escAttr(agentId) + '\')">'
        + (isOpen ? '▼' : '▶')
        + ' <div class="mt-dot ' + dotCls + '"></div> '
        + L.esc(agentId)
        + '</div>';

      if (!isOpen) return;

      var subtopics = Object.keys(mqttTree[agentId]).sort();

      subtopics.forEach(function (sub) {
        if (f && !sub.includes(f) && !agentId.includes(f)) return;

        var fullTopic = 'lucid/agents/' + agentId + '/' + sub;
        var isLive = !!viewerByTopic[fullTopic];
        var entry = mqttTree[agentId][sub];
        var rowCls = 'mt-row mt-l2' + (isLive ? ' mt-live' : '');

        html += '<div class="' + rowCls + '" onclick="mqttOpenViewer(\'' + L.escAttr(agentId) + '\',\'' + L.escAttr(sub) + '\')">';
        if (!entry.retained) html += '<div class="mt-dot mt-dot-g" style="flex-shrink:0"></div> ';
        html += L.esc(sub);
        if (entry.retained) html += ' <span class="mt-badge">R</span>';
        if (isLive) html += ' <span class="mt-live-badge">LIVE</span>';
        html += '</div>';
      });

      // cmd/ shortcut
      html += '<div class="mt-row mt-l2 mt-cmd" onclick="mqttOpenDrawerForAgent(\'' + L.escAttr(agentId) + '\')">'
        + 'cmd/ <span class="mt-badge" style="color:var(--accent)">↗</span>'
        + '</div>';
    });

    body.innerHTML = html || '<div style="padding:1rem;font-size:0.72rem;color:var(--muted);text-align:center">Waiting for messages…</div>';
  }

  window.mqttToggleAgent = function (agentId) {
    if (treeOpenNodes.has(agentId)) treeOpenNodes.delete(agentId);
    else treeOpenNodes.add(agentId);
    renderTree();
  };

  window.mqttFilterTree = function (val) {
    treeFilter = val;
    renderTree();
  };

  // ── Viewer panes ────────────────────────────────────────────────────────

  function mqttOpenViewer(agentId, subtopic) {
    var fullTopic = 'lucid/agents/' + agentId + '/' + subtopic;

    if (viewerByTopic[fullTopic]) {
      // Flash existing pane
      var existingEl = document.getElementById('viewer-' + viewerByTopic[fullTopic]);
      if (existingEl) {
        existingEl.style.outline = '2px solid var(--accent)';
        setTimeout(function () { existingEl.style.outline = ''; }, 500);
      }
      return;
    }

    var id = uid();
    // Replace an empty pane if one exists, otherwise add
    var emptyIdx = mqttViewers.findIndex(function (v) { return !v.agentId; });
    if (emptyIdx >= 0) {
      mqttViewers[emptyIdx] = { id: id, agentId: agentId, topic: subtopic };
    } else {
      mqttViewers.push({ id: id, agentId: agentId, topic: subtopic });
    }
    viewerByTopic[fullTopic] = id;

    renderViewers();
    renderTree();

    // Seed with last known message if we have it
    var entry = mqttTree[agentId] && mqttTree[agentId][subtopic];
    if (entry && entry.lastPayload) {
      pushMsgToViewer(id, entry.lastPayload, entry.qos, entry.retained);
    }
  }

  window.mqttOpenViewer = mqttOpenViewer;

  window.mqttCloseViewer = function (id) {
    var v = mqttViewers.find(function (x) { return x.id === id; });
    if (v && v.agentId) {
      var fullTopic = 'lucid/agents/' + v.agentId + '/' + v.topic;
      delete viewerByTopic[fullTopic];
    }
    mqttViewers = mqttViewers.filter(function (x) { return x.id !== id; });
    renderViewers();
    renderTree();
  };

  window.mqttAddPane = function () {
    mqttViewers.push({ id: uid(), agentId: null, topic: null });
    renderViewers();
  };

  function pushMsgToViewer(viewerId, payload, qos, retained) {
    var body = document.getElementById('mv-body-' + viewerId);
    if (!body) return;

    var countEl = document.getElementById('mv-count-' + viewerId);
    if (countEl) {
      var n = (parseInt(countEl.textContent) || 0) + 1;
      countEl.textContent = n + ' msgs';
    }

    var div = document.createElement('div');
    div.className = 'mv-msg mv-flash';
    div.innerHTML = '<div class="mv-msg-meta">'
      + '<span class="mv-time">' + fmtTime() + '</span>'
      + '<span class="mv-qos">QoS ' + qos + '</span>'
      + (retained ? '<span class="mv-ret">retained</span>' : '')
      + '</div>'
      + '<div class="mv-body-text">' + (payload !== null ? colorJson(payload) : '<span class="mn">—</span>') + '</div>';

    body.insertBefore(div, body.firstChild);

    // Trim old messages
    while (body.children.length > 100) body.removeChild(body.lastChild);
  }

  function renderViewers() {
    var container = document.getElementById('mqtt-viewers');
    if (!container) return;
    container.innerHTML = '';

    if (mqttViewers.length === 0) {
      var ph = document.createElement('div');
      ph.className = 'mqtt-viewer';
      ph.innerHTML = '<div class="mv-empty"><div class="mv-empty-icon">📡</div>'
        + '<p>Click any topic to open it</p>'
        + '<small>Multiple topics open side by side</small></div>';
      container.appendChild(ph);
      return;
    }

    mqttViewers.forEach(function (v) {
      var el = document.createElement('div');
      el.className = 'mqtt-viewer';
      el.id = 'viewer-' + v.id;

      if (!v.agentId) {
        el.innerHTML = '<div class="mv-hdr"><div class="mv-topic" style="color:var(--border)">— empty pane —</div></div>'
          + '<div class="mv-empty"><div class="mv-empty-icon">📭</div><p>Click a topic in the tree</p><small>to stream live messages here</small></div>';
      } else {
        var topicHtml = 'lucid/agents/<em>' + L.esc(v.agentId) + '</em>/' + L.esc(v.topic);
        el.innerHTML = '<div class="mv-hdr">'
          + '<div class="mv-live-dot"></div>'
          + '<div class="mv-topic">' + topicHtml + '</div>'
          + '<span class="mv-count" id="mv-count-' + v.id + '">0 msgs</span>'
          + '<div class="mv-close" onclick="mqttCloseViewer(\'' + v.id + '\')">✕</div>'
          + '</div>'
          + '<div class="mv-body" id="mv-body-' + v.id + '"></div>';
      }
      container.appendChild(el);
    });
  }

  // ── Publisher drawer ────────────────────────────────────────────────────

  function mqttOpenDrawer() {
    document.getElementById('mqtt-drawer').classList.add('mqtt-drawer-open');
    document.getElementById('mqtt-fab').style.display = 'none';
    document.getElementById('md-result').className = 'md-result';
    document.getElementById('md-topic-input').focus();
    mdUpdateChips();
  }

  window.mqttOpenDrawer = mqttOpenDrawer;

  window.mqttCloseDrawer = function () {
    document.getElementById('mqtt-drawer').classList.remove('mqtt-drawer-open');
    document.getElementById('mqtt-fab').style.display = 'flex';
  };

  window.mqttOpenDrawerForAgent = function (agentId) {
    if (pubCrumbs.length === 0) mdAddCrumb(agentId);
    mqttOpenDrawer();
  };

  function mdAddCrumb(val) {
    pubCrumbs.push(val);
    document.getElementById('md-topic-input').value = '';
    mdRenderCrumbs();
    mdUpdateChips();
    mdUpdatePayload();
    document.getElementById('md-result').className = 'md-result';
  }

  window.mdRemoveCrumb = function (idx) {
    pubCrumbs = pubCrumbs.slice(0, idx);
    mdRenderCrumbs();
    mdUpdateChips();
    mdUpdatePayload();
    document.getElementById('md-result').className = 'md-result';
    document.getElementById('md-topic-input').focus();
  };

  function mdRenderCrumbs() {
    var inner = document.getElementById('md-crumbs-inner');
    if (!inner) return;
    inner.innerHTML = pubCrumbs.map(function (c, i) {
      return '<div class="md-crumb" onclick="mdRemoveCrumb(' + i + ')">'
        + L.esc(c) + ' <span class="md-crumb-x">✕</span></div>'
        + '<span class="md-sep">/</span>';
    }).join('');

    var placeholders = ['select agent…', 'cmd or components…', 'action or comp-id…', 'action…'];
    var depth = pubCrumbs.length;
    document.getElementById('md-topic-input').placeholder = placeholders[Math.min(depth, placeholders.length - 1)];

    // Scroll to end so input is always visible
    var scroller = document.getElementById('md-crumbs-scroll');
    if (scroller) setTimeout(function () { scroller.scrollLeft = scroller.scrollWidth; }, 0);
  }

  function mdUpdateChips() {
    var row = document.getElementById('md-ac-row');
    if (!row) return;

    var depth = pubCrumbs.length;
    var agent = pubCrumbs[0];
    var level1 = pubCrumbs[1];
    var level2 = pubCrumbs[2];
    var label = '';
    var chips = []; // [{label, dot, ghost}]

    if (depth === 0) {
      label = 'agents';
      var agents = L.agents ? Object.keys(L.agents) : [];
      // Online agents first
      agents.sort(function (a, b) {
        return (isOnline(a) ? 0 : 1) - (isOnline(b) ? 0 : 1) || a.localeCompare(b);
      });
      chips = agents.map(function (a) { return { label: a, dot: isOnline(a) ? 'g' : 'd' }; });
      if (chips.length === 0) chips = [{ label: 'no agents yet', ghost: true }];
    } else if (depth === 1) {
      label = 'topic';
      chips = [{ label: 'cmd', dot: 'g' }, { label: 'components', dot: 'g' }];
    } else if (depth === 2 && level1 === 'cmd') {
      label = 'commands';
      var catalog = L.catalogs && L.catalogs[agent];
      if (catalog && catalog.agent) {
        chips = catalog.agent.map(function (c) { return { label: c.action, dot: 'g' }; });
      }
      if (chips.length === 0) chips = [{ label: 'loading…', ghost: true }];
      // Lazy load catalog if missing
      if (!catalog && L.loadCatalog) {
        L.loadCatalog(agent).then(function () { mdUpdateChips(); });
      }
    } else if (depth === 2 && level1 === 'components') {
      label = 'components';
      var a = L.agents && L.agents[agent];
      var comps = a ? Object.keys(a.components || {}) : [];
      chips = comps.map(function (c) { return { label: c, dot: 'g' }; });
      if (chips.length === 0) chips = [{ label: 'no components', ghost: true }];
    } else if (depth === 3 && level1 === 'components') {
      label = 'subtopic';
      chips = [{ label: 'cmd', dot: 'g' }, { label: 'status', dot: 'g' }, { label: 'state', dot: 'g' }];
    } else if (depth === 4 && level1 === 'components' && level2 === 'cmd') {
      label = 'commands';
      var compId = pubCrumbs[2];
      var catalog2 = L.catalogs && L.catalogs[agent];
      if (catalog2 && catalog2.components && catalog2.components[compId]) {
        chips = catalog2.components[compId].map(function (c) { return { label: c.action, dot: 'g' }; });
      }
      if (chips.length === 0) chips = [{ label: 'loading…', ghost: true }];
      if (!(L.catalogs && L.catalogs[agent]) && L.loadCatalog) {
        L.loadCatalog(agent).then(function () { mdUpdateChips(); });
      }
    } else {
      label = 'ready to send';
      chips = [];
    }

    var html = '<span class="md-ac-label">' + L.esc(label) + '</span>';
    chips.forEach(function (c, i) {
      var cls = 'md-chip' + (i === 0 && !c.ghost ? ' md-chip-hi' : '') + (c.ghost ? ' md-chip-ghost' : '');
      var dot = c.ghost ? '' : '<div class="md-chip-dot md-chip-dot-' + (c.dot || 'g') + '"></div> ';
      html += '<div class="' + cls + '" onclick="mdPickChip(\'' + L.escAttr(c.label) + '\')">'
        + dot + L.esc(c.label) + '</div>';
    });
    row.innerHTML = html;
  }

  window.mdPickChip = function (val) {
    if (val === 'no agents yet' || val === 'no components' || val === 'loading…') return;
    mdAddCrumb(val);
    document.getElementById('md-topic-input').focus();
  };

  window.mdOnInput = function (val) {
    // Could filter chips here — keeping it simple for now
  };

  window.mdOnKey = function (e) {
    var input = document.getElementById('md-topic-input');
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === '/') {
      e.preventDefault();
      var val = input.value.trim();
      if (!val) {
        // Pick first non-ghost chip
        var row = document.getElementById('md-ac-row');
        var first = row && row.querySelector('.md-chip:not(.md-chip-ghost)');
        if (first) {
          var chipVal = first.textContent.replace(/\s*✕\s*/g, '').trim();
          // Strip the dot character from chip text
          chipVal = chipVal.replace(/^[^\w-]/, '').trim();
          // Actually get from onclick attribute
          var m = first.getAttribute('onclick').match(/mdPickChip\('(.+?)'\)/);
          if (m) val = m[1];
        }
      }
      if (val) mdAddCrumb(val);
    } else if (e.key === 'Backspace' && !input.value) {
      e.preventDefault();
      mdRemoveCrumb(pubCrumbs.length - 1);
    }
  };

  function mdUpdatePayload() {
    var ta = document.getElementById('md-payload');
    if (!ta) return;

    var action = pubCrumbs[pubCrumbs.length - 1] || '';
    var agent = pubCrumbs[0];

    // Find command schema from catalog
    var params = {};
    if (agent && L.catalogs && L.catalogs[agent]) {
      var cat = L.catalogs[agent];
      var allCmds = (cat.agent || []);

      // Also check component commands
      if (pubCrumbs[1] === 'components' && pubCrumbs[2] && cat.components) {
        var compCmds = cat.components[pubCrumbs[2]] || [];
        allCmds = allCmds.concat(compCmds);
      }

      var match = allCmds.find(function (c) { return c.action === action; });
      if (match && match.template) {
        // Build params from template, excluding request_id
        try {
          var tmpl = typeof match.template === 'string' ? JSON.parse(match.template) : match.template;
          Object.entries(tmpl).forEach(function (kv) {
            if (kv[0] !== 'request_id') params[kv[0]] = kv[1];
          });
        } catch (e) {}
      }
    }

    var payload = { request_id: genRequestId() };
    Object.assign(payload, params);
    ta.value = JSON.stringify(payload, null, 2);
  }

  function getPayloadJson() {
    var ta = document.getElementById('md-payload');
    if (!ta) return { request_id: genRequestId() };
    try {
      return JSON.parse(ta.value);
    } catch (e) {
      L.toast && L.toast({ message: 'Invalid JSON payload', type: 'error' });
      return null;
    }
  }

  window.mqttSend = function () {
    if (!mqttConnected || !mqttClient) {
      L.toast && L.toast({ message: 'Not connected to MQTT', type: 'error' });
      return;
    }

    if (pubCrumbs.length < 2) {
      L.toast && L.toast({ message: 'Select at least agent and command', type: 'error' });
      return;
    }

    var payload = getPayloadJson();
    if (!payload) return;

    var topic = 'lucid/agents/' + pubCrumbs.join('/');
    var payloadStr = JSON.stringify(payload);

    var sendBtn = document.getElementById('md-send');
    sendBtn.disabled = true;
    sendBtn.textContent = '…';

    mqttClient.publish(topic, payloadStr, { qos: 1 }, function (err) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send ↑';

      if (err) {
        L.toast && L.toast({ message: 'Publish failed: ' + err.message, type: 'error' });
        return;
      }

      L.toast && L.toast({ message: '↑ ' + topic, type: 'success' });

      // Subscribe to result topic for 30s
      var agentId = pubCrumbs[0];
      var action = pubCrumbs[pubCrumbs.length - 1];
      var resultTopic;
      if (pubCrumbs[1] === 'components' && pubCrumbs.length >= 4) {
        resultTopic = 'lucid/agents/' + agentId + '/components/' + pubCrumbs[2] + '/evt/' + action + '/result';
      } else {
        resultTopic = 'lucid/agents/' + agentId + '/evt/' + action + '/result';
      }

      mqttClient.subscribe(resultTopic, { qos: 1 });
      var timer = setTimeout(function () {
        if (mqttClient && mqttConnected) mqttClient.unsubscribe(resultTopic);
        delete resultSubs[resultTopic];
      }, 30000);
      resultSubs[resultTopic] = { timer: timer };
    });
  };

  function showDrawerResult(payload) {
    var el = document.getElementById('md-result');
    if (!el) return;
    var ok = payload && payload.ok !== false;
    el.className = 'md-result ' + (ok ? 'md-ok' : 'md-err');
    el.textContent = ok ? '✓ ok' : ('✗ ' + (payload && payload.error ? payload.error : 'error'));
  }

  // ── Page init ───────────────────────────────────────────────────────────

  function init() {
    // Pre-fill from sessionStorage if available
    try {
      var saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (saved) {
        if (saved.host) document.getElementById('mqtt-host').value = saved.host;
        if (saved.port) document.getElementById('mqtt-port').value = saved.port;
        if (saved.username) document.getElementById('mqtt-username').value = saved.username;
      }
    } catch (e) {}

    // Allow Enter key in connect form
    ['mqtt-host', 'mqtt-port', 'mqtt-username', 'mqtt-password'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') mqttDoConnect();
      });
    });

    renderViewers();
  }

  // Run after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window.LUCID);
