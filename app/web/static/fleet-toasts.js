// fleet-toasts.js — Toast notification system
// Depends on: fleet-utils.js

(function (L) {
  'use strict';

  var MAX_VISIBLE = 3;
  var queue = [];
  var visible = 0;

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

    if (details) {
      html += '<button class="toast-details-toggle">\u25BC Details</button>';
      html += '<div class="toast-details hidden">';
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

    // Details toggle
    var toggleBtn = el.querySelector('.toast-details-toggle');
    var detailsDiv = el.querySelector('.toast-details');
    if (toggleBtn && detailsDiv) {
      toggleBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isHidden = detailsDiv.classList.toggle('hidden');
        toggleBtn.textContent = isHidden ? '\u25BC Details' : '\u25B2 Details';
        // Pause auto-dismiss when details are open
        if (!isHidden) {
          clearTimeout(dismissTimer);
          el.classList.add('toast-pinned');
        } else {
          dismissTimer = setTimeout(dismissFn, 3000);
          el.classList.remove('toast-pinned');
        }
      });
    }

    // Trigger animation
    requestAnimationFrame(function () { el.classList.add('toast-show'); });

    var dismissFn = function () {
      if (el.classList.contains('toast-pinned')) return;
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

    var dismissTimer = setTimeout(dismissFn, details ? 6000 : duration);

    // Click to dismiss (unless clicking details)
    el.addEventListener('click', function (e) {
      if (e.target.closest('.toast-details-toggle') || e.target.closest('.toast-details')) return;
      clearTimeout(dismissTimer);
      dismissFn();
    });
  }

})(window.LUCID);
