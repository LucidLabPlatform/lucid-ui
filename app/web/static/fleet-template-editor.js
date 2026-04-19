// fleet-template-editor.js — Template CRUD editor: Builder | Graph | JSON
// Depends on: fleet-utils.js, fleet-toasts.js, Sortable.js (CDN)

(function () {
  'use strict';

  var L = window.LUCID;
  var overlay = null;

  // ── Editor state ──────────────────────────────────────────────────────
  var es = null;              // editorState: full template object
  var selId = null;           // selected step _id
  var ctxStack = [];          // [{label, steps}] parallel drill-down stack
  var activeTab = 'builder';  // 'builder' | 'graph' | 'json'
  var savedCb = null;         // callback(template) after successful save
  var stepSortable = null;    // Sortable instance

  var _idCounter = 0;
  function _uid() { return 's' + (++_idCounter) + Math.random().toString(36).slice(2, 6); }

  // ── Public API ────────────────────────────────────────────────────────
  window.TemplateEditor = {
    open: function (tpl, cb) {
      savedCb = cb || null;
      _initState(tpl);
      _ensureOverlay();
      _renderAll();
      overlay.classList.remove('te-hidden');
      document.body.style.overflow = 'hidden';
    },
    close: _close
  };

  // ── State initialisation ──────────────────────────────────────────────
  function _initState(tpl) {
    ctxStack = [];
    selId = null;
    activeTab = 'builder';
    if (stepSortable) { stepSortable.destroy(); stepSortable = null; }

    if (!tpl) {
      es = { id: '', name: '', version: '1.0.0', description: '', tags: [], parameters: {}, steps: [] };
    } else {
      var params = tpl.parameters_schema || tpl.parameters || {};
      var steps  = (tpl.definition && tpl.definition.steps) || tpl.steps || [];
      es = {
        id:          tpl.id          || '',
        name:        tpl.name        || '',
        version:     tpl.version     || '1.0.0',
        description: tpl.description || '',
        tags:        (tpl.tags || []).slice(),
        parameters:  JSON.parse(JSON.stringify(params)),
        steps:       _tagSteps(JSON.parse(JSON.stringify(steps)))
      };
    }
  }

  function _tagSteps(steps) {
    return (steps || []).map(function (s) {
      var t = Object.assign({}, s);
      if (!t._id) t._id = _uid();
      if (t.steps) t.steps = _tagSteps(t.steps);
      return t;
    });
  }

  // ── Overlay (created once, reused) ────────────────────────────────────
  function _ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'te-overlay te-hidden';
    overlay.innerHTML = [
      '<div class="te-modal">',
      '  <div class="te-titlebar">',
      '    <span class="te-title">Template Editor</span>',
      '    <button class="act te-close-btn">&#x2715;</button>',
      '  </div>',
      '  <div class="te-meta-section" id="te-meta"></div>',
      '  <div class="te-params-section" id="te-params-wrap"></div>',
      '  <div class="te-tabs-bar" id="te-tabs-bar">',
      '    <button class="te-tab-btn active" data-tab="builder">Builder</button>',
      '    <button class="te-tab-btn" data-tab="graph">Graph</button>',
      '    <button class="te-tab-btn" data-tab="json">JSON</button>',
      '  </div>',
      '  <div class="te-body" id="te-body"></div>',
      '  <div class="te-footer">',
      '    <span class="te-footer-err" id="te-footer-err"></span>',
      '    <button class="act" id="te-cancel-btn">Cancel</button>',
      '    <button class="act act-primary" id="te-save-btn">Save</button>',
      '  </div>',
      '</div>',
    ].join('');

    document.body.appendChild(overlay);

    overlay.querySelector('.te-close-btn').addEventListener('click', _close);
    overlay.querySelector('#te-cancel-btn').addEventListener('click', _close);
    overlay.querySelector('#te-save-btn').addEventListener('click', _save);
    overlay.querySelector('#te-tabs-bar').addEventListener('click', function (e) {
      var btn = e.target.closest('.te-tab-btn');
      if (btn) _switchTab(btn.dataset.tab);
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) _close(); });
  }

  function _close() {
    if (!overlay) return;
    overlay.classList.add('te-hidden');
    document.body.style.overflow = '';
    if (stepSortable) { stepSortable.destroy(); stepSortable = null; }
  }

  // ── Full render ───────────────────────────────────────────────────────
  function _renderAll() {
    _renderMeta();
    _renderParams();
    _setActiveTab('builder');
  }

  // ── Metadata section ──────────────────────────────────────────────────
  function _renderMeta() {
    var el = document.getElementById('te-meta');
    if (!el) return;
    el.innerHTML = [
      '<div class="te-meta-row">',
      '  <div class="te-meta-field">',
      '    <label class="te-label">ID</label>',
      '    <input class="te-input" id="te-meta-id" value="', _ea(es.id), '" placeholder="template-id">',
      '  </div>',
      '  <div class="te-meta-field te-meta-grow">',
      '    <label class="te-label">Name</label>',
      '    <input class="te-input" id="te-meta-name" value="', _ea(es.name), '" placeholder="Human-readable name">',
      '  </div>',
      '  <div class="te-meta-field te-meta-sm">',
      '    <label class="te-label">Version</label>',
      '    <input class="te-input" id="te-meta-ver" value="', _ea(es.version), '" placeholder="1.0.0">',
      '  </div>',
      '  <div class="te-meta-field">',
      '    <label class="te-label">Tags</label>',
      '    <input class="te-input" id="te-meta-tags" value="', _ea(es.tags.join(', ')), '" placeholder="tag1, tag2">',
      '  </div>',
      '</div>',
      '<div class="te-meta-row">',
      '  <div class="te-meta-field te-meta-full">',
      '    <label class="te-label">Description</label>',
      '    <textarea class="te-input te-ta-sm" id="te-meta-desc" rows="2" placeholder="Describe what this template does">', _e(es.description), '</textarea>',
      '  </div>',
      '</div>',
    ].join('');

    el.querySelectorAll('input, textarea').forEach(function (inp) {
      inp.addEventListener('input', _syncMeta);
    });
  }

  function _syncMeta() {
    var g = _gv;
    es.id          = g('te-meta-id')   || '';
    es.name        = g('te-meta-name') || '';
    es.version     = g('te-meta-ver')  || '1.0.0';
    es.description = g('te-meta-desc') || '';
    es.tags = (g('te-meta-tags') || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  }

  // ── Parameters section ────────────────────────────────────────────────
  function _renderParams() {
    var wrap = document.getElementById('te-params-wrap');
    if (!wrap) return;
    var keys = Object.keys(es.parameters);
    var rows = keys.map(function (k) {
      var p = es.parameters[k] || {};
      return [
        '<div class="te-param-row" data-pkey="', _ea(k), '">',
        '  <input class="te-input te-pname" value="', _ea(k), '" placeholder="name">',
        '  <select class="te-select te-ptype">',
        _opt('string', p.type), _opt('float', p.type), _opt('integer', p.type), _opt('boolean', p.type),
        '  </select>',
        '  <input class="te-input te-pdefault" value="', _ea(p.default != null ? String(p.default) : ''), '" placeholder="default">',
        '  <input class="te-input te-pdesc" value="', _ea(p.description || ''), '" placeholder="description">',
        '  <label class="te-param-req"><input type="checkbox" class="te-preq"', p.required ? ' checked' : '', '> req</label>',
        '  <button class="act act-danger act-quick te-pdel" data-pkey="', _ea(k), '">&#x2715;</button>',
        '</div>',
      ].join('');
    }).join('');

    wrap.innerHTML = [
      '<div class="te-section-header">',
      '  <span class="te-section-label">Parameters</span>',
      '  <button class="act act-quick" id="te-add-param-btn">+ Add</button>',
      '</div>',
      '<div id="te-params-list" class="te-params-list">', rows, '</div>',
    ].join('');

    wrap.querySelector('#te-add-param-btn').addEventListener('click', function () {
      var k = 'param_' + (Object.keys(es.parameters).length + 1);
      es.parameters[k] = { type: 'string', default: '', description: '', required: false };
      _renderParams();
    });

    wrap.querySelectorAll('.te-pdel').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var k = btn.dataset.pkey;
        if (k) { delete es.parameters[k]; _renderParams(); }
      });
    });

    wrap.querySelectorAll('.te-param-row').forEach(function (row) {
      row.querySelectorAll('input, select').forEach(function (el) {
        el.addEventListener('input', _syncParams);
        el.addEventListener('change', _syncParams);
      });
    });
  }

  function _syncParams() {
    var nw = {};
    document.querySelectorAll('#te-params-list .te-param-row').forEach(function (row) {
      var name = row.querySelector('.te-pname').value.trim();
      if (!name) return;
      var type = row.querySelector('.te-ptype').value;
      var def  = row.querySelector('.te-pdefault').value;
      var desc = row.querySelector('.te-pdesc').value;
      var req  = row.querySelector('.te-preq').checked;
      var coerced = def;
      if (type === 'float')   coerced = def === '' ? null : (parseFloat(def) || 0);
      else if (type === 'integer') coerced = def === '' ? null : (parseInt(def, 10) || 0);
      else if (type === 'boolean') coerced = (def === 'true');
      nw[name] = { type: type, default: coerced, description: desc, required: req };
    });
    es.parameters = nw;
  }

  // ── Tabs ──────────────────────────────────────────────────────────────
  function _switchTab(tab) {
    if (activeTab === 'json') _syncJSONToState();
    else if (activeTab === 'builder') _syncFormToStep();
    _setActiveTab(tab);
  }

  function _setActiveTab(tab) {
    activeTab = tab;
    var bar = document.getElementById('te-tabs-bar');
    if (bar) bar.querySelectorAll('.te-tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    if (tab === 'builder') _renderBuilder();
    else if (tab === 'graph') _renderGraph();
    else if (tab === 'json') _renderJSON();
  }

  // ── Builder ───────────────────────────────────────────────────────────
  function _curSteps() {
    return ctxStack.length ? ctxStack[ctxStack.length - 1].steps : es.steps;
  }

  function _renderBuilder() {
    var body = document.getElementById('te-body');
    if (!body) return;
    body.innerHTML = [
      '<div class="te-builder">',
      '  <div class="te-step-list-panel" id="te-step-list-panel"></div>',
      '  <div class="te-step-form-panel" id="te-step-form-panel"></div>',
      '</div>',
    ].join('');
    _renderStepList();
    _renderStepForm();
  }

  function _renderStepList() {
    var panel = document.getElementById('te-step-list-panel');
    if (!panel) return;
    var steps = _curSteps();

    var bc = '';
    if (ctxStack.length) {
      bc = '<div class="te-breadcrumb"><button class="act act-quick te-back-btn">&larr; Back</button>';
      ctxStack.forEach(function (ctx) {
        bc += '<span class="te-bc-sep">&rsaquo;</span><span class="te-bc-item">' + _e(ctx.label) + '</span>';
      });
      bc += '</div>';
    }

    var items = steps.map(function (s, i) {
      var sel = s._id === selId ? ' te-selected' : '';
      return [
        '<li class="te-step-row', sel, '" data-id="', _ea(s._id), '">',
        '<span class="te-drag-handle">&#8801;</span>',
        '<span class="te-step-num">', (i + 1), '</span>',
        '<span class="te-type-badge te-t-', s.type, '">', _typeAbbr(s.type), '</span>',
        '<span class="te-step-name">', _e(s.name || '(unnamed)'), '</span>',
        s.type === 'parallel'
          ? '<span class="te-enter-par" title="Edit sub-steps">&#x25B6;</span>'
          : '',
        '<button class="act act-quick act-danger te-step-del" title="Remove">&#x2715;</button>',
        '</li>',
      ].join('');
    }).join('');

    panel.innerHTML = [
      bc,
      '<ul class="te-step-ul" id="te-step-ul">', items, '</ul>',
      '<div class="te-step-add">',
      '  <div class="te-add-wrap">',
      '    <button class="act te-add-btn" id="te-add-step-btn">+ Add Step &#x25BE;</button>',
      '    <ul class="te-add-menu te-hidden" id="te-add-menu">',
      '      <li data-type="command">Command</li>',
      '      <li data-type="delay">Delay</li>',
      '      <li data-type="parallel">Parallel</li>',
      '      <li data-type="topic_link">Topic Link</li>',
      '      <li data-type="approval">Approval</li>',
      '      <li data-type="wait_for_condition">Wait For Condition</li>',
      '      <li data-type="template">Sub-template</li>',
      '    </ul>',
      '  </div>',
      '</div>',
    ].join('');

    // Back button
    var backBtn = panel.querySelector('.te-back-btn');
    if (backBtn) backBtn.addEventListener('click', function () {
      _syncFormToStep();
      ctxStack.pop();
      selId = null;
      _renderStepList();
      _renderStepForm();
    });

    // Row interactions
    var ul = panel.querySelector('#te-step-ul');
    ul.addEventListener('click', function (e) {
      var row = e.target.closest('.te-step-row');
      if (!row) return;
      var id = row.dataset.id;

      if (e.target.closest('.te-step-del')) {
        _syncFormToStep();
        var cur = _curSteps();
        var idx = _findIdx(cur, id);
        if (idx !== -1) cur.splice(idx, 1);
        if (selId === id) selId = null;
        _renderStepList();
        _renderStepForm();
        return;
      }

      if (e.target.closest('.te-enter-par')) {
        _syncFormToStep();
        var step = _findStep(_curSteps(), id);
        if (step && step.type === 'parallel') {
          if (!step.steps) step.steps = [];
          ctxStack.push({ label: step.name || 'parallel', steps: step.steps });
          selId = null;
          _renderStepList();
          _renderStepForm();
        }
        return;
      }

      _syncFormToStep();
      selId = id;
      _renderStepList();
      _renderStepForm();
    });

    // Add step dropdown
    var addBtn = panel.querySelector('#te-add-step-btn');
    var menu = panel.querySelector('#te-add-menu');
    addBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.toggle('te-hidden');
    });
    menu.querySelectorAll('li').forEach(function (li) {
      li.addEventListener('click', function () {
        menu.classList.add('te-hidden');
        _syncFormToStep();
        _addStep(li.dataset.type);
      });
    });
    document.addEventListener('click', function _hideMnu(e) {
      if (!e.target.closest('.te-add-wrap')) {
        menu.classList.add('te-hidden');
        document.removeEventListener('click', _hideMnu);
      }
    });

    // Sortable
    if (stepSortable) { stepSortable.destroy(); stepSortable = null; }
    if (window.Sortable) {
      stepSortable = new Sortable(ul, {
        handle: '.te-drag-handle',
        animation: 150,
        onEnd: function (evt) {
          var cur = _curSteps();
          var moved = cur.splice(evt.oldIndex, 1)[0];
          cur.splice(evt.newIndex, 0, moved);
          _renderStepList();
        }
      });
    }
  }

  function _typeAbbr(type) {
    return { command: 'cmd', delay: 'dly', parallel: 'par', topic_link: 'lnk',
             approval: 'apr', wait_for_condition: 'wfc', template: 'tpl' }[type] || type.slice(0, 3);
  }

  function _addStep(type) {
    var s = _defaultStep(type);
    s._id = _uid();
    _curSteps().push(s);
    selId = s._id;
    _renderStepList();
    _renderStepForm();
  }

  function _defaultStep(type) {
    var b = { name: 'new_' + type, type: type, on_failure: 'abort', retries: 0 };
    if (type === 'command')           return Object.assign(b, { agent_id: '', component_id: '', action: 'ping', timeout_s: 30, params: {} });
    if (type === 'delay')             return Object.assign(b, { duration_s: 5 });
    if (type === 'parallel')          return Object.assign(b, { steps: [] });
    if (type === 'topic_link')        return Object.assign(b, { operation: 'create', source_topic: '', target_topic: '', select_clause: '*', payload_template: '', qos: 0 });
    if (type === 'approval')          return Object.assign(b, { message: 'Please approve to continue.', timeout_s: 300 });
    if (type === 'wait_for_condition') return Object.assign(b, { agent_id: '', component_id: '', telemetry_metric: '', condition: { field: 'value', equals: '' }, timeout_s: 60 });
    if (type === 'template')          return Object.assign(b, { template_id: '', template_params: {} });
    return b;
  }

  // ── Step form ─────────────────────────────────────────────────────────
  function _renderStepForm() {
    var panel = document.getElementById('te-step-form-panel');
    if (!panel) return;

    if (!selId) {
      panel.innerHTML = '<div class="te-form-empty">Select a step to edit its properties</div>';
      return;
    }
    var step = _findStep(_curSteps(), selId);
    if (!step) {
      panel.innerHTML = '<div class="te-form-empty">Step not found</div>';
      return;
    }

    var on_timeout = step.on_timeout || 'abort';
    var html = '<div class="te-form-inner">';
    html += _fg('Name', 'te-f-name', '<input class="te-input" id="te-f-name" value="' + _ea(step.name || '') + '">');
    html += _fg('Type', 'te-f-type', _sel('te-f-type', ['command','delay','parallel','topic_link','approval','wait_for_condition','template'], step.type));
    html += _fg('On Failure', 'te-f-on-failure', _sel('te-f-on-failure', ['abort','continue'], step.on_failure || 'abort'));
    html += _fg('Retries', 'te-f-retries', '<input class="te-input te-input-num" id="te-f-retries" type="number" min="0" value="' + _ea(String(step.retries || 0)) + '">');

    if (step.type === 'command') {
      html += _fg('Agent ID', 'te-f-agent', '<input class="te-input" id="te-f-agent" value="' + _ea(step.agent_id || '') + '" placeholder="${agent_id}">');
      html += _fg('Component ID', 'te-f-component', '<input class="te-input" id="te-f-component" value="' + _ea(step.component_id || '') + '">');
      html += _fg('Action', 'te-f-action', '<input class="te-input" id="te-f-action" value="' + _ea(step.action || '') + '" placeholder="ping">');
      html += _fg('Timeout (s)', 'te-f-timeout', '<input class="te-input te-input-num" id="te-f-timeout" type="number" value="' + _ea(String(step.timeout_s || 30)) + '">');
      html += _kvEditor('te-kv-params', 'Params', step.params || {});

    } else if (step.type === 'delay') {
      html += _fg('Duration (s)', 'te-f-duration', '<input class="te-input te-input-num" id="te-f-duration" type="number" value="' + _ea(String(step.duration_s || 5)) + '">');

    } else if (step.type === 'parallel') {
      html += '<div class="te-form-hint">Click <strong>&#x25B6;</strong> next to this step in the list to edit its sub-steps.</div>';

    } else if (step.type === 'topic_link') {
      html += _fg('Operation', 'te-f-operation', _sel('te-f-operation', ['create','delete','activate','deactivate'], step.operation || 'create'));
      html += _fg('Source Topic', 'te-f-src', '<input class="te-input" id="te-f-src" value="' + _ea(step.source_topic || '') + '">');
      html += _fg('Target Topic', 'te-f-tgt', '<input class="te-input" id="te-f-tgt" value="' + _ea(step.target_topic || '') + '">');
      html += _fg('Select Clause', 'te-f-select', '<input class="te-input" id="te-f-select" value="' + _ea(step.select_clause || '*') + '">');
      html += _fg('Payload Template', 'te-f-payload', '<textarea class="te-input te-ta-sm" id="te-f-payload">' + _e(step.payload_template || '') + '</textarea>');
      html += _fg('QoS', 'te-f-qos', '<input class="te-input te-input-num" id="te-f-qos" type="number" min="0" max="2" value="' + _ea(String(step.qos || 0)) + '">');

    } else if (step.type === 'approval') {
      html += _fg('Message', 'te-f-message', '<textarea class="te-input te-ta-sm" id="te-f-message">' + _e(step.message || '') + '</textarea>');
      html += _fg('Timeout (s)', 'te-f-timeout', '<input class="te-input te-input-num" id="te-f-timeout" type="number" value="' + _ea(String(step.timeout_s || 300)) + '">');
      html += _fg('On Timeout', 'te-f-on-timeout', _sel('te-f-on-timeout', ['abort','continue'], on_timeout));

    } else if (step.type === 'wait_for_condition') {
      html += _fg('Agent ID', 'te-f-agent', '<input class="te-input" id="te-f-agent" value="' + _ea(step.agent_id || '') + '">');
      html += _fg('Component ID', 'te-f-component', '<input class="te-input" id="te-f-component" value="' + _ea(step.component_id || '') + '">');
      html += _fg('Telemetry Metric', 'te-f-metric', '<input class="te-input" id="te-f-metric" value="' + _ea(step.telemetry_metric || '') + '">');
      var cond = step.condition || {};
      var condOp = cond.less_than !== undefined ? 'less_than' : cond.greater_than !== undefined ? 'greater_than' : 'equals';
      var condVal = cond[condOp] !== undefined ? String(cond[condOp]) : '';
      html += _fg('Condition Field', 'te-f-cond-field', '<input class="te-input" id="te-f-cond-field" value="' + _ea(cond.field || '') + '" placeholder="value.data.state">');
      html += _fg('Operator', 'te-f-cond-op', _sel('te-f-cond-op', ['equals','less_than','greater_than'], condOp));
      html += _fg('Condition Value', 'te-f-cond-val', '<input class="te-input" id="te-f-cond-val" value="' + _ea(condVal) + '" placeholder="success">');
      html += _fg('Timeout (s)', 'te-f-timeout', '<input class="te-input te-input-num" id="te-f-timeout" type="number" value="' + _ea(String(step.timeout_s || 60)) + '">');
      html += _fg('On Timeout', 'te-f-on-timeout', _sel('te-f-on-timeout', ['abort','continue'], on_timeout));

    } else if (step.type === 'template') {
      html += _fg('Template ID', 'te-f-tpl-id', '<input class="te-input" id="te-f-tpl-id" value="' + _ea(step.template_id || '') + '">');
      html += _kvEditor('te-kv-tplparams', 'Template Params', step.template_params || {});
    }

    html += '</div>';
    panel.innerHTML = html;

    panel.querySelectorAll('input, select, textarea').forEach(function (el) {
      el.addEventListener('input', _syncFormToStep);
      el.addEventListener('change', _syncFormToStep);
    });

    panel.querySelectorAll('.te-kv-add').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _syncFormToStep();
        var kvId = btn.dataset.kvid;
        var s = _findStep(_curSteps(), selId);
        if (!s) return;
        var obj = kvId === 'te-kv-params' ? s.params : s.template_params;
        if (!obj) obj = {};
        obj['key_' + _uid()] = '';
        if (kvId === 'te-kv-params') s.params = obj; else s.template_params = obj;
        _renderStepForm();
      });
    });

    panel.querySelectorAll('.te-kv-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _syncFormToStep();
        var kvId  = btn.dataset.kvid;
        var key   = btn.dataset.key;
        var s = _findStep(_curSteps(), selId);
        if (!s) return;
        var obj = kvId === 'te-kv-params' ? s.params : s.template_params;
        if (obj) delete obj[key];
        _renderStepForm();
      });
    });
  }

  function _fg(label, id, control) {
    return '<div class="te-form-group"><label class="te-label" for="' + id + '">' + _e(label) + '</label>' + control + '</div>';
  }

  function _sel(id, options, selected) {
    var opts = options.map(function (o) {
      return '<option value="' + _ea(o) + '"' + (o === selected ? ' selected' : '') + '>' + _e(o) + '</option>';
    }).join('');
    return '<select class="te-select" id="' + id + '">' + opts + '</select>';
  }

  function _kvEditor(kvId, label, obj) {
    var rows = Object.keys(obj).map(function (k) {
      return [
        '<div class="te-kv-row">',
        '<input class="te-input te-kv-k" data-kvid="', _ea(kvId), '" data-key="', _ea(k), '" value="', _ea(k), '" placeholder="key">',
        '<input class="te-input te-kv-v" data-kvid="', _ea(kvId), '" data-key="', _ea(k), '" value="', _ea(obj[k] != null ? String(obj[k]) : ''), '" placeholder="value">',
        '<button class="act act-quick act-danger te-kv-del" data-kvid="', _ea(kvId), '" data-key="', _ea(k), '">&#x2715;</button>',
        '</div>',
      ].join('');
    }).join('');
    return [
      '<div class="te-form-group">',
      '<label class="te-label">', _e(label), '</label>',
      '<div class="te-kv-list">', rows, '</div>',
      '<button class="act act-quick te-kv-add" data-kvid="', _ea(kvId), '">+ Add</button>',
      '</div>',
    ].join('');
  }

  function _syncFormToStep() {
    if (!selId) return;
    var step = _findStep(_curSteps(), selId);
    if (!step) return;

    var g = _gv;

    var newName = g('te-f-name');
    if (newName !== null) step.name = newName;

    var newType = g('te-f-type');
    if (newType && newType !== step.type) {
      var savedName = step.name;
      var savedId   = step._id;
      var fresh = _defaultStep(newType);
      Object.assign(step, fresh);
      step._id  = savedId;
      step.name = savedName;
      step.type = newType;
      _renderStepList();
      _renderStepForm();
      return;
    }

    var onf = g('te-f-on-failure'); if (onf !== null) step.on_failure = onf;
    var ret = g('te-f-retries');    if (ret !== null) step.retries = parseInt(ret, 10) || 0;

    if (step.type === 'command') {
      var ag = g('te-f-agent');    if (ag !== null) step.agent_id    = ag;
      var cp = g('te-f-component'); if (cp !== null) step.component_id = cp;
      var ac = g('te-f-action');   if (ac !== null) step.action       = ac;
      var to = g('te-f-timeout');  if (to !== null) step.timeout_s    = parseFloat(to) || 30;
      step.params = _collectKV('te-kv-params');

    } else if (step.type === 'delay') {
      var dur = g('te-f-duration'); if (dur !== null) step.duration_s = parseFloat(dur) || 5;

    } else if (step.type === 'topic_link') {
      var op  = g('te-f-operation'); if (op  !== null) step.operation       = op;
      var src = g('te-f-src');       if (src !== null) step.source_topic    = src;
      var tgt = g('te-f-tgt');       if (tgt !== null) step.target_topic    = tgt;
      var sel = g('te-f-select');    if (sel !== null) step.select_clause   = sel;
      var pl  = g('te-f-payload');   if (pl  !== null) step.payload_template = pl;
      var qos = g('te-f-qos');       if (qos !== null) step.qos = parseInt(qos, 10) || 0;

    } else if (step.type === 'approval') {
      var msg = g('te-f-message'); if (msg !== null) step.message = msg;
      var to2 = g('te-f-timeout'); if (to2 !== null) step.timeout_s = parseFloat(to2) || 300;
      var oto = g('te-f-on-timeout'); if (oto !== null) step.on_timeout = oto;

    } else if (step.type === 'wait_for_condition') {
      var ag2 = g('te-f-agent');      if (ag2  !== null) step.agent_id       = ag2;
      var cp2 = g('te-f-component');  if (cp2  !== null) step.component_id   = cp2;
      var met = g('te-f-metric');     if (met  !== null) step.telemetry_metric = met;
      var cf  = g('te-f-cond-field'); var cop = g('te-f-cond-op'); var cv = g('te-f-cond-val');
      if (cf !== null || cop !== null || cv !== null) {
        var cond = {};
        cond.field = cf || '';
        cond[cop || 'equals'] = cv || '';
        step.condition = cond;
      }
      var to3 = g('te-f-timeout');    if (to3  !== null) step.timeout_s = parseFloat(to3) || 60;
      var oto2 = g('te-f-on-timeout'); if (oto2 !== null) step.on_timeout = oto2;

    } else if (step.type === 'template') {
      var tid = g('te-f-tpl-id'); if (tid !== null) step.template_id = tid;
      step.template_params = _collectKV('te-kv-tplparams');
    }

    // Live-update name in step list
    var nameEl = document.querySelector('.te-step-row[data-id="' + CSS.escape(selId) + '"] .te-step-name');
    if (nameEl) nameEl.textContent = step.name || '(unnamed)';
  }

  function _collectKV(kvId) {
    var result = {};
    document.querySelectorAll('.te-kv-k[data-kvid="' + kvId + '"]').forEach(function (kEl) {
      var key = kEl.value.trim();
      if (!key) return;
      var vEl = document.querySelector('.te-kv-v[data-kvid="' + kvId + '"][data-key="' + kEl.dataset.key + '"]');
      result[key] = vEl ? vEl.value : '';
    });
    return result;
  }

  // ── Graph ─────────────────────────────────────────────────────────────
  var TYPE_COLOR = {
    command: '#3b82f6', delay: '#6b7280', parallel: '#8b5cf6',
    topic_link: '#14b8a6', approval: '#f59e0b',
    wait_for_condition: '#eab308', template: '#10b981'
  };

  function _renderGraph() {
    var body = document.getElementById('te-body');
    if (!body) return;
    body.innerHTML = '<div class="te-graph-wrap"><svg id="te-graph-svg" xmlns="http://www.w3.org/2000/svg"></svg></div>';
    _drawGraph(document.getElementById('te-graph-svg'), es.steps);
  }

  function _drawGraph(svg, steps) {
    var NW = 220, NH = 44, VSTRIDE = 80, HGAP = 16, CX = 300;
    var nodes = [], edges = [];

    function layout(stepList, cx, startY) {
      var y = startY;
      var prevId = null;

      stepList.forEach(function (step) {
        var nid = step._id || _uid();
        if (!step._id) step._id = nid;

        if (step.type === 'parallel' && step.steps && step.steps.length) {
          var subs = step.steps;
          var colW = NW + HGAP;
          var totalW = subs.length * colW - HGAP;
          var leftX = cx - totalW / 2;

          // Parallel header
          nodes.push({ id: 'ph_' + nid, step: step, x: cx - NW / 2, y: y, w: NW, h: NH });
          if (prevId) edges.push({ from: prevId, to: 'ph_' + nid });

          var subStartY = y + NH + 24;
          var subEndIds = [];
          subs.forEach(function (sub, i) {
            var subCx = leftX + i * colW + NW / 2;
            var subId = sub._id || _uid();
            if (!sub._id) sub._id = subId;
            nodes.push({ id: subId, step: sub, x: subCx - NW / 2, y: subStartY, w: NW, h: NH });
            edges.push({ from: 'ph_' + nid, to: subId });
            subEndIds.push(subId);
          });

          // Virtual merge node
          var mergeY = subStartY + NH + 24;
          var mergeId = 'merge_' + nid;
          nodes.push({ id: mergeId, isMerge: true, x: cx, y: mergeY });
          subEndIds.forEach(function (sid) { edges.push({ from: sid, to: mergeId }); });

          y = mergeY + 24;
          prevId = mergeId;
        } else {
          nodes.push({ id: nid, step: step, x: cx - NW / 2, y: y, w: NW, h: NH });
          if (prevId) edges.push({ from: prevId, to: nid });
          y += VSTRIDE;
          prevId = nid;
        }
      });
      return y;
    }

    var finalY = layout(steps, CX, 20);
    var svgW = 600, svgH = Math.max(finalY + 20, 120);

    var defs = [
      '<defs>',
      '<marker id="arr" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">',
      '<polygon points="0 0, 7 2.5, 0 5" fill="#374151"/>',
      '</marker>',
      '</defs>',
    ].join('');

    // Build node lookup
    var nodeMap = {};
    nodes.forEach(function (n) { nodeMap[n.id] = n; });

    var edgeSvg = edges.map(function (e) {
      var from = nodeMap[e.from];
      var to   = nodeMap[e.to];
      if (!from || !to) return '';
      var x1, y1, x2, y2;
      if (from.isMerge) {
        x1 = from.x; y1 = from.y;
      } else {
        x1 = from.x + from.w / 2; y1 = from.y + from.h;
      }
      if (to.isMerge) {
        x2 = to.x; y2 = to.y;
      } else {
        x2 = to.x + to.w / 2; y2 = to.y;
      }
      var cy1 = y1 + (y2 - y1) * 0.5;
      return '<path d="M' + x1 + ',' + y1 + ' C' + x1 + ',' + cy1 + ' ' + x2 + ',' + cy1 + ' ' + x2 + ',' + y2 + '" stroke="#374151" stroke-width="1.5" fill="none" marker-end="url(#arr)"/>';
    }).join('');

    var nodeSvg = nodes.filter(function (n) { return !n.isMerge; }).map(function (n) {
      var col = TYPE_COLOR[n.step.type] || '#4b5563';
      var lbl = (n.step.name || '').slice(0, 27);
      return [
        '<g>',
        '<rect x="', n.x, '" y="', n.y, '" width="', n.w, '" height="', n.h, '" rx="8"',
        ' fill="', col, '1a" stroke="', col, '" stroke-width="1.5"/>',
        '<text x="', (n.x + 10), '" y="', (n.y + 17), '"',
        ' fill="#e2e8f0" font-size="12" font-family="system-ui,sans-serif" font-weight="500">',
        _e(lbl), '</text>',
        '<text x="', (n.x + 10), '" y="', (n.y + 33), '"',
        ' fill="', col, '" font-size="9" font-family="monospace">',
        _e(n.step.type), '</text>',
        '</g>',
      ].join('');
    }).join('');

    svg.setAttribute('width',   svgW);
    svg.setAttribute('height',  svgH);
    svg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);
    svg.innerHTML = defs + edgeSvg + nodeSvg;
  }

  // ── JSON tab ──────────────────────────────────────────────────────────
  function _renderJSON() {
    var body = document.getElementById('te-body');
    if (!body) return;
    var json = JSON.stringify(_buildPayload(), null, 2);
    body.innerHTML = [
      '<div class="te-json-wrap">',
      '  <div class="te-json-bar">',
      '    <span class="te-json-ok" id="te-json-status">&#x2713; Valid JSON</span>',
      '    <button class="act act-quick" id="te-fmt-btn">Format</button>',
      '  </div>',
      '  <div class="te-json-err te-hidden" id="te-json-err"></div>',
      '  <textarea class="te-json-ta" id="te-json-ta" spellcheck="false">', _e(json), '</textarea>',
      '</div>',
    ].join('');

    var ta      = document.getElementById('te-json-ta');
    var errEl   = document.getElementById('te-json-err');
    var statEl  = document.getElementById('te-json-status');
    var saveBtn = document.getElementById('te-save-btn');

    ta.addEventListener('input', function () {
      try {
        JSON.parse(ta.value);
        errEl.classList.add('te-hidden');
        statEl.textContent = '\u2713 Valid JSON';
        statEl.className = 'te-json-ok';
        if (saveBtn) saveBtn.disabled = false;
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove('te-hidden');
        statEl.textContent = '\u2717 Invalid JSON';
        statEl.className = 'te-json-err-badge';
        if (saveBtn) saveBtn.disabled = true;
      }
    });

    document.getElementById('te-fmt-btn').addEventListener('click', function () {
      try {
        ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
        errEl.classList.add('te-hidden');
        statEl.textContent = '\u2713 Valid JSON';
        statEl.className = 'te-json-ok';
        if (saveBtn) saveBtn.disabled = false;
      } catch (e) { /* already invalid */ }
    });
  }

  function _syncJSONToState() {
    var ta = document.getElementById('te-json-ta');
    if (!ta) return;
    try {
      var parsed = JSON.parse(ta.value);
      _initState(parsed);
    } catch (e) { /* ignore invalid JSON */ }
  }

  // ── Payload builder ───────────────────────────────────────────────────
  function _buildPayload() {
    _syncMeta();
    _syncParams();
    if (activeTab === 'builder' && selId) _syncFormToStep();
    return {
      id:          es.id,
      name:        es.name,
      version:     es.version,
      description: es.description,
      tags:        es.tags,
      parameters:  es.parameters,
      steps:       _stripIds(es.steps)
    };
  }

  function _stripIds(steps) {
    return (steps || []).map(function (s) {
      var c = Object.assign({}, s);
      delete c._id;
      if (c.steps) c.steps = _stripIds(c.steps);
      return c;
    });
  }

  // ── Save ──────────────────────────────────────────────────────────────
  function _save() {
    var payload;
    if (activeTab === 'json') {
      var ta = document.getElementById('te-json-ta');
      if (ta) {
        try { payload = JSON.parse(ta.value); }
        catch (e) {
          _setFooterErr('Fix JSON errors before saving');
          return;
        }
      }
    }
    if (!payload) payload = _buildPayload();

    if (!payload.id || !payload.id.trim()) {
      _setFooterErr('Template ID is required');
      return;
    }

    _setFooterErr('');
    var saveBtn = document.getElementById('te-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving\u2026'; }

    L.apiFetch('/api/experiments/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return { detail: 'Server error' }; }).then(function (err) {
          throw new Error(err.detail || 'Save failed (' + res.status + ')');
        });
      }
      L.toast({ message: 'Template \u201c' + (payload.name || payload.id) + '\u201d saved', type: 'success' });
      _close();
      if (savedCb) savedCb(payload);
    }).catch(function (e) {
      _setFooterErr(e.message);
    }).finally(function () {
      var btn = document.getElementById('te-save-btn');
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    });
  }

  function _setFooterErr(msg) {
    var el = document.getElementById('te-footer-err');
    if (el) el.textContent = msg;
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function _e(s)  { return L.esc(s); }
  function _ea(s) { return L.escAttr(s); }
  function _gv(id) { var el = document.getElementById(id); return el ? el.value : null; }
  function _opt(val, sel) { return '<option value="' + _ea(val) + '"' + (val === sel ? ' selected' : '') + '>' + _e(val) + '</option>'; }
  function _findStep(steps, id) {
    for (var i = 0; i < steps.length; i++) {
      if (steps[i]._id === id) return steps[i];
    }
    return null;
  }
  function _findIdx(steps, id) {
    for (var i = 0; i < steps.length; i++) {
      if (steps[i]._id === id) return i;
    }
    return -1;
  }

})();
