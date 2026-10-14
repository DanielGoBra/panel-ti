"""Panel TI: punto de entrada de la aplicación Flask.

Desarrollo:   python3 app.py
Producción:   python3 serve.py   (waitress; ver README para HTTPS y despliegue)
"""
import envfile  # noqa: F401  (debe ir primero)
import logging
import os
import secrets
from datetime import timedelta

from flask import Flask, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

import auth
from core import bump_revision
from db import DB, get_db, init_db

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _secret_key():
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = os.path.join(os.path.dirname(os.path.abspath(DB)), ".secret_key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    with open(path) as f:
        return f.read().strip()


def create_app():
    app = Flask(__name__, static_folder="static", static_url_path="")
    app.json.ensure_ascii = False
    secure = os.environ.get("COOKIE_SECURE", "0") == "1"
    app.config.update(
        SECRET_KEY=_secret_key(),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=secure,
        SESSION_COOKIE_NAME="panel_ti_session",
        PERMANENT_SESSION_LIFETIME=timedelta(days=int(os.environ.get("SESSION_DAYS", 14))),
        MAX_CONTENT_LENGTH=int(os.environ.get("MAX_UPLOAD_MB", 25)) * 1024 * 1024,
    )
    if os.environ.get("TRUST_PROXY", "0") == "1":
        # Detrás de un proxy inverso (Caddy, Nginx, IIS) que termina HTTPS
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    from api_core import bp as core_bp
    from api_misc import bp as misc_bp
    from api_pages import bp as pages_bp
    from api_tasks import bp as tasks_bp
    from notify import bp as notify_bp
    for bp in (auth.bp, core_bp, tasks_bp, pages_bp, misc_bp, notify_bp):
        app.register_blueprint(bp)

    app.before_request(auth.load_user)
    app.before_request(auth.enforce)

    @app.after_request
    def finish(resp):
        # Cada escritura correcta incrementa la revisión: los demás clientes la detectan y se refrescan.
        if (request.path.startswith("/api/") and request.method in ("POST", "PUT", "DELETE") and resp.status_code < 400
                and not request.path.startswith(("/api/auth/", "/api/notifications", "/api/ai/query", "/api/ai/classify"))):
            with get_db() as db:
                resp.headers["X-Revision"] = str(bump_revision(db))
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        resp.headers.setdefault("Content-Security-Policy",
                                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                                "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; "
                                "frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        if secure:
            resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        if request.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    @app.route("/")
    def index():
        return send_from_directory("static", "index.html")

    @app.errorhandler(413)
    def too_large(_e):
        from core import bad
        return bad(f"El archivo supera el máximo de {app.config['MAX_CONTENT_LENGTH'] // (1024 * 1024)} MB", 413)

    return app


init_db()
from seed import seed_demo_data  # noqa: E402  (necesita la base inicializada)
seed_demo_data()
app = create_app()

if os.environ.get("PANEL_TI_SCHEDULER", "1") != "0":
    import automation
    automation.start()

if __name__ == "__main__":
    print("Servidor de desarrollo. Para producción usa: python3 serve.py")
    app.run(debug=False, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", 5000)))
