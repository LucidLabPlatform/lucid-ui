// fleet-utils.js — Shared helpers for the LUCID fleet dashboard
// All functions attached to window.LUCID namespace

(function (L) {
  'use strict';

  // ── HTML escaping ──────────────────────────────────────────────────
  const _escEl = document.createElement('span');
  L.esc = function (s) {
    _escEl.textContent = s == null ? '' : String(s);
    return _escEl.innerHTML;
  };

  L.escAttr = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  // ── Time formatting ────────────────────────────────────────────────
  L.fmtTs = function (ts) {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };

  L.fmtUptime = function (status) {
    var up = status && status.uptime_s;
    if (up == null) return '—';
    var d = Math.floor(up / 86400);
    var h = Math.floor((up % 86400) / 3600);
    var m = Math.floor((up % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  };

  L.fmtDuration = function (ms) {
    if (ms == null) return '—';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  };

  // ── Agent state helper ─────────────────────────────────────────────
  L.agentState = function (a) {
    return (a.status && a.status.state) || 'unknown';
  };

  // ── Component icon ─────────────────────────────────────────────────
  L.compIcon = function (compId) {
    var map = {
      exec: '\u2699\uFE0F',
      ros_bridge: '\uD83D\uDD17',
      led_strip: '\uD83D\uDCA1',
      ndi: '\uD83D\uDCE1',
      projector: '\uD83C\uDFA5',
      viz: '\uD83D\uDDA5\uFE0F',
      knx: '\uD83D\uDCA1',
      optitrack: '\uD83C\uDFAF',
      camera: '\uD83D\uDCF7',
      cpu_monitor: '\uD83D\uDCBB',
    };
    return map[compId] || '\uD83D\uDCE6';
  };

  // ── Component type detection ───────────────────────────────────────
  L.detectComponentType = function (compId, capabilities) {
    var id = compId.toLowerCase();
    // Exact and substring matches on component ID
    if (id === 'cpu' || id.indexOf('cpu') !== -1 || id.indexOf('fixture_cpu') !== -1) return 'cpu_monitor';
    if (id === 'knx' || id.indexOf('knx') !== -1) return 'knx';
    if (id === 'optitrack' || id.indexOf('optitrack') !== -1) return 'optitrack';
    if (id === 'camera' || id.indexOf('camera') !== -1) return 'camera';
    var types = ['exec', 'ros_bridge', 'led_strip', 'ndi', 'projector', 'viz'];
    for (var i = 0; i < types.length; i++) {
      if (id === types[i] || id.indexOf(types[i]) !== -1) return types[i];
    }
    // Secondary signal: capabilities
    if (capabilities && capabilities.length) {
      var caps = capabilities.join(' ');
      if (caps.indexOf('set-color') !== -1 || caps.indexOf('set-brightness') !== -1) return 'led_strip';
      if (caps.indexOf('roslaunch') !== -1) return 'ros_bridge';
      if (caps.indexOf('light/') !== -1 || caps.indexOf('brightness') !== -1) return 'knx';
      if (caps.indexOf('optitrack') !== -1) return 'optitrack';
    }
    return 'generic';
  };

  // ── Component summary ──────────────────────────────────────────────
  L.compSummary = function (compId, comp) {
    var s = (comp.state && comp.state.payload) || comp.state || {};
    var status = (comp.status && comp.status.state) || 'unknown';
    var type = L.detectComponentType(compId, comp.metadata && comp.metadata.capabilities);

    if (type === 'exec') {
      var active = s.active_runs || s['active runs'] || 0;
      return active > 0 ? active + ' active run(s)' : 'No active runs';
    }
    if (type === 'ros_bridge') {
      var rl = s.roslaunch || s.roslaunch_state || '';
      var pubs = s.publishers || '';
      var subs = s.subscriptions || '';
      if (status === 'error') return 'ROS master not reachable';
      var parts = [];
      if (rl) parts.push('roslaunch: ' + rl);
      if (pubs !== '') parts.push(pubs + ' pub');
      if (subs !== '') parts.push(subs + ' sub');
      return parts.join(' \u00B7 ') || status;
    }
    if (type === 'led_strip') {
      var count = s.led_count || s['led count'] || '';
      var bright = s.brightness != null ? s.brightness : '';
      var effect = s.current_effect || s['current effect'] || '';
      var parts2 = [];
      if (count) parts2.push(count + ' LEDs');
      if (bright !== '') parts2.push('Brightness: ' + bright);
      if (effect) parts2.push('Effect: ' + effect);
      return parts2.join(' \u00B7 ') || status;
    }
    if (type === 'ndi') {
      var rx = s.receive_active || s['receive active'] || 'false';
      var tx = s.send_active || s['send active'] || 'false';
      if (rx === 'true' || tx === 'true') {
        var p = [];
        if (rx === 'true') p.push('receiving');
        if (tx === 'true') p.push('sending');
        return p.join(' + ');
      }
      return 'Idle';
    }
    if (type === 'projector') {
      var conn = s.connected || '';
      var port = s.serial_port || s['serial port'] || '';
      if (conn === 'true') return 'Connected' + (port ? ' \u00B7 ' + port : '');
      return 'Not connected';
    }
    if (type === 'viz') {
      var arena = s.arena || 'unknown';
      var td = s.touchdesigner || 'unknown';
      return 'Arena: ' + arena + ' \u00B7 TD: ' + td;
    }
    return status;
  };

  // ── Payload form helpers ───────────────────────────────────────────

  // Infer control type from key name and value (fallback when schema unavailable)
  L.inferControl = function (key, val, parentKey) {
    var k = key.toLowerCase();
    var pk = (parentKey || '').toLowerCase();
    if (pk === 'color' && (k === 'r' || k === 'g' || k === 'b'))
      return { type: 'slider', min: 0, max: 255, step: 1 };
    if (k === 'brightness') return { type: 'slider', min: 0, max: 255, step: 1 };
    if (k === 'speed') return { type: 'slider', min: 0.1, max: 5.0, step: 0.1 };
    if (k.indexOf('interval') !== -1 || k.indexOf('timeout') !== -1)
      return { type: 'number', min: 0, max: 3600, step: 1 };
    if (typeof val === 'boolean' || val === 'true' || val === 'false')
      return { type: 'toggle' };
    if (typeof val === 'number') {
      if (Number.isInteger(val)) return { type: 'number', min: 0, max: 10000, step: 1 };
      return { type: 'number', min: 0, max: 1000, step: 0.1 };
    }
    return { type: 'text' };
  };

  // Build control from schema field definition (preferred over inferControl)
  L.controlFromSchema = function (fieldDef) {
    if (!fieldDef) return null;
    var t = fieldDef.type;
    if (fieldDef['enum']) return { type: 'enum', options: fieldDef['enum'] };
    if (t === 'boolean') return { type: 'toggle' };
    if (t === 'integer' || t === 'number' || t === 'float') {
      var min = fieldDef.min != null ? fieldDef.min : 0;
      var max = fieldDef.max != null ? fieldDef.max : 10000;
      var step = t === 'integer' ? 1 : 0.1;
      if (max - min <= 255) return { type: 'slider', min: min, max: max, step: step };
      return { type: 'number', min: min, max: max, step: step };
    }
    if (t === 'string') return { type: 'text' };
    return null;
  };

  // Flatten a template object into form fields
  L.flattenTemplate = function (obj, prefix, parentKey) {
    var fields = [];
    for (var key in obj) {
      if (!obj.hasOwnProperty(key)) continue;
      var val = obj[key];
      var path = prefix ? prefix + '.' + key : key;
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        fields = fields.concat(L.flattenTemplate(val, path, key));
      } else {
        fields.push({ path: path, key: key, value: val, control: L.inferControl(key, val, parentKey) });
      }
    }
    return fields;
  };

  // Build nested object from flat path-value pairs
  L.buildPayload = function (fields) {
    var obj = {};
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var parts = f.path.split('.');
      var cur = obj;
      for (var j = 0; j < parts.length - 1; j++) {
        if (!cur[parts[j]]) cur[parts[j]] = {};
        cur = cur[parts[j]];
      }
      cur[parts[parts.length - 1]] = f.value;
    }
    return obj;
  };

  // ── API helper ─────────────────────────────────────────────────────
  L.apiFetch = function (path, opts) {
    var url = L.apiBase.replace(/\/+$/, '') + path;
    return fetch(url, opts);
  };

})(window.LUCID);
