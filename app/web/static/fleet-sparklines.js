// fleet-sparklines.js — uPlot sparkline + full chart logic
// Depends on: fleet-utils.js, fleet.js, uPlot (CDN)

(function (L) {
  'use strict';

  var sparkInstances = {};  // "agentId/metric" → uPlot instance
  var chartInstances = {};  // "agentId/metric" → uPlot instance (full chart)

  var SPARK_COLORS = {
    cpu_percent: '#60a5fa',
    memory_percent: '#4ade80',
    disk_percent: '#fb923c',
  };

  var METRIC_LABELS = {
    cpu_percent: 'CPU',
    memory_percent: 'Mem',
    disk_percent: 'Disk',
  };

  // ── Sparkline rendering ────────────────────────────────────────────

  L.renderSparklines = function (agentId, containerEl) {
    var metrics = ['cpu_percent', 'memory_percent', 'disk_percent'];
    metrics.forEach(function (metric) {
      var key = agentId + '/' + metric;
      var wrapId = 'spark-' + agentId + '-' + metric;
      var wrap = containerEl.querySelector('#' + CSS.escape(wrapId));
      if (!wrap) return;

      // Destroy existing instance
      if (sparkInstances[key]) {
        sparkInstances[key].destroy();
        delete sparkInstances[key];
      }

      var buf = (L.telemetryCache[agentId] && L.telemetryCache[agentId][metric]) || [];
      if (buf.length < 2) {
        wrap.innerHTML = '<span class="spark-empty">—</span>';
        return;
      }

      var times = buf.map(function (p) { return p.ts; });
      var values = buf.map(function (p) { return p.value; });

      var opts = {
        width: 120,
        height: 30,
        cursor: { show: false },
        legend: { show: false },
        axes: [{ show: false }, { show: false }],
        scales: { y: { min: 0, max: 100 } },
        series: [
          {},
          {
            stroke: SPARK_COLORS[metric] || '#60a5fa',
            width: 1.5,
            fill: (SPARK_COLORS[metric] || '#60a5fa') + '18',
          },
        ],
      };

      wrap.innerHTML = '';
      sparkInstances[key] = new uPlot(opts, [times, values], wrap);
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
      scales: { y: { min: 0, max: 100 } },
      series: [
        { label: 'Time' },
        {
          label: (METRIC_LABELS[metric] || metric) + ' %',
          stroke: SPARK_COLORS[metric] || '#60a5fa',
          width: 2,
          fill: (SPARK_COLORS[metric] || '#60a5fa') + '20',
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
