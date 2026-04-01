/* Experiment Templates page */
let _currentTemplate = null;
let _templates = [];
let _editorMode = 'builder';
let _builderState = null;
let _builderDisabledReason = null;

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultStep(type = 'command') {
  const base = {
    name: '',
    type,
    onFailure: 'abort',
    retries: 0,
    agentId: '',
    componentId: '',
    action: '',
    timeoutS: '30',
    paramsText: '{}',
    durationS: '1',
    operation: 'create',
    sourceTopic: '',
    targetTopic: '',
    selectClause: '*',
    payloadTemplate: '',
    qos: 0,
    steps: [],
  };
  if (type === 'delay') base.durationS = '1';
  if (type === 'parallel') {
    base.steps = [defaultStep('command')];
  }
  return base;
}

function defaultBuilderState() {
  return {
    id: '',
    name: '',
    version: '1.0.0',
    description: '',
    tagsText: '',
    parameters: [],
    steps: [],
  };
}

function templateToBuilderState(template) {
  const state = defaultBuilderState();
  state.id = template.id || '';
  state.name = template.name || '';
  state.version = template.version || '1.0.0';
  state.description = template.description || '';
  state.tagsText = (template.tags || []).join(', ');
  state.parameters = Object.entries(template.parameters || {}).map(([key, spec]) => ({
    key,
    type: spec.type || inferType(spec.default),
    defaultValue: spec.default == null ? '' : String(spec.default),
    description: spec.description || '',
    required: Boolean(spec.required),
  }));
  state.steps = (template.steps || []).map(stepToBuilderState);
  return state;
}

function stepToBuilderState(step) {
  return {
    name: step.name || '',
    type: step.type || 'command',
    onFailure: step.on_failure || 'abort',
    retries: step.retries ?? 0,
    agentId: step.agent_id || '',
    componentId: step.component_id || '',
    action: step.action || '',
    timeoutS: step.timeout_s == null ? '30' : String(step.timeout_s),
    paramsText: JSON.stringify(step.params || {}, null, 2),
    durationS: step.duration_s == null ? '1' : String(step.duration_s),
    operation: step.operation || 'create',
    sourceTopic: step.source_topic || '',
    targetTopic: step.target_topic || '',
    selectClause: step.select_clause || '*',
    payloadTemplate: step.payload_template || '',
    qos: step.qos ?? 0,
    steps: (step.steps || []).map(stepToBuilderState),
  };
}

function inferType(value) {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'float';
  return 'string';
}

function parseDefaultValue(type, value, required, paramName) {
  if (value === '') {
    return required ? null : null;
  }
  if (type === 'integer') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) throw new Error(`Parameter '${paramName}' default must be an integer`);
    return parsed;
  }
  if (type === 'float') {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) throw new Error(`Parameter '${paramName}' default must be a number`);
    return parsed;
  }
  if (type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`Parameter '${paramName}' default must be true or false`);
  }
  return value;
}

function coerceMaybeNumber(value) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('${')) return trimmed;
  const asNumber = Number(trimmed);
  return Number.isNaN(asNumber) ? trimmed : asNumber;
}

function builderStateToTemplate(state) {
  const id = state.id.trim();
  const name = state.name.trim();
  if (!id) throw new Error("Template ID is required");
  if (!name) throw new Error("Template name is required");

  const parameters = {};
  for (const param of state.parameters) {
    const key = param.key.trim();
    if (!key) throw new Error("Parameter names must not be empty");
    parameters[key] = {
      type: param.type,
      default: parseDefaultValue(param.type, param.defaultValue, param.required, key),
      description: param.description.trim(),
      required: Boolean(param.required),
    };
  }

  return {
    id,
    name,
    version: state.version.trim() || '1.0.0',
    description: state.description.trim(),
    tags: state.tagsText
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean),
    parameters,
    steps: state.steps.map(builderStepToTemplate),
  };
}

function builderStateToDraft(state) {
  return {
    id: state.id.trim(),
    name: state.name.trim(),
    version: state.version.trim() || '1.0.0',
    description: state.description.trim(),
    tags: state.tagsText
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean),
    parameters: Object.fromEntries(
      state.parameters
        .filter(param => param.key.trim())
        .map(param => [
          param.key.trim(),
          {
            type: param.type,
            default: param.defaultValue === '' ? null : param.defaultValue,
            description: param.description.trim(),
            required: Boolean(param.required),
          },
        ])
    ),
    steps: state.steps.map(builderStepToDraft),
  };
}

