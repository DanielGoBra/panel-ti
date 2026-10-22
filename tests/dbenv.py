"""Base de datos para las pruebas.

Por defecto, un archivo SQLite temporal. Con TEST_DATABASE_URL (p. ej.
postgresql://postgres:postgres@localhost/panel_test) cada clase de pruebas usa un
esquema nuevo de PostgreSQL que se borra al terminar.
"""
import importlib
import os
import sys
import uuid

MODULES = ("db", "storage", "core", "auth", "sla", "notify", "ai", "backup", "api_tasks", "api_core", "api_pages",
           "api_misc", "automation", "seed", "app")


def configure(tmpdir, name="test.db"):
    os.environ["PANEL_TI_DB"] = os.path.join(tmpdir, name)
    os.environ["PANEL_TI_UPLOADS"] = os.path.join(tmpdir, "uploads")
    os.environ["PANEL_TI_BACKUP_DIR"] = os.path.join(tmpdir, "backups")
    os.environ["PANEL_TI_SCHEDULER"] = "0"
    for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "CRON_SECRET"):
        os.environ.pop(k, None)
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        os.environ["DATABASE_URL"] = url
        os.environ["PANEL_TI_PG_SCHEMA"] = f"test_{uuid.uuid4().hex[:10]}"
    else:
        os.environ.pop("DATABASE_URL", None)


def reload_app():
    """Vuelve a importar los módulos para que lean el entorno de esta clase de pruebas."""
    if "db" in sys.modules:
        sys.modules["db"].close_pool()
    for mod in MODULES:
        if mod in sys.modules:
            importlib.reload(sys.modules[mod])
    import app
    return app


def cleanup():
    import db
    db.close_pool()
    if db.DIALECT == "postgres":
        conn = db.connect()
        try:
            conn.execute(f"DROP SCHEMA IF EXISTS {db.PG_SCHEMA} CASCADE")
            conn.commit()
        finally:
            conn.close()
