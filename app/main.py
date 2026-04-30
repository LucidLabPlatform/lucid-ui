import os

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
import httpx
import websockets

from app.routes.ui import router as ui_router

_STATIC_DIR = os.path.join(os.path.dirname(__file__), "web", "static")
_ORCHESTRATOR_URL = os.environ.get("ORCHESTRATOR_URL", "http://localhost:8000").rstrip("/")
_AI_URL = os.environ.get("AI_URL", "http://lucid-ai:5000").rstrip("/")
_VOICE_URL = os.environ.get("VOICE_URL", "http://lucid-voice:5100").rstrip("/")

app = FastAPI(title="LUCID UI")

_session_secret = os.environ["SESSION_SECRET"]
app.add_middleware(SessionMiddleware, secret_key=_session_secret)

# ── Thin reverse proxy for /api/* → orchestrator ────────────────────

_http_client = httpx.AsyncClient(base_url=_ORCHESTRATOR_URL, timeout=30.0)
_ai_client = httpx.AsyncClient(base_url=_AI_URL, timeout=120.0)
_voice_client = httpx.AsyncClient(base_url=_VOICE_URL, timeout=60.0)


_HOP_BY_HOP = {"host", "connection", "transfer-encoding", "content-length"}


def _filtered_headers(headers) -> dict:
    return {k: v for k, v in headers.items() if k.lower() not in _HOP_BY_HOP}


@app.api_route("/api/ai/chat/stream", methods=["POST"])
async def proxy_ai_stream(request: Request):
    """SSE stream proxy for the AI chat endpoint."""
    body = await request.body()

    async def event_stream():
        async with _ai_client.stream(
            method="POST",
            url="/api/ai/chat/stream",
            content=body,
            headers=_filtered_headers(request.headers),
        ) as upstream:
            async for chunk in upstream.aiter_raw():
                if chunk:
                    yield chunk

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.api_route("/api/ai/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_ai(request: Request, path: str):
    url = f"/api/ai/{path}"
    if request.url.query:
        url += f"?{request.url.query}"
    body = await request.body()
    resp = await _ai_client.request(
        method=request.method,
        url=url,
        content=body,
        headers=_filtered_headers(request.headers),
    )
    return StreamingResponse(
        content=iter([resp.content]),
        status_code=resp.status_code,
        headers={k: v for k, v in resp.headers.items()
                 if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")},
        media_type=resp.headers.get("content-type"),
    )


@app.api_route("/api/voice/{path:path}", methods=["GET", "POST"])
async def proxy_voice(request: Request, path: str):
    url = f"/api/voice/{path}"
    if request.url.query:
        url += f"?{request.url.query}"
    body = await request.body()
    resp = await _voice_client.request(
        method=request.method,
        url=url,
        content=body,
        headers=_filtered_headers(request.headers),
    )
    return StreamingResponse(
        content=iter([resp.content]),
        status_code=resp.status_code,
        headers={k: v for k, v in resp.headers.items()
                 if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")},
        media_type=resp.headers.get("content-type"),
    )


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_api(request: Request, path: str):
    url = f"/api/{path}"
    if request.url.query:
        url += f"?{request.url.query}"
    body = await request.body()
    resp = await _http_client.request(
        method=request.method,
        url=url,
        content=body,
        headers=_filtered_headers(request.headers),
    )
    return StreamingResponse(
        content=iter([resp.content]),
        status_code=resp.status_code,
        headers={k: v for k, v in resp.headers.items()
                 if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")},
        media_type=resp.headers.get("content-type"),
    )


@app.websocket("/api/ws")
async def proxy_ws(client_ws: WebSocket):
    await client_ws.accept()
    ws_url = _ORCHESTRATOR_URL.replace("http", "ws", 1) + "/api/ws"
    try:
        async with websockets.connect(ws_url) as upstream:
            import asyncio

            async def client_to_upstream():
                try:
                    while True:
                        data = await client_ws.receive_text()
                        await upstream.send(data)
                except WebSocketDisconnect:
                    pass

            async def upstream_to_client():
                try:
                    async for msg in upstream:
                        await client_ws.send_text(msg)
                except Exception:
                    pass

            await asyncio.gather(client_to_upstream(), upstream_to_client())
    except Exception:
        pass
    finally:
        try:
            await client_ws.close()
        except Exception:
            pass


app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")
app.include_router(ui_router)
