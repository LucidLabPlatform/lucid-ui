// fleet-components-page.js — All components grouped by type
// Depends on: fleet-utils.js, fleet.js, fleet-components.js

(function (L) {
  'use strict';

  var containerEl;
  var activeFilter = 'all';
  var searchQuery = '';

  var TYPE_ORDER = ['projector', 'ndi', 'led_strip', 'ros_bridge', 'knx', 'optitrack', 'camera', 'cpu_monitor', 'exec', 'viz', 'generic'];
  var TYPE_LABELS = {
    projector: 'Projectors', ndi: 'NDI', led_strip: 'LED Strips',
    ros_bridge: 'ROS Bridges', knx: 'KNX Lighting', optitrack: 'OptiTrack',
    camera: 'Cameras', cpu_monitor: 'CPU Monitors',
    exec: 'Exec', viz: 'Visualization', generic: 'Other',
  };

  // ── Full render ───────────────────────────────────────────────────

  function renderPage() {
    containerEl = containerEl || document.getElementById('components-page');
    if (!containerEl) return;

    var allComps = gatherComponents();
    var filtered = filterComponents(allComps);
    var groups = groupByType(filtered);

    if (!filtered.length) {
      containerEl.innerHTML = '<div class="fleet-empty">No components found</div>';
      updateStats(allComps);
      return;
    }

    var html = '';
    TYPE_ORDER.forEach(function (type) {
      if (!groups[type] || !groups[type].length) return;
      var icon = L.compIcon(type === 'generic' ? '' : type);
      html += '<div class="comp-type-group" data-type="' + type + '">';
      html += '<a class="comp-type-header" href="/components/' + encodeURIComponent(type) + '">';
      html += '<span class="comp-type-icon">' + icon + '</span>';
      html += '<span class="comp-type-name">' + (TYPE_LABELS[type] || type) + '</span>';
      html += '<span class="comp-type-count">' + groups[type].length + '</span>';
      html += '</a>';
      html += '<div class="comp-cards">';
      groups[type].forEach(function (item) {
        var agentState = L.agentState(item.agent);
        html += '<div class="comp-card-wrapper">';
        html += '<div class="comp-agent-label">';
        html += '<span class="agent-dot dot-' + agentState + '"></span>';
        html += '<a href="/agent/' + encodeURIComponent(item.agentId) + '">' + L.esc(item.agentId) + '</a>';
        html += '</div>';
        html += L.renderComponent(item.agentId, item.compId, item.comp, item.catalog);
        html += '</div>';
      });
      html += '</div></div>';
    });

    containerEl.innerHTML = html;
    updateStats(allComps);
  }

  // ── Gather all components ─────────────────────────────────────────

  function gatherComponents() {
    var result = [];
    Object.values(L.agents).forEach(function (a) {
      var catalog = L.catalogs[a.agent_id] || {};
      Object.values(a.components || {}).forEach(function (c) {
        result.push({
          agentId: a.agent_id,
          agent: a,
          compId: c.component_id,
          comp: c,
          catalog: catalog,
          type: L.detectComponentType(c.component_id, c.metadata && c.metadata.capabilities),
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
        var text = (item.agentId + ' ' + item.compId + ' ' + item.type).toLowerCase();
        if (text.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function groupByType(comps) {
    var groups = {};
    comps.forEach(function (item) {
      var t = TYPE_ORDER.indexOf(item.type) !== -1 ? item.type : 'generic';
      if (!groups[t]) groups[t] = [];
      groups[t].push(item);
    });
    return groups;
  }

  // ── Stats ─────────────────────────────────────────────────────────

  function updateStats(allComps) {
    if (!allComps) allComps = gatherComponents();
    var running = allComps.filter(function (c) { return c.state === 'running'; });
    var errors = allComps.filter(function (c) { return c.state === 'error'; });

    var el;
    el = document.getElementById('stat-total-comps');
    if (el) el.textContent = allComps.length + ' component' + (allComps.length !== 1 ? 's' : '');
    el = document.getElementById('stat-running-comps');
    if (el) el.textContent = running.length + ' running';
    el = document.getElementById('stat-error-comps');
    if (el) el.textContent = errors.length + ' error';
  }

  // ── Event delegation ──────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    // Action buttons
    var actBtn = e.target.closest('.act[data-action]');
    if (actBtn) {
      handleActionClick(actBtn);
      return;
    }

    // Filter pills
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
      try { tpl = JSON.parse(btn.dataset.template || '{}'); } catch (e) {}
      if (Object.keys(tpl).length === 0) {
        hasBody = false;
      } else {
        if (typeof L.openCommandPanel === 'function') {
          L.openCommandPanel({ agentId: aid, componentId: compId, action: action, template: tpl });
        }
        return;
      }
    }

    var origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '\u2026';

    L.fireCmd(aid, compId, action, {}).then(function (result) {
      btn.textContent = result.ok ? '\u2713' : '\u2717';
      btn.style.color = result.ok ? 'var(--green)' : 'var(--red)';
      setTimeout(function () {
        btn.textContent = origText;
        btn.style.color = '';
        btn.disabled = false;
      }, 2000);
    });
  }

  // ── Bulk bar ───────────────────────────────────────────────────────

  function setupBulkBar() {
    L.renderBulkBar('bulk-bar', {
      label: 'Component Lifecycle',
      commandsFn: function () {
        // Use agent-level component management commands
        var targets = Object.keys(L.agents).map(function (id) { return { agentId: id, componentId: null }; });
        var all = L.computeCommonCommands(targets, 'agent');
        // Filter to lifecycle-related commands
        return all.filter(function (c) {
          return ['components/enable', 'components/disable', 'components/install', 'components/uninstall'].indexOf(c.action) !== -1;
        });
      },
      targetsFn: function () {
        return Object.keys(L.agents).map(function (id) { return { agentId: id, componentId: null }; });
      },
    });
  }

  // ── Load catalogs for all agents, then register ───────────────────

  L.loadAgents().then(function () {
    var promises = Object.keys(L.agents).map(function (id) { return L.loadCatalog(id); });
    return Promise.all(promises);
  }).then(function () {
    renderPage();
    setupBulkBar();
  });

  L.registerPageRenderer({
    renderFull: renderPage,
    renderDirty: function () { renderPage(); },
    renderStats: function () { updateStats(); },
  });

})(window.LUCID);
