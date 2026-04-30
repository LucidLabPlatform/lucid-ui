# LUCID UI Refresh — Design Spec

**Date:** 2026-04-07
**Scope:** Fleet dashboard redesign + agent detail page redesign + visual polish

## Overview

Redesign the fleet dashboard and agent detail pages to surface more information, improve navigation, and modernize the visual appearance. No new dependencies — same vanilla JS + CSS + Jinja2 stack.

## 1. Fleet Dashboard — Table View

### Current State
Card grid showing: agent ID, status badge, component count, last seen. Minimal info requires clicking into each agent.

### New Design
Replace the card grid with a **sortable table**. Each row is one agent.

**Columns:**
| Column | Content |
|--------|---------|
| Agent | Agent ID as clickable link (navigates to detail page) |
| Status | Color-coded badge (online/offline/error/starting/unknown) |
| Host / IP | Hostname on first line, IP on second line (muted) |
| Uptime | Duration string (e.g., "4d 12h") or "—" if offline |
| Last Seen | Relative timestamp (e.g., "2s ago", "3h ago") |
| Components | Inline badges with status-colored dots per component |
| Actions | Icon buttons: ping (online only), delete |

**Behaviors:**
- Keep existing filter buttons (All / Online / Offline) above the table
- Offline agent rows rendered at reduced opacity (0.6)
- Rows highlight on hover with subtle background shift
- Click anywhere on a row (except action buttons) to navigate to agent detail
- Agent count subtitle remains ("3 agents, 2 online")
- WebSocket live updates: rows update in-place, new agents append, removed agents fade out
- Auto-refresh relative timestamps every 30s (same as current)
- Sort by clicking column headers (default: status then agent ID)

**Data source:** Same `GET /api/agents` endpoint. Host/IP/uptime come from agent metadata and status objects already returned by the API.

## 2. Agent Detail Page — Sidebar + Tabs

### Current State
Three-column layout: left panel (state/metadata JSON blobs + components), center (live logs — dominates the page), right (commands). No way to switch agents without going back to fleet dashboard.

### New Design

#### 2.1 Agent Sidebar (left, 220px)
- Lists all agents with status dot and agent ID
- Active agent highlighted with accent background + left border
- Click to switch — updates URL and reloads agent data without full page navigation
- Fetched from `/api/agents` on load, updated via WebSocket
- Scrollable if list is long
- Collapsible on small screens (hamburger toggle)

#### 2.2 Main Content Area (right of sidebar)

**Header bar:**
- Agent ID (large, bold)
- Status badge
- Last seen timestamp

**Tab bar** below header with 4 tabs:

##### Tab: Overview (default)
2x2 grid of info cards:

**Status & State card:**
- Key-value pairs extracted from status and state JSON
- Fields: state, uptime, last heartbeat, mode, errors
- Status values color-coded (online=green, error=red, etc.)

**Metadata card:**
- Key-value pairs: hostname, IP, OS, platform, architecture, agent version
- Static info, updates only on agent reconnect

**Components card:**
- List of components with name + status badge
- Each component row expandable to show component state/config
- Click component name to see its details inline

**Config card:**
- Key-value pairs: heartbeat interval, log level, telemetry enabled/disabled
- Logging and telemetry config summarized

All cards use a **key-value table layout** (label left, value right) instead of raw JSON. Clean, scannable.

##### Tab: Logs
- Same live log feed as current implementation
- Timestamp, level badge, message
- Max 500 lines, auto-scroll, clear button
- Component logs prefixed with component ID
- No changes to log functionality, just moved to its own tab so it doesn't dominate

##### Tab: Commands
- Same command form: target selector, quick commands, action input, body textarea, send button
- Same command history section below
- No changes to command functionality, just moved to its own tab

##### Tab: Raw JSON
- Collapsible sections for: Status, State, Metadata, Config
- Each section shows formatted JSON with syntax highlighting (monospace, color-coded keys/values)
- Useful for debugging, not the primary view

#### 2.3 URL Structure
- Agent detail URL remains `/agent/{agent_id}`
- Tab state stored in URL hash: `/agent/pi-01#logs`, `/agent/pi-01#commands`
- Clicking sidebar agent updates URL via `history.pushState` (no full reload)

## 3. Visual Polish

### Spacing
- Base spacing unit: 4px. Use multiples: 8, 12, 16, 24, 32
- Increase card/section padding from current ~8px to 16px
- Consistent gap between sections: 16px (small), 24px (medium)
- Table row padding: 12px vertical, 16px horizontal

### Typography & Hierarchy
- Page titles: 1.5rem, weight 700
- Section headers (card titles): 0.7rem uppercase, muted color, letter-spacing 0.05em
- Body text: 0.85rem
- Monospace values: 0.8rem
- Increase contrast on muted text: #64748b → #8494ab

### Colors
- Surface color slightly warmer: #1e2433 → #1a2036
- Border color softer: #2d3748 → #283044
- Active/selected accent: add subtle glow (`box-shadow: 0 0 0 1px var(--accent)`)
- Badge backgrounds: reduce saturation (e.g., `#22c55e33` → `#22c55e20`)
- Hover states: background shifts to `#ffffff08`

### Components
- Border radius: 8px → 10px for cards, 6px for badges/buttons
- Buttons: add subtle transition (150ms) on background and transform
- Hover: `transform: translateY(-1px)` on cards, `background` shift on table rows
- Status badges: consistent pill shape with dot prefix
- Tab bar: bottom border indicator on active tab, smooth transition

### Animations
- Page content: fade-in on load (opacity 0→1, 200ms)
- Tab switch: crossfade content (150ms)
- Table rows on WebSocket update: brief highlight flash (accent glow, 500ms fade)
- Sidebar agent switch: smooth content transition

## 4. Files Changed

| File | Changes |
|------|---------|
| `templates/dashboard.html` | Replace card grid markup with table structure |
| `static/dashboard.js` | Render table rows, add column sort, adapt WebSocket handlers |
| `templates/agent.html` | New sidebar + tabbed layout markup |
| `static/agent.js` | Tab switching, sidebar fetch/render, pushState navigation, adapt existing logs/commands |
| `static/styles.css` | Table styles, tab styles, sidebar styles, polish pass on spacing/colors/transitions |

No new files. No new dependencies. No backend changes.

## 5. Out of Scope

- Mobile/responsive redesign (beyond basic sidebar collapse)
- New API endpoints
- Telemetry charts or graphs
- Component detail sub-pages
- Search/filter within agent detail
