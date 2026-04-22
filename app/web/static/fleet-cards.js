// fleet-cards.js — Fleet dashboard: Agents grid
// Depends on: fleet-utils.js, fleet.js, fleet-toasts.js, fleet-bulk-commands.js

(function (L) {
  'use strict';

  var gridEl;

  // ══════════════════════════════════════════════════════════════════
  // AGENTS VIEW
  // ══════════════════════════════════════════════════════════════════

  function renderFleetGrid() {
    gridEl = gridEl || document.getElementById('fleet-grid');
    if (!gridEl) return;

    var list = getFilteredAgents();

    if (!list.length) {
      gridEl.innerHTML = '<div class="fleet-empty">No agents found</div>';
      return;
    }

    gridEl.innerHTML = list.map(renderAgentCard).join('');
  }

  function updateAgentCard(agentId) {
    gridEl = gridEl || document.getElementById('fleet-grid');
    if (!gridEl) return;

    var a = L.agents[agentId];
    if (!a) return;

    var card = gridEl.querySelector('[data-agent-card="' + CSS.escape(agentId) + '"]');
    if (!card) { L.fullRenderNeeded = true; return; }

    if (!matchesAgentFilter(a)) { card.style.display = 'none'; return; }
    card.style.display = '';

    var state = L.agentState(a);
    var dot = card.querySelector('.agent-dot');
    if (dot) dot.className = 'agent-dot dot-' + state;

    var uptimeEl = card.querySelector('.card-uptime');
    if (uptimeEl) uptimeEl.textContent = L.fmtUptime(a.status);

    var tsEl = card.querySelector('.card-lastseen');
    if (tsEl) { tsEl.textContent = L.fmtTs(a.last_seen_ts); tsEl.dataset.ts = a.last_seen_ts || ''; }

    var compsEl = card.querySelector('.card-comps');
    if (compsEl) compsEl.innerHTML = renderCompList(a);
  }

  function matchesAgentFilter(a) {
    var state = L.agentState(a);
    if (L.activeFilter === 'online' && state !== 'online') return false;
    if (L.activeFilter === 'offline' && state === 'online') return false;
    if (L.searchQuery && a.agent_id.toLowerCase().indexOf(L.searchQuery.toLowerCase()) === -1) return false;
    return true;
  }

  function getFilteredAgents() {
    var list = Object.values(L.agents).filter(matchesAgentFilter);
    list.sort(function (a, b) {
      var aOn = L.agentState(a) === 'online' ? 0 : 1;
      var bOn = L.agentState(b) === 'online' ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      return a.agent_id.localeCompare(b.agent_id);
    });
    return list;
  }

  function renderAgentCard(a) {
    var state = L.agentState(a);
    var meta = a.metadata || {};

    var html = '<a class="agent-card" href="/agent/' + encodeURIComponent(a.agent_id) + '" data-agent-card="' + L.escAttr(a.agent_id) + '">';
    html += '<div class="card-header">';
    html += '<span class="agent-dot dot-' + state + '"></span>';
    html += '<span class="agent-name">' + L.esc(a.agent_id) + '</span>';
    if (meta.version) html += '<span class="card-version">v' + L.esc(meta.version) + '</span>';
    html += '</div>';
    html += '<div class="card-meta">';
    html += '<span class="card-uptime">' + L.fmtUptime(a.status) + '</span>';
    html += ' \u00B7 <span class="card-lastseen" data-ts="' + L.escAttr(a.last_seen_ts || '') + '">' + L.fmtTs(a.last_seen_ts) + '</span>';
    if (meta.platform) html += ' \u00B7 ' + L.esc(meta.platform);
    html += '</div>';
    html += '<div class="card-comps">' + renderCompList(a) + '</div>';
    html += '<div class="card-actions">';
    html += '<button class="act act-quick" data-agent="' + L.escAttr(a.agent_id) + '" data-action="ping">ping</button>';
    html += '<button class="act act-quick" data-agent="' + L.escAttr(a.agent_id) + '" data-action="restart">restart</button>';
    html += '<button class="act act-quick" data-agent="' + L.escAttr(a.agent_id) + '" data-action="refresh">refresh</button>';
    html += '</div>';
    html += '</a>';
    return html;
  }

  function renderCompList(a) {
    var comps = Object.values(a.components || {});
    if (!comps.length) return '<div class="no-comps">no components</div>';
    return comps.map(function (c) {
      var cState = (c.status && c.status.state) || 'unknown';
      var icon = L.compIcon(c.component_id, c);
      var summary = L.compSummary(c.component_id, c);
      return '<div class="card-comp-row">' +
        '<span class="pill-dot dot-' + cState + '"></span>' +
        '<span class="card-comp-icon">' + icon + '</span>' +
        '<span class="card-comp-name">' + L.esc(c.component_id) + '</span>' +
        '<span class="card-comp-summary">' + L.esc(summary) + '</span>' +
        '</div>';
    }).join('');
  }

  // ══════════════════════════════════════════════════════════════════
  // STATS
  // ══════════════════════════════════════════════════════════════════

  function updateStats() {
    var all = Object.values(L.agents);
    var online = all.filter(function (a) { return L.agentState(a) === 'online'; });
    var errored = all.filter(function (a) {
      return Object.values(a.components || {}).some(function (c) {
        return (c.status && c.status.state) === 'error';
      });
    });
    setStatText('stat-total', all.length + ' agent' + (all.length !== 1 ? 's' : ''));
    setStatText('stat-online', online.length + ' online');
    setStatText('stat-offline', (all.length - online.length) + ' offline');
    var errEl = document.getElementById('stat-error');
    if (errEl) {
      errEl.textContent = errored.length + ' error' + (errored.length !== 1 ? 's' : '');
      errEl.style.display = errored.length > 0 ? '' : 'none';
    }
  }

  function setStatText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ══════════════════════════════════════════════════════════════════
  // EVENTS
  // ══════════════════════════════════════════════════════════════════

  document.addEventListener('click', function (e) {
    // Action buttons — prevent card navigation
    var actBtn = e.target.closest('.act[data-action]');
    if (actBtn) {
      var card = actBtn.closest('.agent-card');
      if (card) { e.preventDefault(); e.stopPropagation(); }
      handleActionClick(actBtn);
      return;
    }

    // Filter pills
    var filterPill = e.target.closest('.filter-pill');
    if (filterPill) {
      document.querySelectorAll('.filter-pill').forEach(function (p) { p.classList.remove('active'); });
      filterPill.classList.add('active');
      L.activeFilter = filterPill.dataset.filter;
      renderFleetGrid();
      return;
    }
  });

  var searchEl = document.getElementById('fleet-search');
  if (searchEl) {
    searchEl.addEventListener('input', function () {
      L.searchQuery = searchEl.value;
      renderFleetGrid();
    });
  }

  function handleActionClick(btn) {
    var agentId = btn.dataset.agent;
    var compId = btn.dataset.comp || null;
    var action = btn.dataset.action;
    var hasBody = btn.dataset.hasBody === '1';

    if (hasBody) {
      var tpl = {};
      try { tpl = JSON.parse(btn.dataset.template || '{}'); } catch (e) {}
      if (typeof L.openCommandPanel === 'function') {
        L.openCommandPanel({ agentId: agentId, componentId: compId, action: action, template: tpl });
        return;
      }
    }

    var origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '\u2026';

    L.fireCmd(agentId, compId, action, {}).then(function (result) {
      btn.textContent = result.ok ? '\u2713' : '\u2717';
      btn.style.color = result.ok ? 'var(--green)' : 'var(--red)';
      setTimeout(function () {
        btn.textContent = origText;
        btn.style.color = '';
        btn.disabled = false;
      }, 2000);
    });
  }

  // ── Render dispatch ───────────────────────────────────────────────

  function renderFull() {
    renderFleetGrid();
    updateStats();
    setupBulkBar();
  }

  function renderDirty(ids) {
    ids.forEach(updateAgentCard);
  }

  function setupBulkBar() {
    L.renderBulkBar('bulk-bar', {
      label: 'Fleet Commands',
      commandsFn: function () {
        var targets = Object.keys(L.agents).map(function (id) { return { agentId: id, componentId: null }; });
        return L.computeCommonCommands(targets, 'agent');
      },
      targetsFn: function () {
        return Object.keys(L.agents).map(function (id) { return { agentId: id, componentId: null }; });
      },
    });
  }

  // Pre-load catalogs for bulk bar
  L.loadAgents().then(function () {
    var promises = Object.keys(L.agents).map(function (id) { return L.loadCatalog(id); });
    return Promise.all(promises);
  }).then(function () { setupBulkBar(); });

  L.registerPageRenderer({
    renderFull: renderFull,
    renderDirty: renderDirty,
    renderStats: updateStats,
  });

})(window.LUCID);
