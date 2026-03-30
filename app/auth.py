"""Dashboard authentication helpers for the LUCID Central Command web UI.

Authentication strategy
-----------------------
1. If ``LDAP_URL`` is set, attempt an LDAP simple-bind first.
   A successful bind grants access regardless of ``DASHBOARD_PASSWORD``.
2. If LDAP is not configured or the bind fails, compare the supplied password
   against the ``DASHBOARD_PASSWORD`` environment variable (default: ``"lucid"``).

Session management
------------------
The Starlette ``SessionMiddleware`` stores the logged-in username under the key
``SESSION_USER_KEY`` in a signed cookie.  ``get_current_user`` reads this key;
``require_login`` redirects unauthenticated requests to ``/login``.

Environment variables consumed by this module:
    LDAP_URL                  URL of the LDAP server (e.g. ``ldap://ldap:389``).
                              Unset → LDAP disabled.
    LDAP_BIND_DN_TEMPLATE     DN template; ``{username}`` is substituted at bind time.
    DASHBOARD_PASSWORD        Fallback password (default: ``"lucid"``).
"""
import logging
import os

from fastapi import Request
from fastapi.responses import RedirectResponse

logger = logging.getLogger(__name__)

# LDAP config — inactive when LDAP_URL is unset
LDAP_URL = os.environ.get("LDAP_URL", "")
LDAP_BIND_DN_TEMPLATE = os.environ.get("LDAP_BIND_DN_TEMPLATE", "")

DASHBOARD_PASSWORD = os.environ["DASHBOARD_PASSWORD"]

# Session key
SESSION_USER_KEY = "dashboard_user"


def authenticate(username: str, password: str) -> bool:
    """Try LDAP first (if configured), then fall back to the default password."""
    if LDAP_URL and _ldap_bind(username, password):
        return True
    if password == DASHBOARD_PASSWORD:
        return True
    return False


def _ldap_bind(username: str, password: str) -> bool:
    """Attempt LDAP simple bind."""
    try:
        import ldap3

        bind_dn = LDAP_BIND_DN_TEMPLATE.format(username=username)
        server = ldap3.Server(LDAP_URL, connect_timeout=5)
        conn = ldap3.Connection(server, user=bind_dn, password=password, auto_bind=True)
        conn.unbind()
        return True
    except Exception:
        logger.debug("LDAP bind failed for %s", username)
        return False


def get_current_user(request: Request) -> str | None:
    """Return the logged-in username from the session, or None."""
    return request.session.get(SESSION_USER_KEY)


def require_login(request: Request) -> str | RedirectResponse:
    """Return username if logged in, otherwise a redirect to /login."""
    user = get_current_user(request)
    if user is None:
        return RedirectResponse(url="/login", status_code=303)
    return user
