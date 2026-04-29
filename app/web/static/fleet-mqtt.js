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

  // viewer message history (persisted across renderViewers calls)
  var viewerMessages = {};  // viewerId → [{payload, qos, retained, ts}]

  // publisher state
  var pubCrumbs = [];
  // form + JSON are always both visible side by side
  var pubFormFields = [];   // [{path, key, value, control}]

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

  function strRepeat(str, n) {
    var out = ''; for (var i = 0; i < n; i++) out += str; return out;
  }

  function colorJson(obj, indent) {
    if (indent === undefined) indent = 0;
    var pad = '  ';
    if (obj === null || obj === undefined) return '<span class="mn">null</span>';
    if (typeof obj === 'boolean') return '<span class="mb">' + obj + '</span>';
    if (typeof obj === 'number') return '<span class="mn">' + obj + '</span>';
    if (typeof obj === 'string') return '<span class="ms">"' + L.esc(obj) + '"</span>';
    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      var items = obj.map(function (v) {
        return strRepeat(pad, indent + 1) + colorJson(v, indent + 1);
      });
      return '[\n' + items.join(',\n') + '\n' + strRepeat(pad, indent) + ']';
    }
    if (typeof obj === 'object') {
      var entries = Object.entries(obj);
      if (entries.length === 0) return '{}';
      var lines = entries.map(function (kv) {
        return strRepeat(pad, indent + 1)
          + '<span class="mk">"' + L.esc(kv[0]) + '"</span>: '
          + colorJson(kv[1], indent + 1);
      });
      return '{\n' + lines.join(',\n') + '\n' + strRepeat(pad, indent) + '}';
    }
    return L.esc(String(obj));
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

  // Extract component info from a subtopic that starts with 'components/'
  function parseComponentSubtopic(subtopic) {
    if (!subtopic.startsWith('components/')) return null;
    var rest = subtopic.slice('components/'.length);
    var slash = rest.indexOf('/');
    return slash === -1
      ? { compId: rest, compSubtopic: '' }
      : { compId: rest.slice(0, slash), compSubtopic: rest.slice(slash + 1) };
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
    viewerMessages = {};
    resultSubs = {};
    pubCrumbs = [];
    pubFormFields = [];
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

      // Partition: flat topics vs component subtopics
      var flatTopics = [];
      var compGroups = {};
      subtopics.forEach(function (sub) {
        var parsed = parseComponentSubtopic(sub);
        if (parsed) {
          if (!compGroups[parsed.compId]) compGroups[parsed.compId] = [];
          compGroups[parsed.compId].push({ compSubtopic: parsed.compSubtopic, entry: mqttTree[agentId][sub], sub: sub });
        } else {
          flatTopics.push(sub);
        }
      });

      // Render flat topics
      flatTopics.forEach(function (sub) {
        if (f && !sub.includes(f) && !agentId.includes(f)) return;
        var fullTopic = 'lucid/agents/' + agentId + '/' + sub;
        var isLive = !!viewerByTopic[fullTopic];
        var entry = mqttTree[agentId][sub];
        var rowCls = 'mt-row mt-l2' + (isLive ? ' mt-live' : '');
        html += '<div class="' + rowCls + '" title="' + L.escAttr('lucid/agents/' + agentId + '/' + sub) + '" onclick="mqttOpenViewer(\'' + L.escAttr(agentId) + '\',\'' + L.escAttr(sub) + '\')">';
        if (!entry.retained) html += '<div class="mt-dot mt-dot-g" style="flex-shrink:0"></div> ';
        html += L.esc(sub);
        if (entry.retained) html += ' <span class="mt-badge">R</span>';
        if (isLive) html += ' <span class="mt-live-badge">LIVE</span>';
        html += '</div>';
      });

      // Render component groups
      Object.keys(compGroups).sort().forEach(function (compId) {
        var compKey = agentId + '::comp::' + compId;
        var compOpen = treeOpenNodes.has(compKey);
        var compItems = compGroups[compId];
        // Show group if any item matches filter
        if (f && !compId.includes(f) && !agentId.includes(f)) {
          var anyMatch = compItems.some(function (ci) { return ci.compSubtopic.includes(f); });
          if (!anyMatch) return;
        }
        html += '<div class="mt-row mt-l2 mt-comp-hdr" onclick="mqttToggleComp(\'' + L.escAttr(agentId) + '\',\'' + L.escAttr(compId) + '\')">'
          + (compOpen ? '▼' : '▶') + ' <span class="mt-comp-icon">◈</span> ' + L.esc(compId)
          + '</div>';
        if (compOpen) {
          compItems.forEach(function (ci) {
            if (!ci.compSubtopic) return; // skip bare 'components/{id}' with no subtopic
            if (f && !ci.compSubtopic.includes(f) && !compId.includes(f) && !agentId.includes(f)) return;
            var fullTopic = 'lucid/agents/' + agentId + '/' + ci.sub;
            var isLive = !!viewerByTopic[fullTopic];
            var rowCls = 'mt-row mt-l3' + (isLive ? ' mt-live' : '');
            html += '<div class="' + rowCls + '" title="' + L.escAttr('lucid/agents/' + agentId + '/' + ci.sub) + '" onclick="mqttOpenViewer(\'' + L.escAttr(agentId) + '\',\'' + L.escAttr(ci.sub) + '\')">';
            if (!ci.entry.retained) html += '<div class="mt-dot mt-dot-g" style="flex-shrink:0"></div> ';
            html += L.esc(ci.compSubtopic);
            if (ci.entry.retained) html += ' <span class="mt-badge">R</span>';
            if (isLive) html += ' <span class="mt-live-badge">LIVE</span>';
            html += '</div>';
          });
        }
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

  window.mqttToggleComp = function (agentId, compId) {
    var key = agentId + '::comp::' + compId;
    if (treeOpenNodes.has(key)) treeOpenNodes.delete(key);
    else treeOpenNodes.add(key);
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
    // Always append a new pane (don't recycle empties — confusing UX)
    mqttViewers.push({ id: id, agentId: agentId, topic: subtopic });
    viewerByTopic[fullTopic] = id;
    viewerMessages[id] = [];

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
    delete viewerMessages[id];
    // Remove the pane DOM element directly (no full re-render needed)
    var el = document.getElementById('viewer-' + id);
    if (el) el.parentNode.removeChild(el);
    // If now empty, show placeholder
    if (mqttViewers.length === 0) renderViewers();
    renderTree();
  };

  window.mqttAddPane = function () {
    mqttViewers.push({ id: uid(), agentId: null, topic: null });
    renderViewers();
  };

  function pushMsgToViewer(viewerId, payload, qos, retained) {
    // 1. Persist to state
    if (!viewerMessages[viewerId]) viewerMessages[viewerId] = [];
    var record = { payload: payload, qos: qos, retained: !!retained, ts: fmtTime() };
    viewerMessages[viewerId].unshift(record);
    if (viewerMessages[viewerId].length > 100) viewerMessages[viewerId].pop();

    // 2. Update count badge directly
    var countEl = document.getElementById('mv-count-' + viewerId);
    if (countEl) countEl.textContent = viewerMessages[viewerId].length + ' msgs';

    // 3. Append single message to DOM
    appendMsgDOM(viewerId, record);
  }

  function appendMsgDOM(viewerId, record) {
    var body = document.getElementById('mv-body-' + viewerId);
    if (!body) return;
    var div = document.createElement('div');
    div.className = 'mv-msg mv-flash';
    div.innerHTML = '<div class="mv-msg-meta">'
      + '<span class="mv-time">' + record.ts + '</span>'
      + '<span class="mv-qos">QoS ' + record.qos + '</span>'
      + (record.retained ? '<span class="mv-ret">retained</span>' : '')
      + '</div>'
      + '<div class="mv-body-text">'
      + (record.payload !== null ? colorJson(record.payload) : '<span class="mn">—</span>')
      + '</div>';
    body.insertBefore(div, body.firstChild);
    while (body.children.length > 100) body.removeChild(body.lastChild);
  }

  function buildViewerHTML(v) {
    if (!v.agentId) {
      return '<div class="mv-hdr"><div class="mv-topic" style="color:var(--border)">— empty pane —</div>'
        + '<div class="mv-close" onclick="mqttCloseViewer(\'' + v.id + '\')">✕</div></div>'
        + '<div class="mv-empty"><div class="mv-empty-icon">📭</div><p>Click a topic in the tree</p><small>to stream live messages here</small></div>';
    }
    var fullTopic = 'lucid/agents/' + v.agentId + '/' + v.topic;
    var topicHtml = 'lucid/agents/<em>' + L.esc(v.agentId) + '</em>/' + L.esc(v.topic);
    return '<div class="mv-hdr">'
      + '<div class="mv-live-dot"></div>'
      + '<div class="mv-topic" title="' + L.escAttr(fullTopic) + '">' + topicHtml + '</div>'
      + '<span class="mv-count" id="mv-count-' + v.id + '">0 msgs</span>'
      + '<div class="mv-close" onclick="mqttCloseViewer(\'' + v.id + '\')">✕</div>'
      + '</div>'
      + '<div class="mv-body" id="mv-body-' + v.id + '"></div>';
  }

  function renderViewers() {
    var container = document.getElementById('mqtt-viewers');
    if (!container) return;

    if (mqttViewers.length === 0) {
      container.innerHTML = '';
      var ph = document.createElement('div');
      ph.className = 'mqtt-viewer';
      ph.innerHTML = '<div class="mv-empty"><div class="mv-empty-icon">📡</div>'
        + '<p>Click any topic to open it</p>'
        + '<small>Multiple topics open side by side</small></div>';
      container.appendChild(ph);
      return;
    }

    // Keyed DOM diff: remove stale, add new — never touch existing viewers' children
    var validIds = new Set(mqttViewers.map(function (v) { return v.id; }));
    Array.from(container.children).forEach(function (child) {
      if (!child.id || !child.id.startsWith('viewer-')) return;
      var vid = child.id.slice('viewer-'.length);
      if (!validIds.has(vid)) container.removeChild(child);
    });

    mqttViewers.forEach(function (v) {
      var existing = document.getElementById('viewer-' + v.id);
      if (existing) return; // already in DOM with all its messages intact

      var el = document.createElement('div');
      el.className = 'mqtt-viewer';
      el.id = 'viewer-' + v.id;
      el.innerHTML = buildViewerHTML(v);
      container.appendChild(el);

      // Replay buffered messages (newest first, already in that order)
      var msgs = viewerMessages[v.id] || [];
      // Replay oldest-first so they end up in newest-first DOM order
      for (var i = msgs.length - 1; i >= 0; i--) {
        appendMsgDOM(v.id, msgs[i]);
      }
      // Update count
      var countEl = document.getElementById('mv-count-' + v.id);
      if (countEl) countEl.textContent = msgs.length + ' msgs';
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
        chips = catalog.agent.map(function (c) { return { label: c.action, dot: 'g', tip: c.help || c.label || '' }; });
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
    } else if (depth === 4 && level1 === 'components' && pubCrumbs[3] === 'cmd') {
      label = 'commands';
      var compId = pubCrumbs[2];
      var catalog2 = L.catalogs && L.catalogs[agent];
      if (catalog2 && catalog2.components && catalog2.components[compId]) {
        chips = catalog2.components[compId].map(function (c) { return { label: c.action, dot: 'g', tip: c.help || c.label || '' }; });
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
      var tipAttr = c.tip ? ' title="' + L.escAttr(c.tip) + '"' : '';
      html += '<div class="' + cls + '"' + tipAttr + ' onclick="mdPickChip(\'' + L.escAttr(c.label) + '\')">'
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
    var filter = val.toLowerCase();
    var row = document.getElementById('md-ac-row');
    if (!row) return;
    var chips = row.querySelectorAll('.md-chip');
    chips.forEach(function (chip) {
      var text = chip.textContent.toLowerCase();
      chip.style.display = (filter && text.indexOf(filter) === -1) ? 'none' : '';
    });
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

  // ── Publisher form helpers ──────────────────────────────────────────────

  // Both form and JSON are always visible side by side — no mode toggle needed

  function mdGetSchemaFields(agentId, action) {
    if (!agentId || !action) return null;
    var schema = L.schemas && L.schemas[agentId];
    if (!schema) return null;
    var subscribes;
    if (pubCrumbs[1] === 'components' && pubCrumbs[2]) {
      var compSchema = schema.components && schema.components[pubCrumbs[2]];
      if (compSchema) subscribes = compSchema.subscribes;
    } else {
      subscribes = schema.subscribes;
    }
    if (!subscribes) return null;
    var cmdSchema = subscribes['cmd/' + action];
    if (!cmdSchema || !cmdSchema.fields) return null;
    return Object.keys(cmdSchema.fields)
      .filter(function (k) { return k !== 'request_id'; })
      .map(function (k) {
        var f = cmdSchema.fields[k];
        return { name: k, type: f.type, description: f.description,
                 default_value: f['default'], min: f.min, max: f.max, 'enum': f['enum'] };
      });
  }

  function mdRenderFieldInput(c, value, id) {
    if (!c) c = { type: 'text' };
    if (c.type === 'enum') {
      var out = '<select class="md-field-input" id="' + id + '">';
      (c.options || []).forEach(function (opt) {
        var sel = (opt === value) ? ' selected' : '';
        out += '<option value="' + L.escAttr(String(opt)) + '"' + sel + '>' + L.esc(String(opt)) + '</option>';
      });
      return out + '</select>';
    }
    if (c.type === 'slider') {
      var v = (typeof value === 'number') ? value : Math.round(((c.min || 0) + (c.max || 255)) / 2);
      return '<div class="md-slider-row">'
        + '<input type="range" id="' + id + '" class="md-slider" min="' + (c.min || 0)
        + '" max="' + (c.max || 255) + '" step="' + (c.step || 1) + '" value="' + v + '"'
        + ' oninput="this.nextElementSibling.textContent=this.value">'
        + '<span class="md-slider-val">' + v + '</span></div>';
    }
    if (c.type === 'number') {
      return '<input type="number" id="' + id + '" class="md-field-input" min="' + (c.min || 0)
        + '" max="' + (c.max || 10000) + '" step="' + (c.step || 1)
        + '" value="' + (value != null ? value : 0) + '">';
    }
    if (c.type === 'toggle') {
      var checked = (value === true || value === 'true') ? ' checked' : '';
      return '<label class="md-toggle-label"><input type="checkbox" id="' + id
        + '" class="md-toggle"' + checked + '><span class="md-toggle-val">'
        + (checked ? 'on' : 'off') + '</span></label>';
    }
    return '<input type="text" id="' + id + '" class="md-field-input" value="'
      + L.escAttr(value != null ? String(value) : '') + '">';
  }

  function mdRenderFormView() {
    var formEl = document.getElementById('md-form-view');
    if (!formEl) return;

    if (!pubFormFields.length) {
      formEl.innerHTML = '<div class="md-no-fields">No parameters — only request_id will be sent</div>';
      formEl.dataset.fields = '[]';
      return;
    }

    // Group by top-level key
    var groups = [];
    var groupMap = {};
    pubFormFields.forEach(function (f) {
      var dotIdx = f.path.indexOf('.');
      if (dotIdx === -1) {
        groups.push({ key: null, fields: [f] });
      } else {
        var topKey = f.path.substring(0, dotIdx);
        if (!groupMap[topKey]) { groupMap[topKey] = { key: topKey, fields: [] }; groups.push(groupMap[topKey]); }
        groupMap[topKey].fields.push(f);
      }
    });

    var html = '';
    var allFieldMeta = [];
    groups.forEach(function (group) {
      if (group.key !== null) html += '<div class="md-field-group"><div class="md-field-group-label">' + L.esc(group.key) + '</div>';
      group.fields.forEach(function (f) {
        var idx = allFieldMeta.length;
        var fid = 'mdf-' + idx;
        var label = group.key !== null ? f.path.substring(group.key.length + 1) : f.path;
        html += '<div class="md-field-row">'
          + '<label class="md-field-label" for="' + fid + '" title="' + L.escAttr(f.description || '') + '">' + L.esc(label) + '</label>'
          + mdRenderFieldInput(f.control, f.value, fid)
          + '</div>';
        if (f.description) html += '<div class="md-field-desc">' + L.esc(f.description) + '</div>';
        allFieldMeta.push({ path: f.path, control: f.control });
      });
      if (group.key !== null) html += '</div>';
    });

    formEl.innerHTML = html;
    formEl.dataset.fields = JSON.stringify(allFieldMeta);

    formEl.querySelectorAll('input, select').forEach(function (el) {
      el.addEventListener('input', mdSyncFormToJson);
      el.addEventListener('change', mdSyncFormToJson);
    });
    formEl.querySelectorAll('.md-toggle').forEach(function (chk) {
      chk.addEventListener('change', function () {
        var span = chk.parentNode.querySelector('.md-toggle-val');
        if (span) span.textContent = chk.checked ? 'on' : 'off';
        mdSyncFormToJson();
      });
    });
  }

  function mdSyncFormToJson() {
    var formEl = document.getElementById('md-form-view');
    var ta = document.getElementById('md-payload');
    if (!formEl || !ta) return;
    var fieldMeta = JSON.parse(formEl.dataset.fields || '[]');
    var fieldValues = fieldMeta.map(function (fm, i) {
      var el = document.getElementById('mdf-' + i);
      if (!el) return { path: fm.path, value: null };
      var val;
      if (fm.control && (fm.control.type === 'slider' || fm.control.type === 'number')) val = Number(el.value);
      else if (fm.control && fm.control.type === 'toggle') val = el.checked;
      else val = el.value;
      return { path: fm.path, value: val };
    });
    var payload = L.buildPayload ? L.buildPayload(fieldValues) : {};
    ta.value = JSON.stringify(payload, null, 2);
  }

  function mdFindCatalogCmd(agent, action) {
    if (!agent || !action || !L.catalogs || !L.catalogs[agent]) return null;
    var cat = L.catalogs[agent];
    var allCmds = (cat.agent || []);
    if (pubCrumbs[1] === 'components' && pubCrumbs[2] && cat.components) {
      allCmds = allCmds.concat(cat.components[pubCrumbs[2]] || []);
    }
    return allCmds.find(function (c) { return c.action === action; }) || null;
  }

  function mdUpdatePayload() {
    var action = pubCrumbs[pubCrumbs.length - 1] || '';
    var agent = pubCrumbs[0];

    // Show command description hint
    var hintEl = document.getElementById('md-payload-hint');
    var match = mdFindCatalogCmd(agent, action);
    if (hintEl) {
      var hint = '';
      if (match) {
        hint = match.help || match.label || '';
        if (match.has_body === false && !hint) hint = 'no extra payload — only request_id';
      }
      hintEl.textContent = hint;
      hintEl.title = hint;
    }

    // 1. Try schema fields first
    var schemaFields = mdGetSchemaFields(agent, action);

    // 2. Fall back to catalog template
    var tmpl = {};
    if (!schemaFields && match) {
      if (match.template) {
        try {
          tmpl = typeof match.template === 'string' ? JSON.parse(match.template) : JSON.parse(JSON.stringify(match.template));
        } catch (e) {}
      }
    }

    // 3. Build form fields — always include request_id
    var reqId = genRequestId();
    if (schemaFields && schemaFields.length) {
      pubFormFields = schemaFields.map(function (sf) {
        var ctrl = (L.controlFromSchema && L.controlFromSchema({ type: sf.type, 'enum': sf['enum'], min: sf.min, max: sf.max }))
                || (L.inferControl && L.inferControl(sf.name, sf.default_value, ''))
                || { type: 'text' };
        return { path: sf.name, key: sf.name, value: sf.default_value, control: ctrl, description: sf.description };
      });
    } else {
      // Remove request_id from template — we add it as a dedicated field
      delete tmpl.request_id;
      pubFormFields = L.flattenTemplate ? L.flattenTemplate(tmpl, '', '') : [];
    }

    // Always prepend request_id as first field
    pubFormFields.unshift({
      path: 'request_id', key: 'request_id', value: reqId,
      control: { type: 'text' }, description: 'Unique ID to correlate command with result'
    });

    mdRenderFormView();
    mdSyncFormToJson();

    // Wire JSON→form sync once
    var ta = document.getElementById('md-payload');
    if (ta && !ta._mdSyncBound) {
      ta._mdSyncBound = true;
      ta.addEventListener('input', function () {
        try {
          var obj = JSON.parse(ta.value);
          ta.style.borderColor = '';
          var meta = JSON.parse((document.getElementById('md-form-view') || {}).dataset && document.getElementById('md-form-view').dataset.fields || '[]');
          meta.forEach(function (fm, i) {
            var el = document.getElementById('mdf-' + i);
            if (!el) return;
            var parts = fm.path.split('.'); var val = obj;
            for (var j = 0; j < parts.length && val != null; j++) val = val[parts[j]];
            if (val == null) return;
            if (fm.control && fm.control.type === 'toggle') {
              el.checked = (val === true || val === 'true');
              var span = el.parentNode.querySelector('.md-toggle-val');
              if (span) span.textContent = el.checked ? 'on' : 'off';
            } else {
              el.value = val;
              var sv = el.nextElementSibling;
              if (sv && sv.classList.contains('md-slider-val')) sv.textContent = val;
            }
          });
        } catch (e) { ta.style.borderColor = 'var(--red)'; }
      });
    }
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
    // Pre-fill defaults then override with saved session values
    document.getElementById('mqtt-host').value = window.location.hostname;
    document.getElementById('mqtt-port').value = '8083';

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
