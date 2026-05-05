// fleet-template-edit.js — Full-page experiment template editor
// Depends on: fleet-utils.js, fleet.js, Sortable (loaded globally in base.html)

(function (L) {
  'use strict';

  var templateId = L.templateId;
  if (!templateId) return;

  var STORAGE_KEY = 'lucid_template_edit_' + templateId;

  var TYPE_COLOR = {
    command: '#3b82f6', delay: '#6b7280', parallel: '#8b5cf6',
    topic_link: '#14b8a6', approval: '#f59e0b',
    wait_for_condition: '#eab308', template: '#10b981'
  };

  var STEP_TYPES = [
    'command', 'delay', 'parallel', 'topic_link',
    'approval', 'wait_for_condition', 'template'
  ];

  var state = {
    template: null,
    savedSnapshot: '',
    dirty: false,
    expandedSubs: {},
    drawer: { kind: 'settings', step: null, parentChain: [], readOnly: false }
  };

  // ── Load ──────────────────────────────────────────────────────────

  async function init() {
    try {
      var res = await L.apiFetch('/api/experiments/templates/' + encodeURIComponent(templateId) + '/resolve');
      if (!res.ok) throw new Error('Failed to load template');
      state.template = await res.json();
    } catch (e) {
      var body = document.getElementById('te2-graph-body');
      if (body) body.textContent = 'Error: ' + e.message;
      return;
    }
    state.savedSnapshot = JSON.stringify(buildPayload());

    // Default expansion: every parallel and template (with resolved_steps) is expanded.
    var saved = _loadLocal();
    if (saved && saved.expandedSubs) {
      state.expandedSubs = saved.expandedSubs;
    } else {
      _walkAll(_getMainSteps(), function (s) {
        if (_getExpandChildren(s)) state.expandedSubs[s.name] = true;
      });
      _saveLocal();
    }

    renderAll();
    setupGlobalEvents();
  }

  function _loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function _saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ expandedSubs: state.expandedSubs }));
  }

  // ── Helpers (steps tree) ─────────────────────────────────────────

  function _getMainSteps() {
    var def = state.template.definition || state.template;
    if (!def.steps) def.steps = [];
    return def.steps;
  }
  function _getExpandChildren(step) {
    if (!step) return null;
    if (step.type === 'template' && step.resolved_steps) return step.resolved_steps;
    if (step.type === 'parallel' && step.steps) return step.steps;
    return null;
  }
  function _walkAll(steps, fn, parents) {
    parents = parents || [];
    for (var i = 0; i < steps.length; i++) {
      fn(steps[i], parents);
      var kids = _getExpandChildren(steps[i]);
      if (kids) _walkAll(kids, fn, parents.concat([steps[i]]));
    }
  }
  function _findStepWithChain(steps, name, chain) {
    chain = chain || [];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].name === name) return { step: steps[i], chain: chain.slice(), index: i, parentSteps: steps };
      var kids = _getExpandChildren(steps[i]);
      if (kids) {
        var r = _findStepWithChain(kids, name, chain.concat([steps[i]]));
        if (r) return r;
      }
    }
    return null;
  }
  function _isInsideTemplate(chain) {
    for (var i = 0; i < chain.length; i++) {
      if (chain[i].type === 'template') return true;
    }
    return false;
  }
  function _stepIsDisabled(step) {
    return false; // no `when` evaluation in editor; always show as enabled
  }

  // ── Render orchestration ─────────────────────────────────────────

  function renderAll() {
    renderHeader();
    renderGraph();
    renderSettingsDrawer();
    renderStepDrawer();
  }

  function renderHeader() {
    var t = state.template || {};
    var totalNodes = 0;
    _walkAll(_getMainSteps(), function () { totalNodes++; });
    var titleEl = document.getElementById('te2-graph-title');
    if (titleEl) {
      titleEl.innerHTML = 'Steps' +
        '<span class="te2-graph-meta">· ' + _esc(t.id || templateId) +
        ' v' + _esc(t.version || '') +
        ' · ' + totalNodes + ' nodes</span>';
    }
    var dot = document.getElementById('te2-dirty-dot');
    if (dot) dot.hidden = !state.dirty;
  }

  // ── Graph render (mirrors fleet-run-config.js with tighter geometry) ──

  var NW = 220, NH = 36, VSTRIDE = 46, INDENT = 28;

  function renderGraph() {
    var container = document.getElementById('te2-graph-body');
    if (!container) return;

    var steps = _getMainSteps();
    var nodes = [], edges = [];

    function layoutSteps(stepList, baseX, y, parents) {
      var prevId = null;
      for (var i = 0; i < stepList.length; i++) {
        var step = stepList[i];
        var nid = 'n' + nodes.length;
        var children = _getExpandChildren(step);
        var isExpanded = !!state.expandedSubs[step.name];
        nodes.push({
          id: nid, step: step, x: baseX, y: y,
          parents: parents.slice()
        });
        if (prevId) edges.push({ from: prevId, to: nid });
        prevId = nid;
        y += VSTRIDE;
        if (isExpanded && children) {
          var res = layoutSteps(children, baseX + INDENT, y, parents.concat([step]));
          y = res.y;
          if (res.lastId) prevId = res.lastId;
        }
      }
      return { y: y, lastId: prevId };
    }

    var result = layoutSteps(steps, 20, 14, []);
    var maxY = Math.max(result.y + 14, 120);
    var maxX = 280;
    nodes.forEach(function (n) { maxX = Math.max(maxX, n.x + NW + 20); });

    var nodeMap = {};
    nodes.forEach(function (n) { nodeMap[n.id] = n; });

    var parts = [];
    parts.push(
      '<defs><marker id="te2-arr" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto">' +
      '<polygon points="0 0, 6 2.5, 0 5" fill="#374151"/></marker></defs>'
    );

    edges.forEach(function (e) {
      var a = nodeMap[e.from], b = nodeMap[e.to];
      if (!a || !b) return;
      var x1 = a.x + NW / 2, y1 = a.y + NH;
      var x2 = b.x + NW / 2, y2 = b.y;
      var cy = y1 + (y2 - y1) * 0.5;
      parts.push(
        '<path d="M' + x1 + ',' + y1 + ' C' + x1 + ',' + cy + ' ' +
        x2 + ',' + cy + ' ' + x2 + ',' + y2 +
        '" stroke="#374151" stroke-width="1.2" fill="none" marker-end="url(#te2-arr)"/>'
      );
    });

    var selectedName = state.drawer.kind === 'step' && state.drawer.step
      ? state.drawer.step.name : null;

    nodes.forEach(function (n) {
      var step = n.step;
      var col = TYPE_COLOR[step.type] || '#4b5563';
      var name = (step.name || '').slice(0, 28);
      var expandable = !!_getExpandChildren(step);
      var isExpanded = !!state.expandedSubs[step.name];
      var isSelected = selectedName && selectedName === step.name;
      var stroke = isSelected ? '#e2e8f0' : (expandable ? '#10b981' : col);
      var sw = isSelected ? '2.2' : (expandable ? '1.8' : '1.2');
      var resolvedReadonly = _isInsideTemplate(n.parents);

      var g = '<g class="te2-node" data-name="' + _escAttr(step.name || '') + '"';
      if (resolvedReadonly) g += ' data-readonly="1"';
      g += '>';
      g += '<rect x="' + n.x + '" y="' + n.y + '" width="' + NW + '" height="' + NH +
           '" rx="6" fill="' + col + '1a" stroke="' + stroke + '" stroke-width="' + sw + '"/>';
      g += '<text x="' + (n.x + 9) + '" y="' + (n.y + 15) +
           '" fill="#e2e8f0" font-size="11" font-family="system-ui,sans-serif" font-weight="500">' +
           _esc(name) + '</text>';
      g += '<text x="' + (n.x + 9) + '" y="' + (n.y + 28) +
           '" fill="' + col + '" font-size="9" font-family="ui-monospace,monospace">' +
           _esc(step.type) + '</text>';
      if (expandable) {
        g += '<text x="' + (n.x + NW - 16) + '" y="' + (n.y + 22) +
             '" fill="#e2e8f0" font-size="10">' + (isExpanded ? '\u25B2' : '\u25BC') + '</text>';
      }
      if (resolvedReadonly) {
        g += '<text x="' + (n.x + NW - 36) + '" y="' + (n.y + 12) +
             '" fill="#f59e0b" font-size="8" font-family="ui-monospace,monospace">RO</text>';
      }
      g += '</g>';
      parts.push(g);
    });

    var svg = document.getElementById('te2-svg-main');
    if (!svg) {
      container.innerHTML = '<svg id="te2-svg-main" xmlns="http://www.w3.org/2000/svg"></svg>';
      svg = document.getElementById('te2-svg-main');
    }
    svg.setAttribute('viewBox', '0 0 ' + maxX + ' ' + maxY);
    svg.setAttribute('width', maxX);
    svg.setAttribute('height', maxY);
    svg.innerHTML = parts.join('');

    var nodeEls = svg.querySelectorAll('.te2-node');
    for (var i = 0; i < nodeEls.length; i++) {
      (function (el) {
        el.addEventListener('click', function () {
          var name = el.getAttribute('data-name');
          openStepDrawer(name);
        });
      })(nodeEls[i]);
    }
  }

  // ── Click handler ────────────────────────────────────────────────

  function openStepDrawer(name) {
    var found = _findStepWithChain(_getMainSteps(), name);
    if (!found) return;
    var step = found.step;

    // Toggle expand if expandable.
    if (_getExpandChildren(step)) {
      if (state.expandedSubs[step.name]) delete state.expandedSubs[step.name];
      else state.expandedSubs[step.name] = true;
      _saveLocal();
    }

    state.drawer = {
      kind: 'step',
      step: step,
      parentChain: found.chain,
      readOnly: _isInsideTemplate(found.chain)
    };
    renderAll();
  }

  function closeStepDrawer() {
    // Step drawer is always present, just shows placeholder when nothing selected.
    state.drawer = { kind: 'settings', step: null, parentChain: [], readOnly: false };
    renderAll();
  }

  // ── Drawer render: settings (always on) ──────────────────────────

  function renderSettingsDrawer() {
    var headerEl = document.getElementById('te2-settings-header');
    var bodyEl = document.getElementById('te2-settings-body');
    var footerEl = document.getElementById('te2-settings-footer');
    if (!headerEl || !bodyEl || !footerEl) return;

    headerEl.innerHTML =
      '<div class="te2-drawer-title"><span class="te2-drawer-title-name">Template settings</span></div>';
    bodyEl.innerHTML = _renderSettingsForm();
    footerEl.innerHTML =
      '<span class="te2-spacer"></span>' +
      '<button class="act act-quick" id="te2-settings-revert">Revert</button>' +
      '<button class="act act-primary" id="te2-settings-apply">Apply</button>';
    _attachSettingsEvents(bodyEl);

    var revert = document.getElementById('te2-settings-revert');
    if (revert) revert.addEventListener('click', function () {
      _settingsDraft = null;
      renderSettingsDrawer();
    });
    var apply = document.getElementById('te2-settings-apply');
    if (apply) apply.addEventListener('click', _applySettingsAndDirty);
  }

  function _applySettingsAndDirty() {
    _applySettings();
    setDirty();
    renderHeader();
    renderSettingsDrawer();
  }

  // ── Drawer render: step (always present, placeholder when none) ──

  function renderStepDrawer() {
    var drawer = document.getElementById('te2-step-drawer');
    var headerEl = document.getElementById('te2-step-header');
    var bodyEl = document.getElementById('te2-step-body');
    var footerEl = document.getElementById('te2-step-footer');
    if (!drawer || !headerEl || !bodyEl || !footerEl) return;

    if (state.drawer.kind !== 'step' || !state.drawer.step) {
      drawer.hidden = true;
      headerEl.innerHTML = '';
      bodyEl.innerHTML = '';
      footerEl.innerHTML = '';
      return;
    }
    drawer.hidden = false;

    var step = state.drawer.step;
    var typeCls = 't-' + step.type;
    var readOnlyMark = state.drawer.readOnly
      ? ' <span class="te2-pill" style="background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.4)">read-only</span>'
      : '';
    headerEl.innerHTML =
      '<div class="te2-drawer-title">' +
      '<span class="te2-drawer-title-name">' + _esc(step.name || '(unnamed)') + '</span>' +
      '<span class="te2-pill ' + _escAttr(typeCls) + '">' + _esc(step.type) + '</span>' +
      readOnlyMark +
      '</div>' +
      '<button class="te2-drawer-x" id="te2-step-close">&times;</button>';
    bodyEl.innerHTML = state.drawer.readOnly
      ? _renderReadOnlyStep(step)
      : _renderStepForm(step);
    footerEl.innerHTML = state.drawer.readOnly
      ? '<span class="te2-spacer"></span><button class="act act-quick" id="te2-step-close-2">Close</button>'
      : '<button class="act act-quick act-danger" id="te2-step-delete">Delete</button>' +
        '<span class="te2-spacer"></span>' +
        '<button class="act act-quick" id="te2-step-cancel">Cancel</button>' +
        '<button class="act act-primary" id="te2-step-apply">Apply</button>';
    if (!state.drawer.readOnly) _attachStepEvents(bodyEl);

    var x = document.getElementById('te2-step-close');
    if (x) x.addEventListener('click', closeStepDrawer);
    var x2 = document.getElementById('te2-step-close-2');
    if (x2) x2.addEventListener('click', closeStepDrawer);
    var cancel = document.getElementById('te2-step-cancel');
    if (cancel) cancel.addEventListener('click', closeStepDrawer);
    var apply = document.getElementById('te2-step-apply');
    if (apply) apply.addEventListener('click', _applyStepAndDirty);
    var del = document.getElementById('te2-step-delete');
    if (del) del.addEventListener('click', deleteCurrentStep);
  }

  function _applyStepAndDirty() {
    if (state.drawer.kind === 'step' && !state.drawer.readOnly) {
      _applyStepDraft();
      setDirty();
      closeStepDrawer();
    }
  }

  function _renderReadOnlyStep(step) {
    // Find owning template in parent chain
    var ownerTplId = '';
    for (var i = state.drawer.parentChain.length - 1; i >= 0; i--) {
      var p = state.drawer.parentChain[i];
      if (p.type === 'template') { ownerTplId = p.template_id || ''; break; }
    }
    var html = '<div class="te2-readonly-banner">' +
      'This step is part of template <code>' + _esc(ownerTplId) + '</code>.' +
      (ownerTplId
        ? ' <a href="/experiments/' + encodeURIComponent(ownerTplId) + '/edit">Open ' + _esc(ownerTplId) + ' editor &rarr;</a>'
        : '') +
      '</div>';
    html += _renderStepInfo(step);
    return html;
  }

  function _renderStepInfo(step) {
    // Read-only summary of fields for resolved steps.
    var html = '';
    function row(k, v) {
      return '<div class="te2-field"><label class="te2-field-label">' + _esc(k) +
        '</label><div style="font-size:0.78rem;font-family:var(--font-mono);color:var(--text);word-break:break-all">' +
        _esc(v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v))) + '</div></div>';
    }
    html += row('Name', step.name);
    html += row('Type', step.type);
    if (step.when) html += row('When', step.when);
    if (step.on_failure) html += row('On failure', step.on_failure);
    if (step.type === 'command') {
      html += row('Agent', step.agent_id);
      if (step.component_id) html += row('Component', step.component_id);
      html += row('Action', step.action);
      if (step.params) html += row('Params', step.params);
    } else if (step.type === 'delay') {
      html += row('Duration (s)', step.duration_s);
    } else if (step.type === 'topic_link') {
      html += row('Operation', step.operation);
      html += row('Source topic', step.source_topic);
      html += row('Target topic', step.target_topic);
    } else if (step.type === 'approval') {
      html += row('Message', step.message);
    } else if (step.type === 'wait_for_condition') {
      html += row('Metric', step.telemetry_metric);
      html += row('Condition', step.condition);
    } else if (step.type === 'template') {
      html += row('Template ID', step.template_id);
      if (step.template_params) html += row('Template params', step.template_params);
    }
    return html;
  }

  // ── Step form (per type) ─────────────────────────────────────────

  function _renderStepForm(step) {
    var html = '';
    html += '<div class="te2-section-label">General</div>';
    html += _row2(
      _field('Name', '<input class="te2-input" data-bind="name" value="' + _escAttr(step.name || '') + '">'),
      _field('On failure',
        '<select class="te2-input" data-bind="on_failure">' +
        _opt('abort', step.on_failure || 'abort') +
        _opt('continue', step.on_failure) +
        '</select>')
    );
    html += _field('When (guard)',
      '<input class="te2-input" data-bind="when" value="' + _escAttr(step.when || '') +
      '" placeholder="${param_name}">' +
      '<div class="te2-field-desc">Optional. e.g. <code>${enable_search}</code></div>');

    switch (step.type) {
      case 'command':
        html += '<div class="te2-section-label">Target</div>';
        html += _row2(
          _field('Agent ID', '<input class="te2-input" data-bind="agent_id" value="' + _escAttr(step.agent_id || '') + '">'),
          _field('Component ID', '<input class="te2-input" data-bind="component_id" value="' + _escAttr(step.component_id || '') + '">')
        );
        html += _field('Action', '<input class="te2-input" data-bind="action" value="' + _escAttr(step.action || '') + '">');
        html += '<div class="te2-section-label">Execution</div>';
        html += _row2(
          _field('Timeout (s)', '<input class="te2-input" type="number" step="any" data-bind="timeout_s" value="' + _escAttr(step.timeout_s != null ? step.timeout_s : '') + '">'),
          _field('Retries', '<input class="te2-input" type="number" data-bind="retries" value="' + _escAttr(step.retries != null ? step.retries : '') + '">')
        );
        html += '<div class="te2-section-label">Payload</div>';
        html += _jsonField('Params (JSON)', 'params', step.params || {});
        break;
      case 'delay':
        html += '<div class="te2-section-label">Delay</div>';
        html += _field('Duration (s)', '<input class="te2-input" type="number" step="any" data-bind="duration_s" value="' + _escAttr(step.duration_s != null ? step.duration_s : '') + '">');
        break;
      case 'parallel':
        html += '<div class="te2-section-label">Sub-steps (' + (step.steps || []).length + ')</div>';
        html += _renderSubStepList(step.steps || [], 'parallel');
        html += _renderAddSubButton(step);
        break;
      case 'template':
        html += '<div class="te2-section-label">Template</div>';
        html += _field('Template ID', '<input class="te2-input" data-bind="template_id" value="' + _escAttr(step.template_id || '') + '">');
        html += _kvEditor('Template parameters', 'template_params', step.template_params || {});
        if (step.resolved_steps) {
          html += '<div class="te2-section-label">Resolved sub-steps (' + step.resolved_steps.length + ')</div>';
          html += '<div class="te2-readonly-banner" style="margin-bottom:0">Resolved steps are read-only here. Edit them in the source template.</div>';
        }
        break;
      case 'topic_link':
        html += '<div class="te2-section-label">Topic link</div>';
        html += _row2(
          _field('Operation',
            '<select class="te2-input" data-bind="operation">' +
            _opt('create', step.operation || 'create') +
            _opt('activate', step.operation) +
            _opt('deactivate', step.operation) +
            _opt('delete', step.operation) +
            '</select>'),
          _field('QoS',
            '<select class="te2-input" data-bind="qos">' +
            _opt('0', step.qos != null ? String(step.qos) : '0') +
            _opt('1', step.qos != null ? String(step.qos) : '') +
            _opt('2', step.qos != null ? String(step.qos) : '') +
            '</select>')
        );
        html += _field('Source topic', '<input class="te2-input" data-bind="source_topic" value="' + _escAttr(step.source_topic || '') + '">');
        html += _field('Target topic', '<input class="te2-input" data-bind="target_topic" value="' + _escAttr(step.target_topic || '') + '">');
        html += _field('Select clause', '<input class="te2-input" data-bind="select_clause" value="' + _escAttr(step.select_clause || '*') + '">');
        html += _field('Payload template', '<textarea class="te2-textarea" data-bind="payload_template">' + _esc(step.payload_template || '') + '</textarea>');
        break;
      case 'approval':
        html += '<div class="te2-section-label">Approval</div>';
        html += _field('Message', '<textarea class="te2-textarea" data-bind="message">' + _esc(step.message || '') + '</textarea>');
        break;
      case 'wait_for_condition':
        html += '<div class="te2-section-label">Wait for condition</div>';
        html += _row2(
          _field('Telemetry metric', '<input class="te2-input" data-bind="telemetry_metric" value="' + _escAttr(step.telemetry_metric || '') + '">'),
          _field('Timeout (s)', '<input class="te2-input" type="number" step="any" data-bind="timeout_s" value="' + _escAttr(step.timeout_s != null ? step.timeout_s : '') + '">')
        );
        html += _jsonField('Condition (JSON)', 'condition', step.condition || {});
        break;
    }
    return html;
  }

  function _row2(a, b) {
    return '<div class="te2-form-row">' + a + b + '</div>';
  }

  function _renderSubStepList(subs, parentType) {
    var html = '<div class="te2-sub-list" id="te2-sub-list">';
    if (!subs.length) html += '<div class="te2-sub-row" style="color:var(--muted);justify-content:center">No sub-steps</div>';
    subs.forEach(function (s, idx) {
      html += '<div class="te2-sub-row" data-idx="' + idx + '">';
      html += '<span class="te2-drag-handle">\u22EE\u22EE</span>';
      html += '<span class="te2-sub-name">' + _esc(s.name || '?') + '</span>';
      html += '<span class="te2-pill t-' + _escAttr(s.type) + '">' + _esc(s.type) + '</span>';
      html += '<button class="te2-sub-del" data-sub-del="' + idx + '" title="Remove">&times;</button>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function _renderAddSubButton(step) {
    return '<button class="te2-add-sub" id="te2-add-substep">+ Add sub-step</button>';
  }

  function _kvEditor(label, bindKey, kv) {
    var keys = Object.keys(kv);
    var html = '<div class="te2-section-label">' + _esc(label) + '</div>';
    html += '<div class="te2-pschema-list" data-kv-bind="' + _escAttr(bindKey) + '">';
    if (!keys.length) {
      html += '<div style="color:var(--muted);font-size:0.75rem">(none)</div>';
    } else {
      keys.forEach(function (k) {
        var v = kv[k];
        var dv = typeof v === 'object' ? JSON.stringify(v) : String(v == null ? '' : v);
        html += '<div class="te2-pschema-row">' +
          '<input class="te2-input" data-kv-k value="' + _escAttr(k) + '" placeholder="key">' +
          '<input class="te2-input" data-kv-v value="' + _escAttr(dv) + '" placeholder="value" style="grid-column:span 2">' +
          '<button class="te2-pschema-del" data-kv-del title="Remove">&times;</button>' +
          '</div>';
      });
    }
    html += '</div>';
    html += '<button class="act act-quick" data-kv-add="' + _escAttr(bindKey) + '">+ Add</button>';
    return html;
  }

  function _jsonField(label, bindKey, value) {
    var raw = JSON.stringify(value, null, 2);
    return '<div class="te2-field">' +
      '<label class="te2-field-label">' + _esc(label) + ' <span class="te2-json-ok" data-json-status="' + _escAttr(bindKey) + '">\u2713 valid</span></label>' +
      '<textarea class="te2-textarea" data-json-bind="' + _escAttr(bindKey) + '">' + _esc(raw) + '</textarea>' +
      '<div class="te2-field-err" data-json-err="' + _escAttr(bindKey) + '"></div>' +
      '</div>';
  }

  function _field(label, control) {
    return '<div class="te2-field"><label class="te2-field-label">' + _esc(label) + '</label>' + control + '</div>';
  }
  function _opt(value, current) {
    var sel = String(current) === String(value) ? ' selected' : '';
    return '<option value="' + _escAttr(value) + '"' + sel + '>' + _esc(value) + '</option>';
  }

  // ── Step-form events ─────────────────────────────────────────────

  // Working copy of fields, reflected on Apply
  var _formDraft = {};

  function _attachStepEvents(body) {
    _formDraft = {};
    var step = state.drawer.step;

    // Capture all bound inputs into draft
    body.querySelectorAll('[data-bind]').forEach(function (el) {
      _formDraft[el.dataset.bind] = el.value;
      el.addEventListener('input', function () {
        _formDraft[el.dataset.bind] = el.value;
      });
    });

    // JSON fields with live validation
    body.querySelectorAll('[data-json-bind]').forEach(function (ta) {
      var key = ta.dataset.jsonBind;
      _formDraft[key] = ta.value;
      var statusEl = body.querySelector('[data-json-status="' + CSS.escape(key) + '"]');
      var errEl = body.querySelector('[data-json-err="' + CSS.escape(key) + '"]');
      var apply = document.getElementById('te2-step-apply');

      function validate() {
        try {
          JSON.parse(ta.value || 'null');
          ta.classList.remove('te2-input-bad');
          if (statusEl) { statusEl.className = 'te2-json-ok'; statusEl.textContent = '\u2713 valid'; }
          if (errEl) errEl.textContent = '';
          if (apply) apply.disabled = false;
        } catch (e) {
          ta.classList.add('te2-input-bad');
          if (statusEl) { statusEl.className = 'te2-json-err'; statusEl.textContent = '\u2717 invalid'; }
          if (errEl) errEl.textContent = e.message;
          if (apply) apply.disabled = true;
        }
      }
      validate();
      ta.addEventListener('input', function () {
        _formDraft[key] = ta.value;
        validate();
      });
    });

    // KV editors
    body.querySelectorAll('[data-kv-bind]').forEach(function (list) {
      var bindKey = list.dataset.kvBind;
      _attachKvEvents(body, list, bindKey);
    });

    // Sub-step list (parallel) — sortable + delete
    var subList = body.querySelector('#te2-sub-list');
    if (subList && step.type === 'parallel') {
      _attachSubStepEvents(body, subList, step);
    }

    // Add sub-step
    var addSub = body.querySelector('#te2-add-substep');
    if (addSub) {
      addSub.addEventListener('click', function (e) {
        e.preventDefault();
        _showTypePicker(addSub, function (type) {
          if (!step.steps) step.steps = [];
          var newStep = _newStepOfType(type);
          step.steps.push(newStep);
          renderStepDrawer(); // re-render step drawer to show new sub
        });
      });
    }
  }

  function _attachKvEvents(body, list, bindKey) {
    function readKvBack() {
      var rows = list.querySelectorAll('.te2-pschema-row');
      var out = {};
      rows.forEach(function (r) {
        var k = r.querySelector('[data-kv-k]').value.trim();
        var v = r.querySelector('[data-kv-v]').value;
        if (k) out[k] = v;
      });
      _formDraft[bindKey] = out;
    }
    list.querySelectorAll('[data-kv-k], [data-kv-v]').forEach(function (inp) {
      inp.addEventListener('input', readKvBack);
    });
    list.querySelectorAll('[data-kv-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.closest('.te2-pschema-row').remove();
        readKvBack();
      });
    });
    var addBtn = body.querySelector('[data-kv-add="' + CSS.escape(bindKey) + '"]');
    if (addBtn) {
      addBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var row = document.createElement('div');
        row.className = 'te2-pschema-row';
        row.innerHTML =
          '<input class="te2-input" data-kv-k placeholder="key">' +
          '<input class="te2-input" data-kv-v placeholder="value" style="grid-column:span 2">' +
          '<button class="te2-pschema-del" data-kv-del title="Remove">&times;</button>';
        list.appendChild(row);
        row.querySelectorAll('[data-kv-k], [data-kv-v]').forEach(function (inp) {
          inp.addEventListener('input', readKvBack);
        });
        row.querySelector('[data-kv-del]').addEventListener('click', function () {
          row.remove(); readKvBack();
        });
      });
    }
    readKvBack(); // capture initial values
  }

  function _attachSubStepEvents(body, subList, parentStep) {
    if (window.Sortable) {
      new Sortable(subList, {
        handle: '.te2-drag-handle',
        animation: 150,
        onEnd: function (evt) {
          if (evt.oldIndex === evt.newIndex) return;
          var moved = parentStep.steps.splice(evt.oldIndex, 1)[0];
          parentStep.steps.splice(evt.newIndex, 0, moved);
          setDirty();
          renderAll();
        }
      });
    }
    subList.querySelectorAll('[data-sub-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.subDel, 10);
        parentStep.steps.splice(idx, 1);
        setDirty();
        renderAll();
      });
    });
  }

  // ── Apply / cancel / delete ──────────────────────────────────────

  function _applyStepDraft() {
    var step = state.drawer.step;
    Object.keys(_formDraft).forEach(function (k) {
      var v = _formDraft[k];
      if (k === 'params' || k === 'condition') {
        try { step[k] = JSON.parse(v || 'null'); } catch (e) { /* ignore */ }
      } else if (k === 'template_params') {
        step[k] = v;
      } else if (k === 'timeout_s' || k === 'retries' || k === 'duration_s' || k === 'qos') {
        step[k] = (v === '' || v == null) ? undefined : Number(v);
      } else if (k === 'when') {
        if (v === '' || v == null) delete step.when; else step.when = v;
      } else {
        if (v === '') delete step[k]; else step[k] = v;
      }
    });
  }

  function deleteCurrentStep() {
    if (!confirm('Delete step "' + (state.drawer.step.name || '') + '"?')) return;
    var found = _findStepWithChain(_getMainSteps(), state.drawer.step.name);
    if (!found) return;
    found.parentSteps.splice(found.index, 1);
    setDirty();
    closeStepDrawer();
  }

  // ── Settings drawer ──────────────────────────────────────────────

  function _renderSettingsForm() {
    var t = state.template || {};
    var html = '';
    html += '<div class="te2-section-label">Identity</div>';
    html += '<div class="te2-form-row">' +
      _field('ID', '<input class="te2-input" data-set="id" value="' + _escAttr(t.id || '') + '" disabled>') +
      _field('Version', '<input class="te2-input" data-set="version" value="' + _escAttr(t.version || '') + '">') +
      '</div>';
    html += _field('Name', '<input class="te2-input" data-set="name" value="' + _escAttr(t.name || '') + '">');
    html += _field('Description', '<textarea class="te2-textarea" data-set="description">' + _esc(t.description || '') + '</textarea>');
    html += _renderTagsField(t.tags || []);
    html += '<div class="te2-section-label">Parameters</div>';
    html += _renderParamsSchema(t.parameters_schema || {});
    return html;
  }

  function _renderTagsField(tags) {
    var html = '<div class="te2-field"><label class="te2-field-label">Tags</label>';
    html += '<div class="te2-tags" id="te2-tags">';
    tags.forEach(function (tag) {
      html += '<span class="te2-tag">' + _esc(tag) + ' <span class="te2-tag-x" data-tag-x="' + _escAttr(tag) + '">&times;</span></span>';
    });
    html += '<input class="te2-tag-input" id="te2-tag-input" placeholder="add tag…">';
    html += '</div></div>';
    return html;
  }

  function _renderParamsSchema(schema) {
    var keys = Object.keys(schema);
    var html = '<div class="te2-pschema-list" id="te2-pschema-list">';
    keys.forEach(function (k) {
      var s = schema[k] || {};
      html += _pschemaRow(k, s);
    });
    if (!keys.length) {
      html += '<div style="color:var(--muted);font-size:0.75rem;padding:0.4rem 0">No parameters defined.</div>';
    }
    html += '</div>';
    html += '<button class="act act-quick" id="te2-pschema-add">+ Add parameter</button>';
    return html;
  }

  function _pschemaRow(k, s) {
    s = s || {};
    var typeOpts = ['string','integer','float','boolean'].map(function (t) {
      var sel = (s.type === t) ? ' selected' : '';
      return '<option value="' + t + '"' + sel + '>' + t + '</option>';
    }).join('');
    return '<div class="te2-pschema-row" data-pname="' + _escAttr(k || '') + '">' +
      '<input class="te2-input" data-pkey value="' + _escAttr(k || '') + '" placeholder="name">' +
      '<select class="te2-input" data-ptype>' + typeOpts + '</select>' +
      '<input class="te2-input" data-pdefault value="' + _escAttr(s.default == null ? '' : String(s.default)) + '" placeholder="default">' +
      '<button class="te2-pschema-del" data-prm-del title="Remove">&times;</button>' +
      '<input class="te2-pschema-desc" data-pdesc value="' + _escAttr(s.description || '') + '" placeholder="description (optional)">' +
      '</div>';
  }

  var _settingsDraft = null;

  function _attachSettingsEvents(body) {
    var t = state.template;
    _settingsDraft = {
      name: t.name || '',
      version: t.version || '',
      description: t.description || '',
      tags: (t.tags || []).slice(),
      schema: JSON.parse(JSON.stringify(t.parameters_schema || {}))
    };

    body.querySelectorAll('[data-set]').forEach(function (el) {
      el.addEventListener('input', function () {
        _settingsDraft[el.dataset.set] = el.value;
      });
    });

    // Tags
    var tagInput = body.querySelector('#te2-tag-input');
    var tagsBox = body.querySelector('#te2-tags');
    if (tagInput) {
      tagInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          var v = tagInput.value.trim();
          if (v && _settingsDraft.tags.indexOf(v) === -1) {
            _settingsDraft.tags.push(v);
            var span = document.createElement('span');
            span.className = 'te2-tag';
            span.innerHTML = _esc(v) + ' <span class="te2-tag-x" data-tag-x="' + _escAttr(v) + '">&times;</span>';
            tagsBox.insertBefore(span, tagInput);
            span.querySelector('[data-tag-x]').addEventListener('click', function () {
              _removeTag(v); span.remove();
            });
          }
          tagInput.value = '';
        }
      });
    }
    body.querySelectorAll('[data-tag-x]').forEach(function (x) {
      x.addEventListener('click', function () {
        var v = x.dataset.tagX;
        _removeTag(v);
        x.parentElement.remove();
      });
    });

    // Param schema rows
    var list = body.querySelector('#te2-pschema-list');
    function rebuildSchema() {
      var out = {};
      list.querySelectorAll('.te2-pschema-row').forEach(function (row) {
        var name = row.querySelector('[data-pkey]').value.trim();
        if (!name) return;
        var type = row.querySelector('[data-ptype]').value;
        var def = row.querySelector('[data-pdefault]').value;
        var desc = row.querySelector('[data-pdesc]').value;
        var entry = { type: type };
        if (def !== '') entry.default = _coerce(def, type);
        if (desc) entry.description = desc;
        out[name] = entry;
      });
      _settingsDraft.schema = out;
    }
    list.querySelectorAll('input, select').forEach(function (el) {
      el.addEventListener('input', rebuildSchema);
      el.addEventListener('change', rebuildSchema);
    });
    list.querySelectorAll('[data-prm-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.closest('.te2-pschema-row').remove();
        rebuildSchema();
      });
    });
    var addBtn = body.querySelector('#te2-pschema-add');
    if (addBtn) {
      addBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var wrap = document.createElement('div');
        wrap.innerHTML = _pschemaRow('', { type: 'string' });
        var row = wrap.firstChild;
        list.appendChild(row);
        row.querySelectorAll('input, select').forEach(function (el) {
          el.addEventListener('input', rebuildSchema);
          el.addEventListener('change', rebuildSchema);
        });
        row.querySelector('[data-prm-del]').addEventListener('click', function () {
          row.remove(); rebuildSchema();
        });
        row.querySelector('[data-pkey]').focus();
      });
    }
  }

  function _removeTag(v) {
    var idx = _settingsDraft.tags.indexOf(v);
    if (idx >= 0) _settingsDraft.tags.splice(idx, 1);
  }

  function _applySettings() {
    if (!_settingsDraft) return;
    var t = state.template;
    t.name = _settingsDraft.name;
    t.version = _settingsDraft.version;
    t.description = _settingsDraft.description;
    t.tags = _settingsDraft.tags.slice();
    t.parameters_schema = _settingsDraft.schema;
    _settingsDraft = null;
  }

  function _coerce(v, type) {
    if (type === 'integer') { var n = parseInt(v, 10); return isNaN(n) ? v : n; }
    if (type === 'float')   { var f = parseFloat(v); return isNaN(f) ? v : f; }
    if (type === 'boolean') { return v === 'true' || v === true || v === '1'; }
    return v;
  }

  // ── Add step (top-level) ─────────────────────────────────────────

  function _showTypePicker(anchor, cb) {
    // Reuse the toolbar popover for top-level adds; for sub-steps, render an ephemeral popover.
    var popover = document.getElementById('te2-add-popover');
    var isToolbar = anchor.id === 'te2-add-btn';
    if (!isToolbar) {
      // Build inline picker
      popover = document.createElement('div');
      popover.className = 'te2-add-popover';
      popover.style.position = 'fixed';
      var rect = anchor.getBoundingClientRect();
      popover.style.left = rect.left + 'px';
      popover.style.top = (rect.bottom + 4) + 'px';
      document.body.appendChild(popover);
    }
    popover.innerHTML = STEP_TYPES.map(function (t) {
      return '<button data-pick="' + t + '">' + t + '</button>';
    }).join('');
    popover.hidden = false;
    function pick(e) {
      var b = e.target.closest('[data-pick]');
      if (!b) return;
      cb(b.dataset.pick);
      cleanup();
    }
    function cleanup() {
      popover.hidden = true;
      popover.removeEventListener('click', pick);
      document.removeEventListener('click', outside, true);
      if (!isToolbar) popover.remove();
    }
    function outside(e) {
      if (!popover.contains(e.target) && e.target !== anchor) cleanup();
    }
    popover.addEventListener('click', pick);
    setTimeout(function () { document.addEventListener('click', outside, true); }, 0);
  }

  function _newStepOfType(type) {
    var n = 1;
    var taken = {};
    _walkAll(_getMainSteps(), function (s) { taken[s.name] = true; });
    while (taken['new-' + type + '-' + n]) n++;
    var s = { name: 'new-' + type + '-' + n, type: type };
    if (type === 'delay') s.duration_s = 1;
    if (type === 'parallel') s.steps = [];
    if (type === 'command') { s.agent_id = ''; s.action = ''; s.params = {}; }
    if (type === 'topic_link') { s.operation = 'create'; s.source_topic = ''; s.target_topic = ''; }
    if (type === 'approval') s.message = '';
    if (type === 'wait_for_condition') { s.telemetry_metric = ''; s.condition = {}; }
    if (type === 'template') { s.template_id = ''; s.template_params = {}; }
    return s;
  }

  function addStepTop(type) {
    var newStep = _newStepOfType(type);
    _getMainSteps().push(newStep);
    setDirty();
    state.drawer = { kind: 'step', step: newStep, parentChain: [], readOnly: false };
    renderAll();
  }

  // ── Save / discard / dirty ──────────────────────────────────────

  function setDirty() {
    state.dirty = true;
    var dot = document.getElementById('te2-dirty-dot');
    if (dot) dot.hidden = false;
  }
  function clearDirty() {
    state.dirty = false;
    var dot = document.getElementById('te2-dirty-dot');
    if (dot) dot.hidden = true;
  }

  function buildPayload() {
    var t = state.template || {};
    var steps = _stripResolved(_getMainSteps());
    var parameters = {};
    var schema = t.parameters_schema || {};
    Object.keys(schema).forEach(function (k) {
      parameters[k] = Object.assign({}, schema[k]);
    });
    return {
      id: t.id || templateId,
      name: t.name || '',
      version: t.version || '1.0.0',
      description: t.description || '',
      parameters: parameters,
      steps: steps,
      tags: (t.tags || []).slice()
    };
  }

  function _stripResolved(steps) {
    return steps.map(function (s) {
      var copy = {};
      Object.keys(s).forEach(function (k) {
        if (k === 'resolved_steps' || k === 'resolved_parameters') return;
        if (k === 'steps' && Array.isArray(s.steps)) {
          copy.steps = _stripResolved(s.steps);
        } else {
          copy[k] = s[k];
        }
      });
      return copy;
    });
  }

  async function save() {
    var btn = document.getElementById('te2-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      var payload = buildPayload();
      var res = await L.apiFetch('/api/experiments/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        var err = await res.text();
        throw new Error(err || ('HTTP ' + res.status));
      }
      state.savedSnapshot = JSON.stringify(payload);
      clearDirty();
      L.toast({ message: 'Template saved', type: 'success' });
    } catch (e) {
      L.toast({ message: 'Save failed: ' + e.message, type: 'error' });
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
  }

  async function discard() {
    if (state.dirty && !confirm('Discard unsaved changes?')) return;
    var res = await L.apiFetch('/api/experiments/templates/' + encodeURIComponent(templateId) + '/resolve');
    if (!res.ok) { L.toast({ message: 'Failed to reload', type: 'error' }); return; }
    state.template = await res.json();
    state.savedSnapshot = JSON.stringify(buildPayload());
    clearDirty();
    closeStepDrawer();
  }

  function expandAll() {
    _walkAll(_getMainSteps(), function (s) {
      if (_getExpandChildren(s)) state.expandedSubs[s.name] = true;
    });
    _saveLocal();
    renderAll();
  }
  function collapseAll() {
    state.expandedSubs = {};
    _saveLocal();
    renderAll();
  }

  // ── Global event wiring ─────────────────────────────────────────

  function setupGlobalEvents() {
    var addBtn = document.getElementById('te2-add-btn');
    if (addBtn) addBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      _showTypePicker(addBtn, addStepTop);
    });

    var expandBtn = document.getElementById('te2-expand-all-btn');
    if (expandBtn) expandBtn.addEventListener('click', expandAll);

    var collapseBtn = document.getElementById('te2-collapse-all-btn');
    if (collapseBtn) collapseBtn.addEventListener('click', collapseAll);

    var discardBtn = document.getElementById('te2-discard-btn');
    if (discardBtn) discardBtn.addEventListener('click', discard);

    var saveBtn = document.getElementById('te2-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', save);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.drawer.kind === 'step') closeStepDrawer();
    });

    window.addEventListener('beforeunload', function (e) {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // ── Helpers ────────────────────────────────────────────────────

  function _esc(s) { return L.esc ? L.esc(s) : String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _escAttr(s) { return L.escAttr ? L.escAttr(s) : String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

  // ── Boot ────────────────────────────────────────────────────────

  init();

  if (L.registerPageRenderer) {
    L.registerPageRenderer({
      renderFull: function () {},
      renderDirty: function () {},
      renderStats: function () {},
    });
  }

})(window.LUCID);
