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

    if (visible >= MAX_VISIBLE) {
      queue.push(opts);
      return;
    }

    showToast(msg, type, duration);
  };

  function showToast(message, type, duration) {
    var container = document.getElementById('toast-container');
    if (!container) return;

    visible++;

    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    var icon = type === 'success' ? '\u2713' : type === 'error' ? '\u2717' : '\u2139';
    el.innerHTML = '<span class="toast-icon">' + icon + '</span><span class="toast-msg">' + L.esc(message) + '</span>';
    container.appendChild(el);

    // Trigger animation
    requestAnimationFrame(function () { el.classList.add('toast-show'); });

    setTimeout(function () {
      el.classList.remove('toast-show');
      el.classList.add('toast-hide');
      setTimeout(function () {
        el.remove();
        visible--;
        if (queue.length) {
          var next = queue.shift();
          showToast(next.message, next.type || 'info', next.duration || 3000);
        }
      }, 200);
    }, duration);
  }

})(window.LUCID);
