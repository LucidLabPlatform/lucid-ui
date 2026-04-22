// fleet-sparklines.js — uPlot sparkline + full chart logic
// Depends on: fleet-utils.js, fleet.js, uPlot (CDN)

(function (L) {
  'use strict';

  var sparkInstances = {};  // "agentId/metric" → uPlot instance
  var chartInstances = {};  // "agentId/metric" → uPlot instance (full chart)

  // Well-known metrics get stable colors; unknown metrics pull from palette
  var KNOWN_COLORS = {
    cpu_percent:    '#60a5fa',
    memory_percent: '#4ade80',
    disk_percent:   '#fb923c',
  };

  var KNOWN_LABELS = {
    cpu_percent:    'CPU',
    memory_percent: 'Memory',
    disk_percent:   'Disk',
  };

  var COLOR_PALETTE = ['#f472b6', '#a78bfa', '#34d399', '#fbbf24', '#38bdf8', '#fb7185', '#818cf8', '#e879f9'];
  var _paletteIndex = {};

  function metricColor(metric) {
    if (KNOWN_COLORS[metric]) return KNOWN_COLORS[metric];
    if (_paletteIndex[metric] == null) {
      _paletteIndex[metric] = Object.keys(_paletteIndex).length;
    }
    return COLOR_PALETTE[_paletteIndex[metric] % COLOR_PALETTE.length];
  }

  function metricLabel(metric) {
    if (KNOWN_LABELS[metric]) return KNOWN_LABELS[metric];
    // snake_case → Title Case, strip trailing _percent/_pct
    return metric
      .replace(/_(percent|pct)$/i, ' %')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // Percentage metrics get fixed 0-100 scale; everything else auto-scales
  function metricYScale(metric) {
    if (/(^|_)(percent|pct|usage)($|_)/i.test(metric)) return { min: 0, max: 100 };
    return {};
  }

  // Expose for use in other modules (e.g. chart container labels)
  L.metricLabel = metricLabel;
  L.metricColor = metricColor;

  // ── Sparkline rendering ────────────────────────────────────────────

  L.renderSparklines = function (containerEl) {
    var wraps = containerEl.querySelectorAll('.chart-container[data-agent][data-metric]');
    wraps.forEach(function (wrap) {
      var agentId = wrap.dataset.agent;
      var componentId = wrap.dataset.component || null;
      var metric = wrap.dataset.metric;
      var cacheKey = componentId ? agentId + '/' + componentId : agentId;
      var instanceKey = cacheKey + '/' + metric;

      if (sparkInstances[instanceKey]) {
        sparkInstances[instanceKey].destroy();
        delete sparkInstances[instanceKey];
      }

      var buf = (L.telemetryCache[cacheKey] && L.telemetryCache[cacheKey][metric]) || [];
      if (buf.length < 2) {
        wrap.innerHTML = '<span class="spark-empty">—</span>';
        return;
      }

      var times = buf.map(function (p) { return p.ts; });
      var values = buf.map(function (p) { return p.value; });
      var color = metricColor(metric);

      var opts = {
        width: wrap.clientWidth || 300,
        height: 60,
        cursor: { show: false },
        legend: { show: false },
        axes: [{ show: false }, { show: false }],
        scales: { y: metricYScale(metric) },
        series: [
          {},
          { stroke: color, width: 1.5, fill: color + '18' },
        ],
      };

      wrap.innerHTML = '<div class="spark-label">' + metricLabel(metric) + '</div>';
      var canvasWrap = document.createElement('div');
      canvasWrap.className = 'spark-canvas';
      canvasWrap.dataset.metric = metric;
      wrap.appendChild(canvasWrap);
      sparkInstances[instanceKey] = new uPlot(opts, [times, values], canvasWrap);
    });
  };

  // ── Update sparkline data (called from render loop) ────────────────

  L.updateSparkline = function (agentId, metric) {
    var key = agentId + '/' + metric;
    var inst = sparkInstances[key];
    if (!inst) return;

    var buf = (L.telemetryCache[agentId] && L.telemetryCache[agentId][metric]) || [];
    if (buf.length < 2) return;

    var times = buf.map(function (p) { return p.ts; });
    var values = buf.map(function (p) { return p.value; });
    inst.setData([times, values]);
  };

  // ── Destroy sparklines for an agent ────────────────────────────────

  L.destroySparklines = function (agentId) {
    var prefix = agentId + '/';
    Object.keys(sparkInstances).forEach(function (key) {
      if (key.startsWith(prefix)) {
        sparkInstances[key].destroy();
        delete sparkInstances[key];
      }
    });
  };

  // ── Full chart toggle ──────────────────────────────────────────────

  L.toggleFullChart = function (agentId, metric, containerEl) {
    var key = agentId + '/' + metric;

    // If chart exists, destroy it
    if (chartInstances[key]) {
      chartInstances[key].destroy();
      delete chartInstances[key];
      containerEl.innerHTML = '';
      containerEl.classList.remove('chart-open');
      return;
    }

    containerEl.classList.add('chart-open');
    renderFullChart(agentId, metric, containerEl, '1h');
  };

  async function renderFullChart(agentId, metric, containerEl, range) {
    var key = agentId + '/' + metric;

    // Destroy existing
    if (chartInstances[key]) {
      chartInstances[key].destroy();
      delete chartInstances[key];
    }

    // Time range
    var now = new Date();
    var from;
    var resolution = '1m';
    switch (range) {
      case '6h': from = new Date(now - 6 * 3600000); resolution = '5m'; break;
      case '24h': from = new Date(now - 24 * 3600000); resolution = '15m'; break;
      case '7d': from = new Date(now - 7 * 86400000); resolution = '1h'; break;
      default: from = new Date(now - 3600000); resolution = '1m';
    }

    // Range selector buttons
    var btnHtml = '<div class="chart-range-btns">';
    ['1h', '6h', '24h', '7d'].forEach(function (r) {
      var cls = r === range ? ' active' : '';
      btnHtml += '<button class="chart-range-btn' + cls + '" data-range="' + r + '" data-agent="' + L.escAttr(agentId) + '" data-metric="' + L.escAttr(metric) + '">' + r + '</button>';
    });
    btnHtml += '</div>';
    containerEl.innerHTML = btnHtml + '<div class="chart-canvas" id="chart-' + L.escAttr(agentId) + '-' + L.escAttr(metric) + '"></div>';

    var canvasEl = containerEl.querySelector('.chart-canvas');

    // Try fetching from API
    var times, values;
    try {
      var res = await L.apiFetch('/api/agents/' + encodeURIComponent(agentId) + '/telemetry?metric=' + encodeURIComponent(metric) + '&from=' + from.toISOString() + '&to=' + now.toISOString() + '&resolution=' + resolution);
      if (res.ok) {
        var data = await res.json();
        times = data.map(function (p) { return new Date(p.ts).getTime() / 1000; });
        values = data.map(function (p) { return p.value; });
      }
    } catch (e) { /* fallback to buffer */ }

    // Fallback to local buffer
    if (!times || !times.length) {
      var buf = (L.telemetryCache[agentId] && L.telemetryCache[agentId][metric]) || [];
      times = buf.map(function (p) { return p.ts; });
      values = buf.map(function (p) { return p.value; });
    }

    if (!times.length) {
      canvasEl.innerHTML = '<div class="comp-empty">No telemetry data</div>';
      return;
    }

    var width = canvasEl.clientWidth || 600;
    var opts = {
      width: width,
      height: 200,
      cursor: { show: true, drag: { x: true, y: false } },
      legend: { show: true },
      axes: [
        { show: true, stroke: '#8494ab', font: '10px system-ui', grid: { stroke: '#283044', width: 1 } },
        { show: true, stroke: '#8494ab', font: '10px system-ui', grid: { stroke: '#283044', width: 1 }, scale: 'y' },
      ],
      scales: { y: metricYScale(metric) },
      series: [
        { label: 'Time' },
        {
          label: metricLabel(metric),
          stroke: metricColor(metric),
          width: 2,
          fill: metricColor(metric) + '20',
        },
      ],
    };

    chartInstances[key] = new uPlot(opts, [times, values], canvasEl);
  }

  // ── Chart range button handler (event delegation from fleet-rows) ──
  L.handleChartRangeClick = function (btn) {
    var range = btn.dataset.range;
    var agentId = btn.dataset.agent;
    var metric = btn.dataset.metric;
    var container = btn.closest('.chart-container');
    if (container) renderFullChart(agentId, metric, container, range);
  };

})(window.LUCID);
