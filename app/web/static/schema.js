// Schema visualization page
document.querySelector('a[href="/schema"]')?.classList.add('active');

const metaEl   = document.getElementById('schema-meta');
const grid     = document.getElementById('schema-tables');
const relTbody = document.getElementById('relations-tbody');
const search   = document.getElementById('search');

let tablesData = {};
let relationsData = [];

// ── Tab switching ────────────────────────────────────────────────────
document.querySelectorAll('.schema-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.schema-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.schema-tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'diagram') renderDiagram();
  });
});

// ── Tables card view ─────────────────────────────────────────────────
function renderTables() {
  const q = search.value.toLowerCase();
  const names = Object.keys(tablesData).sort();
  const filtered = names.filter(name => {
    if (!q) return true;
    if (name.includes(q)) return true;
    return tablesData[name].some(c => c.column.includes(q));
  });

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty">No tables match</div>';
    return;
  }

  grid.innerHTML = filtered.map(name => {
    const cols = tablesData[name];
    const rows = cols.map(c => {
      const badges = [];
      if (c.primary_key) badges.push('<span class="badge badge-authn">PK</span>');
      if (!c.nullable)   badges.push('<span class="col-notnull">NOT NULL</span>');
      return `<tr>
        <td class="col-name">${c.column}</td>
        <td class="col-type">${c.type}</td>
        <td>${badges.join(' ')}</td>
      </tr>`;
    }).join('');

    return `<div class="schema-card">
      <div class="schema-card-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="schema-card-name">${name}</span>
        <span class="schema-card-count">${cols.length} cols</span>
      </div>
      <div class="schema-card-body">
        <table class="schema-col-table">${rows}</table>
      </div>
    </div>`;
  }).join('');
}

// ── Relations table view ─────────────────────────────────────────────
function renderRelations() {
  if (!relationsData.length) {
    relTbody.innerHTML = '<tr><td colspan="5" class="empty">No relations</td></tr>';
    return;
  }
  relTbody.innerHTML = relationsData.map(r => `
    <tr>
      <td style="font-family:var(--font-mono);font-size:0.78rem">${r.from_table}</td>
      <td class="col-name">${r.from_column}</td>
      <td style="color:var(--muted)">&rarr;</td>
      <td style="font-family:var(--font-mono);font-size:0.78rem">${r.to_table}</td>
      <td class="col-name">${r.to_column}</td>
    </tr>`).join('');
}

// ── ER Diagram ───────────────────────────────────────────────────────
const SVG_NS = 'http://www.w3.org/2000/svg';
const COL_H = 20;
const HDR_H = 28;
const PAD_X = 12;
const PAD_Y = 6;
const TABLE_W = 260;

let tablePositions = {};
let svgEl, viewBox, dragState = null, panState = null;

function measureTableH(name) {
  const cols = tablesData[name] || [];
  return HDR_H + cols.length * COL_H + PAD_Y;
}

// Shorten verbose Postgres type names for diagram display
function shortType(t) {
  const map = {
    'timestamp with time zone': 'timestamptz',
    'timestamp without time zone': 'timestamp',
    'double precision': 'float8',
    'character varying': 'varchar',
    'USER-DEFINED': 'custom',
  };
  return map[t] || t;
}

