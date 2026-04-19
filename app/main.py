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

app = FastAPI(title="LUCID UI")

_session_secret = os.environ["SESSION_SECRET"]
app.add_middleware(SessionMiddleware, secret_key=_session_secret)

# ── Thin reverse proxy for /api/* → orchestrator ────────────────────

_http_client = httpx.AsyncClient(base_url=_ORCHESTRATOR_URL, timeout=30.0)


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
        headers={k: v for k, v in request.headers.items()
                 if k.lower() not in ("host", "connection", "transfer-encoding")},
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
