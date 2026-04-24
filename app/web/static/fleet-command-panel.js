// fleet-command-panel.js — Slide-out command panel with schema-driven forms
// Depends on: fleet-utils.js, fleet.js

(function (L) {
  'use strict';

  var panelEl, overlayEl;
  var currentState = { agentId: null, componentId: null, action: null };

  // ── Result watcher state ──────────────────────────────────────────
  var _resultUnsubscribe = null;
  var _resultTimeout = null;
  var _currentRequestId = null;

  function clearResultWatcher() {
    if (_resultUnsubscribe) { _resultUnsubscribe(); _resultUnsubscribe = null; }
    if (_resultTimeout) { clearTimeout(_resultTimeout); _resultTimeout = null; }
    if (L._panelWatchingRequestId) L._panelWatchingRequestId = null;
    _currentRequestId = null;
  }

  function showPanelResult(entry, evt) {
    var resultEl = document.getElementById('panel-result');
    if (!resultEl) return;
    resultEl.style.display = '';
    var ok = evt.payload && evt.payload.ok;
    var cls = ok ? 'result-ok' : 'result-err';
    var elapsed = entry && entry.result_elapsed != null ? L.fmtDuration(entry.result_elapsed) : '';
    var errMsg = (evt.payload && evt.payload.error) || '';
    resultEl.innerHTML = '<div class="' + cls + '">' +
      '<span class="result-icon">' + (ok ? '\u2713' : '\u2717') + '</span>' +
      '<span class="result-action">' + L.esc(entry ? entry.action : currentState.action) + '</span>' +
      (elapsed ? '<span class="result-time">' + L.esc(elapsed) + '</span>' : '') +
      (errMsg ? '<div class="result-err-msg">' + L.esc(errMsg) + '</div>' : '') +
      '</div>' +
      (evt.payload ? '<pre class="result-payload">' + L.esc(JSON.stringify(evt.payload, null, 2)) + '</pre>' : '');
  }

  function showTimeout() {
    var resultEl = document.getElementById('panel-result');
    if (resultEl) {
      resultEl.style.display = '';
      resultEl.innerHTML = '<div class="result-warn">' +
        '<span class="result-icon">\u23F1</span> No response within 30s</div>';
    }
  }

  L.openCommandPanel = function (opts) {
    opts = opts || {};
    panelEl = panelEl || document.getElementById('cmd-panel');
    overlayEl = overlayEl || document.getElementById('cmd-panel-overlay');
    if (!panelEl || !overlayEl) return;

    currentState.agentId = opts.agentId || null;
    currentState.componentId = opts.componentId || null;
    currentState.action = opts.action || null;

    renderPanel();
    panelEl.classList.remove('hidden');
    panelEl.classList.add('open');
    overlayEl.classList.remove('hidden');
  };

  L.closeCommandPanel = function () {
    clearResultWatcher();
    if (panelEl) { panelEl.classList.remove('open'); panelEl.classList.add('hidden'); }
    if (overlayEl) overlayEl.classList.add('hidden');
  };

  function renderPanel() {
    clearResultWatcher();
    var html = '<div class="panel-header">';
    html += '<span class="panel-title">Send Command</span>';
    html += '<button class="panel-close" id="panel-close-btn">\u2715</button>';
    html += '</div>';
    html += '<div class="panel-body">';

    // Step 1: Agent selector
    html += '<div class="panel-field">';
    html += '<label class="panel-label">Agent</label>';
    html += '<select class="panel-select" id="panel-agent">';
    html += '<option value="">Select agent…</option>';
    Object.values(L.agents).sort(function (a, b) { return a.agent_id.localeCompare(b.agent_id); }).forEach(function (a) {
      var state = L.agentState(a);
      var compCount = Object.keys(a.components || {}).length;
      var sel = a.agent_id === currentState.agentId ? ' selected' : '';
      html += '<option value="' + L.escAttr(a.agent_id) + '"' + sel + '>' + L.esc(a.agent_id) + ' (' + state + ', ' + compCount + ' comp)</option>';
    });
    html += '</select></div>';

    // Step 2: Component selector (populated dynamically)
    html += '<div class="panel-field">';
    html += '<label class="panel-label">Component</label>';
    html += '<select class="panel-select" id="panel-comp">';
    html += '<option value="">Agent-level</option>';
    if (currentState.agentId && L.agents[currentState.agentId]) {
      var comps = L.agents[currentState.agentId].components || {};
      Object.keys(comps).sort().forEach(function (cid) {
        var sel = cid === currentState.componentId ? ' selected' : '';
        html += '<option value="' + L.escAttr(cid) + '"' + sel + '>' + L.compIcon(cid) + ' ' + L.esc(cid) + '</option>';
      });
    }
    html += '</select></div>';

    // Step 3: Action selector (populated dynamically)
    html += '<div class="panel-field">';
    html += '<label class="panel-label">Action</label>';
    html += '<select class="panel-select" id="panel-action">';
    html += '<option value="">Select action…</option>';
    html += '</select>';
    html += '<div class="panel-action-desc" id="panel-action-desc"></div>';
    html += '</div>';

    // Step 4: Payload form (populated on action select)
    html += '<div class="panel-field" id="panel-payload-section" style="display:none">';
    html += '<label class="panel-label">Payload</label>';
    html += '<div id="panel-payload-form"></div>';
    html += '<details class="panel-json-toggle"><summary>Raw JSON</summary>';
    html += '<textarea class="panel-json" id="panel-json" spellcheck="false">{}</textarea>';
    html += '</details>';
    html += '</div>';

    // Send button
    html += '<div class="panel-send-row">';
    html += '<button class="btn-primary panel-send" id="panel-send-btn">Send Command</button>';
    html += '</div>';

    // Result area
    html += '<div class="panel-result" id="panel-result" style="display:none"></div>';

    // Command history
    html += '<div class="panel-history">';
    html += '<div class="panel-label">History</div>';
    html += '<div id="panel-history-list">' + renderHistory() + '</div>';
    html += '</div>';

    html += '</div>'; // panel-body
    panelEl.innerHTML = html;

    // Wire up events
    setupPanelEvents();

    // If we have pre-filled state, populate actions then pre-select
    if (currentState.agentId) {
      populateActions().then(function () {
        if (currentState.action) {
          var actionSel = document.getElementById('panel-action');
          if (actionSel) {
            actionSel.value = currentState.action;
            onActionChange();
          }
        }
      });
    }
  }

  function setupPanelEvents() {
    var closeBtn = document.getElementById('panel-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', L.closeCommandPanel);

    var overlay = document.getElementById('cmd-panel-overlay');
    if (overlay) overlay.addEventListener('click', L.closeCommandPanel);

    var agentSel = document.getElementById('panel-agent');
    if (agentSel) agentSel.addEventListener('change', function () {
      currentState.agentId = agentSel.value;
      currentState.componentId = null;
      currentState.action = null;
      populateComponents();
      populateActions();
    });

    var compSel = document.getElementById('panel-comp');
    if (compSel) compSel.addEventListener('change', function () {
      currentState.componentId = compSel.value || null;
      currentState.action = null;
      populateActions();
    });

    var actionSel = document.getElementById('panel-action');
    if (actionSel) actionSel.addEventListener('change', onActionChange);

    var sendBtn = document.getElementById('panel-send-btn');
    if (sendBtn) sendBtn.addEventListener('click', sendCommand);

    // Keyboard shortcut
    panelEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') L.closeCommandPanel();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') sendCommand();
    });
  }

  function populateComponents() {
    var compSel = document.getElementById('panel-comp');
    if (!compSel) return;
    compSel.innerHTML = '<option value="">Agent-level</option>';
    if (!currentState.agentId || !L.agents[currentState.agentId]) return;
    var comps = L.agents[currentState.agentId].components || {};
    Object.keys(comps).sort().forEach(function (cid) {
      compSel.innerHTML += '<option value="' + L.escAttr(cid) + '">' + L.compIcon(cid) + ' ' + L.esc(cid) + '</option>';
    });
  }

  async function populateActions() {
    var actionSel = document.getElementById('panel-action');
    if (!actionSel) return;
    actionSel.innerHTML = '<option value="">Select action…</option>';

    if (!currentState.agentId) return;
    await L.loadCatalog(currentState.agentId);
    var catalog = L.catalogs[currentState.agentId] || {};

    var commands;
    if (currentState.componentId) {
      commands = (catalog.components && catalog.components[currentState.componentId]) || [];
    } else {
      commands = catalog.agent || [];
    }

    // Group by category
    var groups = {};
    commands.forEach(function (cmd) {
      var cat = cmd.category || 'general';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(cmd);
    });

    Object.keys(groups).sort().forEach(function (cat) {
      actionSel.innerHTML += '<optgroup label="' + L.escAttr(cat) + '">';
      groups[cat].forEach(function (cmd) {
        actionSel.innerHTML += '<option value="' + L.escAttr(cmd.action) + '" data-desc="' + L.escAttr(cmd.help || '') + '" data-has-body="' + (cmd.has_body ? '1' : '0') + '" data-template="' + L.escAttr(JSON.stringify(cmd.template || {})) + '">' + L.esc(cmd.label || cmd.action) + '</option>';
      });
      actionSel.innerHTML += '</optgroup>';
    });
  }

  function onActionChange() {
    var actionSel = document.getElementById('panel-action');
    var payloadSection = document.getElementById('panel-payload-section');
    var descEl = document.getElementById('panel-action-desc');
    if (!actionSel) return;

    var opt = actionSel.selectedOptions[0];
    if (!opt || !opt.value) {
      if (payloadSection) payloadSection.style.display = 'none';
      if (descEl) descEl.textContent = '';
      return;
    }

    currentState.action = opt.value;
    if (descEl) descEl.textContent = opt.dataset.desc || '';

    var hasBody = opt.dataset.hasBody === '1';
    if (!hasBody) {
      if (payloadSection) payloadSection.style.display = 'none';
      return;
    }

    if (payloadSection) payloadSection.style.display = '';

    // Build form from template + schema
    var tpl = {};
    try { tpl = JSON.parse(opt.dataset.template || '{}'); } catch (e) {}
    buildPayloadForm(tpl);
  }

  function renderFieldInput(c, value, id) {
    if (c.type === 'enum') {
      var out = '<select class="panel-input" id="' + id + '">';
      (c.options || []).forEach(function (opt) {
        var sel = opt === value ? ' selected' : '';
        out += '<option value="' + L.escAttr(opt) + '"' + sel + '>' + L.esc(opt) + '</option>';
      });
      return out + '</select>';
    }
    if (c.type === 'slider') {
      var v = typeof value === 'number' ? value : Math.round((c.min + c.max) / 2);
      return '<div class="slider-row"><input type="range" id="' + id + '" class="panel-slider" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" value="' + v + '" oninput="this.nextElementSibling.textContent=this.value"><span class="slider-val">' + v + '</span></div>';
    }
    if (c.type === 'number') {
      return '<input type="number" id="' + id + '" class="panel-input" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" value="' + (value != null ? value : 0) + '">';
    }
    if (c.type === 'toggle') {
      var checked = value === true || value === 'true' ? ' checked' : '';
      return '<label class="toggle-label"><input type="checkbox" id="' + id + '" class="panel-toggle"' + checked + '><span>' + (value === true || value === 'true' ? 'on' : 'off') + '</span></label>';
    }
    return '<input type="text" id="' + id + '" class="panel-input" value="' + L.escAttr(value != null ? value : '') + '">';
  }

  function buildPayloadForm(template) {
    var formEl = document.getElementById('panel-payload-form');
    var jsonEl = document.getElementById('panel-json');
    if (!formEl) return;

    // Try schema first
    var schemaFields = getSchemaFields();
    var fields;

    if (schemaFields && schemaFields.length) {
      fields = schemaFields.map(function (sf) {
        var ctrl = L.controlFromSchema(sf) || L.inferControl(sf.name, sf.default_value, '');
        return { path: sf.name, key: sf.name, value: sf.default_value, control: ctrl, description: sf.description };
      });
    } else {
      fields = L.flattenTemplate(template, '', '');
    }

    if (!fields.length) {
      formEl.innerHTML = '';
      if (jsonEl) jsonEl.value = '{}';
      return;
    }

    // Group fields by top-level key. Nested fields (path contains '.') are grouped
    // under their first path segment; top-level fields stand alone.
    var groups = [];
    var groupMap = {};
    fields.forEach(function (f) {
      var dotIdx = f.path.indexOf('.');
      if (dotIdx === -1) {
        groups.push({ key: null, fields: [f] });
      } else {
        var topKey = f.path.substring(0, dotIdx);
        if (!groupMap[topKey]) {
          groupMap[topKey] = { key: topKey, fields: [] };
          groups.push(groupMap[topKey]);
        }
        groupMap[topKey].fields.push(f);
      }
    });

    var html = '';
    var allFields = [];

    groups.forEach(function (group) {
      if (group.key !== null) {
        html += '<details class="payload-group" open>';
        html += '<summary class="payload-group-label">' + L.esc(group.key) + '</summary>';
        html += '<div class="payload-group-body">';
      }
      group.fields.forEach(function (f) {
        var i = allFields.length;
        var id = 'pf-' + i;
        var label = group.key !== null ? f.path.substring(group.key.length + 1) : f.path;
        html += '<div class="payload-field">';
        html += '<label class="payload-label" for="' + id + '">' + L.esc(label) + '</label>';
        if (f.description) html += '<div class="payload-desc">' + L.esc(f.description) + '</div>';
        html += renderFieldInput(f.control, f.value, id);
        html += '</div>';
        allFields.push({ path: f.path, control: f.control });
      });
      if (group.key !== null) {
        html += '</div></details>';
      }
    });

    formEl.innerHTML = html;
    formEl.dataset.fieldCount = allFields.length;
    formEl.dataset.fields = JSON.stringify(allFields);

    // Sync JSON
    syncFormToJson();

    // Toggle text update
    formEl.querySelectorAll('.panel-toggle').forEach(function (chk) {
      chk.addEventListener('change', function () {
        chk.nextElementSibling.textContent = chk.checked ? 'on' : 'off';
        syncFormToJson();
      });
    });

    // Sync on all inputs
    formEl.querySelectorAll('input, select').forEach(function (el) {
      el.addEventListener('input', syncFormToJson);
      el.addEventListener('change', syncFormToJson);
    });

    // JSON textarea → form sync
    if (jsonEl) {
      jsonEl.addEventListener('input', function () {
        try {
          var obj = JSON.parse(jsonEl.value);
          jsonEl.style.borderColor = '';
          // Update form fields from JSON
          var fieldMeta = JSON.parse(formEl.dataset.fields || '[]');
          fieldMeta.forEach(function (fm, i) {
            var el = document.getElementById('pf-' + i);
            if (!el) return;
            var parts = fm.path.split('.');
            var val = obj;
            for (var j = 0; j < parts.length && val != null; j++) val = val[parts[j]];
            if (val == null) return;
            if (fm.control.type === 'toggle') {
              el.checked = val === true || val === 'true';
              el.nextElementSibling.textContent = el.checked ? 'on' : 'off';
            } else {
              el.value = val;
              var valSpan = el.nextElementSibling;
              if (valSpan && valSpan.classList.contains('slider-val')) valSpan.textContent = val;
            }
          });
        } catch (e) {
          jsonEl.style.borderColor = 'var(--red)';
        }
      });
    }
  }

  function syncFormToJson() {
    var formEl = document.getElementById('panel-payload-form');
    var jsonEl = document.getElementById('panel-json');
    if (!formEl || !jsonEl) return;

    var fieldMeta = JSON.parse(formEl.dataset.fields || '[]');
    var fieldValues = fieldMeta.map(function (fm, i) {
      var el = document.getElementById('pf-' + i);
      if (!el) return { path: fm.path, value: null };
      var val;
      if (fm.control.type === 'slider' || fm.control.type === 'number') val = Number(el.value);
      else if (fm.control.type === 'toggle') val = el.checked;
      else val = el.value;
      return { path: fm.path, value: val };
    });

    var payload = L.buildPayload(fieldValues);
    jsonEl.value = JSON.stringify(payload, null, 2);
  }

  function getSchemaFields() {
    if (!currentState.agentId || !currentState.action) return null;
    var schema = L.schemas[currentState.agentId];
    if (!schema) return null;

    var subscribes;
    if (currentState.componentId) {
      var compSchema = schema.components && schema.components[currentState.componentId];
      if (compSchema) subscribes = compSchema.subscribes;
    } else {
      subscribes = schema.subscribes;
    }
    if (!subscribes) return null;

    // Find the command in subscribes
    var cmdKey = 'cmd/' + currentState.action;
    var cmdSchema = subscribes[cmdKey];
    if (!cmdSchema || !cmdSchema.fields) return null;

    return Object.keys(cmdSchema.fields).filter(function (k) { return k !== 'request_id'; }).map(function (k) {
      var f = cmdSchema.fields[k];
      return { name: k, type: f.type, description: f.description, default_value: f.default, min: f.min, max: f.max, 'enum': f['enum'] };
    });
  }

  async function sendCommand() {
    if (!currentState.agentId || !currentState.action) return;

    // Cancel any previous result watcher
    clearResultWatcher();

    var jsonEl = document.getElementById('panel-json');
    var payloadSection = document.getElementById('panel-payload-section');
    var payload = {};

    if (payloadSection && payloadSection.style.display !== 'none') {
      try {
        payload = JSON.parse(jsonEl.value || '{}');
      } catch (e) {
        if (jsonEl) jsonEl.style.borderColor = 'var(--red)';
        return;
      }
    }

    var sendBtn = document.getElementById('panel-send-btn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending\u2026'; }

    var dispatchResult = await L.fireCmd(currentState.agentId, currentState.componentId, currentState.action, payload);

    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send Command'; }

    // Update history immediately after dispatch
    var historyEl = document.getElementById('panel-history-list');
    if (historyEl) historyEl.innerHTML = renderHistory();

    var requestId = dispatchResult && dispatchResult.request_id;

    if (!dispatchResult.ok || !requestId) {
      // Dispatch failed — show error inline
      var resultEl2 = document.getElementById('panel-result');
      if (resultEl2) {
        resultEl2.style.display = '';
        var errMsg = (dispatchResult.result && (dispatchResult.result.error || dispatchResult.result.detail)) || 'dispatch failed';
        resultEl2.innerHTML = '<div class="result-err">' +
          '<span class="result-icon">\u2717</span>' +
          '<span class="result-action">' + L.esc(currentState.action) + '</span>' +
          '<div class="result-err-msg">' + L.esc(errMsg) + '</div>' +
          '</div>';
      }
      return;
    }

    // Dispatch OK — show waiting state and watch for WS result
    var resultEl = document.getElementById('panel-result');
    if (resultEl) {
      resultEl.style.display = '';
      resultEl.innerHTML = '<div class="result-pending">\u27F3 Waiting for agent response\u2026</div>';
    }

    L._panelWatchingRequestId = requestId;
    _currentRequestId = requestId;

    function handleCmdResult(entry, evt) {
      if (!evt || !evt.payload || evt.payload.request_id !== _currentRequestId) return;
      clearResultWatcher();
      showPanelResult(entry, evt);
      var histEl = document.getElementById('panel-history-list');
      if (histEl) histEl.innerHTML = renderHistory();
    }

    _resultUnsubscribe = L.onCmdResult(handleCmdResult);
    _resultTimeout = setTimeout(function () {
      clearResultWatcher();
      showTimeout();
    }, 30000);
  }

  function renderHistory() {
    if (!L.commandHistory.length) return '<div class="comp-empty">No commands sent yet</div>';
    return L.commandHistory.slice(0, 10).map(function (cmd) {
      var icon, cls;
      if (cmd.result_received) {
        icon = cmd.result_ok ? '\u2713' : '\u2717';
        cls = cmd.result_ok ? 'act-ok' : 'act-err';
      } else if (cmd.ok) {
        icon = '\u2026'; // dispatched, awaiting agent result
        cls = 'act-pending';
      } else {
        icon = '\u2717';
        cls = 'act-err';
      }
      var target = (cmd.componentId ? cmd.componentId + '/' : '') + cmd.action;
      var elapsed = cmd.result_received && cmd.result_elapsed != null
        ? L.fmtDuration(cmd.result_elapsed)
        : L.fmtDuration(cmd.elapsed);
      return '<div class="history-row">' +
        '<span class="activity-icon ' + cls + '">' + icon + '</span>' +
        '<span class="history-target">' + L.esc(target) + '</span>' +
        '<span class="history-agent">' + L.esc(cmd.agentId) + '</span>' +
        '<span class="history-time">' + elapsed + '</span>' +
        '<span class="activity-ts">' + L.fmtTs(cmd.ts) + '</span>' +
        '</div>';
    }).join('');
  }

})(window.LUCID);
