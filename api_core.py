"""Proyectos, personas, ajustes, métricas, informes y sincronización."""
import csv
import io
import json
import secrets
from datetime import date, datetime, timedelta

from flask import Blueprint, Response, jsonify, request, send_file

from api_tasks import TASK_SELECT, decorate
from auth import hash_password, public_user, require_admin
from core import (DEFAULT_SETTINGS, MEMBER_WRITABLE_SETTINGS, PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL, actor, bad,
                  body, current_user, get_settings, get_state, is_admin, log, now, parse_dt, save_setting, task_key,
                  today)
from db import PRIORITIES, ROLES, STATUSES, TYPES, get_db, make_key
from export_docx import build_docx
from export_xlsx import build_xlsx
from sla import compute_sla

bp = Blueprint("core_api", __name__)

PROJECT_FIELDS = ["name", "key", "description", "color", "status", "owner", "area", "due_date"]


def member_view(m, admin=False):
    d = public_user(m)
    d["capacity"] = m["capacity"]
    d["active"] = bool(m["active"])
    if admin:
        d["last_login"] = m["last_login"]
    return d


# ---------- Arranque ----------
@bp.get("/api/bootstrap")
def bootstrap():
    admin = is_admin()
    with get_db() as db:
        settings = get_settings(db, include_secrets=admin)
        return jsonify({
            "user": public_user(current_user()),
            "projects": [dict(r) for r in db.execute("SELECT * FROM projects ORDER BY name")],
            "members": [member_view(m, admin) for m in db.execute("SELECT * FROM members ORDER BY name") if m["active"] or admin],
            "tasks": decorate(db, db.execute(TASK_SELECT + " ORDER BY t.position").fetchall(), get_settings(db)),
            "assets": [dict(r) for r in db.execute("SELECT * FROM assets ORDER BY name")],
            "custom_fields": [dict(r, options=json.loads(r["options"] or "[]")) for r in db.execute("SELECT * FROM custom_fields ORDER BY position, id")],
            "templates": [dict(r, payload=json.loads(r["payload"] or "{}")) for r in db.execute("SELECT * FROM templates ORDER BY kind, name")],
            "pages": [dict(r) for r in db.execute("SELECT id, parent_id, project_id, title, icon, kind, position, updated_at, updated_by FROM pages ORDER BY position, id")],
            "settings": settings,
            "revision": get_state(db, "revision", 0),
            "today": today(),
            "features": features(),
        })


def features():
    import ai
    import os
    from notify import smtp_configured
    from auth import sso_enabled
    return {"ai": ai.available(), "email": smtp_configured(), "sso": sso_enabled(),
            "imap": bool(os.environ.get("IMAP_HOST"))}


@bp.get("/api/sync")
def sync():
    """Consulta ligera para la actualización en vivo y el contador de avisos."""
    u = current_user()
    with get_db() as db:
        unread = db.execute("SELECT COUNT(*) FROM notifications WHERE member_id=? AND read_at IS NULL", (u["id"],)).fetchone()[0]
        return jsonify({"revision": get_state(db, "revision", 0), "unread": unread})


# ---------- Ajustes ----------
@bp.get("/api/settings")
def read_settings():
    with get_db() as db:
        return jsonify(get_settings(db, include_secrets=is_admin()))


@bp.put("/api/settings")
def write_settings():
    data = body()
    admin = is_admin()
    with get_db() as db:
        for k, v in data.items():
            if k not in DEFAULT_SETTINGS:
                continue
            if not admin and k not in MEMBER_WRITABLE_SETTINGS:
                return bad("Solo administración puede cambiar este ajuste", 403)
            if k == "inbound_token" and v == "regenerate":
                v = secrets.token_urlsafe(24)
            if k == "teams_webhook_url" and v and not str(v).startswith("https://"):
                return bad("La URL del webhook de Teams debe empezar por https://")
            if k == "sla":
                err = _validate_sla(v)
                if err:
                    return bad(err)
            save_setting(db, k, v)
        return jsonify(get_settings(db, include_secrets=admin))


