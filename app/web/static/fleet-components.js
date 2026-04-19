// fleet-components.js — Type-aware component card renderers
// Depends on: fleet-utils.js

(function (L) {
  'use strict';

  // ── Dispatcher ─────────────────────────────────────────────────────

  L.renderComponent = function (agentId, compId, comp, catalog) {
    var type = L.detectComponentType(compId, comp.metadata && comp.metadata.capabilities);
    var renderer = renderers[type] || renderers.generic;
    return renderer(agentId, compId, comp, catalog);
  };

  // ── Quick-command filter ────────────────────────────────────────────
  // Card only shows the most important commands; detail page shows all.

  function quickCommands(commands) {
    if (!commands || !commands.length) return [];
    return commands.filter(function (cmd) {
      var a = cmd.action.toLowerCase();
      if (a.indexOf('cfg') !== -1) return false;
      if (a.indexOf('navigate') !== -1) return false;
      if (a.indexOf('keystone') !== -1) return false;
      if (a.indexOf('image_shift') !== -1) return false;
      if (a.indexOf('aspect') !== -1) return false;
      return true;
    });
  }

  // ── Action buttons HTML ────────────────────────────────────────────

  function actionsHtml(agentId, compId, commands) {
    if (!commands || !commands.length) return '';
    return '<div class="comp-actions">' + commands.map(function (cmd) {
      var cls = cmd.category === 'danger' ? ' act-danger' : '';
      var hb = cmd.has_body ? ' data-has-body="1"' : '';
      var tpl = cmd.template ? ' data-template="' + L.escAttr(JSON.stringify(cmd.template)) + '"' : '';
      return '<button class="act' + cls + '" data-agent="' + L.escAttr(agentId) +
        '" data-comp="' + L.escAttr(compId) +
        '" data-action="' + L.escAttr(cmd.action) + '"' + hb + tpl + '>' +
        L.esc(cmd.label || cmd.action) + '</button>';
    }).join('') + '</div>';
  }

  // ── Shared parts ───────────────────────────────────────────────────

  function compHeader(compId, comp) {
    var cState = (comp.status && comp.status.state) || 'unknown';
    var icon = L.compIcon(compId);
    return '<div class="comp-card-header">' +
      '<span class="comp-card-icon">' + icon + '</span>' +
      '<span class="comp-card-name">' + L.esc(compId) + '</span>' +
      '<span class="status-badge status-' + cState + '">' + cState + '</span>' +
    '</div>';
  }

  function capsHtml(comp) {
    var caps = (comp.metadata && comp.metadata.capabilities) || [];
    if (!caps.length) return '';
    return '<div class="comp-caps">' + caps.map(function (c) {
      return '<span class="pill">' + L.esc(c) + '</span>';
    }).join('') + '</div>';
  }

  function progressBar(value, max, color) {
    var pct = Math.min(100, Math.max(0, (value / max) * 100));
    return '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%;background:' + (color || 'var(--accent)') + '"></div></div>';
  }

  function metricRow(label, value, unit) {
    return '<div class="metric-row"><span class="metric-label">' + L.esc(label) + '</span>' +
      '<span class="metric-value">' + L.esc(value) + (unit ? ' <span class="metric-unit">' + L.esc(unit) + '</span>' : '') + '</span></div>';
  }

  // ── LED Strip renderer ─────────────────────────────────────────────

  function renderLedStrip(agentId, compId, comp, catalog) {
    var s = (comp.state && comp.state.payload) || comp.state || {};
    var commands = (catalog && catalog.components && catalog.components[compId]) || [];
    var brightness = s.brightness != null ? s.brightness : '—';
    var color = s.color || {};
    var r = color.r || 0, g = color.g || 0, b = color.b || 0;
    var colorHex = 'rgb(' + r + ',' + g + ',' + b + ')';
    var effect = s.current_effect || s['current effect'] || 'none';
    var ledCount = s.led_count || s['led count'] || '—';

    var html = compHeader(compId, comp);
    html += '<div class="comp-card-body">';
    html += '<div class="comp-metrics-grid">';
    html += '<div class="metric-block">';
    html += '<span class="metric-label">Brightness</span>';
    html += '<span class="metric-value">' + L.esc(brightness) + '</span>';
    if (typeof brightness === 'number') html += progressBar(brightness, 255, 'var(--accent)');
    html += '</div>';
    html += '<div class="metric-block">';
    html += '<span class="metric-label">Color</span>';
    html += '<div class="color-swatch" style="background:' + colorHex + '"></div>';
    html += '</div>';
    html += '<div class="metric-block">';
    html += '<span class="metric-label">Effect</span>';
    html += '<span class="metric-value">' + L.esc(effect) + '</span>';
    html += '</div>';
    html += '<div class="metric-block">';
    html += '<span class="metric-label">LEDs</span>';
    html += '<span class="metric-value">' + L.esc(ledCount) + '</span>';
    html += '</div>';
    html += '</div>';
    html += '</div>';
    html += actionsHtml(agentId, compId, quickCommands(commands));

    return '<div class="comp-card comp-led-strip">' + html + '</div>';
  }

  // ── CPU Monitor renderer ───────────────────────────────────────────

  function renderCpuMonitor(agentId, compId, comp, catalog) {
    var s = (comp.state && comp.state.payload) || comp.state || {};
    var commands = (catalog && catalog.components && catalog.components[compId]) || [];
    var cpu = s.cpu_percent != null ? s.cpu_percent : s['cpu percent'];
    var temp = s.temperature || s.cpu_temp || s['cpu temp'];
    var load = s.load_avg || s['load avg'];
    var throttled = s.throttled != null ? s.throttled : s.is_throttled;
    var freq = s.frequency || s.cpu_freq;

    var html = compHeader(compId, comp);
    html += '<div class="comp-card-body">';
    html += '<div class="comp-metrics-grid">';
    if (cpu != null) {
      html += '<div class="metric-block">';
      html += '<span class="metric-label">CPU</span>';
      html += '<span class="metric-value">' + L.esc(cpu) + '%</span>';
      html += progressBar(cpu, 100, cpu > 80 ? 'var(--red)' : cpu > 50 ? 'var(--yellow)' : 'var(--green)');
      html += '</div>';
    }
    if (temp != null) {
      html += '<div class="metric-block">';
      html += '<span class="metric-label">Temp</span>';
      html += '<span class="metric-value">' + L.esc(temp) + '\u00B0C</span>';
      html += '</div>';
    }
    if (load != null) {
      var loadStr = Array.isArray(load) ? load.join(', ') : String(load);
      html += '<div class="metric-block">';
      html += '<span class="metric-label">Load</span>';
      html += '<span class="metric-value">' + L.esc(loadStr) + '</span>';
      html += '</div>';
    }
    if (throttled != null) {
      var thr = throttled === true || throttled === 'true' || throttled === 'Yes';
      html += '<div class="metric-block">';
      html += '<span class="metric-label">Throttled</span>';
      html += '<span class="metric-value ' + (thr ? 'val-warn' : 'val-ok') + '">' + (thr ? 'Yes' : 'No') + '</span>';
      html += '</div>';
    }
    if (freq != null) {
      html += '<div class="metric-block">';
      html += '<span class="metric-label">Freq</span>';
      html += '<span class="metric-value">' + L.esc(freq) + ' MHz</span>';
      html += '</div>';
    }
    html += '</div></div>';
    html += actionsHtml(agentId, compId, quickCommands(commands));

    return '<div class="comp-card comp-cpu-monitor">' + html + '</div>';
  }

  // ── ROS Bridge renderer ────────────────────────────────────────────

  function renderRosBridge(agentId, compId, comp, catalog) {
    var s = (comp.state && comp.state.payload) || comp.state || {};
    var commands = (catalog && catalog.components && catalog.components[compId]) || [];
    var cState = (comp.status && comp.status.state) || 'unknown';

    var html = compHeader(compId, comp);
    html += '<div class="comp-card-body">';
    html += '<div class="comp-metrics-grid">';
    html += metricRow('Roslaunch', s.roslaunch || s.roslaunch_state || '—');
    html += metricRow('Publishers', s.publishers != null ? s.publishers : '—');
    html += metricRow('Subscribers', s.subscriptions != null ? s.subscriptions : '—');
    if (s.active_topics != null) html += metricRow('Active Topics', s.active_topics);
    html += '</div></div>';
    html += actionsHtml(agentId, compId, quickCommands(commands));

    return '<div class="comp-card comp-ros-bridge">' + html + '</div>';
  }

  // ── NDI renderer ───────────────────────────────────────────────────

  function renderNdi(agentId, compId, comp, catalog) {
    var s = (comp.state && comp.state.payload) || comp.state || {};
    var commands = (catalog && catalog.components && catalog.components[compId]) || [];
    var rx = s.receive_active || s['receive active'] || 'false';
    var tx = s.send_active || s['send active'] || 'false';

    var html = compHeader(compId, comp);
    html += '<div class="comp-card-body">';
    html += '<div class="comp-badges">';
    html += '<span class="comp-badge ' + (rx === 'true' ? 'badge-active' : 'badge-inactive') + '">Receive: ' + (rx === 'true' ? 'Active' : 'Off') + '</span>';
    html += '<span class="comp-badge ' + (tx === 'true' ? 'badge-active' : 'badge-inactive') + '">Send: ' + (tx === 'true' ? 'Active' : 'Off') + '</span>';
    html += '</div></div>';
    html += actionsHtml(agentId, compId, quickCommands(commands));

    return '<div class="comp-card">' + html + '</div>';
  }

  // ── Generic renderer (fallback) ────────────────────────────────────

  function renderGeneric(agentId, compId, comp, catalog) {
    var s = (comp.state && comp.state.payload) || comp.state || {};
    var commands = (catalog && catalog.components && catalog.components[compId]) || [];

    var html = compHeader(compId, comp);
    html += '<div class="comp-card-body">';

    // Key-value grid of all state fields
    var keys = Object.keys(s);
    if (keys.length) {
      html += '<div class="kv-grid">';
      keys.forEach(function (k) {
        html += '<div class="kv-cell"><div class="kv-key">' + L.esc(k) + '</div><div class="kv-val">' + L.esc(s[k]) + '</div></div>';
      });
      html += '</div>';
    } else {
      html += '<div class="comp-empty">No state data</div>';
    }
    html += '</div>';
    html += actionsHtml(agentId, compId, quickCommands(commands));

    return '<div class="comp-card">' + html + '</div>';
  }

  // ── Renderer map ───────────────────────────────────────────────────

  var renderers = {
    led_strip: renderLedStrip,
    cpu_monitor: renderCpuMonitor,
    ros_bridge: renderRosBridge,
    ndi: renderNdi,
    projector: renderGeneric,
    viz: renderGeneric,
    exec: renderGeneric,
    generic: renderGeneric,
  };

})(window.LUCID);
