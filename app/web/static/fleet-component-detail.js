// fleet-component-detail.js — Single component detail page renderer
// Depends on: fleet-utils.js, fleet.js, fleet-components.js, fleet-sparklines.js

(function (L) {
  'use strict';

  var agentId = L.agentId;
  var componentId = L.componentId;
  if (!agentId || !componentId) return;

  var headerEl, bodyEl;

  // ── Full render ───────────────────────────────────────────────────

  function renderDetail() {
    var a = L.agents[agentId];
    if (!a) {
      headerEl = headerEl || document.getElementById('component-detail-header');
      if (headerEl) headerEl.innerHTML = '<div class="fleet-empty">Agent "' + L.esc(agentId) + '" not found</div>';
      return;
    }
    var comp = (a.components || {})[componentId];
    if (!comp) {
      headerEl = headerEl || document.getElementById('component-detail-header');
      if (headerEl) headerEl.innerHTML = '<div class="fleet-empty">Component "' + L.esc(componentId) + '" not found on ' + L.esc(agentId) + '</div>';
      return;
    }
    renderHeader(a, comp);
    renderBody(a, comp);
  }

  function renderHeader(a, comp) {
    headerEl = headerEl || document.getElementById('component-detail-header');
    if (!headerEl) return;

    var cState = (comp.status && comp.status.state) || 'unknown';
    var icon = L.compIcon(componentId);
    var type = L.detectComponentType(componentId, comp.metadata && comp.metadata.capabilities);

    var html = '<div class="detail-header">';
    html += '<span class="comp-detail-icon">' + icon + '</span>';
    html += '<h1 class="detail-name">' + L.esc(componentId) + '</h1>';
    html += '<span class="status-badge status-' + cState + '">' + cState + '</span>';
    html += '<span class="detail-meta">Type: ' + L.esc(type) + '</span>';
    html += '<span class="detail-meta">on <a href="/agent/' + encodeURIComponent(agentId) + '">' + L.esc(agentId) + '</a>';
    html += ' <span class="agent-dot dot-' + L.agentState(a) + '"></span></span>';
    html += '</div>';

    headerEl.innerHTML = html;
  }

  async function renderBody(a, comp) {
    bodyEl = bodyEl || document.getElementById('component-detail-body');
    if (!bodyEl) return;

    await L.loadCatalog(agentId);
    var catalog = L.catalogs[agentId] || {};

    var html = '';

    // Section 1: Full component card
    html += '<div class="tier2-section">';
    html += '<div class="tier2-label">Status &amp; Metrics</div>';
    html += L.renderComponent(agentId, componentId, comp, catalog);
    html += '</div>';

    // Section 2: Component telemetry
    var cacheKey = agentId + '/' + componentId;
    var telData = L.telemetryCache[cacheKey];
    if (telData && Object.keys(telData).length) {
      html += '<div class="tier2-section">';
      html += '<div class="tier2-label">Telemetry</div>';
      html += '<div class="chart-containers">';
      Object.keys(telData).forEach(function (metric) {
        html += '<div class="chart-container" id="chart-container-' + L.escAttr(cacheKey) + '-' + metric + '" data-agent="' + L.escAttr(agentId) + '" data-component="' + L.escAttr(componentId) + '" data-metric="' + metric + '"></div>';
      });
      html += '</div></div>';
    }

    // Section 3: Full state dump
    var state = comp.state || {};
    if (Object.keys(state).length) {
      html += '<div class="tier2-section">';
      html += '<div class="tier2-label">State</div>';
      html += '<div class="kv-grid">';
      Object.keys(state).forEach(function (k) {
        var v = state[k];
        var display = typeof v === 'object' ? JSON.stringify(v) : String(v);
        html += '<div class="kv-cell"><span class="kv-k">' + L.esc(k) + '</span><span class="kv-v">' + L.esc(display) + '</span></div>';
      });
      html += '</div></div>';
    }

    // Section 4: Component config
    var cfg = comp.cfg || {};
    if (Object.keys(cfg).length) {
      html += '<div class="tier2-section">';
      html += '<div class="tier2-label">Config</div>';
      html += '<div class="kv-grid">';
      Object.keys(cfg).forEach(function (k) {
        var v = cfg[k];
        var display = typeof v === 'object' ? JSON.stringify(v) : String(v);
        html += '<div class="kv-cell"><span class="kv-k">' + L.esc(k) + '</span><span class="kv-v">' + L.esc(display) + '</span></div>';
      });
      html += '</div></div>';
    }

    // Section 5: Schema
    var schema = L.schemas[agentId] && L.schemas[agentId].components && L.schemas[agentId].components[componentId];
    if (schema) {
      html += '<div class="tier2-section">';
      html += '<div class="tier2-label">Schema</div>';
      html += '<pre class="schema-dump">' + L.esc(JSON.stringify(schema, null, 2)) + '</pre>';
      html += '</div>';
    }

    // Section 7: Component commands
    var compCmds = (catalog.components && catalog.components[componentId]) || [];
    if (compCmds.length) {
      html += '<div class="tier2-section">';
      html += '<div class="tier2-label">Commands</div>';
      html += '<div class="tier2-actions">';
      compCmds.forEach(function (cmd) {
        var hb = cmd.has_body ? ' data-has-body="1"' : '';
        var tpl = cmd.template ? ' data-template="' + L.escAttr(JSON.stringify(cmd.template)) + '"' : '';
        html += '<button class="act" data-agent="' + L.escAttr(agentId) + '" data-comp="' + L.escAttr(componentId) + '" data-action="' + L.escAttr(cmd.action) + '"' + hb + tpl + '>' + L.esc(cmd.label || cmd.action) + '</button>';
      });
      html += '</div></div>';
    }

    bodyEl.innerHTML = html;
  }

  // ── Targeted update ───────────────────────────────────────────────

  function updateDetail(dirtyIds) {
    if (dirtyIds.indexOf(agentId) === -1) return;
    renderDetail();
  }

  // ── Event delegation ──────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    var actBtn = e.target.closest('.act[data-action]');
    if (actBtn) {
      handleActionClick(actBtn);
      return;
    }
    var panelBtn = e.target.closest('[data-open-panel]');
    if (panelBtn) {
      if (typeof L.openCommandPanel === 'function') L.openCommandPanel({ agentId: panelBtn.dataset.openPanel, componentId: componentId });
      return;
    }
  });

  function handleActionClick(btn) {
    var aid = btn.dataset.agent;
    var cid = btn.dataset.comp || null;
    var action = btn.dataset.action;
    var hasBody = btn.dataset.hasBody === '1';

    if (hasBody) {
      var tpl = {};
      try { tpl = JSON.parse(btn.dataset.template || '{}'); } catch (ex) {}
      if (Object.keys(tpl).length === 0) hasBody = false;
      else {
        if (typeof L.openCommandPanel === 'function')
          L.openCommandPanel({ agentId: aid, componentId: cid, action: action, template: tpl });
        return;
      }
    }

    var origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '\u2026';
    L.fireCmd(aid, cid, action, {}).then(function (result) {
      btn.textContent = result.ok ? '\u2713' : '\u2717';
      btn.style.color = result.ok ? 'var(--green)' : 'var(--red)';
      setTimeout(function () { btn.textContent = origText; btn.style.color = ''; btn.disabled = false; }, 2000);
    });
  }

  // ── Register ──────────────────────────────────────────────────────

  L.registerPageRenderer({
    renderFull: renderDetail,
    renderDirty: updateDetail,
    renderStats: null,
  });

})(window.LUCID);