def _validate_sla(v):
    if not isinstance(v, dict):
        return "Configuración de SLA no válida"
    for t in v.get("types", []):
        if t not in TYPES:
            return "Tipo de tarea no válido en SLA"
    for p, pol in (v.get("policies") or {}).items():
        if p not in PRIORITIES:
            return "Prioridad no válida en SLA"
        try:
            if float(pol["response_min"]) <= 0 or float(pol["resolve_h"]) <= 0:
                return "Los tiempos de SLA deben ser mayores que cero"
        except (KeyError, TypeError, ValueError):
            return "Los tiempos de SLA deben ser números"
    return None


# ---------- Proyectos ----------
@bp.get("/api/projects")
def list_projects():
    with get_db() as db:
        return jsonify([dict(r) for r in db.execute("SELECT * FROM projects ORDER BY name")])


@bp.post("/api/projects")
def create_project():
    data = body()
    name = str(data.get("name", "")).strip()
    if not name:
        return bad("El nombre es obligatorio")
    key = (str(data.get("key", "")).strip().upper() or make_key(name))[:6]
    with get_db() as db:
        pid = db.execute(
            "INSERT INTO projects (name, key, description, color, status, owner, area, due_date, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (name, key, data.get("description", ""), data.get("color", "#2a78d6"), data.get("status", "active"),
             data.get("owner", ""), data.get("area", ""), data.get("due_date", ""), now())).lastrowid
        log(db, "project_created", project_id=pid, new=name)
        return jsonify(dict(db.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone())), 201


@bp.put("/api/projects/<int:pid>")
def update_project(pid):
    data = body()
    sets, vals = [], []
    for f in PROJECT_FIELDS:
        if f in data:
            v = data[f]
            if f == "name":
                v = str(v).strip()
                if not v:
                    return bad("El nombre es obligatorio")
            if f == "key":
                v = str(v).strip().upper()[:6] or "TI"
            sets.append(f"{f}=?")
            vals.append(v)
    if not sets:
        return bad("Nada que actualizar")
    with get_db() as db:
        if not db.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone():
            return bad("No existe", 404)
        db.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id=?", [*vals, pid])
        return jsonify(dict(db.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()))


@bp.delete("/api/projects/<int:pid>")
@require_admin
def delete_project(pid):
    with get_db() as db:
        row = db.execute("SELECT name FROM projects WHERE id=?", (pid,)).fetchone()
        if not row:
            return bad("No existe", 404)
        db.execute("DELETE FROM projects WHERE id=?", (pid,))
        log(db, "project_deleted", project_id=None, old=row["name"])
        return jsonify({"ok": True})


# ---------- Personas ----------
@bp.get("/api/members")
def list_members():
    admin = is_admin()
    with get_db() as db:
        return jsonify([member_view(m, admin) for m in db.execute("SELECT * FROM members ORDER BY name")])


def _temp_password():
    return secrets.token_urlsafe(9)


@bp.post("/api/members")
@require_admin
def create_member():
    data = body()
    name = str(data.get("name", "")).strip()
    if not name:
        return bad("El nombre es obligatorio")
    role = data.get("role", "member")
    if role not in ROLES:
        return bad("Rol no válido")
    temp = None
    with get_db() as db:
        if db.execute("SELECT 1 FROM members WHERE lower(name)=lower(?)", (name,)).fetchone():
            return bad("Ya existe una persona con ese nombre")
        email = str(data.get("email", "")).strip().lower()
        if email and db.execute("SELECT 1 FROM members WHERE lower(email)=?", (email,)).fetchone():
            return bad("Ya existe una persona con ese correo")
        pw_hash = ""
        if email and data.get("create_login", True):
            temp = _temp_password()
            pw_hash = hash_password(temp)
        mid = db.execute(
            "INSERT INTO members (name, email, role, title, team, capacity, is_cab, password_hash) VALUES (?,?,?,?,?,?,?,?)",
            (name, email, role, data.get("title", ""), data.get("team", ""), int(data.get("capacity") or 8),
             1 if data.get("is_cab") else 0, pw_hash)).lastrowid
        out = member_view(db.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone(), True)
        out["temp_password"] = temp
        return jsonify(out), 201


