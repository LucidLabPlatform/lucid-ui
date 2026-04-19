// fleet-experiments.js — Experiments templates list + recent runs
// Depends on: fleet-utils.js, fleet.js, fleet-toasts.js

(function (L) {
  'use strict';

  var templatesEl, runsEl;
  var templates = [];
  var runs = [];
  var activeFilter = 'all';
  var searchQuery = '';

  // ── Load data ─────────────────────────────────────────────────────

  async function loadData() {
    try {
      var [tplRes, runsRes] = await Promise.all([
        L.apiFetch('/api/experiments/templates'),
        L.apiFetch('/api/experiments/runs'),
      ]);
      if (tplRes.ok) templates = await tplRes.json();
      if (runsRes.ok) runs = await runsRes.json();
    } catch (e) {
      console.error('Failed to load experiments:', e);
    }
    renderPage();
  }

  // ── Render ────────────────────────────────────────────────────────

  function renderPage() {
    templatesEl = templatesEl || document.getElementById('exp-templates');
    runsEl = runsEl || document.getElementById('exp-recent-runs');

    renderTemplates();
    renderRecentRuns();
    updateStats();
  }

  function renderTemplates() {
    if (!templatesEl) return;

    var filtered = templates.filter(function (t) {
      if (searchQuery) {
        var q = searchQuery.toLowerCase();
        var text = ((t.id || '') + ' ' + (t.name || '') + ' ' + (t.description || '') + ' ' + (t.tags || []).join(' ')).toLowerCase();
        if (text.indexOf(q) === -1) return false;
      }
      return true;
    });

    if (!filtered.length) {
      templatesEl.innerHTML = '<div class="fleet-empty">No experiment templates found</div>';
      return;
    }

    var html = '<div class="exp-grid">';
    filtered.forEach(function (t) {
      var steps = (t.definition && t.definition.steps) || t.steps || [];
      var params = t.parameters_schema || t.parameters || {};
      var paramCount = Object.keys(params).length;

      html += '<a class="exp-card" href="/experiments/' + encodeURIComponent(t.id) + '">';
      html += '<div class="exp-card-header">';
      html += '<span class="exp-card-name">' + L.esc(t.name || t.id) + '</span>';
      if (t.version) html += '<span class="card-version">v' + L.esc(t.version) + '</span>';
      html += '</div>';
      if (t.description) html += '<div class="exp-card-desc">' + L.esc(t.description) + '</div>';
      html += '<div class="exp-card-meta">';
      html += '<span>' + steps.length + ' step' + (steps.length !== 1 ? 's' : '') + '</span>';
      if (paramCount) html += ' \u00B7 <span>' + paramCount + ' param' + (paramCount !== 1 ? 's' : '') + '</span>';
      html += '</div>';
      if (t.tags && t.tags.length) {
        html += '<div class="exp-card-tags">';
        t.tags.forEach(function (tag) {
          html += '<span class="pill">' + L.esc(tag) + '</span>';
        });
        html += '</div>';
      }
      html += '</a>';
    });
    html += '</div>';

    templatesEl.innerHTML = html;
  }

  function renderRecentRuns() {
    if (!runsEl) return;
    if (!runs.length) { runsEl.innerHTML = ''; return; }

    var recent = runs.slice(0, 10);
    var html = '<div class="tier2-section">';
    html += '<div class="tier2-label">Recent Runs</div>';
    html += '<div class="exp-runs-list">';
    recent.forEach(function (r) {
      var statusCls = 'status-' + (r.status || 'unknown');
      html += '<a class="exp-run-row" href="/experiments/runs/' + encodeURIComponent(r.id) + '">';
      html += '<span class="status-badge ' + statusCls + '">' + L.esc(r.status || 'unknown') + '</span>';
      html += '<span class="exp-run-tpl">' + L.esc(r.template_id || '') + '</span>';
      if (r.started_at) html += '<span class="exp-run-ts" data-ts="' + L.escAttr(r.started_at) + '">' + L.fmtTs(r.started_at) + '</span>';
      html += '</a>';
    });
    html += '</div></div>';

    runsEl.innerHTML = html;
  }

  function updateStats() {
    var el;
    el = document.getElementById('stat-templates');
    if (el) el.textContent = templates.length + ' template' + (templates.length !== 1 ? 's' : '');
    var active = runs.filter(function (r) { return r.status === 'running' || r.status === 'pending'; });
    el = document.getElementById('stat-runs-active');
    if (el) el.textContent = active.length + ' active';
    el = document.getElementById('stat-runs-total');
    if (el) el.textContent = runs.length + ' run' + (runs.length !== 1 ? 's' : '');
  }

  // ── Events ────────────────────────────────────────────────────────

  var searchEl = document.getElementById('exp-search');
  if (searchEl) {
    searchEl.addEventListener('input', function () {
      searchQuery = searchEl.value;
      renderTemplates();
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────

  loadData();

  // Register minimal renderer — experiments data comes from API, not WS
  L.registerPageRenderer({
    renderFull: function () { /* templates loaded via API, not agents */ },
    renderDirty: function () {},
    renderStats: function () {},
  });

})(window.LUCID);
