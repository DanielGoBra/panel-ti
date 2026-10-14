"""Inicio de sesión, roles y protección de la API.

Roles: admin (todo), member (trabaja con tareas, páginas y activos), viewer (solo lectura).
Inicio de sesión con contraseña y, opcionalmente, con Microsoft Entra ID si se
definen MS_TENANT_ID, MS_CLIENT_ID y MS_CLIENT_SECRET.
"""
import base64
import json
import os
import secrets
import time
import urllib.parse
import urllib.request
from functools import wraps

from flask import Blueprint, g, jsonify, redirect, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from core import bad, body, current_user, now
from db import ROLES, get_db

bp = Blueprint("auth", __name__)

PUBLIC_API = {"/api/auth/status", "/api/auth/login", "/api/auth/setup"}
PUBLIC_PREFIXES = ("/api/inbound",)
# Rutas que un usuario de solo lectura sí puede usar para escribir
VIEWER_WRITABLE = ("/api/auth/", "/api/notifications")
CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "panel-ti"
MIN_PASSWORD = 8
_failures = {}


# ---------- Utilidades ----------
def hash_password(pw):
    return generate_password_hash(pw)


def check_password_policy(pw):
    if not pw or len(pw) < MIN_PASSWORD:
        return f"La contraseña debe tener al menos {MIN_PASSWORD} caracteres"
    return None


def public_user(m):
    return {"id": m["id"], "name": m["name"], "email": m["email"], "role": m["role"], "title": m["title"],
            "team": m["team"], "is_cab": bool(m["is_cab"]), "notify_email": bool(m["notify_email"]),
            "has_password": bool(m["password_hash"]), "sso": bool(m["sso_subject"])}


def _session_marker(m):
    # Cambia al cambiar la contraseña: invalida sesiones abiertas en otros equipos
    return (m["password_hash"] or m["sso_subject"] or "")[-16:]


def start_session(db, m, remember=False):
    session.clear()
    session["uid"] = m["id"]
    session["mk"] = _session_marker(m)
    session.permanent = bool(remember)
    db.execute("UPDATE members SET last_login=? WHERE id=?", (now(), m["id"]))


def needs_setup(db):
    return not db.execute(
        "SELECT 1 FROM members WHERE role='admin' AND active=1 AND (password_hash<>'' OR sso_subject<>'')").fetchone()


def sso_enabled():
    return all(os.environ.get(k) for k in ("MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"))


