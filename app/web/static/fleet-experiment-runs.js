// fleet-experiment-runs.js — All experiment runs, grouped by template
// Depends on: fleet-utils.js, fleet.js

(function (L) {
  'use strict';

  var listEl;
  var runs = [];
  var templates = [];
  var activeFilter = '';

  // ── Load ────────────────────────────────────────────────────────────

  async function loadData() {
    try {
      var [runsRes, tplRes] = await Promise.all([
        L.apiFetch('/api/experiments/runs'),
        L.apiFetch('/api/experiments/templates'),
      ]);
      if (runsRes.ok) runs = await runsRes.json();
      if (tplRes.ok) templates = await tplRes.json();
    } catch (e) {
      console.error('Failed to load runs:', e);
    }
    renderList();
  }

  // ── Render — grouped by template ────────────────────────────────────

  function renderList() {
    listEl = listEl || document.getElementById('runs-list');
    if (!listEl) return;

    var filtered = activeFilter
      ? runs.filter(function (r) { return r.status === activeFilter; })
      : runs;

    if (!filtered.length) {
      listEl.innerHTML = '<div class="fleet-empty">No runs found</div>';
      return;
    }

    // Group by template_id
    var groups = {};
    var order = [];
    filtered.forEach(function (r) {
      var tid = r.template_id || 'unknown';
      if (!groups[tid]) { groups[tid] = []; order.push(tid); }
      groups[tid].push(r);
    });

    var html = '';
    order.forEach(function (tid) {
      var groupRuns = groups[tid];
      html += '<div class="runs-group">';
      html += '<div class="runs-group-header">';
      html += '<a href="/experiments/' + encodeURIComponent(tid) + '" class="runs-group-name">' + L.esc(tid) + '</a>';
      html += '<span class="runs-group-count">' + groupRuns.length + ' run' + (groupRuns.length !== 1 ? 's' : '') + '</span>';
      html += '<a href="/experiments/' + encodeURIComponent(tid) + '/run" class="act act-quick runs-group-run">Run</a>';
      html += '</div>';

      html += '<table class="runs-table"><thead><tr>';
      html += '<th>Status</th><th>Run ID</th><th>Started</th><th>Duration</th>';
      html += '</tr></thead><tbody>';

      groupRuns.forEach(function (r) {
        var statusCls = 'status-' + (r.status || 'unknown');
        var duration = '';
        if (r.started_at && r.ended_at) {
          var ms = new Date(r.ended_at) - new Date(r.started_at);
          duration = _fmtDuration(ms);
        } else if (r.status === 'running' && r.started_at) {
          duration = 'running\u2026';
        }

        html += '<tr class="runs-row" data-href="/experiments/runs/' + encodeURIComponent(r.id) + '">';
        html += '<td><span class="status-badge ' + statusCls + '">' + L.esc(r.status || '?') + '</span></td>';
        html += '<td class="runs-id">' + L.esc(r.id.substring(0, 8)) + '</td>';
        html += '<td>' + (r.started_at ? L.fmtTs(r.started_at) : '\u2014') + '</td>';
        html += '<td>' + L.esc(duration || '\u2014') + '</td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';
    });

    listEl.innerHTML = html;

    // Clickable rows
    listEl.querySelectorAll('.runs-row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') return;
        window.location.href = row.dataset.href;
      });
    });
  }

  function _fmtDuration(ms) {
    if (ms < 1000) return ms + 'ms';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    return m + 'm ' + (s % 60) + 's';
  }

  // ── Filters ─────────────────────────────────────────────────────────

  function setupFilters() {
    var container = document.getElementById('runs-filters');
    if (!container) return;
    container.querySelectorAll('.runs-filter').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.runs-filter').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeFilter = btn.dataset.status || '';
        renderList();
      });
    });
  }

  // ── Start Run — template picker ─────────────────────────────────────

  function setupStartRun() {
    var btn = document.getElementById('start-run-btn');
    var overlay = document.getElementById('tpl-picker-overlay');
    var closeBtn = document.getElementById('tpl-picker-close');
    var body = document.getElementById('tpl-picker-body');
    if (!btn || !overlay) return;

    btn.addEventListener('click', function () {
      overlay.classList.remove('hidden');
      renderPicker(body);
    });

    closeBtn.addEventListener('click', function () { overlay.classList.add('hidden'); });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  }

  function renderPicker(body) {
    if (!templates.length) {
      body.innerHTML = '<div class="fleet-empty">No templates found</div>';
      return;
    }
    var html = '<div class="tpl-picker-list">';
    templates.forEach(function (t) {
      var tid = t.id || t.name;
      html += '<a class="tpl-picker-item" href="/experiments/' + encodeURIComponent(tid) + '/run">';
      html += '<div class="tpl-picker-name">' + L.esc(t.name || tid) + '</div>';
      if (t.description) html += '<div class="tpl-picker-desc">' + L.esc(t.description).substring(0, 100) + '</div>';
      if (t.tags && t.tags.length) {
        html += '<div class="tpl-picker-tags">';
        t.tags.forEach(function (tag) { html += '<span class="pill">' + L.esc(tag) + '</span>'; });
        html += '</div>';
      }
      html += '</a>';
    });
    html += '</div>';
    body.innerHTML = html;
  }

  // ── Real-time updates ───────────────────────────────────────────────

  function listenForEvents() {
    if (typeof L.onExperimentEvent === 'function') {
      L.onExperimentEvent(function (evt) {
        if (evt.type === 'experiment_started' || evt.type === 'experiment_completed' ||
            evt.type === 'experiment_failed' || evt.type === 'experiment_cancelled') {
          loadData();
        }
      });
    }
    setInterval(function () { loadData(); }, 10000);
  }

  // ── Boot ────────────────────────────────────────────────────────────

  loadData();
  setupFilters();
  setupStartRun();
  listenForEvents();

  L.registerPageRenderer({
    renderFull: function () {},
    renderDirty: function () {},
    renderStats: function () {},
  });

})(window.LUCID);