// ── Layout groups ────────────────────────────────────────────────────
const LAYOUT_GROUPS = [
  { name: 'Agents',
    color: 'rgba(96, 165, 250, 0.05)', border: 'rgba(96, 165, 250, 0.2)', label: '#60a5fa',
    tables: ['agents', 'agent_status', 'agent_state', 'agent_metadata',
             'agent_cfg', 'agent_cfg_logging', 'agent_cfg_telemetry',
             'agent_telemetry', 'agent_events', 'client_events'] },
  { name: 'Components',
    color: 'rgba(52, 211, 153, 0.05)', border: 'rgba(52, 211, 153, 0.2)', label: '#34d399',
    tables: ['components', 'component_status', 'component_state', 'component_metadata',
             'component_cfg', 'component_cfg_logging', 'component_cfg_telemetry',
             'component_telemetry', 'component_events'] },
  { name: 'Commands',
    color: 'rgba(251, 191, 36, 0.05)', border: 'rgba(251, 191, 36, 0.2)', label: '#fbbf24',
    tables: ['commands', 'logs', 'mqtt_rejected_messages'] },
  { name: 'Auth',
    color: 'rgba(248, 113, 113, 0.05)', border: 'rgba(248, 113, 113, 0.2)', label: '#f87171',
    tables: ['users', 'authn_log', 'authz_log', 'topic_links'] },
  { name: 'System',
    color: 'rgba(148, 163, 184, 0.04)', border: 'rgba(148, 163, 184, 0.15)', label: '#94a3b8',
    tables: ['schema_migrations'] },
];

function autoLayout() {
  tablePositions = {};

  const CW = TABLE_W + 36;        // column step (table width + gap)
  const ROW_GAP = 20;             // vertical gap between stacked tables
  const SECTION_GAP = 70;         // horizontal gap between major sections

  // Helper: table height (0 if table doesn't exist)
  function th(name) {
    return tablesData[name] ? measureTableH(name) : 0;
  }

  // Helper: place tables in a vertical stack, return Y after last table
  function stackV(tables, x, y0) {
    let y = y0;
    for (const t of tables) {
      if (!tablesData[t]) continue;
      tablePositions[t] = { x, y };
      y += measureTableH(t) + ROW_GAP;
    }
    return y;
  }

  const BASE_Y = 60;

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: Agent domain — 3 sub-columns (retained | config | streaming)
  // ═══════════════════════════════════════════════════════════════════
  const aX = 40;

  // "agents" centered above the 3 sub-columns
  tablePositions['agents'] = { x: aX + CW, y: BASE_Y };

  const aChildY = BASE_Y + th('agents') + 36;

  // Col 1 — retained info
  stackV(['agent_status', 'agent_state', 'agent_metadata'], aX, aChildY);
  // Col 2 — config
  stackV(['agent_cfg', 'agent_cfg_logging', 'agent_cfg_telemetry'], aX + CW, aChildY);
  // Col 3 — streaming / events
  stackV(['agent_telemetry', 'agent_events', 'client_events'], aX + CW * 2, aChildY);

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: Component domain — 3 sub-columns (retained | config | streaming)
  // ═══════════════════════════════════════════════════════════════════
  const cX = aX + CW * 3 + SECTION_GAP;

  // "components" centered above 3 sub-columns
  tablePositions['components'] = { x: cX + CW, y: BASE_Y };

  const cChildY = BASE_Y + th('components') + 36;

  // Col 1 — retained info
  stackV(['component_status', 'component_state', 'component_metadata'], cX, cChildY);
  // Col 2 — config
  stackV(['component_cfg', 'component_cfg_logging', 'component_cfg_telemetry'], cX + CW, cChildY);
  // Col 3 — streaming / events
  stackV(['component_logs', 'component_telemetry', 'component_events'], cX + CW * 2, cChildY);

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3: Commands and broker observability
  // ═══════════════════════════════════════════════════════════════════
  const cmdX = cX + CW * 3 + SECTION_GAP;
  tablePositions['commands'] = { x: cmdX, y: BASE_Y };
  stackV(['logs', 'mqtt_rejected_messages'], cmdX, BASE_Y + th('commands') + 36);

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4: Auth — stacked below commands
  // ═══════════════════════════════════════════════════════════════════
  const authY = BASE_Y + th('commands') + th('logs') + th('mqtt_rejected_messages') + 72;
  stackV(['users', 'authn_log', 'authz_log', 'topic_links'], cmdX, authY);

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 5: System
  // ═══════════════════════════════════════════════════════════════════
  tablePositions['schema_migrations'] = { x: cmdX + CW, y: BASE_Y };

  // Catch-all: place any tables not explicitly positioned
  let overflowY = 1400;
  for (const name of Object.keys(tablesData).sort()) {
    if (tablePositions[name]) continue;
    tablePositions[name] = { x: 40, y: overflowY };
    overflowY += (tablesData[name] ? measureTableH(name) : 60) + ROW_GAP;
  }
}

