// fleet-experiment-run.js — Live run viewer + approval handling
// Depends on: fleet-utils.js, fleet.js, fleet-toasts.js

(function (L) {
  'use strict';

  var runId = L.runId;
  if (!runId) return;

  var headerEl, timelineEl;
  var run = null;
  var steps = [];

  // ── WebSocket experiment events ───────────────────────────────────

  var pollTimer = null;

  function listenForEvents() {
    // Real-time via L.onExperimentEvent (fleet.js)
    if (typeof L.onExperimentEvent === 'function') {
      L.onExperimentEvent(function (evt) {
        if (evt.run_id !== runId) return;
        if (evt.type === 'step_started' || evt.type === 'step_completed' || evt.type === 'step_failed') {
          refreshRun();
        }
        if (evt.type === 'experiment_completed' || evt.type === 'experiment_failed') {
          refreshRun();
        }
        if (evt.type === 'approval_required') {
          showApprovalModal(evt.step_name, evt.message);
        }
      });
    }

    // Fallback polling for when WS events aren't flowing
    pollTimer = setInterval(function () { refreshRun(); }, 5000);
  }

  // ── Load data ─────────────────────────────────────────────────────

  async function loadData() {
    await refreshRun();
    renderDetail();
  }

  async function refreshRun() {
    try {
      var res = await L.apiFetch('/api/experiments/runs/' + encodeURIComponent(runId));
      if (res.ok) {
        var data = await res.json();
        run = data;
        steps = (data.steps || []).slice().sort(function (a, b) {
          // Primary sort: step_index ascending. Fall back to id, then started_at.
          var ai = (typeof a.step_index === 'number') ? a.step_index : 1e9;
          var bi = (typeof b.step_index === 'number') ? b.step_index : 1e9;
          if (ai !== bi) return ai - bi;
          if (a.id != null && b.id != null) return a.id - b.id;
          return 0;
        });
        renderDetail();
      }
    } catch (e) {
      console.error('Failed to load run:', e);
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  function renderDetail() {
    headerEl = headerEl || document.getElementById('exp-run-header');
    timelineEl = timelineEl || document.getElementById('exp-run-timeline');

    if (!run) {
      if (headerEl) headerEl.innerHTML = '<div class="fleet-empty">Run not found</div>';
      return;
    }

    renderHeader();
    renderTimeline();
  }

  function renderHeader() {
    if (!headerEl) return;
    var statusCls = 'status-' + (run.status || 'unknown');

    var html = '<div class="detail-header">';
    html += '<h1 class="detail-name">Run ' + L.esc(run.id.substring(0, 8)) + '</h1>';
    html += '<span class="status-badge ' + statusCls + '">' + L.esc(run.status || 'unknown') + '</span>';
    html += '</div>';

    html += '<div class="exp-run-meta">';
    html += '<span>Template: <a href="/experiments/' + encodeURIComponent(run.template_id) + '">' + L.esc(run.template_id) + '</a></span>';
    if (run.started_at) html += ' \u00B7 <span>Started: <span data-ts="' + L.escAttr(run.started_at) + '">' + L.fmtTs(run.started_at) + '</span></span>';
    if (run.ended_at) html += ' \u00B7 <span>Ended: <span data-ts="' + L.escAttr(run.ended_at) + '">' + L.fmtTs(run.ended_at) + '</span></span>';
    html += '</div>';

    // Cancel button (only for running/pending)
    if (run.status === 'running' || run.status === 'pending') {
      html += '<div class="exp-run-actions">';
      html += '<button class="act" id="cancel-run-btn">Cancel Run</button>';
      html += '</div>';
    }

    // Parameters
    if (run.parameters && Object.keys(run.parameters).length) {
      html += '<details class="exp-run-params"><summary>Parameters</summary>';
      html += '<pre class="schema-dump">' + L.esc(JSON.stringify(run.parameters, null, 2)) + '</pre>';
      html += '</details>';
    }

    // Error
    if (run.error) {
      html += '<div class="exp-run-error">' + L.esc(run.error) + '</div>';
    }

    headerEl.innerHTML = html;

    // Cancel button handler
    var cancelBtn = document.getElementById('cancel-run-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling\u2026';
        L.apiFetch('/api/experiments/runs/' + encodeURIComponent(runId), { method: 'DELETE' })
          .then(function (res) {
            if (res.ok) {
              L.toast({ message: 'Run cancelled', type: 'info' });
              refreshRun();
            } else {
              L.toast({ message: 'Failed to cancel', type: 'error' });
              cancelBtn.disabled = false;
              cancelBtn.textContent = 'Cancel Run';
            }
          });
      });
    }
  }

  function renderTimeline() {
    if (!timelineEl) return;
    if (!steps.length) {
      timelineEl.innerHTML = '<div class="fleet-empty">No steps recorded yet</div>';
      return;
    }

    // Progress summary: count steps by status.
    var counts = { completed: 0, running: 0, failed: 0, pending: 0, skipped: 0 };
    steps.forEach(function (s) {
      if (counts[s.status] !== undefined) counts[s.status] += 1;
      else counts.pending += 1;
    });
    var done = counts.completed + counts.skipped + counts.failed;
    var pct = steps.length ? Math.round((counts.completed / steps.length) * 100) : 0;

    var html = '';
    html += '<div class="exp-progress">';
    html += '<div class="exp-progress-bar"><div class="exp-progress-fill" style="width:' + pct + '%"></div></div>';
    html += '<div class="exp-progress-meta">';
    html += '<span class="exp-progress-count">' + done + ' / ' + steps.length + ' steps</span>';
    if (counts.running) html += ' \u00B7 <span class="exp-progress-running">' + counts.running + ' running</span>';
    if (counts.failed)  html += ' \u00B7 <span class="exp-progress-failed">' + counts.failed + ' failed</span>';
    if (counts.skipped) html += ' \u00B7 <span class="exp-progress-skipped">' + counts.skipped + ' skipped</span>';
    html += '</div>';
    html += '</div>';

    html += '<div class="exp-timeline">';
    steps.forEach(function (step, idx) {
      var statusIcon = '\u25CB'; // pending
      var statusCls = 'exp-step-pending';
      if (step.status === 'running') { statusIcon = '\u25CF'; statusCls = 'exp-step-running'; }
      else if (step.status === 'completed') { statusIcon = '\u2713'; statusCls = 'exp-step-completed'; }
      else if (step.status === 'failed') { statusIcon = '\u2717'; statusCls = 'exp-step-failed'; }
      else if (step.status === 'skipped') { statusIcon = '\u2014'; statusCls = 'exp-step-skipped'; }

      var stepNum = (typeof step.step_index === 'number') ? (step.step_index + 1) : (idx + 1);
      html += '<div class="exp-tl-step ' + statusCls + '" data-step-name="' + L.escAttr(step.step_name || '') + '">';
      html += '<div class="exp-tl-num">' + stepNum + '</div>';
      html += '<div class="exp-tl-icon">' + statusIcon + '</div>';
      html += '<div class="exp-tl-body">';
      html += '<div class="exp-tl-header">';
      html += '<span class="exp-tl-name">' + L.esc(step.step_name || 'Step ' + stepNum) + '</span>';
      if (step.action) {
        html += '<span class="exp-tl-action">';
        if (step.agent_id) html += L.esc(step.agent_id);
        if (step.component_id) html += '/' + L.esc(step.component_id);
        html += ' \u2192 ' + L.esc(step.action);
        html += '</span>';
      }
      if (step.duration_ms) html += '<span class="exp-tl-duration">' + L.fmtDuration(step.duration_ms) + '</span>';
      html += '</div>';

      // Request/response payloads (expandable)
      if (step.request_payload || step.response_payload) {
        html += '<details class="exp-tl-payloads">';
        html += '<summary>Payloads</summary>';
        if (step.request_payload) {
          html += '<div class="exp-tl-payload"><span class="kv-k">Request:</span><pre class="schema-dump">' + L.esc(JSON.stringify(step.request_payload, null, 2)) + '</pre></div>';
        }
        if (step.response_payload) {
          html += '<div class="exp-tl-payload"><span class="kv-k">Response:</span><pre class="schema-dump">' + L.esc(JSON.stringify(step.response_payload, null, 2)) + '</pre></div>';
        }
        html += '</details>';
      }

      html += '</div></div>';
    });
    html += '</div>';

    timelineEl.innerHTML = html;
  }

  function updateStepInTimeline(evt) {
    if (!timelineEl) return;
    var stepEl = timelineEl.querySelector('[data-step-name="' + CSS.escape(evt.step_name || '') + '"]');
    if (!stepEl) { refreshRun(); return; }

    // Just refresh the full timeline on step events
    refreshRun();
  }

  // ── Approval modal ────────────────────────────────────────────────

  function showApprovalModal(stepName, message) {
    var overlay = document.getElementById('exp-approval-overlay');
    var msgEl = document.getElementById('exp-approval-message');
    var approveBtn = document.getElementById('exp-approve-btn');
    var dismissBtn = document.getElementById('exp-approval-dismiss');

    if (!overlay) return;

    msgEl.textContent = (message || 'Approval required for step: ' + stepName);
    overlay.classList.remove('hidden');

    approveBtn.onclick = function () {
      approveBtn.disabled = true;
      approveBtn.textContent = 'Approving\u2026';
      L.apiFetch('/api/experiments/runs/' + encodeURIComponent(runId) + '/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then(function (res) {
        overlay.classList.add('hidden');
        approveBtn.disabled = false;
        approveBtn.textContent = 'Approve';
        if (res.ok) {
          L.toast({ message: 'Step approved', type: 'success' });
          refreshRun();
        } else {
          L.toast({ message: 'Approval failed', type: 'error' });
        }
      });
    };

    dismissBtn.onclick = function () {
      overlay.classList.add('hidden');
    };
  }

  // ── Boot ──────────────────────────────────────────────────────────

  loadData();
  listenForEvents();

  L.registerPageRenderer({
    renderFull: function () {},
    renderDirty: function () {},
    renderStats: function () {},
  });

})(window.LUCID);
