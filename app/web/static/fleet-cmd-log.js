// fleet-cmd-log.js — Command Log Drawer
// Depends on: fleet.js, fleet-utils.js

(function (L) {
  'use strict';

  var _entries = [];
  var _unread = 0;
  var _isOpen = false;
  var _hasErrors = false;
  var _filter = 'all'; // 'all' | 'errors' | 'mine'

  // Topic-link target index: keys are "agent_id||component_id||action".
  // Used to suppress successful evt/*/result entries triggered by EMQX
  // republish rules (server-side bridges) so the log only shows commands
  // the user actually initiated.
  var _topicLinkKeys = new Set();
  var _topicLinksFetchedAt = 0;
  var TOPIC_LINK_TTL_MS = 60 * 1000;
  var TOPIC_LINK_TARGET_RE = /^lucid\/agents\/([^/]+)\/(?:components\/([^/]+)\/)?cmd\/(.+)$/;

  function _topicLinkKey(agentId, componentId, action) {
    return (agentId || '') + '||' + (componentId || '') + '||' + (action || '');
  }

  function _refreshTopicLinks() {
    return L.apiFetch('/api/topic-links').then(function (res) {
      if (!res.ok) return;
      return res.json().then(function (rows) {
        var next = new Set();
        (rows || []).forEach(function (r) {
          var m = TOPIC_LINK_TARGET_RE.exec(r && r.target_topic || '');
          if (!m) return;
          next.add(_topicLinkKey(m[1], m[2], m[3]));
        });
        _topicLinkKeys = next;
        _topicLinksFetchedAt = Date.now();
      });
    }).catch(function () { /* leave previous index intact */ });
  }

  function _isFromTopicLink(agentId, componentId, action) {
    return _topicLinkKeys.has(_topicLinkKey(agentId, componentId, action));
  }

  // Extract action name from `evt/{action}/result` topic_type. The action
  // can contain slashes (e.g. `cfg/telemetry/set`).
  function _actionFromEvtTopic(topicType) {
    if (!topicType) return '';
    var t = topicType;
    if (t.indexOf('evt/') === 0) t = t.slice(4);
    if (t.length >= 7 && t.slice(-7) === '/result') t = t.slice(0, -7);
    return t;
  }

  function _matchesFilter(entry) {
    if (_filter === 'errors') return !entry.ok;
    if (_filter === 'mine')   return !!entry.fromSession;
    return true;
  }

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

  function _applyFilter() {
    var feed = document.getElementById('cmd-log-feed');
    var empty = document.getElementById('cmd-log-empty');
    if (!feed) return;

    var rows = feed.querySelectorAll('.cmd-log-entry');
    var visible = 0;
    rows.forEach(function (row) {
      var id = row.dataset.entryId;
      var entry = _entries.find(function (e) { return e.id === id; });
      if (entry && _matchesFilter(entry)) {
        row.style.display = '';
        visible++;
      } else {
        row.style.display = 'none';
      }
    });
    if (empty) empty.style.display = visible === 0 ? '' : 'none';
  }

  function _setFilter(f) {
    _filter = f;
    document.querySelectorAll('.cmd-log-filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.filter === f);
    });
    _applyFilter();
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

  function _failureMessage(entry) {
    if (entry.timeoutReason) return entry.timeoutReason;
    var resp = entry.details && entry.details.response;
    if (resp && typeof resp === 'object') {
      if (resp.error) return String(resp.error);
      if (resp.message) return String(resp.message);
    } else if (typeof resp === 'string' && resp) {
      return resp;
    }
    return 'Command failed (no error message returned)';
  }

  function _renderCommandEntry(entry) {
    var el = document.createElement('div');
    el.className = 'cmd-log-entry ' + (entry.ok ? 'cmd-ok' : 'cmd-err');
    el.dataset.entryId = entry.id;
    if (!_matchesFilter(entry)) el.style.display = 'none';

    var icon = entry.ok ? '\u2713' : '\u2717';
    var elapsed = entry.elapsed ? _formatElapsed(entry.elapsed) : '';
    var timeStr = _formatTime(entry.ts);
    var hasDetails = !!entry.details;
    var detailsOpenByDefault = !entry.ok;

    var html = '<span class="cmd-log-icon">' + icon + '</span>';
    html += '<div class="cmd-log-body">';
    html += '<div class="cmd-log-action">' + L.esc(entry.action);
    if (entry.count && entry.count > 1) {
      html += '<span class="cmd-log-count-badge">\u00D7 ' + entry.count + '</span>';
    }
    html += '</div>';
    html += '<div class="cmd-log-target">' + L.esc(entry.target) + '</div>';
    html += '<div class="cmd-log-meta">';
    if (elapsed) html += '<span>' + L.esc(elapsed) + '</span>';
    html += '<span>' + L.esc(timeStr) + '</span>';
    if (!entry.fromSession) html += '<span class="cmd-log-source-tag">auto</span>';
    if (entry.timeoutReason) html += '<span class="cmd-log-source-tag">timeout</span>';
    html += '</div>';

    if (!entry.ok) {
      html += '<div class="cmd-log-error">' + L.esc(_failureMessage(entry)) + '</div>';
    }

    if (hasDetails) {
      html += '<div class="cmd-log-details' + (detailsOpenByDefault ? ' open' : '') + '" id="details-' + entry.id + '">';
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
    if (hasDetails) {
      var caret = detailsOpenByDefault ? '\u25B2' : '\u25BC';
      html += '<button class="cmd-log-expand-btn" title="Toggle details">' + caret + '</button>';
    }

    el.innerHTML = html;

    if (hasDetails) {
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
    el.dataset.entryId = entry.id;
    if (!_matchesFilter(entry)) el.style.display = 'none';

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

  function _replaceTop(entry) {
    var feed = document.getElementById('cmd-log-feed');
    if (!feed || !feed.firstChild) return;
    var el = entry.type === 'bulk' ? _renderBulkEntry(entry) : _renderCommandEntry(entry);
    feed.replaceChild(el, feed.firstChild);
  }

  function _dedupKey(entry) {
    return (entry.target || '') + '::' + (entry.action || '');
  }

  L.cmdLog = {
    refreshTopicLinks: _refreshTopicLinks,

    addEntry: function (historyEntry, wsEvt, opts) {
      opts = opts || {};
      var isTimeout = !!opts.timeout;
      var ok, response, elapsed, timeoutReason;

      if (isTimeout) {
        ok = false;
        response = null;
        elapsed = historyEntry ? (Date.now() - new Date(historyEntry.ts).getTime()) : null;
        timeoutReason = opts.reason || 'No response from agent within 15s';
      } else if (wsEvt === null) {
        ok = false;
        response = historyEntry ? historyEntry.result : null;
        elapsed = historyEntry ? historyEntry.elapsed : null;
      } else {
        ok = !!(wsEvt.payload && wsEvt.payload.ok);
        response = wsEvt ? wsEvt.payload : null;
        elapsed = historyEntry ? historyEntry.result_elapsed : null;
      }

      var agentId = historyEntry ? historyEntry.agentId : (wsEvt && wsEvt.agent_id) || '';
      var componentId = historyEntry ? (historyEntry.componentId || '') : ((wsEvt && wsEvt.component_id) || '');
      var target = agentId + (componentId ? '/' + componentId : '');
      var action = historyEntry
        ? historyEntry.action
        : _actionFromEvtTopic(wsEvt && wsEvt.topic_type);

      var fromSession = !!historyEntry || isTimeout;
      var fromTopicLink = !fromSession && _isFromTopicLink(agentId, componentId, action);

      // Suppress successful results that originated from a topic-link
      // (server-side EMQX republish rule). Failures still surface.
      if (fromTopicLink && ok) return;

      var entry = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2),
        type: 'command',
        fromSession: fromSession,
        fromTopicLink: fromTopicLink,
        action: action,
        target: target,
        ok: ok,
        elapsed: elapsed,
        ts: new Date(),
        timeoutReason: timeoutReason,
        details: {
          request: historyEntry ? historyEntry.payload : null,
          response: response,
        },
        count: 1,
      };

      // Dedup: when the most-recent entry is a successful command with the
      // same (target, action), collapse this one into it instead of stacking.
      // Failures intentionally break dedup so every error gets its own row.
      var top = _entries[0];
      if (top && top.type === 'command' && top.ok && entry.ok && _dedupKey(top) === _dedupKey(entry)) {
        top.count = (top.count || 1) + 1;
        top.ts = entry.ts;
        top.elapsed = entry.elapsed;
        top.details = entry.details;
        top.id = entry.id;
        _replaceTop(top);
        return;
      }

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
        fromSession: true,
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
      if (Date.now() - _topicLinksFetchedAt > TOPIC_LINK_TTL_MS) {
        _refreshTopicLinks();
      }
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

  document.addEventListener('DOMContentLoaded', function () {
    var toggleBtn = document.getElementById('cmd-log-toggle-btn');
    var closeBtn  = document.getElementById('cmd-log-close-btn');
    var clearBtn  = document.getElementById('cmd-log-clear-btn');
    var overlay   = document.getElementById('cmd-log-overlay');

    if (toggleBtn) toggleBtn.addEventListener('click', function () { L.cmdLog.toggle(); });
    if (closeBtn)  closeBtn.addEventListener('click',  function () { L.cmdLog.close(); });
    if (clearBtn)  clearBtn.addEventListener('click',  function () { L.cmdLog.clear(); });
    if (overlay)   overlay.addEventListener('click',   function () { L.cmdLog.close(); });

    document.querySelectorAll('.cmd-log-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { _setFilter(btn.dataset.filter); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _isOpen) L.cmdLog.close();
    });

    _refreshTopicLinks();
  });

})(window.LUCID);
