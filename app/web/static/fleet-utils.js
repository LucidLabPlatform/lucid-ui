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

  // ── Component type registry ────────────────────────────────────────
  // Known types appear first in this order; unknown types sort alphabetically after.
  // Adding a new type here gives it an icon, label, and sort position — but unknown
  // types still render correctly without any code change.
  L.COMP_TYPE_ORDER = ['projector', 'ndi', 'led_strip', 'ros_bridge', 'knx', 'optitrack', 'camera', 'cpu_monitor', 'exec', 'viz'];

  L.COMP_TYPE_LABELS = {
    projector:   'Projectors',
    ndi:         'NDI',
    led_strip:   'LED Strips',
    ros_bridge:  'ROS Bridges',
    knx:         'KNX Lighting',
    optitrack:   'OptiTrack',
    camera:      'Cameras',
    cpu_monitor: 'CPU Monitors',
    exec:        'Exec',
    viz:         'Visualization',
    generic:     'Other',
  };

  // Return a display label for any type, including unknown ones
  L.compTypeLabel = function (type) {
    if (L.COMP_TYPE_LABELS[type]) return L.COMP_TYPE_LABELS[type];
    // Convert snake_case to Title Case
    return type.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  };

  // Sort an array of type strings: known types first (in COMP_TYPE_ORDER), then
  // unknown types alphabetically, 'generic' always last
  L.sortCompTypes = function (types) {
    return types.slice().sort(function (a, b) {
      if (a === 'generic') return 1;
      if (b === 'generic') return -1;
      var ai = L.COMP_TYPE_ORDER.indexOf(a);
      var bi = L.COMP_TYPE_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  };

  // ── Component icon ─────────────────────────────────────────────────
  var _TYPE_ICONS = {
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

  // Accepts a component ID string, optionally a component object as second arg.
  // Routes through detectComponentType so partial-match naming works.
  L.compIcon = function (compId, comp) {
    var caps = comp && comp.metadata && comp.metadata.capabilities;
    var type = L.detectComponentType(compId, caps);
    return _TYPE_ICONS[type] || '\uD83D\uDCE6';
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
    if (Array.isArray(capabilities) && capabilities.length) {
      var caps = capabilities.join(' ');
      if (caps.indexOf('set-color') !== -1 || caps.indexOf('set-brightness') !== -1) return 'led_strip';
      if (caps.indexOf('roslaunch') !== -1) return 'ros_bridge';
      if (caps.indexOf('light/') !== -1 || caps.indexOf('brightness') !== -1) return 'knx';
      if (caps.indexOf('optitrack') !== -1) return 'optitrack';
    }
    return 'generic';
  };

  // ── State helpers ──────────────────────────────────────────────────

  // Normalize component state — handles both {payload: {...}} and bare object
  L.statePayload = function (comp) {
    var s = comp && comp.state;
    if (!s) return {};
    if (s && typeof s === 'object' && s.payload && typeof s.payload === 'object') return s.payload;
    return s;
  };

  // snake_case / kebab-case → Title Case
  L.formatKey = function (key) {
    return String(key)
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  };

  // ── Component summary ──────────────────────────────────────────────
  // Purely state-driven: takes the first 3 non-object scalar values from state.
  // No per-type logic — works for any component without code changes.
  L.compSummary = function (compId, comp) {
    var s = L.statePayload(comp);
    var status = (comp.status && comp.status.state) || 'unknown';
    var parts = [];
    var keys = Object.keys(s);
    for (var i = 0; i < keys.length && parts.length < 3; i++) {
      var k = keys[i];
      var v = s[k];
      if (v == null || typeof v === 'object' || String(v) === '') continue;
      parts.push(L.formatKey(k) + ': ' + v);
    }
    return parts.length ? parts.join(' \u00B7 ') : status;
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