function builderStepToTemplate(step) {
  const name = step.name.trim();
  if (!name) throw new Error("Every step must have a name");

  const common = {
    name,
    type: step.type,
    on_failure: step.onFailure,
    retries: Number.parseInt(step.retries, 10) || 0,
  };

  if (step.type === 'command') {
    if (!step.action.trim()) throw new Error(`Command step '${name}' must specify an action`);
    let params = {};
    if (step.paramsText.trim()) {
      try {
        params = JSON.parse(step.paramsText);
      } catch (err) {
        throw new Error(`Command step '${name}' params must be valid JSON: ${err.message}`);
      }
      if (params == null || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error(`Command step '${name}' params must be a JSON object`);
      }
    }
    return {
      ...common,
      agent_id: step.agentId.trim() || undefined,
      component_id: step.componentId.trim() || undefined,
      action: step.action.trim(),
      timeout_s: coerceMaybeNumber(step.timeoutS) ?? 30,
      params,
    };
  }

  if (step.type === 'delay') {
    return {
      ...common,
      duration_s: coerceMaybeNumber(step.durationS) ?? 1,
    };
  }

  if (step.type === 'topic_link') {
    if (!step.sourceTopic.trim() || !step.targetTopic.trim()) {
      throw new Error(`Topic-link step '${name}' must specify source and target topics`);
    }
    return {
      ...common,
      operation: step.operation,
      source_topic: step.sourceTopic.trim(),
      target_topic: step.targetTopic.trim(),
      select_clause: step.selectClause.trim() || '*',
      payload_template: step.payloadTemplate.trim() || undefined,
      qos: Number.parseInt(step.qos, 10) || 0,
    };
  }

  if (!step.steps.length) {
    throw new Error(`Parallel step '${name}' must contain at least one sub-step`);
  }
  return {
    ...common,
    steps: step.steps.map(builderStepToTemplate),
  };
}

function builderStepToDraft(step) {
  const common = {
    name: step.name.trim(),
    type: step.type,
    on_failure: step.onFailure,
    retries: Number.parseInt(step.retries, 10) || 0,
  };

  if (step.type === 'command') {
    return {
      ...common,
      agent_id: step.agentId.trim() || undefined,
      component_id: step.componentId.trim() || undefined,
      action: step.action.trim() || undefined,
      timeout_s: step.timeoutS.trim() || undefined,
      params: safeParseJson(step.paramsText, {}),
    };
  }

  if (step.type === 'delay') {
    return {
      ...common,
      duration_s: step.durationS.trim() || undefined,
    };
  }

  if (step.type === 'topic_link') {
    return {
      ...common,
      operation: step.operation,
      source_topic: step.sourceTopic.trim() || undefined,
      target_topic: step.targetTopic.trim() || undefined,
      select_clause: step.selectClause.trim() || '*',
      payload_template: step.payloadTemplate.trim() || undefined,
      qos: Number.parseInt(step.qos, 10) || 0,
    };
  }

  return {
    ...common,
    steps: step.steps.map(builderStepToDraft),
  };
}