function renderDiagram() {
  svgEl = document.getElementById('diagram-svg');
  if (!Object.keys(tablesData).length) return;

  if (!Object.keys(tablePositions).length) autoLayout();

  // Compute SVG bounds
  let maxX = 0, maxY = 0;
  for (const name of Object.keys(tablePositions)) {
    const p = tablePositions[name];
    const h = measureTableH(name);
    maxX = Math.max(maxX, p.x + TABLE_W + 80);
    maxY = Math.max(maxY, p.y + h + 80);
  }

  svgEl.setAttribute('width', '100%');
  svgEl.setAttribute('height', '100%');
  viewBox = { x: 0, y: 0, w: Math.max(maxX, 800), h: Math.max(maxY, 600) };
  applyViewBox();

  // Build SVG content
  let svg = '';

  // Defs for arrow marker
  svg += `<defs>
    <marker id="fk-arrow" viewBox="0 0 10 6" refX="10" refY="3"
            markerWidth="8" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,3 L0,6 Z" fill="#60a5fa"/>
    </marker>
  </defs>`;

  // ── Group backgrounds & labels ──
  LAYOUT_GROUPS.forEach(group => {
    let minX = Infinity, minY = Infinity, maxGX = 0, maxGY = 0;
    let count = 0;
    group.tables.forEach(name => {
      const pos = tablePositions[name];
      if (!pos || !tablesData[name]) return;
      count++;
      minX  = Math.min(minX,  pos.x);
      minY  = Math.min(minY,  pos.y);
      maxGX = Math.max(maxGX, pos.x + TABLE_W);
      maxGY = Math.max(maxGY, pos.y + measureTableH(name));
    });
    if (!count) return;

    const pad = 22;
    const labelH = 24;
    svg += `<rect x="${minX - pad}" y="${minY - pad - labelH}"
      width="${maxGX - minX + pad * 2}" height="${maxGY - minY + pad * 2 + labelH}"
      rx="10" fill="${group.color}" stroke="${group.border}" stroke-width="1"
      stroke-dasharray="6,3"/>`;
    svg += `<text x="${minX - pad + 12}" y="${minY - pad - 6}" fill="${group.label}"
      font-family="system-ui, sans-serif" font-size="11" font-weight="700"
      letter-spacing="0.5">${group.name.toUpperCase()}</text>`;
  });

  // Build FK lookup: which columns in each table are FKs, and to where
  const fkMap = {};
  relationsData.forEach(r => {
    const key = r.from_table + '.' + r.from_column;
    fkMap[key] = r.to_table + '.' + r.to_column;
  });

  // Deduplicate relations: one line per (from_table → to_table) pair
  const relByPair = {};
  relationsData.forEach(r => {
    const key = r.from_table + '→' + r.to_table;
    if (!relByPair[key]) relByPair[key] = r;
  });
  const uniqueRels = Object.values(relByPair);

  // ── Draw relation lines ──
  svg += '<g class="diagram-relations">';
  uniqueRels.forEach(r => {
    const fromPos = tablePositions[r.from_table];
    const toPos   = tablePositions[r.to_table];
    if (!fromPos || !toPos) return;

    const fromH = measureTableH(r.from_table);
    const toH   = measureTableH(r.to_table);

    const fromCX = fromPos.x + TABLE_W / 2;
    const fromCY = fromPos.y + fromH / 2;
    const toCX   = toPos.x + TABLE_W / 2;
    const toCY   = toPos.y + toH / 2;

    const dx = toCX - fromCX;
    const dy = toCY - fromCY;

    let x1, y1, x2, y2, path;

    if (Math.abs(dy) > Math.abs(dx) * 0.6) {
      // Vertical-ish: connect top/bottom edges
      if (dy < 0) {
        x1 = fromCX; y1 = fromPos.y;
        x2 = toCX;   y2 = toPos.y + toH;
      } else {
        x1 = fromCX; y1 = fromPos.y + fromH;
        x2 = toCX;   y2 = toPos.y;
      }
      const midY = (y1 + y2) / 2;
      path = `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
    } else {
      // Horizontal-ish: connect left/right edges
      if (dx > 0) {
        x1 = fromPos.x + TABLE_W; y1 = fromCY;
        x2 = toPos.x;             y2 = toCY;
      } else {
        x1 = fromPos.x;           y1 = fromCY;
        x2 = toPos.x + TABLE_W;   y2 = toCY;
      }
      const midX = (x1 + x2) / 2;
      path = `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;
    }

    svg += `<path d="${path}"
      fill="none" stroke="#60a5fa" stroke-width="1.5" opacity="0.35"
      marker-end="url(#fk-arrow)"/>`;
  });
  svg += '</g>';

  // ── Draw tables ──
  const names = Object.keys(tablesData).sort();
  names.forEach(name => {
    const pos = tablePositions[name];
    if (!pos) return;
    const cols = tablesData[name];
    const h = measureTableH(name);

    svg += `<g class="diagram-table" data-table="${name}" transform="translate(${pos.x},${pos.y})">`;

    // Background
    svg += `<rect width="${TABLE_W}" height="${h}" rx="6" ry="6"
      fill="#1e2433" stroke="#2d3748" stroke-width="1.5"/>`;

    // Header
    svg += `<rect width="${TABLE_W}" height="${HDR_H}" rx="6" ry="6"
      fill="#253047" stroke="none"/>`;
    svg += `<rect x="0" y="${HDR_H - 6}" width="${TABLE_W}" height="6"
      fill="#253047" stroke="none"/>`;
    svg += `<text x="${PAD_X}" y="${HDR_H - 8}" fill="#60a5fa"
      font-family="JetBrains Mono, Fira Code, monospace" font-size="12" font-weight="700">${name}</text>`;

    // Header separator
    svg += `<line x1="0" y1="${HDR_H}" x2="${TABLE_W}" y2="${HDR_H}"
      stroke="#2d3748" stroke-width="1"/>`;

    // Columns
    cols.forEach((col, i) => {
      const cy = HDR_H + i * COL_H;
      const textY = cy + COL_H - 5;
      const colKey = name + '.' + col.column;
      const isFK = colKey in fkMap;

      // Column name
      let colColor = '#e2e8f0';
      if (col.primary_key) colColor = '#facc15';
      else if (isFK) colColor = '#60a5fa';

      svg += `<text x="${PAD_X}" y="${textY}" fill="${colColor}"
        font-family="JetBrains Mono, Fira Code, monospace" font-size="11">${col.column}</text>`;

      // Type (shortened)
      svg += `<text x="${TABLE_W - PAD_X}" y="${textY}" fill="#64748b" text-anchor="end"
        font-family="JetBrains Mono, Fira Code, monospace" font-size="9">${shortType(col.type)}</text>`;

      // PK indicator
      if (col.primary_key) {
        svg += `<text x="${TABLE_W - PAD_X - 55}" y="${textY}" fill="#facc15" text-anchor="end"
          font-family="system-ui" font-size="8" font-weight="700">PK</text>`;
      }
      // FK indicator
      if (isFK) {
        const fkOffset = col.primary_key ? 70 : 55;
        svg += `<text x="${TABLE_W - PAD_X - fkOffset}" y="${textY}" fill="#60a5fa" text-anchor="end"
          font-family="system-ui" font-size="8" font-weight="700">FK</text>`;
      }

      // Row separator
      if (i < cols.length - 1) {
        svg += `<line x1="${PAD_X}" y1="${cy + COL_H}" x2="${TABLE_W - PAD_X}" y2="${cy + COL_H}"
          stroke="#1a2030" stroke-width="0.5"/>`;
      }
    });

    svg += '</g>';
  });

  svgEl.innerHTML = svg;

  // Attach drag handlers to table groups
  svgEl.querySelectorAll('.diagram-table').forEach(g => {
    g.style.cursor = 'grab';
    g.addEventListener('mousedown', onTableDragStart);
  });
}

