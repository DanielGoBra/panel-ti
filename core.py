"""Utilidades compartidas por todos los módulos de la API."""
import json
from datetime import date, datetime

from flask import g, has_app_context, jsonify, request

STATUS_LABEL = {"todo": "Por hacer", "in_progress": "En curso", "review": "En revisión", "blocked": "Bloqueada", "done": "Hecha"}
PRIORITY_LABEL = {"low": "Baja", "medium": "Media", "high": "Alta", "critical": "Crítica"}
TYPE_LABEL = {"task": "Tarea", "incident": "Incidente", "change": "Cambio", "request": "Solicitud", "improvement": "Mejora"}
ROLE_LABEL = {"admin": "Administración", "member": "Miembro", "viewer": "Lectura"}

DEFAULT_SETTINGS = {
    "workspace": "Tecnología",
    "wip_limits": {"in_progress": 6, "review": 4},
    # Objetivos de servicio por prioridad: primera respuesta (minutos) y resolución (horas)
    "sla": {
        "types": ["incident"],
        "policies": {
            "critical": {"response_min": 15, "resolve_h": 4},
            "high": {"response_min": 60, "resolve_h": 8},
            "medium": {"response_min": 240, "resolve_h": 24},
            "low": {"response_min": 480, "resolve_h": 72},
        },
    },
    "approval_types": ["change"],
    "teams_webhook_url": "",
    "inbound_token": "",
    "inbound_default_type": "request",
    "inbound_project_id": None,
}
# Ajustes que solo ve y cambia administración
SECRET_SETTINGS = {"teams_webhook_url", "inbound_token"}
MEMBER_WRITABLE_SETTINGS = {"wip_limits"}


def now():
    return datetime.now().isoformat(sep=" ", timespec="seconds")


def today():
    return date.today().isoformat()


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("T", " ")[:19])
    except ValueError:
        return None


def bad(msg, code=400):
    return jsonify({"error": msg}), code


def body():
    return request.get_json(silent=True) or {}


def current_user():
    return getattr(g, "user", None) if has_app_context() else None


def actor():
    u = current_user()
    return u["name"] if u else "Sistema"


def is_admin():
    u = current_user()
    return bool(u and u["role"] == "admin")


def log(db, action, task=None, project_id=None, field="", old="", new="", who=None):
    db.execute(
        "INSERT INTO activity (task_id, project_id, actor, action, field, old_value, new_value, task_title, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (task["id"] if task else None, (task["project_id"] if task else project_id), who or actor(), action, field,
         "" if old is None else str(old), "" if new is None else str(new), task["title"] if task else "", now()))


def get_settings(db, include_secrets=True):
    out = json.loads(json.dumps(DEFAULT_SETTINGS))
    for r in db.execute("SELECT key, value FROM settings"):
        if r["key"] in out:
            val = json.loads(r["value"])
            if isinstance(out[r["key"]], dict) and isinstance(val, dict):
                merged = out[r["key"]]
                merged.update(val)
                val = merged
            out[r["key"]] = val
    if not include_secrets:
        for k in SECRET_SETTINGS:
            out[k] = bool(out[k])
    return out


def save_setting(db, key, value):
    db.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
               (key, json.dumps(value, ensure_ascii=False)))


def get_state(db, key, default=None):
    row = db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def set_state(db, key, value):
    db.execute("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
               (key, json.dumps(value)))


def bump_revision(db):
    rev = (get_state(db, "revision", 0) or 0) + 1
    set_state(db, "revision", rev)
    return rev


def task_key(db_or_projects, t):
    if isinstance(db_or_projects, dict):
        p = db_or_projects.get(t["project_id"])
    else:
        p = db_or_projects.execute("SELECT key FROM projects WHERE id=?", (t["project_id"],)).fetchone() if t["project_id"] else None
    return f"{p['key'] if p else 'TI'}-{t['number']}"