function safeParseJson(text, fallback) {
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isBuilderSupportedTemplate(template) {
  const allowedTemplateKeys = new Set(['id', 'name', 'version', 'description', 'parameters', 'steps', 'tags']);
  for (const key of Object.keys(template || {})) {
    if (!allowedTemplateKeys.has(key)) return `Unsupported template field '${key}'`;
  }
  return isBuilderSupportedSteps(template.steps || [], 0);
}

function isBuilderSupportedSteps(steps, depth) {
  for (const step of steps) {
    const allowedCommon = new Set(['name', 'type', 'on_failure', 'retries']);
    const type = step.type || 'command';
    let allowed = new Set(allowedCommon);
    if (type === 'command') {
      ['agent_id', 'component_id', 'action', 'params', 'timeout_s'].forEach(k => allowed.add(k));
    } else if (type === 'delay') {
      ['duration_s'].forEach(k => allowed.add(k));
    } else if (type === 'topic_link') {
      ['operation', 'source_topic', 'target_topic', 'select_clause', 'payload_template', 'qos'].forEach(k => allowed.add(k));
    } else if (type === 'parallel') {
      if (depth >= 1) return 'Nested parallel steps are only editable in advanced mode';
      ['steps'].forEach(k => allowed.add(k));
    } else {
      return `Unsupported step type '${type}'`;
    }
    for (const key of Object.keys(step)) {
      if (!allowed.has(key)) return `Unsupported step field '${key}'`;
    }
    if (type === 'parallel') {
      const nested = isBuilderSupportedSteps(step.steps || [], depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function pathKey(path) {
  return path.replace(/\./g, '-');
}

function parsePath(path) {
  return path === '' ? [] : path.split('.').map(Number);
}

function getStepArrayAndIndex(path) {
  const parts = parsePath(path);
  let arr = _builderState.steps;
  for (let i = 0; i < parts.length - 1; i += 1) {
    arr = arr[parts[i]].steps;
  }
  return { arr, index: parts[parts.length - 1] };
}

function getStep(path) {
  const parts = parsePath(path);
  let current = null;
  let arr = _builderState.steps;
  for (const idx of parts) {
    current = arr[idx];
    arr = current.steps;
  }
  return current;
}

function syncBuilderFromDom() {
  if (!_builderState) return;
  _builderState.id = document.getElementById('builder-id').value;
  _builderState.name = document.getElementById('builder-name').value;
  _builderState.version = document.getElementById('builder-version').value;
  _builderState.description = document.getElementById('builder-description').value;
  _builderState.tagsText = document.getElementById('builder-tags').value;

  _builderState.parameters.forEach((param, index) => {
    param.key = document.getElementById(`builder-param-key-${index}`).value;
    param.type = document.getElementById(`builder-param-type-${index}`).value;
    param.defaultValue = document.getElementById(`builder-param-default-${index}`).value;
    param.description = document.getElementById(`builder-param-desc-${index}`).value;
    param.required = document.getElementById(`builder-param-required-${index}`).checked;
  });

  const syncStep = (step, path) => {
    const key = pathKey(path);
    step.name = document.getElementById(`builder-step-name-${key}`).value;
    step.type = document.getElementById(`builder-step-type-${key}`).value;
    step.onFailure = document.getElementById(`builder-step-failure-${key}`).value;
    step.retries = document.getElementById(`builder-step-retries-${key}`).value;
    if (step.type === 'command') {
      step.agentId = document.getElementById(`builder-step-agent-${key}`).value;
      step.componentId = document.getElementById(`builder-step-component-${key}`).value;
      step.action = document.getElementById(`builder-step-action-${key}`).value;
      step.timeoutS = document.getElementById(`builder-step-timeout-${key}`).value;
      step.paramsText = document.getElementById(`builder-step-params-${key}`).value;
    } else if (step.type === 'delay') {
      step.durationS = document.getElementById(`builder-step-duration-${key}`).value;
    } else if (step.type === 'topic_link') {
      step.operation = document.getElementById(`builder-step-operation-${key}`).value;
      step.sourceTopic = document.getElementById(`builder-step-source-${key}`).value;
      step.targetTopic = document.getElementById(`builder-step-target-${key}`).value;
      step.selectClause = document.getElementById(`builder-step-select-${key}`).value;
      step.payloadTemplate = document.getElementById(`builder-step-payload-${key}`).value;
      step.qos = document.getElementById(`builder-step-qos-${key}`).value;
    } else if (step.type === 'parallel') {
      step.steps.forEach((child, idx) => syncStep(child, `${path}.${idx}`));
    }
  };

  _builderState.steps.forEach((step, index) => syncStep(step, String(index)));
}

function renderBuilder() {
  if (!_builderState) _builderState = defaultBuilderState();
  document.getElementById('builder-id').value = _builderState.id;
  document.getElementById('builder-name').value = _builderState.name;
  document.getElementById('builder-version').value = _builderState.version;
  document.getElementById('builder-description').value = _builderState.description;
  document.getElementById('builder-tags').value = _builderState.tagsText;

  const paramsEl = document.getElementById('builder-parameters');
  paramsEl.innerHTML = _builderState.parameters.length
    ? _builderState.parameters.map((param, index) => renderParameter(param, index)).join('')
    : '<div class="empty">No parameters yet.</div>';

  const stepsEl = document.getElementById('builder-steps');
  stepsEl.innerHTML = _builderState.steps.length
    ? _builderState.steps.map((step, index) => renderStep(step, String(index), 0)).join('')
    : '<div class="empty">No steps yet. Add a step to define the experiment flow.</div>';
}

function renderParameter(param, index) {
  return `
    <div class="builder-item">
      <div class="builder-item-header">
        <strong>Parameter</strong>
        <button type="button" class="btn-danger" onclick="removeParameter(${index})">Remove</button>
      </div>
      <div class="builder-inline-grid">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" id="builder-param-key-${index}" type="text" value="${escAttr(param.key)}" placeholder="robot_id">
        </div>
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-input" id="builder-param-type-${index}">
            ${selectOptions(['string', 'integer', 'float', 'boolean'], param.type)}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Default</label>
          <input class="form-input" id="builder-param-default-${index}" type="text" value="${escAttr(param.defaultValue)}" placeholder="optional">
        </div>
      </div>
      <div class="builder-inline-grid">
        <div class="form-group">
          <label class="form-label">Description</label>
          <input class="form-input" id="builder-param-desc-${index}" type="text" value="${escAttr(param.description)}" placeholder="What this parameter controls">
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end">
          <label class="builder-checkbox">
            <input id="builder-param-required-${index}" type="checkbox" ${param.required ? 'checked' : ''}>
            Required
          </label>
        </div>
      </div>
    </div>
  `;
}

function renderStep(step, path, depth) {
  const key = pathKey(path);
  const isParallel = step.type === 'parallel';
  const childSteps = isParallel
    ? `
      <div class="builder-step-children">
        <div class="builder-section-header">
          <h4>Parallel sub-steps</h4>
          <button type="button" class="btn-sm" onclick="addStep('${path}', true)">+ Add Sub-step</button>
        </div>
        ${(step.steps || []).length
          ? (step.steps || []).map((child, index) => renderStep(child, `${path}.${index}`, depth + 1)).join('')
          : '<div class="empty">No sub-steps yet.</div>'}
      </div>
    `
    : '';

  return `
    <div class="builder-item builder-step ${depth > 0 ? 'builder-step-nested' : ''}">
      <div class="builder-item-header">
        <strong>${depth > 0 ? 'Sub-step' : 'Step'}</strong>
        <div class="builder-item-actions">
          <button type="button" class="btn-sm" onclick="moveStep('${path}', -1)">↑</button>
          <button type="button" class="btn-sm" onclick="moveStep('${path}', 1)">↓</button>
          <button type="button" class="btn-danger" onclick="removeStep('${path}')">Remove</button>
        </div>
      </div>

      <div class="builder-inline-grid">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" id="builder-step-name-${key}" type="text" value="${escAttr(step.name)}" placeholder="start_foraging">
        </div>
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-input" id="builder-step-type-${key}" onchange="changeStepType('${path}', this.value)">
            ${selectOptions(depth > 0 ? ['command', 'delay', 'topic_link'] : ['command', 'delay', 'topic_link', 'parallel'], step.type)}
          </select>
        </div>
      </div>

      <div class="builder-inline-grid">
        <div class="form-group">
          <label class="form-label">On Failure</label>
          <select class="form-input" id="builder-step-failure-${key}">
            ${selectOptions(['abort', 'continue'], step.onFailure)}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Retries</label>
          <input class="form-input" id="builder-step-retries-${key}" type="number" min="0" value="${escAttr(step.retries)}">
        </div>
      </div>

      ${renderStepFields(step, key)}
      ${childSteps}
    </div>
  `;
}

function renderStepFields(step, key) {
  if (step.type === 'command') {
    return `
      <div class="builder-inline-grid">
        <div class="form-group">
          <label class="form-label">Agent ID</label>
          <input class="form-input" id="builder-step-agent-${key}" type="text" value="${escAttr(step.agentId)}" placeholder="robot_id or \${robot_id}">
        </div>
        <div class="form-group">
          <label class="form-label">Component ID</label>
          <input class="form-input" id="builder-step-component-${key}" type="text" value="${escAttr(step.componentId)}" placeholder="optional">
        </div>
        <div class="form-group">
          <label class="form-label">Action</label>
          <input class="form-input" id="builder-step-action-${key}" type="text" value="${escAttr(step.action)}" placeholder="ping">
        </div>
      </div>
      <div class="builder-inline-grid">
        <div class="form-group">
          <label class="form-label">Timeout (seconds)</label>
          <input class="form-input" id="builder-step-timeout-${key}" type="text" value="${escAttr(step.timeoutS)}" placeholder="30">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Params JSON</label>
        <textarea class="form-textarea builder-textarea" id="builder-step-params-${key}" rows="5" spellcheck="false">${escText(step.paramsText)}</textarea>
      </div>
    `;
  }

  if (step.type === 'delay') {
    return `
      <div class="builder-inline-grid">
        <div class="form-group">
          <label class="form-label">Duration (seconds)</label>
          <input class="form-input" id="builder-step-duration-${key}" type="text" value="${escAttr(step.durationS)}" placeholder="10">
        </div>
      </div>
    `;
  }

  if (step.type === 'topic_link') {
    return `
      <div class="builder-inline-grid">
        <div class="form-group">
          <label class="form-label">Operation</label>
          <select class="form-input" id="builder-step-operation-${key}">
            ${selectOptions(['create', 'activate', 'deactivate', 'delete'], step.operation)}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">QoS</label>
          <select class="form-input" id="builder-step-qos-${key}">
            ${selectOptions(['0', '1'], String(step.qos))}
          </select>
        </div>
      </div>
      <div class="builder-inline-grid">
        <div class="form-group">
          <label class="form-label">Source Topic</label>
          <input class="form-input" id="builder-step-source-${key}" type="text" value="${escAttr(step.sourceTopic)}" placeholder="lucid/agents/\${robot_id}/components/perception/evt/color_detected">
        </div>
        <div class="form-group">
          <label class="form-label">Target Topic</label>
          <input class="form-input" id="builder-step-target-${key}" type="text" value="${escAttr(step.targetTopic)}" placeholder="lucid/agents/\${led_agent_id}/components/led_strip/cmd/set-color">
        </div>
      </div>
      <div class="builder-inline-grid">
        <div class="form-group">
          <label class="form-label">Select Clause</label>
          <input class="form-input" id="builder-step-select-${key}" type="text" value="${escAttr(step.selectClause)}" placeholder="*">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Payload Template</label>
        <textarea class="form-textarea builder-textarea" id="builder-step-payload-${key}" rows="4" spellcheck="false" placeholder='{"request_id":"\${id}"}'>${escText(step.payloadTemplate)}</textarea>
      </div>
    `;
  }

  return '<div class="empty">Parallel step — add and order sub-steps below.</div>';
}

function selectOptions(options, currentValue) {
  return options.map(value => {
    const label = typeof value === 'string' ? value : value.label;
    const optionValue = typeof value === 'string' ? value : value.value;
    const selected = String(optionValue) === String(currentValue) ? 'selected' : '';
    return `<option value="${escAttr(optionValue)}" ${selected}>${esc(label)}</option>`;
  }).join('');
}

function addParameter() {
  syncBuilderFromDom();
  _builderState.parameters.push({
    key: '',
    type: 'string',
    defaultValue: '',
    description: '',
    required: false,
  });
  renderBuilder();
}

function removeParameter(index) {
  syncBuilderFromDom();
  _builderState.parameters.splice(index, 1);
  renderBuilder();
}

function addStep(parentPath, nested = false) {
  syncBuilderFromDom();
  const step = defaultStep('command');
  if (parentPath === '') {
    _builderState.steps.push(step);
  } else {
    const target = getStep(parentPath);
    if (!target.steps) target.steps = [];
    target.steps.push(defaultStep(nested ? 'command' : 'command'));
  }
  renderBuilder();
}

function removeStep(path) {
  syncBuilderFromDom();
  const { arr, index } = getStepArrayAndIndex(path);
  arr.splice(index, 1);
  renderBuilder();
}

function moveStep(path, delta) {
  syncBuilderFromDom();
  const { arr, index } = getStepArrayAndIndex(path);
  const target = index + delta;
  if (target < 0 || target >= arr.length) return;
  [arr[index], arr[target]] = [arr[target], arr[index]];
  renderBuilder();
}

function changeStepType(path, nextType) {
  syncBuilderFromDom();
  const step = getStep(path);
  const name = step.name;
  const onFailure = step.onFailure;
  const retries = step.retries;
  Object.assign(step, defaultStep(nextType));
  step.name = name;
  step.onFailure = onFailure;
  step.retries = retries;
  renderBuilder();
}

function setEditorMode(mode) {
  const errEl = document.getElementById('editor-error');
  errEl.style.display = 'none';
  if (mode === 'builder' && _builderDisabledReason) {
    errEl.textContent = _builderDisabledReason;
    errEl.style.display = 'block';
    return;
  }
  if (mode === 'advanced') {
    syncBuilderFromDom();
    if (_builderState) {
      document.getElementById('editor-json').value = JSON.stringify(builderStateToDraft(_builderState), null, 2);
    }
  } else {
    try {
      const raw = JSON.parse(document.getElementById('editor-json').value);
      const reason = isBuilderSupportedTemplate(raw);
      if (reason) {
        _builderDisabledReason = reason;
        errEl.textContent = `This template is advanced-only: ${reason}`;
        errEl.style.display = 'block';
        return;
      }
      _builderState = templateToBuilderState(raw);
      _builderDisabledReason = null;
      renderBuilder();
    } catch (err) {
      errEl.textContent = 'Builder mode requires valid JSON first: ' + err.message;
      errEl.style.display = 'block';
      return;
    }
  }
  _editorMode = mode;
  document.getElementById('builder-panel').style.display = mode === 'builder' ? '' : 'none';
  document.getElementById('advanced-panel').style.display = mode === 'advanced' ? '' : 'none';
  document.getElementById('builder-tab-btn').classList.toggle('active', mode === 'builder');
  document.getElementById('advanced-tab-btn').classList.toggle('active', mode === 'advanced');
}

function configureEditorMode(reason) {
  _builderDisabledReason = reason;
  const noteEl = document.getElementById('editor-mode-note');
  const builderBtn = document.getElementById('builder-tab-btn');
  if (reason) {
    builderBtn.disabled = true;
    noteEl.textContent = `Advanced-only template: ${reason}`;
    noteEl.className = 'modal-status err';
    _editorMode = 'advanced';
    document.getElementById('advanced-panel').style.display = '';
    document.getElementById('builder-panel').style.display = 'none';
    document.getElementById('advanced-tab-btn').classList.add('active');
    document.getElementById('builder-tab-btn').classList.remove('active');
  } else {
    builderBtn.disabled = false;
    noteEl.textContent = 'Visual builder is active. Switch to advanced JSON for unsupported structures or raw edits.';
    noteEl.className = 'modal-status';
    _editorMode = 'builder';
    document.getElementById('advanced-panel').style.display = 'none';
    document.getElementById('builder-panel').style.display = '';
    document.getElementById('builder-tab-btn').classList.add('active');
    document.getElementById('advanced-tab-btn').classList.remove('active');
  }
}

async function loadTemplates() {
  const grid = document.getElementById('tpl-grid');
  try {
    const res = await fetch('/api/experiments/templates');
    _templates = await res.json();

    document.getElementById('tpl-count').textContent =
      `${_templates.length} template${_templates.length !== 1 ? 's' : ''}`;

    if (!_templates.length) {
      grid.innerHTML = '<div class="empty">No templates found. Click <strong>+ New Template</strong> to create one.</div>';
      return;
    }

    const valid = _templates.filter(t => t.id);
    if (!valid.length) {
      grid.innerHTML = '<div class="empty">No templates found. Click <strong>+ New Template</strong> to create one.</div>';
      document.getElementById('tpl-count').textContent = '0 templates';
      return;
    }

    grid.innerHTML = valid.map((t, idx) => `
      <div class="exp-card">
        <div style="display:flex;align-items:baseline;gap:0.5rem;">
          <div class="exp-card-title">${esc(t.name)}</div>
          <div class="exp-card-ver">v${esc(t.version)}</div>
        </div>
        <div class="exp-card-desc">${esc(t.description || 'No description')}</div>
        <div class="exp-card-tags">
          ${(t.tags || []).map(tag => `<span class="exp-tag">${esc(tag)}</span>`).join('')}
        </div>
        <div class="exp-card-footer">
          <div style="display:flex;gap:0.4rem">
            <button class="btn-sm" onclick="openEditorModal(${idx})">Edit</button>
            <button class="btn-danger" onclick='deleteTemplate(event, ${JSON.stringify(t.id)}, ${JSON.stringify(t.name)})'>Delete</button>
          </div>
          <button class="btn-primary" onclick="openRunModal(${idx})">Run</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    grid.innerHTML = `<div class="empty">Failed to load templates: ${esc(String(err))}</div>`;
  }
}

function openEditorModal(idx) {
  const titleEl = document.getElementById('editor-title');
  const jsonEl = document.getElementById('editor-json');
  const errEl = document.getElementById('editor-error');
  errEl.style.display = 'none';

  let raw;
  if (idx === null) {
    titleEl.textContent = 'New Template';
    _builderState = defaultBuilderState();
    raw = builderStateToDraft(_builderState);
  } else {
    const template = _templates[idx];
    titleEl.textContent = `Edit: ${template.name}`;
    raw = deepClone(template.definition || template);
    _builderState = templateToBuilderState(raw);
  }

  jsonEl.value = JSON.stringify(raw, null, 2);
  const reason = isBuilderSupportedTemplate(raw);
  if (!reason) {
    _builderState = templateToBuilderState(raw);
    renderBuilder();
  }
  configureEditorMode(reason);

  document.getElementById('editor-modal').classList.add('open');
  setTimeout(() => {
    if (_editorMode === 'builder') {
      document.getElementById('builder-name').focus();
    } else {
      jsonEl.focus();
    }
  }, 50);
}

async function submitTemplate() {
  const btn = document.getElementById('editor-submit-btn');
  const errEl = document.getElementById('editor-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Saving…';

  let body;
  try {
    if (_editorMode === 'builder') {
      syncBuilderFromDom();
      body = builderStateToTemplate(_builderState);
      document.getElementById('editor-json').value = JSON.stringify(body, null, 2);
    } else {
      body = JSON.parse(document.getElementById('editor-json').value);
    }
  } catch (err) {
    errEl.textContent = err.message.startsWith('Unexpected')
      ? `Invalid JSON: ${err.message}`
      : err.message;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Save Template';
    return;
  }

  try {
    const res = await fetch('/api/experiments/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.detail || 'Unknown error';
      errEl.style.display = 'block';
      return;
    }
    closeModal('editor-modal');
    loadTemplates();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Template';
  }
}

async function deleteTemplate(e, id, name) {
  e.stopPropagation();
  if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
  const r = await fetch(`/api/experiments/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    alert('Delete failed: ' + (d.detail || r.status));
    return;
  }
  loadTemplates();
}

function openRunModal(idx) {
  _currentTemplate = _templates[idx];
  document.getElementById('modal-title').textContent = `Run: ${_currentTemplate.name}`;
  document.getElementById('modal-subtitle').textContent = _currentTemplate.description || '';
  document.getElementById('modal-status').textContent = '';
  document.getElementById('modal-status').className = 'modal-status';

  const schema = _currentTemplate.parameters_schema || {};
  const formEl = document.getElementById('param-form');

  if (!Object.keys(schema).length) {
    formEl.innerHTML = '<div class="empty" style="padding:0.5rem 0">No parameters required.</div>';
  } else {
    formEl.innerHTML = Object.entries(schema).map(([key, spec]) => {
      const required = spec.required ? '<span class="param-req">*</span>' : '';
      const defaultVal = spec.default != null ? spec.default : '';
      return `
        <div class="param-group">
          <label class="param-label">
            <span class="param-name">${esc(key)}</span>
            <span class="param-type">${esc(spec.type || 'string')}</span>
            ${required}
          </label>
          ${spec.description ? `<div class="param-desc">${esc(spec.description)}</div>` : ''}
          <input
            class="param-input"
            id="param-${escAttr(key)}"
            type="text"
            placeholder="${escAttr(String(defaultVal))}"
            value="${escAttr(String(defaultVal))}"
          />
        </div>
      `;
    }).join('');
  }

  document.getElementById('run-modal').classList.add('open');
}

async function submitRun() {
  if (!_currentTemplate) return;
  const btn = document.getElementById('modal-run-btn');
  const statusEl = document.getElementById('modal-status');
  btn.disabled = true;
  statusEl.textContent = 'Starting…';
  statusEl.className = 'modal-status';

  const schema = _currentTemplate.parameters_schema || {};
  const params = {};
  for (const key of Object.keys(schema)) {
    const input = document.getElementById(`param-${key}`);
    if (input) {
      const val = input.value.trim();
      if (val !== '') params[key] = val;
    }
  }

  try {
    const res = await fetch('/api/experiments/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: _currentTemplate.id, params }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);
    statusEl.textContent = `Run started — ID: ${data.run_id}`;
    statusEl.className = 'modal-status ok';
    setTimeout(() => { window.location.href = `/experiments/runs/${data.run_id}`; }, 800);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'modal-status err';
    btn.disabled = false;
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'run-modal') _currentTemplate = null;
}

document.getElementById('run-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal('run-modal');
});
document.getElementById('editor-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal('editor-modal');
});

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return esc(str).replace(/'/g, '&#39;');
}

function escText(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

loadTemplates();
