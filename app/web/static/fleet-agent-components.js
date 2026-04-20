// fleet-agent-components.js — Agent's components list page renderer
// Depends on: fleet-utils.js, fleet.js, fleet-components.js, fleet-bulk-commands.js

(function (L) {
  'use strict';

  var agentId = L.agentId;
  if (!agentId || L.componentId) return; // not on agent-components page

  var containerEl;
  var activeFilter = 'all';
  var searchQuery = '';

  // ── Full render ───────────────────────────────────────────────────

  function renderPage() {
    containerEl = containerEl || document.getElementById('components-page');
    if (!containerEl) return;

    var a = L.agents[agentId];
    if (!a) {
      containerEl.innerHTML = '<div class="fleet-empty">Agent "' + L.esc(agentId) + '" not found</div>';
      return;
    }

    var comps = getFilteredComponents(a);
    if (!comps.length) {
      containerEl.innerHTML = '<div class="fleet-empty">No components found</div>';
      updateStats(a);
      return;
    }

    var catalog = L.catalogs[agentId] || {};
    var html = '<div class="comp-cards">';
    comps.forEach(function (c) {
      html += '<a class="comp-card-link" href="/agent/' + encodeURIComponent(agentId) + '/components/' + encodeURIComponent(c.component_id) + '">';
      html += L.renderComponent(agentId, c.component_id, c, catalog);
      html += '</a>';
    });
    html += '</div>';

    containerEl.innerHTML = html;
    updateStats(a);
    setupBulkBar(a);
  }

  function getFilteredComponents(a) {
    var comps = Object.values(a.components || {});
    return comps.filter(function (c) {
      var cState = (c.status && c.status.state) || 'unknown';
      if (activeFilter === 'running' && cState !== 'running') return false;
      if (activeFilter === 'error' && cState !== 'error') return false;
      if (searchQuery) {
        var q = searchQuery.toLowerCase();
        if (c.component_id.toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function updateStats(a) {
    if (!a) a = L.agents[agentId];
    if (!a) return;
    var comps = Object.values(a.components || {});
    var running = comps.filter(function (c) { return c.status && c.status.state === 'running'; });
    var errors = comps.filter(function (c) { return c.status && c.status.state === 'error'; });

    var el;
    el = document.getElementById('stat-total');
    if (el) el.textContent = comps.length + ' component' + (comps.length !== 1 ? 's' : '');
    el = document.getElementById('stat-running');
    if (el) el.textContent = running.length + ' running';
    el = document.getElementById('stat-error');
    if (el) el.textContent = errors.length + ' error';
  }

  function setupBulkBar(a) {
    if (!a) return;
    var compIds = Object.keys(a.components || {});
    if (!compIds.length) return;

    L.renderBulkBar('bulk-bar', {
      label: L.esc(agentId) + ' Components',
      commandsFn: function () {
        var targets = compIds.map(function (cid) { return { agentId: agentId, componentId: cid }; });
        return L.computeCommonCommands(targets, 'component');
      },
      targetsFn: function () {
        return compIds.map(function (cid) { return { agentId: agentId, componentId: cid }; });
      },
    });
  }

  // ── Events ────────────────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    var actBtn = e.target.closest('.act[data-action]');
    if (actBtn) {
      e.preventDefault();
      var link = actBtn.closest('.comp-card-link');
      if (link) { e.preventDefault(); e.stopPropagation(); }
      handleActionClick(actBtn);
      return;
    }

    var filterPill = e.target.closest('.filter-pill');
    if (filterPill) {
      document.querySelectorAll('.filter-pill').forEach(function (p) { p.classList.remove('active'); });
      filterPill.classList.add('active');
      activeFilter = filterPill.dataset.filter;
      renderPage();
      return;
    }
  });

  var searchEl = document.getElementById('comp-search');
  if (searchEl) {
    searchEl.addEventListener('input', function () {
      searchQuery = searchEl.value;
      renderPage();
    });
  }

  function handleActionClick(btn) {
    var aid = btn.dataset.agent;
    var compId = btn.dataset.comp || null;
    var action = btn.dataset.action;
    var hasBody = btn.dataset.hasBody === '1';

    if (hasBody) {
      var tpl = {};
      try { tpl = JSON.parse(btn.dataset.template || '{}'); } catch (ex) {}
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
      setTimeout(function () { btn.textContent = origText; btn.style.color = ''; btn.disabled = false; }, 2000);
    });
  }

  // ── Load catalogs and register ────────────────────────────────────

  L.loadCatalog(agentId).then(function () { renderPage(); });

  L.registerPageRenderer({
    renderFull: renderPage,
    renderDirty: function (ids) { if (ids.indexOf(agentId) !== -1) renderPage(); },
    renderStats: function () { updateStats(); },
  });

})(window.LUCID);
