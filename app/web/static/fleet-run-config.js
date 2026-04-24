// fleet-run-config.js — Run configurator: horizontal graph + detail panel + persistence
// Depends on: fleet-utils.js, fleet.js

(function (L) {
  'use strict';

  var templateId = L.templateId;
  if (!templateId) return;

  var template = null;
  var params = {};
  var selectedStep = null;
  var expandedSubs = {};        // { stepName: true } — which template nodes are expanded
  var STORAGE_KEY = 'lucid_run_config_' + templateId;

  var TYPE_COLOR = {
    command: '#3b82f6', delay: '#6b7280', parallel: '#8b5cf6',
    topic_link: '#14b8a6', approval: '#f59e0b',
    wait_for_condition: '#eab308', template: '#10b981'
  };

  // ── Load ────────────────────────────────────────────────────────────

  async function init() {
    try {
      var res = await L.apiFetch('/api/experiments/templates/' + encodeURIComponent(templateId) + '/resolve');
      if (!res.ok) throw new Error('Failed to load template');
      template = await res.json();
    } catch (e) {
      document.getElementById('rc-detail-body').textContent = 'Error: ' + e.message;
      return;
    }

    var schema = _getSchema();
    var defaults = {};
    Object.keys(schema).forEach(function (k) {
      var s = schema[k];
      if (s.default !== undefined && s.default !== null) defaults[k] = s.default;
    });

    var saved = _loadConfig();
    params = Object.assign({}, defaults, saved.params || {});
    expandedSubs = saved.expanded || {};

    renderAll();
    setupEvents();
  }

  function _getSchema() {
    return template.parameters_schema || (template.definition || {}).parameters || {};
  }

  function _getMainSteps() {
    var def = template.definition || template;
    return def.steps || [];
  }

  // ── Persistence ─────────────────────────────────────────────────────

  function _loadConfig() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function _saveConfig() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ params: params, expanded: expandedSubs }));
  }

  // ── Render ──────────────────────────────────────────────────────────

  function renderAll() {
    renderGraph();
    renderDetailPanel();
  }

  // ── Vertical graph — top to bottom, children indented right ─────────

  var NW = 240, NH = 44, VSTRIDE = 64, INDENT = 36;

  function _stepIsDisabled(step) {
    if (!step.when) return false;
    var m = step.when.match(/^\$\{(.+)\}$/);
    if (m) {
      var v = params[m[1]];
      if (v === false || v === 'false' || v === '' || v === undefined) return true;
    }
    return false;
  }

  function _getExpandChildren(step) {
    if (step.type === 'template' && step.resolved_steps) return step.resolved_steps;
    if (step.type === 'parallel' && step.steps) return step.steps;
    return null;
  }

  function renderGraph() {
    var container = document.getElementById('rc-graph-main-body');
    if (!container) return;

    var steps = _getMainSteps();
    var nodes = [], edges = [];

    // Recursive layout: place steps top-to-bottom, indent children
    function layoutSteps(stepList, baseX, y, parentName) {
      var prevId = null;

      for (var i = 0; i < stepList.length; i++) {
        var step = stepList[i];
        var nid = (parentName || '') + '_' + (step.name || i);
        var disabled = _stepIsDisabled(step);
        var isExpanded = expandedSubs[step.name];
        var children = _getExpandChildren(step);

        nodes.push({
          id: nid, step: step, x: baseX, y: y, w: NW, h: NH,
          disabled: disabled, parentName: parentName || null
        });

        if (prevId) edges.push({ from: prevId, to: nid });
        prevId = nid;
        y += VSTRIDE;

        // If expanded, lay out children indented
        if (isExpanded && children) {
          var childResult = layoutSteps(children, baseX + INDENT, y, step.name);
          y = childResult.y;
          // Connect last child back to the main flow via a merge
          if (childResult.lastId) {
            prevId = childResult.lastId;
          }
        }
      }

      return { y: y, lastId: prevId };
    }

    var result = layoutSteps(steps, 30, 20, null);
    var maxY = Math.max(result.y + 10, 120);

    // Compute maxX from nodes
    var maxX = 300;
    nodes.forEach(function (n) { maxX = Math.max(maxX, n.x + n.w + 30); });

    // Build SVG
    var nodeMap = {};
    nodes.forEach(function (n) { nodeMap[n.id] = n; });

    var svgParts = [];
    svgParts.push('<defs><marker id="arr" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0, 7 2.5, 0 5" fill="#374151"/></marker></defs>');

    // Edges — vertical bezier curves
    edges.forEach(function (e) {
      var from = nodeMap[e.from], to = nodeMap[e.to];
      if (!from || !to) return;
      var x1 = from.x + from.w / 2, y1 = from.y + from.h;
      var x2 = to.x + to.w / 2, y2 = to.y;
      var cy = y1 + (y2 - y1) * 0.5;
      svgParts.push('<path d="M' + x1 + ',' + y1 + ' C' + x1 + ',' + cy + ' ' + x2 + ',' + cy + ' ' + x2 + ',' + y2 + '" stroke="#374151" stroke-width="1.5" fill="none" marker-end="url(#arr)"/>');
    });

    // Nodes
    nodes.forEach(function (n) {
      var col = TYPE_COLOR[n.step.type] || '#4b5563';
      var lbl = (n.step.name || '').slice(0, 30);
      var opacity = n.disabled ? '0.35' : '1';
      var isSelected = selectedStep && selectedStep.name === n.step.name;
      var isExpanded = expandedSubs[n.step.name];
      var strokeW = isSelected ? '2.5' : '1.5';
      var strokeCol = isSelected ? '#e2e8f0' : col;
      if (isExpanded) { strokeCol = '#10b981'; strokeW = '2.5'; }

      var children = _getExpandChildren(n.step);
      var hasChildren = !!children;

      var g = '<g class="rc-node" data-step="' + _escAttr(n.step.name || '') + '"';
      if (n.parentName) g += ' data-parent="' + _escAttr(n.parentName) + '"';
      g += ' style="cursor:pointer;opacity:' + opacity + '">';
      g += '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" fill="' + col + '1a" stroke="' + strokeCol + '" stroke-width="' + strokeW + '"/>';
      g += '<text x="' + (n.x + 10) + '" y="' + (n.y + 18) + '" fill="#e2e8f0" font-size="12" font-family="system-ui,sans-serif" font-weight="500">' + _esc(lbl) + '</text>';
      g += '<text x="' + (n.x + 10) + '" y="' + (n.y + 34) + '" fill="' + col + '" font-size="9" font-family="monospace">' + _esc(n.step.type) + '</text>';

      // Expand/collapse icon
      if (hasChildren) {
        var ix = n.x + n.w - 22, iy = n.y + n.h / 2;
        g += '<text x="' + ix + '" y="' + (iy + 4) + '" fill="#e2e8f0" font-size="11">' + (isExpanded ? '\u25B2' : '\u25BC') + '</text>';
      }

      // Strikethrough for disabled
      if (n.disabled) {
        g += '<line x1="' + (n.x + 8) + '" y1="' + (n.y + 18) + '" x2="' + (n.x + 8 + Math.min(lbl.length * 7, n.w - 40)) + '" y2="' + (n.y + 18) + '" stroke="#94a3b8" stroke-width="1"/>';
      }

      g += '</g>';
      svgParts.push(g);
    });

    // Render SVG
    var svg = document.getElementById('rc-svg-main');
    if (!svg) {
      container.innerHTML = '<svg id="rc-svg-main" xmlns="http://www.w3.org/2000/svg"></svg>';
      svg = document.getElementById('rc-svg-main');
    }
    svg.setAttribute('viewBox', '0 0 ' + maxX + ' ' + maxY);
    svg.setAttribute('width', maxX);
    svg.setAttribute('height', maxY);
    svg.innerHTML = svgParts.join('');

    // Click handlers
    var nodeEls = svg.querySelectorAll('.rc-node');
    for (var ni = 0; ni < nodeEls.length; ni++) {
      (function (el) {
        el.addEventListener('click', function () {
          var stepName = el.getAttribute('data-step');
          var parentName = el.getAttribute('data-parent');
          var step;

          if (parentName) {
            var parent = _findStep(_getMainSteps(), parentName);
            var parentChildren = _getExpandChildren(parent);
            if (parentChildren) step = _findStep(parentChildren, stepName);
          } else {
            step = _findStep(_getMainSteps(), stepName);
          }
          if (!step) return;

          // Toggle expand for expandable nodes
          var canExpand = !!_getExpandChildren(step);
          if (canExpand) {
            if (expandedSubs[step.name]) delete expandedSubs[step.name];
            else expandedSubs[step.name] = true;
            _saveConfig();
          }

          selectedStep = step;
          selectedStep._parentName = parentName || null;
          renderAll();
        });
      })(nodeEls[ni]);
    }
  }

  function _findStep(steps, name) {
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].name === name) return steps[i];
      if (steps[i].steps) {
        var found = _findStep(steps[i].steps, name);
        if (found) return found;
      }
    }
    return null;
  }

  // ── Detail panel ────────────────────────────────────────────────────

  function renderDetailPanel() {
    var body = document.getElementById('rc-detail-body');
    if (!body) return;

    if (selectedStep) {
      body.innerHTML = _renderStepDetail(selectedStep);
    } else {
      body.innerHTML = _renderParamsForm();
    }

    _attachDetailEvents(body);
  }

  function _renderParamsForm() {
    var schema = _getSchema();
    var keys = Object.keys(schema);
    if (!keys.length) return '<div class="rc-empty">No parameters</div>';

    var bools = [], others = [];
    keys.forEach(function (k) {
      var s = schema[k];
      if (s.type === 'boolean' || s.type === 'bool') bools.push(k);
      else others.push(k);
    });

    var html = '';

    if (bools.length) {
      html += '<div class="rc-section-label">Toggles</div>';
      bools.forEach(function (k) {
        var s = schema[k];
        var checked = params[k] === true || params[k] === 'true';
        html += '<div class="rc-toggle-row">';
        html += '<label class="rc-toggle-label">';
        html += '<input type="checkbox" class="rc-toggle-input" data-param="' + _escAttr(k) + '"' + (checked ? ' checked' : '') + '>';
        html += '<span class="rc-toggle-switch"></span>';
        html += '<span class="rc-toggle-text">' + _esc(k) + '</span>';
        html += '</label>';
        if (s.description) html += '<div class="rc-toggle-desc">' + _esc(s.description) + '</div>';
        html += '</div>';
      });
    }

    if (others.length) {
      html += '<div class="rc-section-label">Parameters</div>';
      others.forEach(function (k) {
        var s = schema[k];
        var val = params[k] !== undefined ? String(params[k]) : '';
        html += '<div class="rc-field">';
        html += '<label class="rc-field-label">' + _esc(k);
        if (s.required) html += ' <span class="rc-req">*</span>';
        html += '</label>';
        var inputType = (s.type === 'integer' || s.type === 'float' || s.type === 'number') ? 'number' : 'text';
        html += '<input type="' + inputType + '" class="rc-input" data-param="' + _escAttr(k) + '" value="' + _escAttr(val) + '"';
        if (inputType === 'number') html += ' step="any"';
        html += '>';
        if (s.description) html += '<div class="rc-field-desc">' + _esc(s.description) + '</div>';
        html += '</div>';
      });
    }

    return html;
  }

  function _renderStepDetail(step) {
    var html = '';
    html += '<div class="rc-step-header">' + _esc(step.name || 'Unnamed') + '</div>';
    html += '<div class="rc-step-type"><span class="pill" style="background:' + (TYPE_COLOR[step.type] || '#4b5563') + '22;color:' + (TYPE_COLOR[step.type] || '#4b5563') + ';border:1px solid ' + (TYPE_COLOR[step.type] || '#4b5563') + '55">' + _esc(step.type) + '</span></div>';

    // Enable/disable toggle if step has a when guard
    if (step.when) {
      var m = step.when.match(/^\$\{(.+)\}$/);
      if (m) {
        var pk = m[1];
        var checked = params[pk] === true || params[pk] === 'true';
        html += '<div class="rc-toggle-row rc-when-toggle">';
        html += '<label class="rc-toggle-label">';
        html += '<input type="checkbox" class="rc-toggle-input" data-param="' + _escAttr(pk) + '"' + (checked ? ' checked' : '') + '>';
        html += '<span class="rc-toggle-switch"></span>';
        html += '<span class="rc-toggle-text">' + (checked ? 'Enabled' : 'Disabled') + '</span>';
        html += '</label>';
        html += '</div>';
      }
    }

    // Step info
    if (step.type === 'command') {
      html += '<div class="rc-info-row"><span class="rc-info-k">Target:</span> <span class="rc-info-v">';
      if (step.agent_id) html += _esc(step.agent_id);
      if (step.component_id) html += '/' + _esc(step.component_id);
      html += ' &rarr; ' + _esc(step.action || '');
      html += '</span></div>';
      if (step.timeout_s) html += '<div class="rc-info-row"><span class="rc-info-k">Timeout:</span> <span class="rc-info-v">' + step.timeout_s + 's</span></div>';
    } else if (step.type === 'delay') {
      html += '<div class="rc-info-row"><span class="rc-info-k">Duration:</span> <span class="rc-info-v">' + (step.duration_s || 0) + 's</span></div>';
    } else if (step.type === 'template') {
      html += '<div class="rc-info-row"><span class="rc-info-k">Template:</span> <span class="rc-info-v">' + _esc(step.template_id || '') + '</span></div>';
      if (step.resolved_steps) {
        html += '<div class="rc-info-row"><span class="rc-info-k">Steps:</span> <span class="rc-info-v">' + step.resolved_steps.length + '</span></div>';
        var isExp = expandedSubs[step.name];
        html += '<button class="act act-quick rc-expand-btn" data-step="' + _escAttr(step.name) + '">' + (isExp ? 'Collapse' : 'Expand') + '</button>';
      }
    } else if (step.type === 'parallel') {
      if (step.steps) {
        html += '<div class="rc-info-row"><span class="rc-info-k">Sub-steps:</span> <span class="rc-info-v">' + step.steps.length + '</span></div>';
        var isExpP = expandedSubs[step.name];
        html += '<button class="act act-quick rc-expand-btn" data-step="' + _escAttr(step.name) + '">' + (isExpP ? 'Collapse' : 'Expand') + '</button>';
      }
    } else if (step.type === 'wait_for_condition') {
      html += '<div class="rc-info-row"><span class="rc-info-k">Metric:</span> <span class="rc-info-v">' + _esc(step.telemetry_metric || '') + '</span></div>';
      if (step.condition) html += '<div class="rc-info-row"><span class="rc-info-k">Condition:</span> <span class="rc-info-v rc-mono">' + _esc(JSON.stringify(step.condition)) + '</span></div>';
    } else if (step.type === 'approval') {
      html += '<div class="rc-info-row"><span class="rc-info-k">Message:</span> <span class="rc-info-v">' + _esc(step.message || '') + '</span></div>';
    } else if (step.type === 'topic_link') {
      html += '<div class="rc-info-row"><span class="rc-info-k">Op:</span> <span class="rc-info-v">' + _esc(step.operation || 'create') + '</span></div>';
      html += '<div class="rc-info-row"><span class="rc-info-k">Src:</span> <span class="rc-info-v rc-mono">' + _esc(step.source_topic || '') + '</span></div>';
      html += '<div class="rc-info-row"><span class="rc-info-k">Dst:</span> <span class="rc-info-v rc-mono">' + _esc(step.target_topic || '') + '</span></div>';
    }

    html += '<div class="rc-info-row"><span class="rc-info-k">On failure:</span> <span class="rc-info-v">' + _esc(step.on_failure || 'abort') + '</span></div>';

    // Editable params — for command steps (params) and template steps (template_params)
    var stepParams = step.params || step.template_params || {};
    var paramKeys = Object.keys(stepParams);
    if (paramKeys.length) {
      html += '<div class="rc-section-label">Step Parameters</div>';
      paramKeys.forEach(function (k) {
        var v = stepParams[k];
        var displayVal = typeof v === 'object' ? JSON.stringify(v) : String(v != null ? v : '');
        // Check if value references a template param (${...})
        var isRef = typeof v === 'string' && v.match(/^\$\{.+\}$/);
        html += '<div class="rc-field">';
        html += '<label class="rc-field-label">' + _esc(k) + '</label>';
        if (typeof v === 'object') {
          html += '<pre class="rc-param-json">' + _esc(JSON.stringify(v, null, 2)) + '</pre>';
        } else {
          html += '<input type="text" class="rc-input" data-step-param="' + _escAttr(k) + '" value="' + _escAttr(displayVal) + '"';
          if (isRef) html += ' title="References template parameter" style="color:var(--accent)"';
          html += '>';
        }
        html += '</div>';
      });
    }

    // Sub-template resolved params (editable)
    if (step.type === 'template' && step.resolved_parameters) {
      var rp = step.resolved_parameters;
      var rpKeys = Object.keys(rp);
      if (rpKeys.length) {
        html += '<div class="rc-section-label">Sub-template Defaults</div>';
        rpKeys.forEach(function (k) {
          var s = rp[k];
          var defVal = s.default !== undefined ? String(s.default) : '';
          html += '<div class="rc-field">';
          html += '<label class="rc-field-label">' + _esc(k) + '</label>';
          html += '<input type="text" class="rc-input rc-sub-param" data-sub-param="' + _escAttr(k) + '" value="' + _escAttr(defVal) + '" disabled title="Controlled by parent template params">';
          if (s.description) html += '<div class="rc-field-desc">' + _esc(s.description) + '</div>';
          html += '</div>';
        });
      }
    }

    html += '<div class="rc-back-link"><a href="#" id="rc-back-to-params">&larr; Back to parameters</a></div>';
    return html;
  }

  function _attachDetailEvents(body) {
    // Toggle inputs (template-level params)
    body.querySelectorAll('.rc-toggle-input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        params[inp.dataset.param] = inp.checked;
        _saveConfig();
        renderAll();
      });
    });

    // Text/number inputs (template-level params)
    body.querySelectorAll('.rc-input[data-param]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var k = inp.dataset.param;
        if (inp.type === 'number') params[k] = inp.value ? Number(inp.value) : '';
        else params[k] = inp.value;
        _saveConfig();
      });
    });

    // Step-level param edits — update the step object directly
    body.querySelectorAll('.rc-input[data-step-param]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        if (!selectedStep) return;
        var k = inp.dataset.stepParam;
        var target = selectedStep.params || selectedStep.template_params;
        if (target) target[k] = inp.value;
      });
    });

    // Expand button
    body.querySelectorAll('.rc-expand-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.dataset.step;
        if (expandedSubs[name]) delete expandedSubs[name];
        else expandedSubs[name] = true;
        _saveConfig();
        renderAll();
      });
    });

    // Back link
    var back = document.getElementById('rc-back-to-params');
    if (back) {
      back.addEventListener('click', function (e) {
        e.preventDefault();
        selectedStep = null;
        renderAll();
      });
    }
  }

  // ── Events ──────────────────────────────────────────────────────────

  function setupEvents() {
    var runBtn = document.getElementById('rc-run-btn');
    if (runBtn) {
      runBtn.addEventListener('click', function () {
        _saveConfig();
        runBtn.disabled = true;
        runBtn.textContent = 'Starting\u2026';

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
          runBtn.disabled = false;
          runBtn.textContent = 'Run Experiment';
        });
      });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  function _esc(s) { return L.esc ? L.esc(s) : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _escAttr(s) { return L.escAttr ? L.escAttr(s) : String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

  // ── Boot ────────────────────────────────────────────────────────────

  init();

  L.registerPageRenderer({
    renderFull: function () {},
    renderDirty: function () {},
    renderStats: function () {},
  });

})(window.LUCID);
