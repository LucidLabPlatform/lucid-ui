// fleet-logs-panel.js — Live log panel (bottom drawer)
// Depends on: fleet-utils.js, fleet.js

(function (L) {
  'use strict';

  // ── Context (set by page templates via window.LUCID) ──────────────
  var agentId    = L.agentId    || null;   // null = fleet page (all agents)
  var componentId = L.componentId || null; // null = all components for this agent

  // ── State ──────────────────────────────────────────────────────────
  var open         = false;
  var paused       = false;   // true when user scrolled up
  var levelFilter  = 'ALL';   // ALL | DEBUG | INFO | WARNING | ERROR
  var sourceFilter = null;    // null = all, or "agentId" or "agentId/compId"
  var unread       = 0;

  var LEVELS = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR'];
  var LEVEL_ORDER = { DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3 };

  // ── Color palette — one stable color per source ───────────────────
  var COLOR_PALETTE = [
    '#60a5fa', '#4ade80', '#fb923c', '#f472b6',
    '#a78bfa', '#34d399', '#fbbf24', '#38bdf8',
    '#fb7185', '#818cf8', '#e879f9', '#2dd4bf',
  ];
  var _colorMap = {};
  var _colorIdx = 0;

  function sourceKey(entry) {
    return entry.component_id
      ? entry.agent_id + '/' + entry.component_id
      : entry.agent_id;
  }

  function sourceColor(entry) {
    var key = sourceKey(entry);
    if (!_colorMap[key]) {
      _colorMap[key] = COLOR_PALETTE[_colorIdx % COLOR_PALETTE.length];
      _colorIdx++;
    }
    return _colorMap[key];
  }

  function sourceLabel(entry) {
    return entry.component_id ? entry.component_id : entry.agent_id;
  }

  // ── Level badge color ─────────────────────────────────────────────
  var LEVEL_COLORS = {
    DEBUG:   'var(--muted)',
    INFO:    'var(--accent)',
    WARNING: 'var(--yellow)',
    ERROR:   'var(--red)',
    CRITICAL:'var(--red)',
  };

  function levelColor(level) {
    return LEVEL_COLORS[(level || '').toUpperCase()] || 'var(--muted)';
  }

  // ── Filter entry against current context + filters ────────────────
  function entryVisible(entry) {
    // Context filter
    if (componentId) {
      if (entry.agent_id !== agentId || entry.component_id !== componentId) return false;
    } else if (agentId) {
      if (entry.agent_id !== agentId) return false;
    }
    // Source filter (manual selection in panel)
    if (sourceFilter) {
      if (sourceKey(entry) !== sourceFilter) return false;
    }
    // Level filter
    if (levelFilter !== 'ALL') {
      var entryLvl = LEVEL_ORDER[(entry.level || '').toUpperCase()];
      var filterLvl = LEVEL_ORDER[levelFilter];
      if (entryLvl == null || entryLvl < filterLvl) return false;
    }
    return true;
  }

  // ── DOM helpers ───────────────────────────────────────────────────
  function panelEl()  { return document.getElementById('log-panel'); }
  function feedEl()   { return document.getElementById('log-feed'); }
  function badgeEl()  { return document.getElementById('log-badge'); }
  function toggleEl() { return document.getElementById('log-toggle-btn'); }

  // ── Render one log row ────────────────────────────────────────────
  function rowHtml(entry) {
    var color = sourceColor(entry);
    var lvlColor = levelColor(entry.level);
    var ts = entry.ts
      ? new Date(entry.ts).toISOString().replace('T', ' ').substring(0, 19)
      : '';
    var level = (entry.level || '').toUpperCase().substring(0, 4);
    return '<div class="log-row">' +
      '<span class="log-ts">' + L.esc(ts) + '</span>' +
      '<span class="log-src" style="color:' + color + '">' + L.esc(sourceLabel(entry)) + '</span>' +
      '<span class="log-level" style="color:' + lvlColor + '">' + L.esc(level) + '</span>' +
      '<span class="log-msg">' + L.esc(entry.message) + '</span>' +
    '</div>';
  }

  // ── Append entry to feed (live) ───────────────────────────────────
  function appendEntry(entry) {
    if (!entryVisible(entry)) return;

    if (!open) {
      unread++;
      updateBadge();
      return;
    }

    var feed = feedEl();
    if (!feed) return;

    var atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;

    var tmp = document.createElement('div');
    tmp.innerHTML = rowHtml(entry);
    feed.appendChild(tmp.firstChild);

    // Trim old rows if too many in DOM
    while (feed.childElementCount > 500) feed.removeChild(feed.firstChild);

    if (!paused && atBottom) feed.scrollTop = feed.scrollHeight;
  }

  // ── Rebuild feed from buffer ──────────────────────────────────────
  function rebuildFeed() {
    var feed = feedEl();
    if (!feed) return;
    var filtered = L.logBuffer.filter(entryVisible);
    feed.innerHTML = filtered.map(rowHtml).join('');
    feed.scrollTop = feed.scrollHeight;
    paused = false;
  }

  // ── Populate source selector ──────────────────────────────────────
  function buildSourceSelector() {
    var sel = document.getElementById('log-source-sel');
    if (!sel) return;
    // Collect unique sources from buffer that match context
    var seen = {};
    L.logBuffer.forEach(function (e) {
      var k = sourceKey(e);
      if (!seen[k]) {
        // Check context match (ignore sourceFilter and levelFilter here)
        var ok = true;
        if (componentId && (e.agent_id !== agentId || e.component_id !== componentId)) ok = false;
        else if (agentId && !componentId && e.agent_id !== agentId) ok = false;
        if (ok) seen[k] = sourceLabel(e);
      }
    });
    var prev = sel.value;
    sel.innerHTML = '<option value="">All sources</option>';
    Object.keys(seen).sort().forEach(function (k) {
      var sel2 = k === sourceFilter ? ' selected' : '';
      sel.innerHTML += '<option value="' + L.escAttr(k) + '"' + sel2 + '>' + L.esc(seen[k]) + '</option>';
    });
    if (prev && seen[prev]) sel.value = prev;
  }

  // ── Badge ─────────────────────────────────────────────────────────
  function updateBadge() {
    var b = badgeEl();
    if (!b) return;
    if (unread > 0 && !open) {
      b.textContent = unread > 99 ? '99+' : unread;
      b.style.display = '';
    } else {
      b.style.display = 'none';
    }
  }

  // ── Normalise a raw API log record into buffer entry shape ───────
  function normaliseApiLog(raw) {
    return {
      agent_id:     raw.agent_id,
      component_id: raw.component_id || null,
      level:        (raw.level || raw.levelname || 'INFO').toUpperCase(),
      message:      raw.message || raw.msg || JSON.stringify(raw),
      ts:           raw.ts || raw.received_ts,
      received_ts:  raw.received_ts || raw.ts,
      _historical:  true,
    };
  }

  // ── Load historical logs from API into buffer ─────────────────────
  var _historyLoaded = false;

  async function loadHistory() {
    if (_historyLoaded) return;
    _historyLoaded = true;

    var agentsToLoad = agentId ? [agentId] : Object.keys(L.agents);
    var limit = agentId ? 300 : Math.max(50, Math.floor(300 / Math.max(agentsToLoad.length, 1)));

    var results = await Promise.all(agentsToLoad.map(function (id) {
      return L.loadLogs(id, limit).then(function (rows) {
        return (rows || []).map(normaliseApiLog);
      }).catch(function () { return []; });
    }));

    // Merge, sort by ts ascending, deduplicate with live buffer
    var historical = [].concat.apply([], results);
    historical.sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });

    // Prepend historical entries that aren't already in the buffer
    var liveKeys = {};
    L.logBuffer.forEach(function (e) { liveKeys[e.ts + e.message] = true; });
    var toAdd = historical.filter(function (e) { return !liveKeys[e.ts + e.message]; });

    L.logBuffer = toAdd.concat(L.logBuffer);
    if (L.logBuffer.length > 2000) L.logBuffer = L.logBuffer.slice(-2000);
  }

  // ── Open / close ──────────────────────────────────────────────────
  function openPanel() {
    open = true;
    unread = 0;
    updateBadge();
    var p = panelEl();
    if (p) p.classList.add('open');

    // Show loading state, then backfill history
    var feed = feedEl();
    if (feed && !_historyLoaded) {
      feed.innerHTML = '<div class="log-loading">Loading logs\u2026</div>';
    }

    loadHistory().then(function () {
      rebuildFeed();
      buildSourceSelector();
    });
  }

  function closePanel() {
    open = false;
    var p = panelEl();
    if (p) p.classList.remove('open');
  }

  function togglePanel() {
    if (open) closePanel(); else openPanel();
  }

  // ── Wire events ───────────────────────────────────────────────────
  // Scripts load at bottom of body so DOM is ready; use timeout as safety net
  function wireEvents() {
    var toggleBtn = toggleEl();
    if (toggleBtn) toggleBtn.addEventListener('click', togglePanel);

    var closeBtn = document.getElementById('log-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    var clearBtn = document.getElementById('log-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      var feed = feedEl();
      if (feed) feed.innerHTML = '';
      L.logBuffer = L.logBuffer.filter(function (e) { return !entryVisible(e); });
    });

    var levelSel = document.getElementById('log-level-sel');
    if (levelSel) {
      LEVELS.forEach(function (l) {
        levelSel.innerHTML += '<option value="' + l + '"' + (l === levelFilter ? ' selected' : '') + '>' + l + '</option>';
      });
      levelSel.addEventListener('change', function () {
        levelFilter = levelSel.value;
        rebuildFeed();
      });
    }

    var sourceSel = document.getElementById('log-source-sel');
    if (sourceSel) {
      sourceSel.addEventListener('change', function () {
        sourceFilter = sourceSel.value || null;
        rebuildFeed();
      });
    }

    // Pause auto-scroll when user scrolls up
    var feed = feedEl();
    if (feed) {
      feed.addEventListener('scroll', function () {
        paused = feed.scrollHeight - feed.scrollTop - feed.clientHeight > 80;
      });
    }

    // Scroll-to-bottom button
    var bottomBtn = document.getElementById('log-scroll-bottom');
    if (bottomBtn) {
      bottomBtn.addEventListener('click', function () {
        var f = feedEl();
        if (f) { f.scrollTop = f.scrollHeight; paused = false; }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireEvents);
  } else {
    wireEvents();
  }

  // ── Subscribe to live log stream ──────────────────────────────────
  L.onLog(function (entry) {
    appendEntry(entry);
    if (open) buildSourceSelector();
  });

})(window.LUCID);
