// fleet-experiments.js — Experiments templates list + recent runs
// Depends on: fleet-utils.js, fleet.js, fleet-toasts.js

(function (L) {
  'use strict';

  var templatesEl, runsEl;
  var templates = [];
  var runs = [];
  var activeFilter = 'all';
  var searchQuery = '';
  var runsLimit = 10;

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

  var GROUP_ORDER = ['setup', 'ros', 'rosbot', 'foraging', 'recording', 'diagnostic'];

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

    // Group by first tag
    var groups = {};
    filtered.forEach(function (t) {
      var key = (t.tags && t.tags.length) ? t.tags[0] : 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    // Sort group keys: predefined order first, then alphabetical, 'other' last
    var keys = Object.keys(groups).sort(function (a, b) {
      var ai = GROUP_ORDER.indexOf(a), bi = GROUP_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    function cardHtml(t) {
      var steps = (t.definition && t.definition.steps) || t.steps || [];
      var params = t.parameters_schema || t.parameters || {};
      var paramCount = Object.keys(params).length;
      var h = '<div class="exp-card-wrap">';
      h += '<a class="exp-card" href="/experiments/' + encodeURIComponent(t.id) + '">';
      h += '<div class="exp-card-header">';
      h += '<span class="exp-card-name">' + L.esc(t.name || t.id) + '</span>';
      if (t.version) h += '<span class="card-version">v' + L.esc(t.version) + '</span>';
      h += '</div>';
      if (t.description) h += '<div class="exp-card-desc">' + L.esc(t.description) + '</div>';
      h += '<div class="exp-card-meta">';
      h += '<span>' + steps.length + ' step' + (steps.length !== 1 ? 's' : '') + '</span>';
      if (paramCount) h += ' \u00B7 <span>' + paramCount + ' param' + (paramCount !== 1 ? 's' : '') + '</span>';
      h += '</div>';
      if (t.tags && t.tags.length) {
        h += '<div class="exp-card-tags">';
        t.tags.forEach(function (tag) { h += '<span class="pill">' + L.esc(tag) + '</span>'; });
        h += '</div>';
      }
      h += '</a>';
      h += '<div class="exp-card-actions">';
      h += '<button class="act act-quick exp-edit-btn" data-id="' + L.escAttr(t.id) + '">Edit</button>';
      h += '<button class="act act-quick act-danger exp-del-btn" data-id="' + L.escAttr(t.id) + '" data-name="' + L.escAttr(t.name || t.id) + '">Delete</button>';
      h += '</div>';
      h += '</div>';
      return h;
    }

    var html = '';
    keys.forEach(function (key) {
      var label = key.charAt(0).toUpperCase() + key.slice(1);
      html += '<div class="tier2-section">';
      html += '<div class="tier2-label">' + L.esc(label) + '</div>';
      html += '<div class="exp-grid">';
      groups[key].forEach(function (t) { html += cardHtml(t); });
      html += '</div>';
      html += '</div>';
    });

    templatesEl.innerHTML = html;

    // Wire Edit buttons
    templatesEl.querySelectorAll('.exp-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var id = btn.dataset.id;
        var tpl = templates.find(function (t) { return t.id === id; });
        if (tpl && window.TemplateEditor) {
          TemplateEditor.open(tpl, function () { loadData(); });
        }
      });
    });

    // Wire Delete buttons
    templatesEl.querySelectorAll('.exp-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var id   = btn.dataset.id;
        var name = btn.dataset.name;
        if (!confirm('Delete template \u201c' + name + '\u201d? This also deletes all its runs.')) return;
        L.apiFetch('/api/experiments/templates/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function (res) {
            if (!res.ok) throw new Error('Delete failed');
            L.toast({ message: 'Template deleted', type: 'success' });
            loadData();
          })
          .catch(function (e) {
            L.toast({ message: e.message, type: 'error' });
          });
      });
    });
  }

  function getFilteredRuns() {
    if (activeFilter === 'all') return runs;
    return runs.filter(function (r) { return r.status === activeFilter; });
  }

  function renderRecentRuns() {
    if (!runsEl) return;
    var filtered = getFilteredRuns();
    if (!filtered.length) { runsEl.innerHTML = ''; return; }

    var visible = filtered.slice(0, runsLimit);
    var html = '<div class="tier2-section">';
    html += '<div class="tier2-label">Recent Runs</div>';
    html += '<div class="exp-runs-list">';
    visible.forEach(function (r) {
      var statusCls = 'status-' + (r.status || 'unknown');
      html += '<a class="exp-run-row" href="/experiments/runs/' + encodeURIComponent(r.id) + '">';
      html += '<span class="status-badge ' + statusCls + '">' + L.esc(r.status || 'unknown') + '</span>';
      html += '<span class="exp-run-tpl">' + L.esc(r.template_id || '') + '</span>';
      if (r.started_at) html += '<span class="exp-run-ts" data-ts="' + L.escAttr(r.started_at) + '">' + L.fmtTs(r.started_at) + '</span>';
      html += '</a>';
    });
    html += '</div>';
    if (filtered.length > runsLimit) {
      html += '<button class="act act-quick exp-runs-more-btn" style="margin:0.5rem 0">Show more (' + (filtered.length - runsLimit) + ' remaining)</button>';
    }
    html += '</div>';

    runsEl.innerHTML = html;

    var moreBtn = runsEl.querySelector('.exp-runs-more-btn');
    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        runsLimit += 20;
        renderRecentRuns();
      });
    }
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

  var newTplBtn = document.getElementById('exp-new-tpl-btn');
  if (newTplBtn) {
    newTplBtn.addEventListener('click', function () {
      if (window.TemplateEditor) {
        TemplateEditor.open(null, function () { loadData(); });
      }
    });
  }

  // ── Filter pills ──────────────────────────────────────────────────

  document.querySelectorAll('.filter-pill').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-pill').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      runsLimit = 10;
      renderRecentRuns();
    });
  });

  // ── Boot ──────────────────────────────────────────────────────────

  loadData();

  // Register minimal renderer — experiments data comes from API, not WS
  L.registerPageRenderer({
    renderFull: function () { /* templates loaded via API, not agents */ },
    renderDirty: function () {},
    renderStats: function () {},
  });

})(window.LUCID);
