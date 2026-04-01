/* Experiment Runs list page */

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
  const d = new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

function fmtDuration(run) {
  if (!run.started_at) return '—';
  const endTs = run.ended_at ? new Date(run.ended_at) : new Date();
  const ms = endTs - new Date(run.started_at);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function shortId(id) {
  return id ? id.slice(0, 8) + '…' : '—';
}

async function loadRuns() {
  const status = document.getElementById('status-filter').value;
  const url = status ? `/api/experiments/runs?status=${encodeURIComponent(status)}` : '/api/experiments/runs';
  const tbody = document.getElementById('runs-body');

  try {
    const res = await fetch(url);
    const runs = await res.json();

    document.getElementById('run-count').textContent =
      `${runs.length} run${runs.length !== 1 ? 's' : ''}`;

    if (!runs.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">No runs found.</td></tr>';
      return;
    }

    const active = new Set(['pending', 'running']);
    tbody.innerHTML = runs.map(r => `
      <tr style="cursor:pointer" onclick="window.location='/experiments/runs/${esc(r.id)}'">
        <td style="font-family:var(--font-mono);font-size:0.78rem">
          <a href="/experiments/runs/${esc(r.id)}">${esc(shortId(r.id))}</a>
        </td>
        <td style="font-family:var(--font-mono);font-size:0.78rem">${esc(r.template_id)}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="font-size:0.78rem;color:var(--muted)">${fmtTs(r.started_at || r.created_at)}</td>
        <td style="font-size:0.78rem;font-family:var(--font-mono)">${fmtDuration(r)}</td>
        <td style="font-size:0.75rem;color:var(--red);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${r.error ? esc(r.error) : ''}
        </td>
        <td onclick="event.stopPropagation()">
          ${active.has(r.status)
            ? `<button class="btn-danger" onclick="cancelRun('${esc(r.id)}')">Cancel</button>`
            : ''}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">Failed to load: ${esc(String(err))}</td></tr>`;
  }
}

async function cancelRun(id) {
  if (!confirm(`Cancel run ${id.slice(0, 8)}…?`)) return;
  const r = await fetch(`/api/experiments/runs/${id}`, { method: 'DELETE' });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    alert('Cancel failed: ' + (d.detail || r.status));
    return;
  }
  loadRuns();
}

// Live updates: refresh table when experiment status changes
onWsEvent(evt => {
  const runEvents = ['experiment_started', 'experiment_completed', 'experiment_failed', 'experiment_cancelled'];
  if (runEvents.includes(evt.type)) {
    loadRuns();
  }
});

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

loadRuns();
