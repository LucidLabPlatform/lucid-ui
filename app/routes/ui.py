"""HTML page routes for the LUCID Central Command web dashboard."""
from fastapi import APIRouter, Form
from fastapi.requests import Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
import os

from app.auth import authenticate, require_login, SESSION_USER_KEY

router = APIRouter()

_TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "web", "templates")
templates = Jinja2Templates(directory=_TEMPLATE_DIR)
SHOW_EXPERIMENTS = os.environ.get("LUCID_UI_ENABLE_EXPERIMENTS", "false").lower() == "true"
SHOW_AI = os.environ.get("LUCID_UI_ENABLE_AI", "false").lower() == "true"


# ---------------------------------------------------------------------------
# Login / Logout
# ---------------------------------------------------------------------------

@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if request.session.get(SESSION_USER_KEY):
        return RedirectResponse(url="/", status_code=303)
    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={"request": request, "error": None},
    )


@router.post("/login", response_class=HTMLResponse)
def login_submit(request: Request, username: str = Form(...), password: str = Form(...)):
    if authenticate(username, password):
        request.session[SESSION_USER_KEY] = username
        return RedirectResponse(url="/", status_code=303)
    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={"request": request, "error": "Invalid credentials", "username": username},
    )


@router.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/login", status_code=303)


# ---------------------------------------------------------------------------
# Protected pages
# ---------------------------------------------------------------------------

def _ctx(request: Request, **extra) -> dict:
    """Build template context with the logged-in user."""
    result = require_login(request)
    if isinstance(result, RedirectResponse):
        return None  # caller must return the redirect
    return {
        "request": request,
        "user": result,
        "show_experiments": SHOW_EXPERIMENTS,
        "show_ai": SHOW_AI,
        **extra,
    }


@router.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    ctx = _ctx(request)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="dashboard.html", context=ctx)


@router.get("/agent/{agent_id}", response_class=HTMLResponse)
def agent_detail(agent_id: str, request: Request):
    ctx = _ctx(request, agent_id=agent_id)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="agent.html", context=ctx)


@router.get("/users", response_class=HTMLResponse)
def users_page(request: Request):
    ctx = _ctx(request)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="users.html", context=ctx)


@router.get("/auth-log", response_class=HTMLResponse)
def auth_log_page(request: Request):
    ctx = _ctx(request)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="auth_log.html", context=ctx)


@router.get("/schema", response_class=HTMLResponse)
def schema_page(request: Request):
    ctx = _ctx(request)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="schema.html", context=ctx)


if SHOW_EXPERIMENTS:
    @router.get("/experiments/templates", response_class=HTMLResponse)
    def experiments_templates_page(request: Request):
        ctx = _ctx(request)
        if ctx is None:
            return require_login(request)
        return templates.TemplateResponse(
            request=request,
            name="experiments_templates.html",
            context=ctx,
        )


    @router.get("/experiments/runs", response_class=HTMLResponse)
    def experiments_runs_page(request: Request):
        ctx = _ctx(request)
        if ctx is None:
            return require_login(request)
        return templates.TemplateResponse(
            request=request,
            name="experiments_runs.html",
            context=ctx,
        )


    @router.get("/experiments/runs/{run_id}", response_class=HTMLResponse)
    def experiments_run_detail_page(run_id: str, request: Request):
        ctx = _ctx(request, run_id=run_id)
        if ctx is None:
            return require_login(request)
        return templates.TemplateResponse(
            request=request,
            name="experiments_run_detail.html",
            context=ctx,
        )


@router.get("/topic-tree", response_class=HTMLResponse)
def topic_tree_page(request: Request):
    ctx = _ctx(request)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="topic_tree.html", context=ctx)


@router.get("/topic-links", response_class=HTMLResponse)
def topic_links_page(request: Request):
    ctx = _ctx(request)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="topic_links.html", context=ctx)


if SHOW_AI:
    @router.get("/ai", response_class=HTMLResponse)
    def ai_chat_page(request: Request):
        ctx = _ctx(request)
        if ctx is None:
            return require_login(request)
        return templates.TemplateResponse(request=request, name="ai_chat.html", context=ctx)