function applyViewBox() {
  svgEl.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

// ── Drag tables ──────────────────────────────────────────────────────
function onTableDragStart(e) {
  e.stopPropagation();
  const g = e.currentTarget;
  const name = g.dataset.table;
  const pt = svgPoint(e);
  dragState = {
    name,
    startX: pt.x,
    startY: pt.y,
    origX: tablePositions[name].x,
    origY: tablePositions[name].y,
  };
  g.style.cursor = 'grabbing';

  const onMove = (ev) => {
    if (!dragState) return;
    const p = svgPoint(ev);
    tablePositions[dragState.name].x = dragState.origX + (p.x - dragState.startX);
    tablePositions[dragState.name].y = dragState.origY + (p.y - dragState.startY);
    renderDiagram();
  };
  const onUp = () => {
    dragState = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ── Pan & zoom ───────────────────────────────────────────────────────
const container = document.getElementById('diagram-container');

container.addEventListener('mousedown', (e) => {
  if (dragState) return;
  if (e.target.closest('.diagram-table')) return;
  panState = { startX: e.clientX, startY: e.clientY, origX: viewBox.x, origY: viewBox.y };
  container.style.cursor = 'grabbing';

  const onMove = (ev) => {
    if (!panState) return;
    const scale = viewBox.w / container.clientWidth;
    viewBox.x = panState.origX - (ev.clientX - panState.startX) * scale;
    viewBox.y = panState.origY - (ev.clientY - panState.startY) * scale;
    applyViewBox();
  };
  const onUp = () => {
    panState = null;
    container.style.cursor = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});

container.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 1.1 : 0.9;
  const rect = container.getBoundingClientRect();
  const mx = (e.clientX - rect.left) / rect.width;
  const my = (e.clientY - rect.top) / rect.height;

  const newW = viewBox.w * factor;
  const newH = viewBox.h * factor;
  viewBox.x += (viewBox.w - newW) * mx;
  viewBox.y += (viewBox.h - newH) * my;
  viewBox.w = newW;
  viewBox.h = newH;
  applyViewBox();
}, { passive: false });

function svgPoint(e) {
  const rect = svgEl.getBoundingClientRect();
  return {
    x: viewBox.x + (e.clientX - rect.left) / rect.width * viewBox.w,
    y: viewBox.y + (e.clientY - rect.top) / rect.height * viewBox.h,
  };
}

// ── Toolbar ──────────────────────────────────────────────────────────
document.getElementById('diagram-fit').addEventListener('click', () => {
  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  for (const name of Object.keys(tablePositions)) {
    const p = tablePositions[name];
    const h = measureTableH(name);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + TABLE_W);
    maxY = Math.max(maxY, p.y + h);
  }
  viewBox = { x: minX - 50, y: minY - 50, w: maxX - minX + 100, h: maxY - minY + 100 };
  applyViewBox();
});

document.getElementById('diagram-reset').addEventListener('click', () => {
  autoLayout();
  renderDiagram();
  document.getElementById('diagram-fit').click();
});

// ── Load data ────────────────────────────────────────────────────────
async function load() {
  const [tRes, rRes] = await Promise.all([
    fetch('/api/schema/tables'),
    fetch('/api/schema/relations'),
  ]);
  const tData = await tRes.json();
  const rData = await rRes.json();

  tablesData = tData.tables;
  relationsData = rData.relations;

  const count = Object.keys(tablesData).length;
  const relCount = relationsData.length;
  metaEl.textContent = `${count} tables · ${relCount} foreign keys`;

  renderTables();
  renderRelations();
  renderDiagram();
}

search.addEventListener('input', renderTables);
load();
