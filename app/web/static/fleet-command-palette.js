// fleet-command-palette.js — Cmd+K fuzzy search palette
// Depends on: fleet-utils.js, fleet.js, fleet-command-panel.js

(function (L) {
  'use strict';

  var overlayEl, inputEl, resultsEl;
  var selectedIdx = 0;
  var currentResults = [];
  var isOpen = false;

  // ── Open / Close ───────────────────────────────────────────────────

  function open() {
    overlayEl = overlayEl || document.getElementById('palette-overlay');
    inputEl = inputEl || document.getElementById('palette-input');
    resultsEl = resultsEl || document.getElementById('palette-results');
    if (!overlayEl) return;

    isOpen = true;
    overlayEl.classList.remove('hidden');
    inputEl.value = '';
    inputEl.focus();
    selectedIdx = 0;
    updateResults('');
  }

  function close() {
    if (!overlayEl) return;
    isOpen = false;
    overlayEl.classList.add('hidden');
  }

  // ── Fuzzy search ───────────────────────────────────────────────────

  function buildIndex() {
    var items = [];

    Object.values(L.agents).forEach(function (a) {
      var state = L.agentState(a);
      items.push({
        type: 'agent',
        label: a.agent_id,
        secondary: state + ' \u00B7 ' + Object.keys(a.components || {}).length + ' components',
        agentId: a.agent_id,
        score: state === 'online' ? 1 : 0,
      });

      // Components
      Object.values(a.components || {}).forEach(function (c) {
        var cState = (c.status && c.status.state) || 'unknown';
        items.push({
          type: 'component',
          label: a.agent_id + ' / ' + c.component_id,
          secondary: L.compIcon(c.component_id) + ' ' + cState,
          agentId: a.agent_id,
          componentId: c.component_id,
          score: 0,
        });
      });

      // Commands from catalog
      var catalog = L.catalogs[a.agent_id] || {};
      (catalog.agent || []).forEach(function (cmd) {
        items.push({
          type: 'command',
          label: cmd.action + ' \u2192 ' + a.agent_id,
          secondary: cmd.help || cmd.label || '',
          agentId: a.agent_id,
          componentId: null,
          action: cmd.action,
          score: state === 'online' ? 1 : 0,
        });
      });

      Object.keys(catalog.components || {}).forEach(function (cid) {
        (catalog.components[cid] || []).forEach(function (cmd) {
          items.push({
            type: 'command',
            label: cmd.action + ' \u2192 ' + a.agent_id + ' / ' + cid,
            secondary: cmd.help || cmd.label || '',
            agentId: a.agent_id,
            componentId: cid,
            action: cmd.action,
            score: 0,
          });
        });
      });
    });

    return items;
  }

  function fuzzyMatch(query, items) {
    if (!query) return items.slice(0, 20);

    var tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    var results = [];

    items.forEach(function (item) {
      var text = item.label.toLowerCase();
      var allMatch = tokens.every(function (t) { return text.indexOf(t) !== -1; });
      if (!allMatch) return;

      // Score: exact > prefix > substring
      var score = item.score || 0;
      tokens.forEach(function (t) {
        if (text === t) score += 10;
        else if (text.startsWith(t)) score += 5;
        else score += 1;
      });
      results.push({ item: item, score: score });
    });

    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 20).map(function (r) { return r.item; });
  }

  // ── Status query ───────────────────────────────────────────────────

  function checkStatusQuery(query) {
    var m = query.match(/^status\s+(.+)/i);
    if (!m) return null;
    var name = m[1].trim().toLowerCase();
    var agent = Object.values(L.agents).find(function (a) {
      return a.agent_id.toLowerCase().indexOf(name) !== -1;
    });
    if (!agent) return null;
    return agent;
  }

  // ── Render results ─────────────────────────────────────────────────

  function updateResults(query) {
    if (!resultsEl) return;

    // Check for "status {agent}" query
    var statusAgent = checkStatusQuery(query);
    if (statusAgent) {
      var state = L.agentState(statusAgent);
      var comps = Object.keys(statusAgent.components || {}).length;
      resultsEl.innerHTML = '<div class="palette-status">' +
        '<div class="palette-status-header">' +
        '<span class="agent-dot dot-' + state + '"></span>' +
        '<span class="palette-status-name">' + L.esc(statusAgent.agent_id) + '</span>' +
        '<span class="status-badge status-' + state + '">' + state + '</span>' +
        '</div>' +
        '<div class="palette-status-body">' +
        '<div>Uptime: ' + L.fmtUptime(statusAgent.status) + '</div>' +
        '<div>Components: ' + comps + '</div>' +
        '<div>Last seen: ' + L.fmtTs(statusAgent.last_seen_ts) + '</div>' +
        (statusAgent.metadata ? '<div>Version: ' + L.esc(statusAgent.metadata.version || '—') + '</div>' : '') +
        '</div></div>';
      currentResults = [];
      return;
    }

    var index = buildIndex();
    currentResults = fuzzyMatch(query, index);

    if (!currentResults.length) {
      resultsEl.innerHTML = '<div class="palette-empty">No results</div>';
      return;
    }

    // Group by type
    var groups = { command: [], agent: [], component: [] };
    currentResults.forEach(function (r) {
      if (groups[r.type]) groups[r.type].push(r);
    });

    var html = '';
    var globalIdx = 0;

    [['command', 'Commands'], ['agent', 'Agents'], ['component', 'Components']].forEach(function (pair) {
      var key = pair[0], label = pair[1];
      if (!groups[key] || !groups[key].length) return;

      html += '<div class="palette-group-label">' + label + '</div>';
      groups[key].forEach(function (r) {
        var cls = globalIdx === selectedIdx ? ' palette-result-active' : '';
        var icon = r.type === 'command' ? '\u25B8' : r.type === 'agent' ? '\u2022' : L.compIcon(r.componentId || '');
        html += '<div class="palette-result' + cls + '" data-idx="' + globalIdx + '">' +
          '<span class="palette-result-icon">' + icon + '</span>' +
          '<span class="palette-result-label">' + L.esc(r.label) + '</span>' +
          '<span class="palette-result-secondary">' + L.esc(r.secondary) + '</span>' +
          '</div>';
        globalIdx++;
      });
    });

    resultsEl.innerHTML = html;
  }

  // ── Selection ──────────────────────────────────────────────────────

  function selectResult(idx) {
    if (idx < 0 || idx >= currentResults.length) return;
    var item = currentResults[idx];

    close();

    if (item.type === 'agent') {
      window.location.href = '/agent/' + encodeURIComponent(item.agentId);
    } else if (item.type === 'component') {
      window.location.href = '/agent/' + encodeURIComponent(item.agentId) + '/components/' + encodeURIComponent(item.componentId);
    } else if (item.type === 'command') {
      // Open command panel pre-filled
      if (typeof L.openCommandPanel === 'function') {
        L.openCommandPanel({ agentId: item.agentId, componentId: item.componentId, action: item.action });
      }
    }
  }

  // ── Keyboard handling ──────────────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    // Cmd+K / Ctrl+K to open
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (isOpen) close(); else open();
      return;
    }

    if (!isOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, currentResults.length - 1);
      updateResults(inputEl.value);
      scrollActiveIntoView();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      updateResults(inputEl.value);
      scrollActiveIntoView();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      selectResult(selectedIdx);
      return;
    }
  });

  function scrollActiveIntoView() {
    var active = resultsEl && resultsEl.querySelector('.palette-result-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  // ── Input handler ──────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    inputEl = document.getElementById('palette-input');
    resultsEl = document.getElementById('palette-results');
    overlayEl = document.getElementById('palette-overlay');

    if (inputEl) {
      inputEl.addEventListener('input', function () {
        selectedIdx = 0;
        updateResults(inputEl.value);
      });
    }

    // Click on result
    if (resultsEl) {
      resultsEl.addEventListener('click', function (e) {
        var el = e.target.closest('.palette-result');
        if (el) selectResult(parseInt(el.dataset.idx, 10));
      });
    }

    // Click overlay to close
    if (overlayEl) {
      overlayEl.addEventListener('click', function (e) {
        if (e.target === overlayEl) close();
      });
    }

    // Palette hint click
    var hint = document.getElementById('palette-hint');
    if (hint) hint.addEventListener('click', open);
  });

})(window.LUCID);
