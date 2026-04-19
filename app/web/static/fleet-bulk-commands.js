// fleet-bulk-commands.js — Bulk command execution engine + bar renderer
// Depends on: fleet-utils.js, fleet.js, fleet-toasts.js

(function (L) {
  'use strict';

  L._bulkInProgress = false; // suppress individual toasts during bulk ops

  // ── Compute common commands ───────────────────────────────────────
  // Given targets [{agentId, componentId}], find commands available on ALL targets.

  L.computeCommonCommands = function (targets, scope) {
    if (!targets.length) return [];

    // Ensure catalogs are loaded
    var actionMap = {}; // action → {count, label, has_body, template, category}

    targets.forEach(function (t) {
      var catalog = L.catalogs[t.agentId];
      if (!catalog) return;

      var cmds;
      if (scope === 'agent') {
        cmds = catalog.agent || [];
      } else {
        cmds = (catalog.components && catalog.components[t.componentId]) || [];
      }

      cmds.forEach(function (cmd) {
        if (!actionMap[cmd.action]) {
          actionMap[cmd.action] = { count: 0, label: cmd.label, has_body: cmd.has_body, template: cmd.template, category: cmd.category || '' };
        }
        actionMap[cmd.action].count++;
      });
    });

    // Keep only commands present on ALL targets
    var total = targets.length;
    var common = [];
    Object.keys(actionMap).forEach(function (action) {
      if (actionMap[action].count === total) {
        common.push({
          action: action,
          label: actionMap[action].label || action,
          has_body: actionMap[action].has_body,
          template: actionMap[action].template,
          category: actionMap[action].category,
        });
      }
    });

    // Filter out config commands
    common = common.filter(function (c) { return c.category !== 'config'; });

    return common;
  };

  // ── Render bulk commands bar ───────────────────────────────────────

  L.renderBulkBar = function (containerId, opts) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var label = opts.label || 'Bulk Commands';
    var commandsFn = opts.commandsFn;
    var targetsFn = opts.targetsFn;

    function render() {
      var commands = commandsFn ? commandsFn() : [];
      if (!commands.length) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
      }
      container.classList.remove('hidden');

      var html = '<div class="bulk-bar">';
      html += '<span class="bulk-bar-label">' + L.esc(label) + '</span>';
      html += '<div class="bulk-bar-actions">';
      commands.forEach(function (cmd) {
        html += '<button class="act bulk-act" data-bulk-action="' + L.escAttr(cmd.action) + '"';
        if (cmd.has_body && cmd.template) {
          html += ' data-has-body="1" data-template="' + L.escAttr(JSON.stringify(cmd.template)) + '"';
        }
        html += '>' + L.esc(cmd.label || cmd.action) + '</button>';
      });
      html += '</div>';
      html += '<div class="bulk-progress hidden" id="bulk-progress-' + containerId + '"></div>';
      html += '</div>';
      container.innerHTML = html;
    }

    render();

    // Re-render when catalogs change (after initial load)
    container._bulkRender = render;
    container._bulkTargetsFn = targetsFn;
  };

  // ── Fire bulk command via orchestrator batch API ────────────────────

  L.fireBulkCmd = function (targets, action, payload, progressEl) {
    if (!targets.length) return Promise.resolve({ total: 0, success: 0, failed: 0, results: [] });

    var total = targets.length;

    if (progressEl) {
      progressEl.classList.remove('hidden');
      progressEl.textContent = action + ': sending to ' + total + ' target' + (total !== 1 ? 's' : '') + '\u2026';
    }

    var batchBody = {
      action: action,
      targets: targets.map(function (t) {
        return { agent_id: t.agentId, component_id: t.componentId || null };
      }),
      payload: payload || {},
    };

    return L.apiFetch('/api/commands/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batchBody),
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var summary = data.summary || {};
      var success = summary.success || 0;
      var failed = summary.failed || 0;

      // Summary toast
      var msg = action + ': ' + success + '/' + summary.total + ' succeeded';
      if (failed) msg += ', ' + failed + ' failed';
      L.toast({ message: msg, type: failed === 0 ? 'success' : (success > 0 ? 'info' : 'error') });

      // Update progress
      if (progressEl) {
        progressEl.textContent = msg;
        progressEl.className = 'bulk-progress ' + (failed === 0 ? 'bulk-ok' : 'bulk-mixed');
        setTimeout(function () { progressEl.classList.add('hidden'); }, 4000);
      }

      return summary;
    })
    .catch(function (err) {
      L.toast({ message: action + ' batch failed: ' + err.message, type: 'error' });
      if (progressEl) {
        progressEl.textContent = 'Failed: ' + err.message;
        progressEl.className = 'bulk-progress bulk-mixed';
        setTimeout(function () { progressEl.classList.add('hidden'); }, 4000);
      }
      return { total: total, success: 0, failed: total, results: [] };
    });
  };

  // ── Event delegation for bulk action buttons ──────────────────────

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.bulk-act[data-bulk-action]');
    if (!btn) return;

    var bar = btn.closest('.bulk-bar');
    if (!bar) return;

    var container = bar.parentElement;
    if (!container || !container._bulkTargetsFn) return;

    var action = btn.dataset.bulkAction;
    var hasBody = btn.dataset.hasBody === '1';
    var targets = container._bulkTargetsFn();

    if (!targets.length) {
      L.toast({ message: 'No targets available', type: 'info' });
      return;
    }

    // If command needs a body, open the command panel for the first target as a template
    if (hasBody) {
      var tpl = {};
      try { tpl = JSON.parse(btn.dataset.template || '{}'); } catch (ex) {}
      if (Object.keys(tpl).length > 0) {
        // TODO: bulk with body — for now, warn user
        L.toast({ message: 'Bulk commands with parameters not yet supported. Use the command panel for individual targets.', type: 'info' });
        return;
      }
    }

    // Disable all bulk buttons during execution
    var allBtns = bar.querySelectorAll('.bulk-act');
    allBtns.forEach(function (b) { b.disabled = true; });

    var progressEl = bar.querySelector('.bulk-progress');
    L.fireBulkCmd(targets, action, {}, progressEl).then(function () {
      allBtns.forEach(function (b) { b.disabled = false; });
    });
  });

})(window.LUCID);
