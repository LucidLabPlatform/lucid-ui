/* Experiment Templates page */
let _currentTemplate = null;
let _templates = [];

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
            <button class="btn-danger" onclick="deleteTemplate(event, '${esc(t.id)}', '${esc(t.name)}')">Delete</button>
          </div>
          <button class="btn-primary" onclick="openRunModal(${idx})">Run</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    grid.innerHTML = `<div class="empty">Failed to load templates: ${esc(String(err))}</div>`;
  }
}

// ── Editor modal (create / edit) ──────────────────────────────────

function openEditorModal(idx) {
  const titleEl = document.getElementById('editor-title');
  const jsonEl = document.getElementById('editor-json');
  const errEl = document.getElementById('editor-error');
  errEl.style.display = 'none';

  if (idx === null) {
    titleEl.textContent = 'New Template';
    jsonEl.value = JSON.stringify({
      id: '',
      name: '',
      version: '1.0.0',
      description: '',
      parameters: {},
      steps: []
    }, null, 2);
  } else {
    const t = _templates[idx];
    titleEl.textContent = `Edit: ${t.name}`;
    jsonEl.value = JSON.stringify(t.definition || t, null, 2);
  }

  document.getElementById('editor-modal').classList.add('open');
  setTimeout(() => jsonEl.focus(), 50);
}

async function submitTemplate() {
  const jsonEl = document.getElementById('editor-json');
  const btn = document.getElementById('editor-submit-btn');
  const errEl = document.getElementById('editor-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Saving…';

  let body;
  try {
    body = JSON.parse(jsonEl.value);
  } catch (e) {
    errEl.textContent = 'Invalid JSON: ' + e.message;
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

// ── Run modal ─────────────────────────────────────────────────────

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
            id="param-${esc(key)}"
            type="text"
            placeholder="${esc(String(defaultVal))}"
            value="${esc(String(defaultVal))}"
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

// ── Shared helpers ────────────────────────────────────────────────

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

loadTemplates();
