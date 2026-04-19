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
        "orchestrator_url": os.environ.get("ORCHESTRATOR_URL", "http://localhost:8000"),
        **extra,
    }


@router.get("/", response_class=HTMLResponse)
def fleet_dashboard(request: Request):
    ctx = _ctx(request, page_id="fleet")
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="fleet.html", context=ctx)


@router.get("/agent/{agent_id}/components/{component_id}", response_class=HTMLResponse)
def component_detail(request: Request, agent_id: str, component_id: str):
    ctx = _ctx(request, page_id="component_detail", agent_id=agent_id, component_id=component_id)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="component_detail.html", context=ctx)


@router.get("/agent/{agent_id}/components", response_class=HTMLResponse)
def agent_components(request: Request, agent_id: str):
    ctx = _ctx(request, page_id="agent_components", agent_id=agent_id)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="agent_components.html", context=ctx)


@router.get("/agent/{agent_id}", response_class=HTMLResponse)
def agent_detail(request: Request, agent_id: str):
    ctx = _ctx(request, page_id="agent_detail", agent_id=agent_id)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="agent_detail.html", context=ctx)


@router.get("/experiments/runs/{run_id}", response_class=HTMLResponse)
def experiment_run(request: Request, run_id: str):
    ctx = _ctx(request, page_id="experiment_run", run_id=run_id)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="experiment_run.html", context=ctx)


@router.get("/experiments/{template_id}", response_class=HTMLResponse)
def experiment_template(request: Request, template_id: str):
    ctx = _ctx(request, page_id="experiment_template", template_id=template_id)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="experiment_template.html", context=ctx)


@router.get("/experiments", response_class=HTMLResponse)
def experiments_page(request: Request):
    ctx = _ctx(request, page_id="experiments")
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="experiments.html", context=ctx)


@router.get("/components/{component_type}", response_class=HTMLResponse)
def components_by_type(request: Request, component_type: str):
    ctx = _ctx(request, page_id="components_type", component_type=component_type)
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="components_type.html", context=ctx)


@router.get("/components", response_class=HTMLResponse)
def components_page(request: Request):
    ctx = _ctx(request, page_id="components")
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="components.html", context=ctx)


@router.get("/users", response_class=HTMLResponse)
def users_page(request: Request):
    ctx = _ctx(request, page_id="users")
    if ctx is None:
        return require_login(request)
    return templates.TemplateResponse(request=request, name="users.html", context=ctx)
