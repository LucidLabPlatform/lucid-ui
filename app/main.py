import os
import secrets

from fastapi import FastAPI, Request, WebSocket
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.proxy import proxy_http, proxy_websocket
from app.routes.ui import router as ui_router

_STATIC_DIR = os.path.join(os.path.dirname(__file__), "web", "static")

app = FastAPI(title="LUCID UI")

_session_secret = os.environ["SESSION_SECRET"]
app.add_middleware(SessionMiddleware, secret_key=_session_secret)

app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")
app.include_router(ui_router)


@app.websocket("/api/ws")
async def websocket_proxy(ws: WebSocket):
    await proxy_websocket(ws)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def api_proxy(path: str, request: Request):
    return await proxy_http(request, path)
