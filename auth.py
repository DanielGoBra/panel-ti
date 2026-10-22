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
PUBLIC_PREFIXES = ("/api/inbound", "/api/cron")
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
    return any(all(os.environ.get(k) for k in p["env"]) for p in PROVIDERS.values())


def password_login_enabled():
    """PASSWORD_LOGIN=0 deja solo el acceso con Google o Microsoft (recomendado si la app está en internet)."""
    return os.environ.get("PASSWORD_LOGIN", "1") != "0"


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
            "providers": sso_providers(),
            "password": password_login_enabled(),
        })


@bp.post("/api/auth/setup")
def setup():
    """Crea la primera cuenta de administración. Solo funciona mientras no exista ninguna."""
    if not password_login_enabled():
        return bad("El acceso con contraseña está desactivado. Entra con tu cuenta de Google o Microsoft.", 403)
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
    if not password_login_enabled():
        return bad("El acceso con contraseña está desactivado. Entra con tu cuenta de Google o Microsoft.", 403)
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
            if not password_login_enabled():
                return bad("El acceso con contraseña está desactivado")
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


# ---------- Inicio de sesión externo (OpenID Connect): Microsoft y Google ----------
PROVIDERS = {
    "microsoft": {
        "label": "Microsoft",
        "env": ("MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"),
        "client_id": "MS_CLIENT_ID", "client_secret": "MS_CLIENT_SECRET", "redirect": "MS_REDIRECT_URI",
    },
    "google": {
        "label": "Google",
        "env": ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
        "client_id": "GOOGLE_CLIENT_ID", "client_secret": "GOOGLE_CLIENT_SECRET", "redirect": "GOOGLE_REDIRECT_URI",
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "issuers": ("https://accounts.google.com", "accounts.google.com"),
    },
}
SCOPE = "openid profile email"


def provider_enabled(name):
    return all(os.environ.get(k) for k in PROVIDERS[name]["env"])


def sso_providers():
    return [{"id": k, "label": v["label"]} for k, v in PROVIDERS.items() if provider_enabled(k)]


def _env_set(*names):
    for n in names:
        if os.environ.get(n):
            return {x.strip().lower() for x in os.environ[n].replace(";", ",").split(",") if x.strip()}
    return set()


def email_allowed(db, email):
    """Con ALLOWED_EMAILS o ALLOWED_DOMAINS definidos, solo entran esos correos o personas ya dadas de alta."""
    allowed, domains = _env_set("ALLOWED_EMAILS"), _env_set("ALLOWED_DOMAINS")
    if not allowed and not domains:
        return None  # sin lista: decide la autoprovisión
    if email in allowed or email.split("@")[-1] in domains:
        return True
    return bool(db.execute("SELECT 1 FROM members WHERE lower(email)=? AND active=1", (email,)).fetchone())


def _redirect_uri(name):
    base = os.environ.get("PUBLIC_URL") or request.url_root
    return os.environ.get(PROVIDERS[name]["redirect"]) or base.rstrip("/") + f"/auth/{name}/callback"


def _authorize_url(name):
    if name == "microsoft":
        return f"https://login.microsoftonline.com/{os.environ['MS_TENANT_ID']}/oauth2/v2.0/authorize"
    return PROVIDERS[name]["authorize"]


def _token_url(name):
    if name == "microsoft":
        return f"https://login.microsoftonline.com/{os.environ['MS_TENANT_ID']}/oauth2/v2.0/token"
    return PROVIDERS[name]["token"]


def _decode_jwt_payload(token):
    part = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


def exchange_code(name, code):
    """Canjea el código por el id_token y devuelve sus datos.

    El token llega directamente del proveedor por TLS (OIDC Core 3.1.3.7), así que basta con
    validar audiencia, emisor, nonce y caducidad, que se comprueban en _validate.
    """
    cfg = PROVIDERS[name]
    data = urllib.parse.urlencode({
        "client_id": os.environ[cfg["client_id"]], "client_secret": os.environ[cfg["client_secret"]],
        "grant_type": "authorization_code", "code": code, "redirect_uri": _redirect_uri(name), "scope": SCOPE,
    }).encode()
    req = urllib.request.Request(_token_url(name), data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=15) as r:
        tokens = json.loads(r.read())
    return _decode_jwt_payload(tokens["id_token"])


