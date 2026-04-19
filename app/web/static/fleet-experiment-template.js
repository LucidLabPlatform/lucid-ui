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
    if (editBtn && window.TemplateEditor) {
      editBtn.addEventListener('click', function () {
        TemplateEditor.open(template, function () { loadData(); });
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

    // Run experiment button
    html += '<div class="tier2-section">';
    html += '<button class="act act-primary" id="run-experiment-btn">Run Experiment</button>';
    html += '</div>';

    // Run dialog (hidden)
    html += '<div class="exp-run-dialog hidden" id="exp-run-dialog">';
    html += '<div class="tier2-label">Run Parameters</div>';
    html += '<div class="exp-run-form" id="exp-run-form"></div>';
    html += '<div class="exp-run-actions">';
    html += '<button class="act act-primary" id="exp-start-btn">Start</button>';
    html += '<button class="act" id="exp-cancel-dialog-btn">Cancel</button>';
    html += '</div></div>';

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
    setupRunDialog();
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

  // ── Run dialog ────────────────────────────────────────────────────

  function setupRunDialog() {
    var runBtn = document.getElementById('run-experiment-btn');
    var dialog = document.getElementById('exp-run-dialog');
    var startBtn = document.getElementById('exp-start-btn');
    var cancelBtn = document.getElementById('exp-cancel-dialog-btn');
    var formEl = document.getElementById('exp-run-form');

    if (!runBtn || !dialog) return;

    runBtn.addEventListener('click', function () {
      dialog.classList.remove('hidden');
      buildParamForm(formEl);
    });

    if (cancelBtn) cancelBtn.addEventListener('click', function () { dialog.classList.add('hidden'); });

    if (startBtn) startBtn.addEventListener('click', function () {
      var params = collectParams(formEl);
      startBtn.disabled = true;
      startBtn.textContent = 'Starting\u2026';

      L.apiFetch('/api/experiments/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId, params: params }),
      }).then(function (res) {
        if (res.ok) return res.json();
        throw new Error('Failed to start experiment');
      }).then(function (data) {
        L.toast({ message: 'Experiment started', type: 'success' });
        window.location.href = '/experiments/runs/' + encodeURIComponent(data.run_id || data.id);
      }).catch(function (err) {
        L.toast({ message: err.message, type: 'error' });
        startBtn.disabled = false;
        startBtn.textContent = 'Start';
      });
    });
  }

  function buildParamForm(formEl) {
    if (!formEl) return;
    var params = template.parameters_schema || template.parameters || {};
    var keys = Object.keys(params);

    if (!keys.length) {
      formEl.innerHTML = '<div class="comp-empty">No parameters needed</div>';
      return;
    }

    var html = '';
    keys.forEach(function (key) {
      var p = params[key];
      var defaultVal = p.default !== undefined ? String(p.default) : '';
      html += '<div class="exp-form-field">';
      html += '<label class="exp-form-label">' + L.esc(key);
      if (p.required) html += ' <span class="exp-param-req">*</span>';
      html += '</label>';

      if (p.type === 'boolean' || p.type === 'bool') {
        html += '<input type="checkbox" class="exp-form-input" data-param="' + L.escAttr(key) + '" data-type="bool"' + (defaultVal === 'true' ? ' checked' : '') + '>';
      } else if (p.enum) {
        html += '<select class="exp-form-input" data-param="' + L.escAttr(key) + '">';
        p.enum.forEach(function (opt) {
          html += '<option value="' + L.escAttr(String(opt)) + '"' + (String(opt) === defaultVal ? ' selected' : '') + '>' + L.esc(String(opt)) + '</option>';
        });
        html += '</select>';
      } else {
        var inputType = (p.type === 'integer' || p.type === 'float' || p.type === 'number') ? 'number' : 'text';
        html += '<input type="' + inputType + '" class="exp-form-input" data-param="' + L.escAttr(key) + '" value="' + L.escAttr(defaultVal) + '">';
      }

      if (p.description) html += '<div class="exp-form-help">' + L.esc(p.description) + '</div>';
      html += '</div>';
    });

    formEl.innerHTML = html;
  }

  function collectParams(formEl) {
    if (!formEl) return {};
    var params = {};
    var inputs = formEl.querySelectorAll('[data-param]');
    inputs.forEach(function (inp) {
      var key = inp.dataset.param;
      if (inp.type === 'checkbox') params[key] = inp.checked;
      else if (inp.type === 'number') params[key] = inp.value ? Number(inp.value) : null;
      else params[key] = inp.value;
    });
    return params;
  }

  // ── Boot ──────────────────────────────────────────────────────────

  loadData();

  L.registerPageRenderer({
    renderFull: function () {},
    renderDirty: function () {},
    renderStats: function () {},
  });

})(window.LUCID);
