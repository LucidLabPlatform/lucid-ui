// fleet-toasts.js — Toast notification system
// Depends on: fleet-utils.js

(function (L) {
  'use strict';

  var MAX_VISIBLE = Infinity;
  var MAX_EXPANDED = 4;
  var queue = [];
  var visible = 0;
  var expandedToasts = []; // ordered oldest→newest, only pinned/expanded toasts

  L.toast = function (opts) {
    var msg = opts.message || '';
    var type = opts.type || 'info';
    var duration = opts.duration || 3000;
    var details = opts.details || null;

    if (visible >= MAX_VISIBLE) {
      queue.push(opts);
      return;
    }

    showToast(msg, type, duration, details);
  };

  function formatJson(obj) {
    if (obj == null) return 'null';
    try { return JSON.stringify(obj, null, 2); } catch (e) { return String(obj); }
  }

  function showToast(message, type, duration, details) {
    var container = document.getElementById('toast-container');
    if (!container) return;

    visible++;

    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    var icon = type === 'success' ? '\u2713' : type === 'error' ? '\u2717' : '\u2139';

    var html = '<span class="toast-icon">' + icon + '</span>';
    html += '<span class="toast-msg">' + L.esc(message) + '</span>';
    html += '<button class="toast-close" title="Dismiss">\u2715</button>';

    if (details) {
      html += '<button class="toast-details-toggle">\u25B2 Details</button>';
      html += '<div class="toast-details">';
      if (details.target) {
        html += '<div class="toast-detail-section"><span class="toast-detail-label">Target</span>';
        html += '<span class="toast-detail-value">' + L.esc(details.target) + '</span></div>';
      }
      if (details.request != null) {
        html += '<div class="toast-detail-section"><span class="toast-detail-label">Sent</span>';
        html += '<pre class="toast-detail-pre">' + L.esc(formatJson(details.request)) + '</pre></div>';
      }
      if (details.response != null) {
        html += '<div class="toast-detail-section"><span class="toast-detail-label">Response</span>';
        html += '<pre class="toast-detail-pre">' + L.esc(formatJson(details.response)) + '</pre></div>';
      }
      html += '</div>';
    }

    el.innerHTML = html;
    container.appendChild(el);

    // Trigger animation
    requestAnimationFrame(function () { el.classList.add('toast-show'); });

    var dismissTimer = null;

    var dismissFn = function (force) {
      if (!force && el.classList.contains('toast-pinned')) return;
      clearTimeout(dismissTimer);
      var idx = expandedToasts.indexOf(el);
      if (idx !== -1) expandedToasts.splice(idx, 1);
      el.classList.remove('toast-show');
      el.classList.add('toast-hide');
      setTimeout(function () {
        el.remove();
        visible--;
        if (queue.length) {
          var next = queue.shift();
          showToast(next.message, next.type || 'info', next.duration || 3000, next.details || null);
        }
      }, 200);
    };

    // Details toggle
    var toggleBtn = el.querySelector('.toast-details-toggle');
    var detailsDiv = el.querySelector('.toast-details');
    if (toggleBtn && detailsDiv) {
      // Start expanded and pinned
      el.classList.add('toast-pinned');
      expandedToasts.push(el);

      // If we now exceed the max, force-dismiss the oldest expanded toast
      if (expandedToasts.length > MAX_EXPANDED) {
        var oldest = expandedToasts[0]; // oldest is first
        var oldCloseBtn = oldest.querySelector('.toast-close');
        if (oldCloseBtn) oldCloseBtn.click();
      }

      toggleBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isHidden = detailsDiv.classList.toggle('hidden');
        toggleBtn.textContent = isHidden ? '\u25BC Details' : '\u25B2 Details';
        if (!isHidden) {
          // Re-expanding
          clearTimeout(dismissTimer);
          el.classList.add('toast-pinned');
          if (expandedToasts.indexOf(el) === -1) expandedToasts.push(el);
        } else {
          // Collapsing — remove from expanded list, start auto-dismiss
          var idx = expandedToasts.indexOf(el);
          if (idx !== -1) expandedToasts.splice(idx, 1);
          el.classList.remove('toast-pinned');
          dismissTimer = setTimeout(dismissFn, 3000);
        }
      });
    } else {
      // No details — auto-dismiss after duration
      dismissTimer = setTimeout(dismissFn, duration);
    }

    // Close button always force-dismisses
    var closeBtn = el.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        dismissFn(true);
      });
    }

    // Click body to dismiss only when no details panel
    el.addEventListener('click', function (e) {
      if (e.target.closest('.toast-close') || e.target.closest('.toast-details-toggle') || e.target.closest('.toast-details')) return;
      if (!details) { clearTimeout(dismissTimer); dismissFn(true); }
    });
  }

})(window.LUCID);
