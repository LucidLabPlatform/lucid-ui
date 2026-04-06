import asyncio
import os
from typing import Iterable

import httpx
import websockets
from fastapi import Request, Response, WebSocket, WebSocketDisconnect

ORCHESTRATOR_URL = os.environ.get("ORCHESTRATOR_URL", "").rstrip("/")
FLEET_CORE_URL = os.environ.get("FLEET_CORE_URL", ORCHESTRATOR_URL).rstrip("/")
AI_URL = os.environ.get("AI_URL", "").rstrip("/")

_HOP_BY_HOP_HEADERS = {
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def select_api_base(path: str) -> str:
    if path == "ai" or path.startswith("ai/"):
        return AI_URL or ORCHESTRATOR_URL or FLEET_CORE_URL
    return ORCHESTRATOR_URL or FLEET_CORE_URL


def _forward_headers(headers: Iterable[tuple[str, str]]) -> dict[str, str]:
    return {
        key: value
        for key, value in headers
        if key.lower() not in _HOP_BY_HOP_HEADERS
    }


async def proxy_http(request: Request, path: str) -> Response:
    target_base = select_api_base(path)
    target_url = f"{target_base}/api/{path}"
    if request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    body = await request.body()
    headers = _forward_headers(request.headers.items())

    async with httpx.AsyncClient(follow_redirects=False, timeout=120.0) as client:
        upstream = await client.request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=body,
        )

    response_headers = _forward_headers(upstream.headers.items())
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )


def _http_to_ws(url: str) -> str:
    if url.startswith("https://"):
        return "wss://" + url[len("https://"):]
    if url.startswith("http://"):
        return "ws://" + url[len("http://"):]
    return url


async def proxy_websocket(ws: WebSocket) -> None:
    await ws.accept()
    upstream_base = ORCHESTRATOR_URL or FLEET_CORE_URL
    upstream_url = _http_to_ws(upstream_base) + "/api/ws"

    try:
        async with websockets.connect(upstream_url) as upstream:
            async def client_to_upstream() -> None:
                while True:
                    message = await ws.receive_text()
                    await upstream.send(message)

            async def upstream_to_client() -> None:
                async for message in upstream:
                    await ws.send_text(message)

            tasks = [
                asyncio.create_task(client_to_upstream()),
                asyncio.create_task(upstream_to_client()),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            for task in done:
                task.result()
    except WebSocketDisconnect:
        return
    except Exception:
        await ws.close()
