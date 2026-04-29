// fleet-cmd-log.js — Command Log Drawer
// Depends on: fleet.js, fleet-utils.js

(function (L) {
  'use strict';

  var _entries = [];
  var _unread = 0;
  var _isOpen = false;
  var _hasErrors = false;

  function _updateBadge() {
    var badge = document.getElementById('cmd-log-badge');
    if (!badge) return;
    if (_unread === 0) {
      badge.classList.add('hidden');
      return;
    }
    badge.textContent = _unread > 99 ? '99+' : String(_unread);
    badge.classList.remove('hidden');
    if (_hasErrors) {
      badge.classList.remove('badge-ok');
    } else {
      badge.classList.add('badge-ok');
    }
  }

  function _formatTime(ts) {
    try {
      var d = ts instanceof Date ? ts : new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) { return ''; }
  }

  function _formatJson(obj) {
    if (obj == null) return 'null';
    try { return JSON.stringify(obj, null, 2); } catch (e) { return String(obj); }
  }

  function _formatElapsed(ms) {
    if (ms == null) return '';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  function _renderCommandEntry(entry) {
    var el = document.createElement('div');
    el.className = 'cmd-log-entry ' + (entry.ok ? 'cmd-ok' : 'cmd-err');

    var icon = entry.ok ? '\u2713' : '\u2717';
    var elapsed = entry.elapsed ? _formatElapsed(entry.elapsed) : '';
    var timeStr = _formatTime(entry.ts);

    var html = '<span class="cmd-log-icon">' + icon + '</span>';
    html += '<div class="cmd-log-body">';
    html += '<div class="cmd-log-action">' + L.esc(entry.action) + '</div>';
    html += '<div class="cmd-log-target">' + L.esc(entry.target) + '</div>';
    html += '<div class="cmd-log-meta">';
    if (elapsed) html += '<span>' + L.esc(elapsed) + '</span>';
    html += '<span>' + L.esc(timeStr) + '</span>';
    html += '</div>';

    if (entry.details) {
      html += '<div class="cmd-log-details" id="details-' + entry.id + '">';
      if (entry.details.request != null) {
        html += '<span class="cmd-log-detail-label">Sent</span>';
        html += '<pre class="cmd-log-detail-pre">' + L.esc(_formatJson(entry.details.request)) + '</pre>';
      }
      if (entry.details.response != null) {
        html += '<span class="cmd-log-detail-label">Response</span>';
        html += '<pre class="cmd-log-detail-pre">' + L.esc(_formatJson(entry.details.response)) + '</pre>';
      }
      html += '</div>';
    }

    html += '</div>';

    if (entry.details) {
      html += '<button class="cmd-log-expand-btn" title="Toggle details">\u25BC</button>';
    }

    el.innerHTML = html;

    if (entry.details) {
      var expandBtn = el.querySelector('.cmd-log-expand-btn');
      var detailsDiv = el.querySelector('.cmd-log-details');
      expandBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = detailsDiv.classList.toggle('open');
        expandBtn.textContent = open ? '\u25B2' : '\u25BC';
      });
    }

    return el;
  }

  function _renderBulkEntry(entry) {
    var el = document.createElement('div');
    el.className = 'cmd-log-entry ' + (entry.ok ? 'cmd-ok' : 'cmd-err');

    var icon = entry.ok ? '\u2713' : '\u2717';
    var timeStr = _formatTime(entry.ts);
    var label = entry.action + ' \u00D7 ' + entry.total + ' agents';
    var detail = entry.error
      ? entry.error
      : entry.success + ' ok' + (entry.failed ? ', ' + entry.failed + ' failed' : '');

    var html = '<span class="cmd-log-icon">' + icon + '</span>';
    html += '<div class="cmd-log-body">';
    html += '<div class="cmd-log-action">' + L.esc(label) + '</div>';
    html += '<div class="cmd-log-target">' + L.esc(detail) + '</div>';
    html += '<div class="cmd-log-meta"><span>' + L.esc(timeStr) + '</span></div>';
    html += '</div>';

    el.innerHTML = html;
    return el;
  }

  function _prepend(entry) {
    var feed = document.getElementById('cmd-log-feed');
    var empty = document.getElementById('cmd-log-empty');
    if (!feed) return;

    var el = entry.type === 'bulk' ? _renderBulkEntry(entry) : _renderCommandEntry(entry);
    feed.insertBefore(el, feed.firstChild);

    if (empty) empty.style.display = 'none';
  }

  L.cmdLog = {
    addEntry: function (historyEntry, wsEvt) {
      var ok, response, elapsed;

      if (wsEvt === null) {
        // HTTP dispatch failure — no WS result
        ok = false;
        response = historyEntry.result;
        elapsed = historyEntry.elapsed;
      } else {
        ok = wsEvt.payload && wsEvt.payload.ok;
        response = wsEvt ? wsEvt.payload : null;
        elapsed = historyEntry ? historyEntry.result_elapsed : null;
      }

      var target = historyEntry
        ? historyEntry.agentId + (historyEntry.componentId ? '/' + historyEntry.componentId : '')
        : '';

      var entry = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2),
        type: 'command',
        action: historyEntry ? historyEntry.action : '',
        target: target,
        ok: ok,
        elapsed: elapsed,
        ts: new Date(),
        details: {
          request: historyEntry ? historyEntry.payload : null,
          response: response,
        },
      };

      _entries.unshift(entry);
      _prepend(entry);

      if (!_isOpen) {
        _unread++;
        if (!ok) _hasErrors = true;
        _updateBadge();
      }
    },

    addBulkEntry: function (action, summary) {
      var ok = !summary.failed || summary.failed === 0;
      var entry = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2),
        type: 'bulk',
        action: action,
        ok: ok,
        total: summary.total || 0,
        success: summary.success || 0,
        failed: summary.failed || 0,
        error: summary.error || null,
        ts: new Date(),
      };

      _entries.unshift(entry);
      _prepend(entry);

      if (!_isOpen) {
        _unread++;
        if (!ok) _hasErrors = true;
        _updateBadge();
      }
    },

    open: function () {
      var drawer = document.getElementById('cmd-log-drawer');
      var overlay = document.getElementById('cmd-log-overlay');
      if (drawer) drawer.classList.add('cmd-log-open');
      if (overlay) overlay.classList.remove('hidden');
      _isOpen = true;
      _unread = 0;
      _hasErrors = false;
      _updateBadge();
    },

    close: function () {
      var drawer = document.getElementById('cmd-log-drawer');
      var overlay = document.getElementById('cmd-log-overlay');
      if (drawer) drawer.classList.remove('cmd-log-open');
      if (overlay) overlay.classList.add('hidden');
      _isOpen = false;
    },

    toggle: function () {
      if (_isOpen) { L.cmdLog.close(); } else { L.cmdLog.open(); }
    },

    clear: function () {
      _entries = [];
      _unread = 0;
      _hasErrors = false;
      _updateBadge();
      var feed = document.getElementById('cmd-log-feed');
      var empty = document.getElementById('cmd-log-empty');
      if (feed) feed.innerHTML = '';
      if (empty) empty.style.display = '';
    },
  };

  // Wire up after DOM is ready
  document.addEventListener('DOMContentLoaded', function () {
    var toggleBtn = document.getElementById('cmd-log-toggle-btn');
    var closeBtn = document.getElementById('cmd-log-close-btn');
    var clearBtn = document.getElementById('cmd-log-clear-btn');
    var overlay = document.getElementById('cmd-log-overlay');

    if (toggleBtn) toggleBtn.addEventListener('click', function () { L.cmdLog.toggle(); });
    if (closeBtn) closeBtn.addEventListener('click', function () { L.cmdLog.close(); });
    if (clearBtn) clearBtn.addEventListener('click', function () { L.cmdLog.clear(); });
    if (overlay) overlay.addEventListener('click', function () { L.cmdLog.close(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _isOpen) L.cmdLog.close();
    });
  });

})(window.LUCID);
