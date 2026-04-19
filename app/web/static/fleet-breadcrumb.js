// fleet-breadcrumb.js — Breadcrumb dropdown selectors for navigation
// Depends on: fleet-utils.js, fleet.js

(function (L) {
  'use strict';

  var TYPE_ORDER = ['projector', 'ndi', 'led_strip', 'ros_bridge', 'cpu_monitor', 'exec', 'viz', 'generic'];
  var TYPE_LABELS = {
    projector: 'Projectors', ndi: 'NDI', led_strip: 'LED Strips',
    ros_bridge: 'ROS Bridges', cpu_monitor: 'CPU Monitors',
    exec: 'Exec', viz: 'Visualization', generic: 'Other',
  };

  var activeDropdown = null; // currently open dropdown element

  // ── Build dropdown items ──────────────────────────────────────────

  function getAgentItems() {
    return Object.values(L.agents).map(function (a) {
      var state = L.agentState(a);
      var compCount = Object.keys(a.components || {}).length;
      return {
        value: a.agent_id,
        label: a.agent_id,
        secondary: compCount + ' comp' + (compCount !== 1 ? 's' : ''),
        dotClass: 'dot-' + state,
        icon: '',
      };
    }).sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  function getComponentItems(agentId) {
    var a = L.agents[agentId];
    if (!a) return [];
    return Object.values(a.components || {}).map(function (c) {
      var cState = (c.status && c.status.state) || 'unknown';
      return {
        value: c.component_id,
        label: c.component_id,
        secondary: cState,
        dotClass: 'dot-' + cState,
        icon: L.compIcon(c.component_id),
      };
    }).sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  function getTypeItems() {
    var typeCounts = {};
    Object.values(L.agents).forEach(function (a) {
      Object.values(a.components || {}).forEach(function (c) {
        var t = L.detectComponentType(c.component_id, c.metadata && c.metadata.capabilities);
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      });
    });
    var items = [];
    TYPE_ORDER.forEach(function (t) {
      if (!typeCounts[t]) return;
      items.push({
        value: t,
        label: TYPE_LABELS[t] || t,
        secondary: typeCounts[t] + ' total',
        dotClass: '',
        icon: L.compIcon(t === 'generic' ? '' : t),
      });
    });
    return items;
  }

  // ── Dropdown rendering ────────────────────────────────────────────

  function openDropdown(trigger) {
    closeDropdown();

    var type = trigger.dataset.dropdownType;
    var current = trigger.dataset.current || '';
    var navPattern = trigger.dataset.navPattern || '';
    var agentId = trigger.dataset.agentId || '';

    var items;
    if (type === 'agent') items = getAgentItems();
    else if (type === 'component') items = getComponentItems(agentId);
    else if (type === 'type') items = getTypeItems();
    else return;

    if (!items.length) return;

    var dd = document.createElement('div');
    dd.className = 'bc-dropdown';

    // Search input for long lists
    if (items.length > 6) {
      var search = document.createElement('input');
      search.className = 'bc-dropdown-search';
      search.placeholder = 'Filter\u2026';
      search.autocomplete = 'off';
      dd.appendChild(search);
      search.addEventListener('input', function () {
        filterDropdownItems(dd, search.value);
      });
      // Prevent click from closing the dropdown
      search.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    var list = document.createElement('div');
    list.className = 'bc-dropdown-list';

    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'bc-dropdown-item';
      if (item.value === current) row.classList.add('current');
      row.dataset.value = item.value;

      var html = '';
      if (item.dotClass) html += '<span class="agent-dot ' + item.dotClass + '"></span>';
      if (item.icon) html += '<span class="bc-dropdown-icon">' + item.icon + '</span>';
      html += '<span class="bc-dropdown-label">' + L.esc(item.label) + '</span>';
      html += '<span class="bc-dropdown-secondary">' + L.esc(item.secondary) + '</span>';
      row.innerHTML = html;

      row.addEventListener('click', function (e) {
        e.stopPropagation();
        var url = navPattern.replace('{value}', encodeURIComponent(item.value));
        closeDropdown();
        window.location.href = url;
      });

      list.appendChild(row);
    });

    dd.appendChild(list);

    // Position below trigger
    var rect = trigger.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.top = (rect.bottom + 4) + 'px';
    dd.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 260)) + 'px';

    document.body.appendChild(dd);
    activeDropdown = dd;

    // Focus search if present
    var searchInput = dd.querySelector('.bc-dropdown-search');
    if (searchInput) searchInput.focus();

    // Keyboard navigation
    dd._keyHandler = function (e) {
      if (e.key === 'Escape') { closeDropdown(); e.preventDefault(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var visible = list.querySelectorAll('.bc-dropdown-item:not(.bc-dropdown-hidden)');
        if (!visible.length) return;
        var activeItem = list.querySelector('.bc-dropdown-item.highlighted');
        var idx = Array.from(visible).indexOf(activeItem);
        if (activeItem) activeItem.classList.remove('highlighted');
        idx = e.key === 'ArrowDown' ? Math.min(idx + 1, visible.length - 1) : Math.max(idx - 1, 0);
        visible[idx].classList.add('highlighted');
        visible[idx].scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter') {
        var hl = list.querySelector('.bc-dropdown-item.highlighted');
        if (hl) hl.click();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', dd._keyHandler);
  }

  function closeDropdown() {
    if (!activeDropdown) return;
    if (activeDropdown._keyHandler) document.removeEventListener('keydown', activeDropdown._keyHandler);
    activeDropdown.remove();
    activeDropdown = null;
  }

  function filterDropdownItems(dd, query) {
    var q = query.toLowerCase();
    var items = dd.querySelectorAll('.bc-dropdown-item');
    items.forEach(function (item) {
      var label = (item.dataset.value || '').toLowerCase();
      var text = item.textContent.toLowerCase();
      if (!q || label.indexOf(q) !== -1 || text.indexOf(q) !== -1) {
        item.classList.remove('bc-dropdown-hidden');
      } else {
        item.classList.add('bc-dropdown-hidden');
      }
    });
  }

  // ── Event delegation ──────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('.bc-selector');
    if (trigger) {
      e.preventDefault();
      e.stopPropagation();
      if (activeDropdown) { closeDropdown(); return; }
      openDropdown(trigger);
      return;
    }

    // Click outside closes dropdown
    if (activeDropdown && !activeDropdown.contains(e.target)) {
      closeDropdown();
    }
  });

})(window.LUCID);
