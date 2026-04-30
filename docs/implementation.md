# lucid-ui — Implementation

> **Package:** `lucid-ui` | **Container:** `lucid-ui` | **Public port:** 5000

## Overview

`lucid-ui` is the web dashboard for LUCID Central Command. It is a FastAPI application that serves server-rendered HTML pages (Jinja2 templates) and static assets, while proxying all API and WebSocket requests to the backend services (`lucid-orchestrator`, `lucid-ai`, `lucid-voice`). It is the only service with a port exposed to the host network, acting as the single entry point for browser-based interaction.

## Key Modules and Responsibilities

| Module | Responsibility |
|--------|----------------|
| `main.py` | FastAPI app creation; mounts static files; includes UI router; registers API proxy (`/api/*`) and WebSocket proxy (`/api/ws`) catch-all routes |
| `auth.py` | Dashboard authentication: LDAP bind (optional) + fallback password; session management via Starlette `SessionMiddleware` with signed cookies |
| `proxy.py` | HTTP and WebSocket reverse proxy; routes `/api/ai/*` to `lucid-ai`, `/api/voice/*` to `lucid-voice`, everything else to `lucid-orchestrator` |
| `routes/ui.py` | HTML page routes: login/logout, dashboard, agent detail, component detail, users, auth log, schema, experiments (templates/runs/detail), topic tree, topic links, AI chat |
| `web/templates/` | Jinja2 HTML templates (14 pages) |
| `web/static/` | CSS, JavaScript, and static assets |

## Important Implementation Details

### Reverse Proxy Architecture

The UI does not implement any business logic. All data comes from proxied API calls:

```
Browser ──► lucid-ui :5000
              │
              ├── /api/ai/*     ──► lucid-ai :5000
              ├── /api/voice/*  ──► lucid-voice :5100
              ├── /api/ws       ──► lucid-orchestrator :5000 (WebSocket)
              └── /api/*        ──► lucid-orchestrator :5000
```

The proxy (`proxy.py`) uses:
- `httpx.AsyncClient` for HTTP requests (120s timeout, follows redirects disabled)
- `websockets.connect` for WebSocket proxying with bidirectional message forwarding via two `asyncio.Task`s
- Hop-by-hop headers are stripped during proxying
- URL selection logic in `select_api_base()` routes by path prefix

### Authentication

Two-layer authentication:

1. **LDAP** (if `LDAP_URL` is set) — Attempts `ldap3` simple bind using `LDAP_BIND_DN_TEMPLATE.format(username=username)`. A successful bind grants access regardless of the dashboard password.
2. **Password fallback** — Compares the submitted password against `DASHBOARD_PASSWORD` environment variable.

Session state is stored in a Starlette `SessionMiddleware` cookie signed with `SESSION_SECRET`. The `require_login` helper redirects unauthenticated requests to `/login`.

### Feature Flags

Two environment variables control UI section visibility:
- `LUCID_UI_ENABLE_EXPERIMENTS` — Shows/hides experiment template and run pages
- `LUCID_UI_ENABLE_AI` — Shows/hides the AI chat page

These are evaluated at import time and passed to templates as context variables.

### Page Inventory

| Route | Template | Auth Required | Description |
|-------|----------|---------------|-------------|
| `/login` | `login.html` | No | Login form |
| `/` | `dashboard.html` | Yes | Fleet overview with agent cards |
| `/agent/{id}` | `agent.html` | Yes | Agent detail: status, state, config, telemetry, logs, commands |
| `/agent/{id}/component/{cid}` | `component.html` | Yes | Component detail |
| `/users` | `users.html` | Yes | MQTT user management |
| `/auth-log` | `auth_log.html` | Yes | Auth event log (authn + authz) |
| `/schema` | `schema.html` | Yes | Database schema browser |
| `/experiments/templates` | `experiments_templates.html` | Yes | Experiment template list and editor |
| `/experiments/runs` | `experiments_runs.html` | Yes | Experiment run list |
| `/experiments/runs/{id}` | `experiments_run_detail.html` | Yes | Run step-by-step detail |
| `/topic-tree` | `topic_tree.html` | Yes | Live MQTT topic tree visualization |
| `/topic-links` | `topic_links.html` | Yes | EMQX topic link management |
| `/ai` | `ai_chat.html` | Yes | AI chat interface |

## How It Connects to Other Services

- **lucid-orchestrator** — All `/api/*` requests (except AI and voice) are proxied here; WebSocket connections are proxied for live event streaming
- **lucid-ai** — `/api/ai/*` requests proxied for chat and conversation history
- **lucid-voice** — `/api/voice/*` requests proxied for STT/TTS
- No direct database or MQTT connections