def require_admin(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        u = current_user()
        if not u or u["role"] != "admin":
            return bad("Solo administración puede hacer esto", 403)
        return fn(*a, **kw)
    return wrapper


# ---------- Hooks de la aplicación ----------
def load_user():
    g.user = None
    uid = session.get("uid")
    if not uid:
        return
    with get_db() as db:
        m = db.execute("SELECT * FROM members WHERE id=? AND active=1", (uid,)).fetchone()
    if m and session.get("mk") == _session_marker(m):
        g.user = dict(m)
    else:
        session.clear()


def enforce():
    path = request.path
    if not path.startswith("/api/") or request.method == "OPTIONS":
        return None
    if path in PUBLIC_API or path.startswith(PUBLIC_PREFIXES):
        if request.method != "GET" and path in PUBLIC_API and request.headers.get(CSRF_HEADER) != CSRF_VALUE:
            return bad("Petición no válida", 403)
        return None
    if g.user is None:
        return bad("Inicia sesión para continuar", 401)
    if request.method not in ("GET", "HEAD"):
        if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
            return bad("Petición no válida", 403)
        if g.user["role"] == "viewer" and not path.startswith(VIEWER_WRITABLE):
            return bad("Tu rol es de solo lectura", 403)
    return None


def _rate_limited(key):
    t = time.time()
    hits = [x for x in _failures.get(key, []) if t - x < 900]
    _failures[key] = hits
    return len(hits) >= 5


# ---------- Endpoints ----------
@bp.get("/api/auth/status")
def status():
    with get_db() as db:
        return jsonify({
            "authenticated": g.user is not None,
            "user": public_user(g.user) if g.user else None,
            "needs_setup": needs_setup(db),
            "sso": sso_enabled(),
        })


@bp.post("/api/auth/setup")
def setup():
    """Crea la primera cuenta de administración. Solo funciona mientras no exista ninguna."""
    data = body()
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    pw = data.get("password", "")
    if not name or not email:
        return bad("Nombre y correo son obligatorios")
    err = check_password_policy(pw)
    if err:
        return bad(err)
    with get_db() as db:
        if not needs_setup(db):
            return bad("La cuenta de administración ya existe", 409)
        existing = db.execute("SELECT * FROM members WHERE lower(name)=lower(?)", (name,)).fetchone()
        if existing:
            db.execute("UPDATE members SET email=?, password_hash=?, role='admin', active=1 WHERE id=?",
                       (email, hash_password(pw), existing["id"]))
            mid = existing["id"]
        else:
            mid = db.execute("INSERT INTO members (name, email, password_hash, role) VALUES (?,?,?, 'admin')",
                             (name, email, hash_password(pw))).lastrowid
        m = db.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone()
        start_session(db, m, remember=True)
        return jsonify({"user": public_user(m)})


@bp.post("/api/auth/login")
def login():
    data = body()
    ident = str(data.get("email", "")).strip()
    pw = data.get("password", "")
    key = f"{request.remote_addr}|{ident.lower()}"
    if _rate_limited(key):
        return bad("Demasiados intentos. Espera unos minutos antes de volver a probar.", 429)
    with get_db() as db:
        m = db.execute("SELECT * FROM members WHERE active=1 AND (lower(email)=lower(?) OR lower(name)=lower(?))",
                       (ident, ident)).fetchone()
        if not m or not m["password_hash"] or not check_password_hash(m["password_hash"], pw):
            _failures.setdefault(key, []).append(time.time())
            return bad("Correo o contraseña incorrectos", 401)
        _failures.pop(key, None)
        start_session(db, m, remember=bool(data.get("remember")))
        return jsonify({"user": public_user(m)})


@bp.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@bp.put("/api/auth/me")
def update_me():
    """Perfil propio: datos básicos, preferencias y cambio de contraseña."""
    data = body()
    u = current_user()
    with get_db() as db:
        m = db.execute("SELECT * FROM members WHERE id=?", (u["id"],)).fetchone()
        sets, vals = [], []
        for f in ("email", "title", "team"):
            if f in data:
                sets.append(f"{f}=?")
                vals.append(str(data[f]).strip())
        if "notify_email" in data:
            sets.append("notify_email=?")
            vals.append(1 if data["notify_email"] else 0)
        if data.get("new_password"):
            if m["password_hash"] and not check_password_hash(m["password_hash"], data.get("current_password", "")):
                return bad("La contraseña actual no es correcta", 403)
            err = check_password_policy(data["new_password"])
            if err:
                return bad(err)
            sets.append("password_hash=?")
            vals.append(hash_password(data["new_password"]))
        if not sets:
            return bad("Nada que actualizar")
        db.execute(f"UPDATE members SET {', '.join(sets)} WHERE id=?", [*vals, u["id"]])
        m = db.execute("SELECT * FROM members WHERE id=?", (u["id"],)).fetchone()
        if data.get("new_password"):
            session["mk"] = _session_marker(m)
        return jsonify({"user": public_user(m)})


# ---------- Microsoft Entra ID (OpenID Connect) ----------
def _ms_base():
    return f"https://login.microsoftonline.com/{os.environ['MS_TENANT_ID']}/oauth2/v2.0"


def _ms_redirect():
    return os.environ.get("MS_REDIRECT_URI") or request.url_root.rstrip("/") + "/auth/microsoft/callback"


@bp.get("/auth/microsoft/login")
def ms_login():
    if not sso_enabled():
        return redirect("/#/login?error=sso")
    session["oauth_state"] = secrets.token_urlsafe(24)
    session["oauth_nonce"] = secrets.token_urlsafe(24)
    q = urllib.parse.urlencode({
        "client_id": os.environ["MS_CLIENT_ID"], "response_type": "code", "redirect_uri": _ms_redirect(),
        "response_mode": "query", "scope": "openid profile email", "state": session["oauth_state"],
        "nonce": session["oauth_nonce"], "prompt": "select_account",
    })
    return redirect(f"{_ms_base()}/authorize?{q}")


def _decode_jwt_payload(token):
    part = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


@bp.get("/auth/microsoft/callback")
def ms_callback():
    if not sso_enabled():
        return redirect("/")
    if request.args.get("error") or request.args.get("state") != session.pop("oauth_state", None):
        return redirect("/#/login?error=sso")
    data = urllib.parse.urlencode({
        "client_id": os.environ["MS_CLIENT_ID"], "client_secret": os.environ["MS_CLIENT_SECRET"],
        "grant_type": "authorization_code", "code": request.args.get("code", ""), "redirect_uri": _ms_redirect(),
        "scope": "openid profile email",
    }).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{_ms_base()}/token", data=data), timeout=15) as r:
            tokens = json.loads(r.read())
        # El token llega directamente del endpoint de Microsoft por TLS (OIDC Core 3.1.3.7):
        # se validan audiencia, emisor, nonce y caducidad.
        claims = _decode_jwt_payload(tokens["id_token"])
    except Exception:
        return redirect("/#/login?error=sso")
    tenant = os.environ["MS_TENANT_ID"]
    if (claims.get("aud") != os.environ["MS_CLIENT_ID"] or claims.get("nonce") != session.pop("oauth_nonce", None)
            or claims.get("exp", 0) < time.time() or (tenant not in ("common", "organizations") and tenant not in claims.get("iss", ""))):
        return redirect("/#/login?error=sso")
    subject = claims.get("oid") or claims.get("sub")
    email = (claims.get("email") or claims.get("preferred_username") or "").lower()
    name = claims.get("name") or email.split("@")[0]
    with get_db() as db:
        m = db.execute("SELECT * FROM members WHERE sso_subject=?", (subject,)).fetchone()
        if not m and email:
            m = db.execute("SELECT * FROM members WHERE lower(email)=?", (email,)).fetchone()
        first = needs_setup(db)
        if not m:
            if os.environ.get("MS_AUTO_PROVISION", "1") != "1" and not first:
                return redirect("/#/login?error=noaccount")
            role = "admin" if first else os.environ.get("MS_DEFAULT_ROLE", "member")
            role = role if role in ROLES else "member"
            base, n = name, 2
            while db.execute("SELECT 1 FROM members WHERE name=?", (name,)).fetchone():
                name = f"{base} ({n})"
                n += 1
            mid = db.execute("INSERT INTO members (name, email, role, sso_subject) VALUES (?,?,?,?)",
                             (name, email, role, subject)).lastrowid
        else:
            if not m["active"]:
                return redirect("/#/login?error=disabled")
            mid = m["id"]
            db.execute("UPDATE members SET sso_subject=?, email=COALESCE(NULLIF(email,''), ?) WHERE id=?", (subject, email, mid))
        m = db.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone()
        start_session(db, m, remember=True)
    return redirect("/")