@bp.put("/api/members/<int:mid>")
@require_admin
def update_member(mid):
    data = body()
    with get_db() as db:
        old = db.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone()
        if not old:
            return bad("No existe", 404)
        sets, vals = [], []
        for f in ("name", "email", "title", "team", "capacity", "role", "is_cab", "active"):
            if f not in data:
                continue
            v = data[f]
            if f == "name":
                v = str(v).strip()
                if not v:
                    return bad("El nombre es obligatorio")
                if db.execute("SELECT 1 FROM members WHERE lower(name)=lower(?) AND id<>?", (v, mid)).fetchone():
                    return bad("Ya existe una persona con ese nombre")
            if f == "email":
                v = str(v).strip().lower()
                if v and db.execute("SELECT 1 FROM members WHERE lower(email)=? AND id<>?", (v, mid)).fetchone():
                    return bad("Ya existe una persona con ese correo")
            if f == "role" and v not in ROLES:
                return bad("Rol no válido")
            if f in ("is_cab", "active"):
                v = 1 if v else 0
            if f == "capacity":
                v = int(v or 0)
            sets.append(f"{f}=?")
            vals.append(v)
        demoting = (data.get("role", old["role"]) != "admin" or not data.get("active", old["active"])) and old["role"] == "admin"
        if demoting and db.execute("SELECT COUNT(*) FROM members WHERE role='admin' AND active=1 AND id<>?", (mid,)).fetchone()[0] == 0:
            return bad("Debe quedar al menos una persona con rol de administración")
        if not sets:
            return bad("Nada que actualizar")
        db.execute(f"UPDATE members SET {', '.join(sets)} WHERE id=?", [*vals, mid])
        if "name" in data and data["name"].strip() != old["name"]:
            new = data["name"].strip()
            for table, col in (("tasks", "assignee"), ("tasks", "created_by"), ("projects", "owner"), ("assets", "owner")):
                db.execute(f"UPDATE {table} SET {col}=? WHERE {col}=?", (new, old["name"]))
        return jsonify(member_view(db.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone(), True))


@bp.post("/api/members/<int:mid>/reset-password")
@require_admin
def reset_password(mid):
    with get_db() as db:
        m = db.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone()
        if not m:
            return bad("No existe", 404)
        if not m["email"]:
            return bad("Añade antes un correo a esta persona: lo usará para iniciar sesión")
        temp = _temp_password()
        db.execute("UPDATE members SET password_hash=? WHERE id=?", (hash_password(temp), mid))
        return jsonify({"temp_password": temp})


@bp.delete("/api/members/<int:mid>")
@require_admin
def delete_member(mid):
    with get_db() as db:
        row = db.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone()
        if not row:
            return bad("No existe", 404)
        if row["id"] == current_user()["id"]:
            return bad("No puedes eliminar tu propia cuenta")
        if row["role"] == "admin" and db.execute("SELECT COUNT(*) FROM members WHERE role='admin' AND active=1 AND id<>?", (mid,)).fetchone()[0] == 0:
            return bad("Debe quedar al menos una persona con rol de administración")
        db.execute("DELETE FROM members WHERE id=?", (mid,))
        db.execute("UPDATE tasks SET assignee='' WHERE assignee=? AND status<>'done'", (row["name"],))
        return jsonify({"ok": True})


# ---------- Actividad ----------
@bp.get("/api/activity")
def recent_activity():
    limit = min(int(request.args.get("limit", 30)), 200)
    with get_db() as db:
        rows = db.execute("SELECT * FROM activity ORDER BY created_at DESC, id DESC LIMIT ?", (limit,)).fetchall()
        return jsonify([dict(r) for r in rows])


# ---------- Métricas ----------
def week_start(d):
    return d - timedelta(days=d.weekday())


def weekly_flow(tasks, weeks=12):
    t0 = date.today()
    first_week = week_start(t0) - timedelta(weeks=weeks - 1)
    flow = []
    for i in range(weeks):
        ws = first_week + timedelta(weeks=i)
        we = ws + timedelta(days=6)
        created = sum(1 for t in tasks if (d := parse_dt(t["created_at"])) and ws <= d.date() <= we)
        done = sum(1 for t in tasks if (d := parse_dt(t["completed_at"])) and ws <= d.date() <= we)
        flow.append({"week": ws.isoformat(), "created": created, "completed": done})
    return flow


