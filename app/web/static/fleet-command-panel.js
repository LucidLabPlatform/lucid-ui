// fleet-command-panel.js — Slide-out command panel with schema-driven forms
// Depends on: fleet-utils.js, fleet.js

(function (L) {
  'use strict';

  var panelEl, overlayEl;
  var currentState = { agentId: null, componentId: null, action: null };

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
    if (panelEl) { panelEl.classList.remove('open'); panelEl.classList.add('hidden'); }
    if (overlayEl) overlayEl.classList.add('hidden');
  };

  function renderPanel() {
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

    var html = '';
    fields.forEach(function (f, i) {
      var c = f.control;
      var id = 'pf-' + i;
      var inputHtml = '';

      if (c.type === 'enum') {
        inputHtml = '<select class="panel-input" id="' + id + '">';
        (c.options || []).forEach(function (opt) {
          var sel = opt === f.value ? ' selected' : '';
          inputHtml += '<option value="' + L.escAttr(opt) + '"' + sel + '>' + L.esc(opt) + '</option>';
        });
        inputHtml += '</select>';
      } else if (c.type === 'slider') {
        var val = typeof f.value === 'number' ? f.value : Math.round((c.min + c.max) / 2);
        inputHtml = '<div class="slider-row"><input type="range" id="' + id + '" class="panel-slider" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" value="' + val + '" oninput="this.nextElementSibling.textContent=this.value"><span class="slider-val">' + val + '</span></div>';
      } else if (c.type === 'number') {
        inputHtml = '<input type="number" id="' + id + '" class="panel-input" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" value="' + (f.value != null ? f.value : 0) + '">';
      } else if (c.type === 'toggle') {
        var checked = f.value === true || f.value === 'true' ? ' checked' : '';
        inputHtml = '<label class="toggle-label"><input type="checkbox" id="' + id + '" class="panel-toggle"' + checked + '><span>' + (f.value === true || f.value === 'true' ? 'on' : 'off') + '</span></label>';
      } else {
        inputHtml = '<input type="text" id="' + id + '" class="panel-input" value="' + L.escAttr(f.value != null ? f.value : '') + '">';
      }

      html += '<div class="payload-field">';
      html += '<label class="payload-label" for="' + id + '">' + L.esc(f.path) + '</label>';
      if (f.description) html += '<div class="payload-desc">' + L.esc(f.description) + '</div>';
      html += inputHtml;
      html += '</div>';
    });

    formEl.innerHTML = html;
    formEl.dataset.fieldCount = fields.length;
    formEl.dataset.fields = JSON.stringify(fields.map(function (f) { return { path: f.path, control: f.control }; }));

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

    var result = await L.fireCmd(currentState.agentId, currentState.componentId, currentState.action, payload);

    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send Command'; }

    // Show inline result
    var resultEl = document.getElementById('panel-result');
    if (resultEl) {
      resultEl.style.display = '';
      var cls = result.ok ? 'result-ok' : 'result-err';
      resultEl.innerHTML = '<div class="' + cls + '">' +
        '<span class="result-icon">' + (result.ok ? '\u2713' : '\u2717') + '</span>' +
        '<span class="result-action">' + L.esc(currentState.action) + '</span>' +
        '<span class="result-time">' + L.fmtDuration(result.elapsed) + '</span>' +
        '</div>' +
        (result.result ? '<pre class="result-payload">' + L.esc(JSON.stringify(result.result, null, 2)) + '</pre>' : '');
    }

    // Update history
    var historyEl = document.getElementById('panel-history-list');
    if (historyEl) historyEl.innerHTML = renderHistory();
  }

  function renderHistory() {
    if (!L.commandHistory.length) return '<div class="comp-empty">No commands sent yet</div>';
    return L.commandHistory.slice(0, 10).map(function (cmd) {
      var icon = cmd.ok ? '\u2713' : '\u2717';
      var cls = cmd.ok ? 'act-ok' : 'act-err';
      var target = (cmd.componentId ? cmd.componentId + '/' : '') + cmd.action;
      return '<div class="history-row">' +
        '<span class="activity-icon ' + cls + '">' + icon + '</span>' +
        '<span class="history-target">' + L.esc(target) + '</span>' +
        '<span class="history-agent">' + L.esc(cmd.agentId) + '</span>' +
        '<span class="history-time">' + L.fmtDuration(cmd.elapsed) + '</span>' +
        '<span class="activity-ts">' + L.fmtTs(cmd.ts) + '</span>' +
        '</div>';
    }).join('');
  }

})(window.LUCID);
