// fleet-components.js — Schema-driven component card renderer
// Depends on: fleet-utils.js, fleet.js
//
// One renderer for all component types. Field display is driven by
// schema.publishes.state.fields — no per-type branches. Adding a new
// component type requires no changes here.

(function (L) {
  'use strict';

  // ── Public renderer ────────────────────────────────────────────────

  L.renderComponent = function (agentId, compId, comp, catalog) {
    var schema = compSchema(agentId, compId);
    var fieldDefs = schema && schema.publishes && schema.publishes.state && schema.publishes.state.fields;
    var state = L.statePayload(comp);
    var commands = (catalog && catalog.components && catalog.components[compId]) || [];

    var html = compHeader(compId, comp);
    html += '<div class="comp-card-body">';
    html += renderStateFields(state, fieldDefs);
    html += '</div>';
    html += actionsHtml(agentId, compId, commands);

    return '<div class="comp-card">' + html + '</div>';
  };

  // ── Schema lookup ──────────────────────────────────────────────────

  function compSchema(agentId, compId) {
    return L.schemas[agentId] &&
           L.schemas[agentId].components &&
           L.schemas[agentId].components[compId];
  }

  // ── State rendering ────────────────────────────────────────────────
  // Schema fields are rendered with type-aware controls (progress bar,
  // boolean badge, color swatch). Fields not in the schema fall back to
  // plain text. Object values are skipped unless they match the RGB pattern.

  function renderStateFields(state, fieldDefs) {
    if (!state || !Object.keys(state).length) return '<div class="comp-empty">No state</div>';

    var html = '<div class="comp-metrics-grid">';
    var rendered = {};

    // 1. Schema-defined fields first (preserves authored order)
    if (fieldDefs) {
      Object.keys(fieldDefs).forEach(function (key) {
        var val = state[key];
        if (val == null) return;
        rendered[key] = true;
        html += renderField(key, val, fieldDefs[key]);
      });
    }

    // 2. Remaining state fields not covered by schema
    Object.keys(state).forEach(function (key) {
      if (rendered[key]) return;
      var val = state[key];
      if (val == null || typeof val === 'object') return; // skip complex objects
      html += renderField(key, val, null);
    });

    html += '</div>';
    return html;
  }

  function renderField(key, val, def) {
    var type = def && def.type;

    // Color object with r/g/b subfields
    if (type === 'object' || (val && typeof val === 'object')) {
      var fields = def && def.fields;
      if (fields && fields.r != null && fields.g != null && fields.b != null && typeof val === 'object') {
        return colorField(key, val);
      }
      return ''; // skip other objects
    }

    // Boolean
    if (type === 'boolean' || val === true || val === false) {
      return boolField(key, val);
    }
    // String booleans
    if (val === 'true' || val === 'false') {
      return boolField(key, val === 'true');
    }

    // Numeric with min/max → progress bar
    if ((type === 'integer' || type === 'number') && def && def.min != null && def.max != null) {
      return numericField(key, Number(val), def.min, def.max);
    }

    // Enum → plain value (could become a badge later)
    if (def && def['enum']) {
      return textField(key, val);
    }

    // Fallback: plain text
    return textField(key, val);
  }

  function textField(key, val) {
    return '<div class="metric-block">' +
      '<span class="metric-label">' + L.esc(L.formatKey(key)) + '</span>' +
      '<span class="metric-value">' + L.esc(String(val)) + '</span>' +
    '</div>';
  }

  function boolField(key, val) {
    var on = val === true || val === 'true';
    return '<div class="metric-block">' +
      '<span class="metric-label">' + L.esc(L.formatKey(key)) + '</span>' +
      '<span class="metric-value ' + (on ? 'val-ok' : 'val-muted') + '">' + (on ? 'Yes' : 'No') + '</span>' +
    '</div>';
  }

  function numericField(key, val, min, max) {
    var range = max - min;
    var pct = range > 0 ? Math.min(100, Math.max(0, (val - min) / range * 100)) : 0;
    // 0-100 range metrics get traffic-light coloring; other ranges use accent
    var color = (min === 0 && max === 100)
      ? (val > 80 ? 'var(--red)' : val > 50 ? 'var(--yellow)' : 'var(--green)')
      : 'var(--accent)';
    return '<div class="metric-block">' +
      '<span class="metric-label">' + L.esc(L.formatKey(key)) + '</span>' +
      '<span class="metric-value">' + L.esc(String(val)) + '</span>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + pct.toFixed(1) + '%;background:' + color + '"></div></div>' +
    '</div>';
  }

  function colorField(key, val) {
    var r = Math.max(0, Math.min(255, Number(val.r) || 0));
    var g = Math.max(0, Math.min(255, Number(val.g) || 0));
    var b = Math.max(0, Math.min(255, Number(val.b) || 0));
    var hex = '#' + [r, g, b].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
    return '<div class="metric-block">' +
      '<span class="metric-label">' + L.esc(L.formatKey(key)) + '</span>' +
      '<span class="metric-value"><span class="color-swatch" style="background:' + hex + '"></span> ' + L.esc(hex) + '</span>' +
    '</div>';
  }

  // ── Header ─────────────────────────────────────────────────────────

  function compHeader(compId, comp) {
    var cState = (comp.status && comp.status.state) || 'unknown';
    var icon = L.compIcon(compId, comp);
    return '<div class="comp-card-header">' +
      '<span class="comp-card-icon">' + icon + '</span>' +
      '<span class="comp-card-name">' + L.esc(compId) + '</span>' +
      '<span class="status-badge status-' + cState + '">' + cState + '</span>' +
    '</div>';
  }

  // ── Actions ────────────────────────────────────────────────────────
  // Show all non-config commands. Config commands are available via the
  // full command panel only (they need forms, not quick buttons).

  function actionsHtml(agentId, compId, commands) {
    var visible = commands.filter(function (cmd) {
      return cmd.category !== 'config';
    });
    if (!visible.length) return '';
    return '<div class="comp-actions">' +
      visible.map(function (cmd) {
        var hb = cmd.has_body ? ' data-has-body="1"' : '';
        var tpl = cmd.template ? ' data-template="' + L.escAttr(JSON.stringify(cmd.template)) + '"' : '';
        return '<button class="act act-quick"' +
          ' data-agent="' + L.escAttr(agentId) + '"' +
          ' data-comp="' + L.escAttr(compId) + '"' +
          ' data-action="' + L.escAttr(cmd.action) + '"' +
          hb + tpl + '>' +
          L.esc(cmd.label || cmd.action) +
        '</button>';
      }).join('') +
    '</div>';
  }

})(window.LUCID);
