// fleet-components-type.js — Per-type components page renderer
// Depends on: fleet-utils.js, fleet.js, fleet-components.js, fleet-bulk-commands.js

(function (L) {
  'use strict';

  var componentType = L.componentType;
  if (!componentType) return;

  var containerEl;
  var activeFilter = 'all';
  var searchQuery = '';

  // ── Gather components of this type ────────────────────────────────

  function gatherComponents() {
    var result = [];
    Object.values(L.agents).forEach(function (a) {
      var catalog = L.catalogs[a.agent_id] || {};
      Object.values(a.components || {}).forEach(function (c) {
        var type = L.detectComponentType(c.component_id, c.metadata && c.metadata.capabilities);
        if (type !== componentType) return;
        result.push({
          agentId: a.agent_id, agent: a, compId: c.component_id, comp: c, catalog: catalog,
          state: (c.status && c.status.state) || 'unknown',
        });
      });
    });
    return result;
  }

  function filterComponents(comps) {
    return comps.filter(function (item) {
      if (activeFilter === 'running' && item.state !== 'running') return false;
      if (activeFilter === 'error' && item.state !== 'error') return false;
      if (searchQuery) {
        var q = searchQuery.toLowerCase();
        var text = (item.agentId + ' ' + item.compId).toLowerCase();
        if (text.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // ── Render ────────────────────────────────────────────────────────

  function renderPage() {
    containerEl = containerEl || document.getElementById('components-page');
    if (!containerEl) return;

    var allComps = gatherComponents();
    var filtered = filterComponents(allComps);

    if (!filtered.length) {
      containerEl.innerHTML = '<div class="fleet-empty">No ' + L.esc(componentType) + ' components found</div>';
      updateStats(allComps);
      return;
    }

    var html = '<div class="comp-cards">';
    filtered.forEach(function (item) {
      var agentState = L.agentState(item.agent);
      html += '<div class="comp-card-wrapper">';
      html += '<div class="comp-agent-label">';
      html += '<span class="agent-dot dot-' + agentState + '"></span>';
      html += '<a href="/agent/' + encodeURIComponent(item.agentId) + '">' + L.esc(item.agentId) + '</a>';
      html += '</div>';
      html += '<a class="comp-card-link" href="/agent/' + encodeURIComponent(item.agentId) + '/components/' + encodeURIComponent(item.compId) + '">';
      html += L.renderComponent(item.agentId, item.compId, item.comp, item.catalog);
      html += '</a>';
      html += '</div>';
    });
    html += '</div>';

    containerEl.innerHTML = html;
    updateStats(allComps);
    setupBulkBar(allComps);
  }

  function updateStats(allComps) {
    if (!allComps) allComps = gatherComponents();
    var running = allComps.filter(function (c) { return c.state === 'running'; });
    var errors = allComps.filter(function (c) { return c.state === 'error'; });

    var el;
    el = document.getElementById('stat-total');
    if (el) el.textContent = allComps.length + ' ' + L.esc(componentType);
    el = document.getElementById('stat-running');
    if (el) el.textContent = running.length + ' running';
    el = document.getElementById('stat-error');
    if (el) el.textContent = errors.length + ' error';
  }

  function setupBulkBar(allComps) {
    if (!allComps.length) return;
    L.renderBulkBar('bulk-bar', {
      label: L.esc(componentType) + ' Commands',
      commandsFn: function () {
        var targets = allComps.map(function (c) { return { agentId: c.agentId, componentId: c.compId }; });
        return L.computeCommonCommands(targets, 'component');
      },
      targetsFn: function () {
        return gatherComponents().map(function (c) { return { agentId: c.agentId, componentId: c.compId }; });
      },
    });
  }

  // ── Events ────────────────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    var actBtn = e.target.closest('.act[data-action]');
    if (actBtn) {
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
      if (Object.keys(tpl).length === 0) hasBody = false;
      else {
        if (typeof L.openCommandPanel === 'function')
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

  L.loadAgents().then(function () {
    var promises = Object.keys(L.agents).map(function (id) { return L.loadCatalog(id); });
    return Promise.all(promises);
  }).then(function () { renderPage(); });

  L.registerPageRenderer({
    renderFull: renderPage,
    renderDirty: function () { renderPage(); },
    renderStats: function () { updateStats(); },
  });

})(window.LUCID);
