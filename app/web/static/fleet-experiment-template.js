// fleet-experiment-template.js — Template detail + run dialog
// Depends on: fleet-utils.js, fleet.js

(function (L) {
  'use strict';

  var templateId = L.templateId;
  if (!templateId) return;

  var headerEl, bodyEl;
  var template = null;
  var runs = [];

  // ── Load data ─────────────────────────────────────────────────────

  async function loadData() {
    try {
      var [tplRes, runsRes] = await Promise.all([
        L.apiFetch('/api/experiments/templates/' + encodeURIComponent(templateId)),
        L.apiFetch('/api/experiments/runs?template_id=' + encodeURIComponent(templateId)),
      ]);
      if (tplRes.ok) template = await tplRes.json();
      if (runsRes.ok) runs = await runsRes.json();
    } catch (e) {
      console.error('Failed to load template:', e);
    }
    renderDetail();
  }

  // ── Render ────────────────────────────────────────────────────────

  function renderDetail() {
    headerEl = headerEl || document.getElementById('exp-detail-header');
    bodyEl = bodyEl || document.getElementById('exp-detail-body');

    if (!template) {
      if (headerEl) headerEl.innerHTML = '<div class="fleet-empty">Template "' + L.esc(templateId) + '" not found</div>';
      return;
    }

    renderHeader();
    renderBody();
  }

  function renderHeader() {
    if (!headerEl) return;
    var html = '<div class="detail-header" style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">';
    html += '<h1 class="detail-name" style="flex:1;">' + L.esc(template.name || template.id) + '</h1>';
    if (template.version) html += '<span class="card-version">v' + L.esc(template.version) + '</span>';
    html += '<button class="act act-quick" id="tpl-edit-btn">Edit</button>';
    html += '<button class="act act-quick act-danger" id="tpl-del-btn">Delete</button>';
    html += '</div>';
    if (template.description) html += '<div class="exp-description">' + L.esc(template.description) + '</div>';
    if (template.tags && template.tags.length) {
      html += '<div class="exp-card-tags">';
      template.tags.forEach(function (tag) { html += '<span class="pill">' + L.esc(tag) + '</span>'; });
      html += '</div>';
    }
    headerEl.innerHTML = html;

    var editBtn = document.getElementById('tpl-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        window.location.href = '/experiments/' + encodeURIComponent(templateId) + '/edit';
      });
    }

    var delBtn = document.getElementById('tpl-del-btn');
    if (delBtn) {
      delBtn.addEventListener('click', function () {
        var name = template.name || template.id;
        if (!confirm('Delete template \u201c' + name + '\u201d? This also deletes all its runs.')) return;
        L.apiFetch('/api/experiments/templates/' + encodeURIComponent(template.id), { method: 'DELETE' })
          .then(function (res) {
            if (!res.ok) throw new Error('Delete failed');
            L.toast({ message: 'Template deleted', type: 'success' });
            window.location.href = '/experiments';
          })
          .catch(function (e) {
            L.toast({ message: e.message, type: 'error' });
          });
      });
    }
  }

  function renderBody() {
    if (!bodyEl) return;
    var html = '';

    // Parameters
    var params = template.parameters_schema || template.parameters || {};
    var paramKeys = Object.keys(params);
    if (paramKeys.length) {
      html += '<div class="tier2-section">';
      html += '<div class="tier2-label">Parameters</div>';
      html += '<div class="exp-params-grid">';
      paramKeys.forEach(function (key) {
        var p = params[key];
        html += '<div class="exp-param">';
        html += '<span class="exp-param-name">' + L.esc(key) + '</span>';
        html += '<span class="exp-param-type">' + L.esc(p.type || 'string') + '</span>';
        if (p.required) html += '<span class="exp-param-req">required</span>';
        if (p.default !== undefined) html += '<span class="exp-param-default">default: ' + L.esc(String(p.default)) + '</span>';
        if (p.description) html += '<div class="exp-param-desc">' + L.esc(p.description) + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    }

    // Steps timeline
    var steps = (template.definition && template.definition.steps) || template.steps || [];
    if (steps.length) {
      html += '<div class="tier2-section">';
      html += '<div class="tier2-label">Steps</div>';
      html += '<div class="exp-steps-timeline">';
      html += renderSteps(steps, 0);
      html += '</div></div>';
    }

    // Run experiment button — navigates to the run configurator
    html += '<div class="tier2-section">';
    html += '<a class="act act-primary" href="/experiments/' + encodeURIComponent(templateId) + '/run" id="run-experiment-btn">Configure &amp; Run</a>';
    html += '</div>';

    // Run history
    if (runs.length) {
      html += '<div class="tier2-section">';
      html += '<div class="tier2-label">Run History</div>';
      html += '<div class="exp-runs-list">';
      runs.forEach(function (r) {
        var statusCls = 'status-' + (r.status || 'unknown');
        html += '<a class="exp-run-row" href="/experiments/runs/' + encodeURIComponent(r.id) + '">';
        html += '<span class="status-badge ' + statusCls + '">' + L.esc(r.status || 'unknown') + '</span>';
        html += '<span class="exp-run-id">' + L.esc(r.id.substring(0, 8)) + '</span>';
        if (r.started_at) html += '<span class="exp-run-ts" data-ts="' + L.escAttr(r.started_at) + '">' + L.fmtTs(r.started_at) + '</span>';
        html += '</a>';
      });
      html += '</div></div>';
    }

    bodyEl.innerHTML = html;
  }

  function renderSteps(steps, depth) {
    var html = '';
    steps.forEach(function (step, idx) {
      var indent = 'padding-left:' + (depth * 1.5) + 'rem';
      html += '<div class="exp-step" style="' + indent + '">';
      html += '<div class="exp-step-marker">' + (idx + 1) + '</div>';
      html += '<div class="exp-step-content">';
      html += '<span class="exp-step-name">' + L.esc(step.name || 'Step ' + (idx + 1)) + '</span>';
      html += '<span class="exp-step-type pill">' + L.esc(step.type || 'unknown') + '</span>';

      if (step.type === 'command') {
        html += '<span class="exp-step-detail">';
        if (step.agent_id) html += L.esc(step.agent_id);
        if (step.component_id) html += '/' + L.esc(step.component_id);
        html += ' \u2192 ' + L.esc(step.action || '');
        html += '</span>';
      } else if (step.type === 'delay') {
        html += '<span class="exp-step-detail">' + L.esc(String(step.duration_s || 0)) + 's</span>';
      } else if (step.type === 'approval') {
        html += '<span class="exp-step-detail">' + L.esc(step.message || 'Approval required') + '</span>';
      } else if (step.type === 'wait_for_condition') {
        html += '<span class="exp-step-detail">';
        if (step.condition) html += L.esc(step.condition.field || '') + ' ' + L.esc(Object.keys(step.condition).filter(function(k){return k!=='field';})[0] || '');
        html += '</span>';
      }

      html += '</div></div>';

      // Parallel sub-steps
      if (step.type === 'parallel' && step.steps) {
        html += '<div class="exp-parallel-group">';
        html += '<div class="exp-parallel-label" style="padding-left:' + ((depth + 1) * 1.5) + 'rem">\u2502 parallel</div>';
        html += renderSteps(step.steps, depth + 1);
        html += '</div>';
      }
    });
    return html;
  }


  // ── Boot ──────────────────────────────────────────────────────────

  loadData();

  L.registerPageRenderer({
    renderFull: function () {},
    renderDirty: function () {},
    renderStats: function () {},
  });

})(window.LUCID);