def sla_summary(tasks, settings, since):
    closed = [t for t in tasks if t.get("sla") and t["status"] == "done" and (t["completed_at"] or "")[:10] >= since]
    met = sum(1 for t in closed if t["sla"]["state"] == "met")
    open_ = [t for t in tasks if t.get("sla") and t["status"] != "done"]
    return {
        "closed": len(closed),
        "met": met,
        "compliance_pct": round(100 * met / len(closed), 1) if closed else None,
        "open_breached": sum(1 for t in open_ if t["sla"]["state"] == "breached"),
        "open_risk": sum(1 for t in open_ if t["sla"]["state"] == "risk"),
    }


@bp.get("/api/metrics")
def metrics():
    weeks = min(max(int(request.args.get("weeks", 12)), 4), 52)
    pid = request.args.get("project_id")
    with get_db() as db:
        settings = get_settings(db)
        sql = TASK_SELECT + (" WHERE t.project_id=?" if pid else "")
        tasks = decorate(db, db.execute(sql, (pid,) if pid else ()).fetchall(), settings)
        projects = [dict(r) for r in db.execute("SELECT * FROM projects ORDER BY name")]
        members = [dict(r) for r in db.execute("SELECT * FROM members WHERE active=1 AND role<>'viewer' ORDER BY name")]

    t0 = date.today()
    t_str = t0.isoformat()
    open_tasks = [t for t in tasks if t["status"] != "done"]
    overdue = [t for t in open_tasks if t["due_date"] and t["due_date"] < t_str]
    soon_limit = (t0 + timedelta(days=7)).isoformat()
    due_soon = [t for t in open_tasks if t["due_date"] and t_str <= t["due_date"] <= soon_limit]

    def completed_between(a, b):
        return [t for t in tasks if t["completed_at"] and a <= parse_dt(t["completed_at"]).date() <= b]

    last7 = completed_between(t0 - timedelta(days=6), t0)
    prev7 = completed_between(t0 - timedelta(days=13), t0 - timedelta(days=7))
    cycle = []
    for t in completed_between(t0 - timedelta(days=29), t0):
        start = parse_dt(t["started_at"]) or parse_dt(t["created_at"])
        end = parse_dt(t["completed_at"])
        if start and end and end >= start:
            cycle.append((end - start).total_seconds() / 86400)
    cycle.sort()
    median_cycle = round(cycle[len(cycle) // 2], 1) if cycle else None

    flow = weekly_flow(tasks, weeks)

    people = {m["name"]: m for m in members}
    blank = lambda name, cap: {"name": name, "todo": 0, "in_progress": 0, "review": 0, "blocked": 0, "overdue": 0, "estimate": 0.0, "capacity": cap}
    workload = {}
    for t in open_tasks:
        name = t["assignee"] or "Sin asignar"
        w = workload.setdefault(name, blank(name, people.get(name, {}).get("capacity")))
        w[t["status"]] += 1
        w["estimate"] += t["estimate"] or 0
        if t in overdue:
            w["overdue"] += 1
    for name, m in people.items():
        workload.setdefault(name, blank(name, m["capacity"]))
    workload = sorted(workload.values(), key=lambda w: -(w["todo"] + w["in_progress"] + w["review"] + w["blocked"]))

    health = []
    for p in projects:
        if pid and str(p["id"]) != str(pid):
            continue
        pt = [t for t in tasks if t["project_id"] == p["id"]]
        done = sum(1 for t in pt if t["status"] == "done")
        p_over = sum(1 for t in pt if t["status"] != "done" and t["due_date"] and t["due_date"] < t_str)
        blocked = sum(1 for t in pt if t["status"] == "blocked")
        risk = sum(1 for t in pt if t.get("delay"))
        state = "risk" if p_over >= 3 or blocked >= 2 else "watch" if p_over or blocked or risk >= 2 else "ok"
        health.append({"id": p["id"], "name": p["name"], "key": p["key"], "color": p["color"], "owner": p["owner"],
                       "due_date": p["due_date"], "total": len(pt), "done": done, "overdue": p_over, "blocked": blocked,
                       "delay_risk": risk, "state": state, "progress": round(100 * done / len(pt)) if pt else 0})

    by_status = {s: sum(1 for t in tasks if t["status"] == s) for s in STATUSES}
    by_priority = {p: sum(1 for t in open_tasks if t["priority"] == p) for p in PRIORITIES}
    delays = sorted([t for t in open_tasks if t.get("delay")], key=lambda t: -t["delay"]["late_days"])

    return jsonify({
        "today": t_str,
        "kpis": {
            "open": len(open_tasks), "done_7d": len(last7), "done_prev_7d": len(prev7), "overdue": len(overdue),
            "blocked": by_status["blocked"], "due_soon": len(due_soon), "median_cycle_days": median_cycle,
            "critical_open": by_priority["critical"], "delay_risk": len(delays),
            "pending_approvals": sum(1 for t in open_tasks if t["approval_status"] == "pending"),
        },
        "sla": sla_summary(tasks, settings, (t0 - timedelta(days=29)).isoformat()),
        "flow": flow,
        "workload": workload,
        "projects": health,
        "delays": [{"id": t["id"], **t["delay"]} for t in delays[:10]],
        "by_status": by_status,
        "by_priority": by_priority,
        "by_type": {ty: sum(1 for t in open_tasks if t["type"] == ty) for ty in TYPES},
    })


# ---------- CSV ----------
@bp.get("/api/export/tasks.csv")
def export_tasks_csv():
    with get_db() as db:
        projects = {p["id"]: p for p in db.execute("SELECT * FROM projects")}
        rows = decorate(db, db.execute(TASK_SELECT + " ORDER BY t.project_id, t.number").fetchall())
    out = io.StringIO()
    out.write("﻿")
    w = csv.writer(out, delimiter=";")
    w.writerow(["Clave", "Título", "Proyecto", "Tipo", "Estado", "Prioridad", "Responsable", "Creada por", "Inicio",
                "Vence", "Estimación (h)", "Etiquetas", "SLA", "Aprobación", "Creada", "Cerrada"])
    sla_txt = {"ok": "En plazo", "risk": "En riesgo", "breached": "Incumplido", "met": "Cumplido", "missed": "Incumplido"}
    appr = {"pending": "Pendiente", "approved": "Aprobado", "rejected": "Rechazado"}
    for t in rows:
        p = projects.get(t["project_id"])
        w.writerow([task_key(projects, t), t["title"], p["name"] if p else "", TYPE_LABEL.get(t["type"], t["type"]),
                    STATUS_LABEL[t["status"]], PRIORITY_LABEL[t["priority"]], t["assignee"], t["created_by"],
                    t["start_date"], t["due_date"], t["estimate"] or "", t["tags"],
                    sla_txt.get((t["sla"] or {}).get("state"), ""), appr.get(t["approval_status"], ""),
                    t["created_at"], t["completed_at"] or ""])
    return Response(out.getvalue(), mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename=tareas-{today()}.csv"})


# ---------- Informes ----------
def build_report_json(start=None, end=None):
    t0 = date.today()
    start = start or str(t0 - timedelta(days=30))
    end = end or str(t0)
    with get_db() as db:
        settings = get_settings(db)
        rows = db.execute(TASK_SELECT + " WHERE date(t.created_at) BETWEEN ? AND ? OR date(t.updated_at) BETWEEN ? AND ? "
                          "OR t.status <> 'done'", (start, end, start, end)).fetchall()
        tasks = decorate(db, rows, settings)
        projects = {p["id"]: dict(p) for p in db.execute("SELECT * FROM projects")}

    total = len(tasks)
    by_status = {s: 0 for s in STATUSES}
    by_priority = {p: 0 for p in PRIORITIES}
    by_project, overdue, closed_in_period = {}, [], []
    for t in tasks:
        by_status[t["status"]] += 1
        by_priority[t["priority"]] += 1
        pid = t["project_id"] or 0
        bucket = by_project.setdefault(pid, {"name": projects.get(pid, {}).get("name", "Sin proyecto"),
                                             "total": 0, "done": 0, "open": 0, "blocked": 0})
        bucket["total"] += 1
        if t["status"] == "done":
            bucket["done"] += 1
            if t["completed_at"] and start <= t["completed_at"][:10] <= end:
                closed_in_period.append(t)
        else:
            bucket["open"] += 1
            if t["status"] == "blocked":
                bucket["blocked"] += 1
            if t["due_date"] and t["due_date"] < min(end, t0.isoformat()):
                overdue.append(t)

    key_of = lambda t: task_key(projects, t)
    completion = round(100 * by_status["done"] / total, 1) if total else 0
    open_tasks = [t for t in tasks if t["status"] != "done"]
    return {
        "title": "Informe de Comité de TI",
        "period": {"start": start, "end": end},
        "generated_at": now(),
        "kpis": {
            "total_tasks": total, "done": by_status["done"], "closed_in_period": len(closed_in_period),
            "in_progress": by_status["in_progress"], "review": by_status["review"], "blocked": by_status["blocked"],
            "todo": by_status["todo"], "completion_pct": completion, "overdue": len(overdue),
            "projects_tracked": len(by_project),
        },
        "sla": sla_summary(tasks, settings, start),
        "by_priority": by_priority,
        "by_project": list(by_project.values()),
        "overdue_tasks": [{"key": key_of(t), "title": t["title"], "due_date": t["due_date"], "priority": t["priority"],
                           "assignee": t["assignee"]} for t in sorted(overdue, key=lambda t: t["due_date"])],
        "blocked_tasks": [{"key": key_of(t), "title": t["title"], "assignee": t["assignee"], "priority": t["priority"],
                           "notes": t["notes"]} for t in tasks if t["status"] == "blocked"],
        "delay_risks": [{"key": key_of(t), "title": t["title"], "assignee": t["assignee"], "due_date": t["due_date"],
                         "late_days": t["delay"]["late_days"]} for t in sorted(open_tasks, key=lambda t: -(t["delay"] or {}).get("late_days", 0)) if t.get("delay")],
        "pending_approvals": [{"key": key_of(t), "title": t["title"], "assignee": t["assignee"]}
                              for t in open_tasks if t["approval_status"] == "pending"],
    }


@bp.get("/api/report")
def build_report():
    return jsonify(build_report_json(request.args.get("start") or None, request.args.get("end") or None))


@bp.get("/api/export/docx")
def export_docx_route():
    report = build_report_json(request.args.get("start") or None, request.args.get("end") or None)
    if request.args.get("snapshot"):
        with get_db() as db:
            row = db.execute("SELECT payload FROM report_snapshots WHERE id=?", (request.args["snapshot"],)).fetchone()
            if row:
                report = json.loads(row["payload"])
    return send_file(build_docx(report), as_attachment=True, download_name="informe-comite-ti.docx",
                     mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@bp.get("/api/export/xlsx")
def export_xlsx_route():
    report = build_report_json(request.args.get("start") or None, request.args.get("end") or None)
    if request.args.get("snapshot"):
        with get_db() as db:
            row = db.execute("SELECT payload FROM report_snapshots WHERE id=?", (request.args["snapshot"],)).fetchone()
            if row:
                report = json.loads(row["payload"])
    return send_file(build_xlsx(report), as_attachment=True, download_name="informe-comite-ti.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@bp.post("/api/reports")
def save_report():
    data = body()
    if "period" not in data:
        return bad("Informe no válido")
    with get_db() as db:
        rid = db.execute("INSERT INTO report_snapshots (title, period_start, period_end, payload, created_at) VALUES (?,?,?,?,?)",
                         (data.get("title", "Informe"), data["period"]["start"], data["period"]["end"],
                          json.dumps(data, ensure_ascii=False), now())).lastrowid
        return jsonify({"id": rid, "ok": True}), 201


@bp.get("/api/reports")
def saved_reports():
    with get_db() as db:
        rows = db.execute("SELECT id, title, period_start, period_end, created_at FROM report_snapshots ORDER BY id DESC").fetchall()
        return jsonify([dict(r) for r in rows])


@bp.get("/api/reports/<int:rid>")
def get_report(rid):
    with get_db() as db:
        row = db.execute("SELECT payload FROM report_snapshots WHERE id=?", (rid,)).fetchone()
        if not row:
            return bad("No existe", 404)
        return jsonify(json.loads(row["payload"]))


@bp.delete("/api/reports/<int:rid>")
def delete_report(rid):
    with get_db() as db:
        db.execute("DELETE FROM report_snapshots WHERE id=?", (rid,))
        return jsonify({"ok": True})