def _validate(name, claims, nonce):
    cfg = PROVIDERS[name]
    if claims.get("aud") != os.environ[cfg["client_id"]] or claims.get("nonce") != nonce or claims.get("exp", 0) < time.time():
        return False
    if name == "microsoft":
        tenant = os.environ["MS_TENANT_ID"]
        return tenant in ("common", "organizations") or tenant in claims.get("iss", "")
    if claims.get("iss") not in cfg["issuers"]:
        return False
    return claims.get("email_verified") in (True, "true")


def _start(name):
    if not provider_enabled(name):
        return redirect("/#/login?error=sso")
    session["oauth_state"] = secrets.token_urlsafe(24)
    session["oauth_nonce"] = secrets.token_urlsafe(24)
    session["oauth_provider"] = name
    params = {
        "client_id": os.environ[PROVIDERS[name]["client_id"]], "response_type": "code", "redirect_uri": _redirect_uri(name),
        "scope": SCOPE, "state": session["oauth_state"], "nonce": session["oauth_nonce"], "prompt": "select_account",
    }
    if name == "microsoft":
        params["response_mode"] = "query"
    domains = _env_set("ALLOWED_DOMAINS")
    if name == "google" and len(domains) == 1 and not _env_set("ALLOWED_EMAILS"):
        params["hd"] = next(iter(domains))  # Google Workspace: muestra solo cuentas del dominio
    return redirect(f"{_authorize_url(name)}?{urllib.parse.urlencode(params)}")


def _finish(name):
    if not provider_enabled(name):
        return redirect("/")
    state, nonce = session.pop("oauth_state", None), session.pop("oauth_nonce", None)
    if session.pop("oauth_provider", None) != name or request.args.get("error") or not state or request.args.get("state") != state:
        return redirect("/#/login?error=sso")
    try:
        claims = exchange_code(name, request.args.get("code", ""))
    except Exception:
        return redirect("/#/login?error=sso")
    if not _validate(name, claims, nonce):
        return redirect("/#/login?error=sso")
    subject = f"{name}:{claims.get('oid') or claims.get('sub')}"
    legacy = claims.get("oid") or claims.get("sub")  # versiones anteriores guardaban el id de Microsoft sin prefijo
    email = (claims.get("email") or claims.get("preferred_username") or "").strip().lower()
    display = claims.get("name") or email.split("@")[0]
    if not email:
        return redirect("/#/login?error=sso")
    admins = _env_set("ADMIN_EMAILS")
    with get_db() as db:
        allowed = email_allowed(db, email)
        if allowed is False:
            return redirect("/#/login?error=notallowed")
        m = db.execute("SELECT * FROM members WHERE sso_subject IN (?, ?)", (subject, legacy if name == "microsoft" else subject)).fetchone()
        if not m:
            m = db.execute("SELECT * FROM members WHERE lower(email)=?", (email,)).fetchone()
        first = needs_setup(db)
        if not m:
            auto = os.environ.get("SSO_AUTO_PROVISION", os.environ.get("MS_AUTO_PROVISION", "1")) == "1"
            if allowed is None and not auto and not first and email not in admins:
                return redirect("/#/login?error=noaccount")
            role = os.environ.get("SSO_DEFAULT_ROLE", os.environ.get("MS_DEFAULT_ROLE", "member"))
            if email in admins or (first and not admins):
                role = "admin"
            role = role if role in ROLES else "member"
            base, n, uname = display, 2, display
            while db.execute("SELECT 1 FROM members WHERE name=?", (uname,)).fetchone():
                uname = f"{base} ({n})"
                n += 1
            mid = db.execute("INSERT INTO members (name, email, role, sso_subject) VALUES (?,?,?,?)",
                             (uname, email, role, subject)).lastrowid
        else:
            if not m["active"]:
                return redirect("/#/login?error=disabled")
            mid = m["id"]
            db.execute("UPDATE members SET sso_subject=?, email=COALESCE(NULLIF(email,''), ?) WHERE id=?", (subject, email, mid))
            if email in admins and m["role"] != "admin":
                db.execute("UPDATE members SET role='admin' WHERE id=?", (mid,))
        m = db.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone()
        start_session(db, m, remember=True)
    return redirect("/")


@bp.get("/auth/<name>/login")
def sso_login(name):
    if name not in PROVIDERS:
        return redirect("/#/login?error=sso")
    return _start(name)


@bp.get("/auth/<name>/callback")
def sso_callback(name):
    if name not in PROVIDERS:
        return redirect("/")
    return _finish(name)
