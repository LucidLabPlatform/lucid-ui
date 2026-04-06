/* Experiment Run detail page — live WebSocket updates */

const STATUS_CLASSES = {
  pending:   'status-pending',
  running:   'status-running',
  completed: 'status-completed',
  failed:    'status-failed',
  cancelled: 'status-cancelled',
};

function statusBadge(s) {
  const cls = STATUS_CLASSES[s] || 'status-unknown';
  return `<span class="status-badge ${cls}">${esc(s)}</span>`;
}

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

function fmtDuration(startedAt, endedAt) {
  if (!startedAt) return '—';
  const ms = (endedAt ? new Date(endedAt) : new Date()) - new Date(startedAt);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPayload(label, obj) {
  if (obj == null) return '';
  return `
    <div class="step-payload-section">
      <div class="step-payload-label">${label}</div>
      <pre class="json-pre">${esc(JSON.stringify(obj, null, 2))}</pre>
    </div>
  `;
}

function renderStep(step) {
  const statusCls = STATUS_CLASSES[step.status] || 'status-unknown';
  const agentLabel = [step.agent_id, step.component_id].filter(Boolean).join(' / ');
  const attempt = step.attempt > 0 ? `<span class="step-attempt">attempt ${step.attempt + 1}</span>` : '';

  return `
    <div class="step-card ${statusCls}" id="step-${step.id}">
      <div class="step-card-header" onclick="toggleStep(this.parentElement)">
        <span class="step-idx">#${step.step_index + 1}</span>
        <span class="step-name">${esc(step.step_name)}</span>
        <div class="step-meta">
          ${agentLabel ? `<span class="step-agent">${esc(agentLabel)}</span>` : ''}
          ${step.action ? `<span class="step-agent" style="color:var(--accent)">${esc(step.action)}</span>` : ''}
          ${step.duration_ms != null ? `<span class="step-duration">${step.duration_ms}ms</span>` : ''}
          ${attempt}
          ${statusBadge(step.status)}
        </div>
      </div>
      <div class="step-card-body">
        ${renderPayload('Request', step.request_payload)}
        ${renderPayload('Response', step.response_payload)}
        <div style="font-size:0.72rem;color:var(--muted)">
          ${step.started_at ? `Started ${fmtTs(step.started_at)}` : ''}
          ${step.ended_at ? ` · Ended ${fmtTs(step.ended_at)}` : ''}
        </div>
      </div>
    </div>
  `;
}

function toggleStep(card) {
  card.classList.toggle('open');
}

let _runData = null;

function updateMeta(run) {
  _runData = run;
  document.getElementById('meta-template').textContent = run.template_id;
  document.getElementById('meta-status').innerHTML = statusBadge(run.status);
  document.getElementById('meta-started').textContent = fmtTs(run.started_at);
  document.getElementById('meta-duration').textContent = fmtDuration(run.started_at, run.ended_at);

  const errorRow = document.getElementById('meta-error-row');
  if (run.error) {
    errorRow.style.display = '';
    document.getElementById('meta-error').textContent = run.error;
  } else {
    errorRow.style.display = 'none';
  }

  // Show cancel button only for active runs
  const cancelBtn = document.getElementById('cancel-btn');
  cancelBtn.style.display = (run.status === 'running' || run.status === 'pending') ? '' : 'none';

  // Hide approve button when run completes/fails/cancels
  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    document.getElementById('approve-btn').style.display = 'none';
    document.getElementById('approval-banner').style.display = 'none';
  }
}

async function loadRun() {
  try {
    const res = await fetch(`/api/experiments/runs/${encodeURIComponent(RUN_ID)}`);
    if (!res.ok) {
      document.getElementById('step-timeline').innerHTML =
        `<div class="empty">Run not found.</div>`;
      return;
    }
    const run = await res.json();
    updateMeta(run);
    renderTimeline(run.steps || []);
  } catch (err) {
    document.getElementById('step-timeline').innerHTML =
      `<div class="empty">Error: ${esc(String(err))}</div>`;
  }
}

function renderTimeline(steps) {
  const tl = document.getElementById('step-timeline');
  if (!steps.length) {
    tl.innerHTML = '<div class="empty">No steps yet…</div>';
    return;
  }
  tl.innerHTML = steps.map(renderStep).join('');
}

// ── Live WebSocket updates ─────────────────────────────────────────

function updateStepCard(stepId, updates) {
  const card = document.getElementById(`step-${stepId}`);
  if (!card) {
    // New step — reload the whole run
    loadRun();
    return;
  }
  // Update status class
  if (updates.status) {
    Object.values(STATUS_CLASSES).forEach(c => card.classList.remove(c));
    card.classList.add(STATUS_CLASSES[updates.status] || '');
    const badgeEl = card.querySelector('.step-card-header .status-badge');
    if (badgeEl) badgeEl.outerHTML = statusBadge(updates.status);
  }
  // Update duration if provided
  if (updates.duration_ms != null) {
    const durEl = card.querySelector('.step-duration');
    if (durEl) durEl.textContent = `${updates.duration_ms}ms`;
  }
}

onWsEvent(evt => {
  // Only handle events for this run
  if (evt.run_id && evt.run_id !== RUN_ID) return;

  switch (evt.type) {
    case 'experiment_started':
    case 'experiment_completed':
    case 'experiment_failed':
    case 'experiment_cancelled':
      loadRun();
      break;

    case 'step_started':
      // Reload to render the new step row
      loadRun();
      break;

    case 'step_completed':
      // Refresh to pick up response_payload and duration
      loadRun();
      break;

    case 'step_failed':
      loadRun();
      break;

    case 'approval_required':
      document.getElementById('approve-btn').style.display = '';
      document.getElementById('approval-banner').style.display = '';
      document.getElementById('approval-message').textContent = evt.message || 'Waiting for approval…';
      break;

    case 'approval_granted':
      document.getElementById('approve-btn').style.display = 'none';
      document.getElementById('approval-banner').style.display = 'none';
      break;
  }
});

async function approveRun() {
  const btn = document.getElementById('approve-btn');
  btn.disabled = true;
  btn.textContent = 'Approving…';
  try {
    const res = await fetch(`/api/experiments/runs/${encodeURIComponent(RUN_ID)}/approve`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json();
      alert(`Approve failed: ${err.detail || res.statusText}`);
      btn.disabled = false;
      btn.textContent = 'Approve';
      return;
    }
    // Hide immediately on success (WS event is a bonus, not required)
    btn.style.display = 'none';
    document.getElementById('approval-banner').style.display = 'none';
  } catch (err) {
    alert(`Approve error: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Approve';
  }
}

async function cancelRun() {
  const btn = document.getElementById('cancel-btn');
  btn.disabled = true;
  btn.textContent = 'Cancelling…';
  try {
    const res = await fetch(`/api/experiments/runs/${encodeURIComponent(RUN_ID)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json();
      alert(`Cancel failed: ${err.detail || res.statusText}`);
      btn.disabled = false;
      btn.textContent = 'Cancel';
    }
    // UI updates via WebSocket event
  } catch (err) {
    alert(`Cancel error: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Cancel';
  }
}

loadRun();
