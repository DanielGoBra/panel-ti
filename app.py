import csv
import io
import json
from datetime import date, datetime, timedelta
from urllib.parse import unquote

from flask import Flask, Response, jsonify, request, send_file, send_from_directory

from db import PRIORITIES, STATUSES, TYPES, get_db, init_db, make_key, next_number
from export_docx import build_docx
from export_xlsx import build_xlsx
from seed import seed_demo_data

app = Flask(__name__, static_folder="static", static_url_path="")
app.json.ensure_ascii = False

STATUS_LABEL = {"todo": "Por hacer", "in_progress": "En curso", "review": "En revisión", "blocked": "Bloqueada", "done": "Hecha"}
PRIORITY_LABEL = {"low": "Baja", "medium": "Media", "high": "Alta", "critical": "Crítica"}
TYPE_LABEL = {"task": "Tarea", "incident": "Incidente", "change": "Cambio", "request": "Solicitud", "improvement": "Mejora"}
DEFAULT_SETTINGS = {"wip_limits": {"in_progress": 6, "review": 4}, "workspace": "Tecnología"}

TASK_FIELDS = ["project_id", "title", "notes", "status", "priority", "type", "assignee",
               "start_date", "due_date", "estimate", "tags", "position"]
PROJECT_FIELDS = ["name", "key", "description", "color", "status", "owner", "area", "due_date"]
MEMBER_FIELDS = ["name", "email", "role", "team", "capacity"]


def now():
    return datetime.now().isoformat(sep=" ", timespec="seconds")


def today():
    return date.today().isoformat()


def actor():
    return unquote(request.headers.get("X-User", "")).strip() or "Sistema"


def bad(msg, code=400):
    return jsonify({"error": msg}), code


def body():
    return request.get_json(silent=True) or {}


def log(db, action, task=None, project_id=None, field="", old="", new=""):
    db.execute(
        "INSERT INTO activity (task_id, project_id, actor, action, field, old_value, new_value, task_title, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (task["id"] if task else None, (task["project_id"] if task else project_id), actor(), action, field,
         "" if old is None else str(old), "" if new is None else str(new), task["title"] if task else "", now()))


def validate_task(data):
    if "status" in data and data["status"] not in STATUSES:
        return "Estado no válido"
    if "priority" in data and data["priority"] not in PRIORITIES:
        return "Prioridad no válida"
    if "type" in data and data["type"] not in TYPES:
        return "Tipo no válido"
    if "title" in data and not str(data["title"]).strip():
        return "El título es obligatorio"
    if "estimate" in data and data["estimate"] not in (None, ""):
        try:
            if float(data["estimate"]) < 0:
                return "La estimación no puede ser negativa"
        except (TypeError, ValueError):
            return "La estimación debe ser un número"
    return None


def clean_task_value(field, value):
    if field == "project_id":
        return int(value) if value not in (None, "", 0, "0") else None
    if field == "estimate":
        return float(value) if value not in (None, "") else None
    if field == "position":
        return float(value)
    if field == "tags":
        if isinstance(value, list):
            value = ",".join(value)
        return ", ".join(t.strip() for t in str(value or "").split(",") if t.strip())
    if field == "title":
        return str(value).strip()
    return value if value is not None else ""


TASK_SELECT = """
SELECT t.*,
  (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id=t.id) AS checklist_total,
  (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id=t.id AND c.done=1) AS checklist_done,
  (SELECT COUNT(*) FROM comments m WHERE m.task_id=t.id) AS comment_count
FROM tasks t
"""


def fetch_task(db, tid):
    row = db.execute(TASK_SELECT + " WHERE t.id=?", (tid,)).fetchone()
    return dict(row) if row else None


def get_settings(db):
    out = json.loads(json.dumps(DEFAULT_SETTINGS))
    for r in db.execute("SELECT key, value FROM settings"):
        out[r["key"]] = json.loads(r["value"])
    return out


# ---------- Pages ----------
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/meta")
def meta():
    return jsonify({
        "statuses": [{"id": s, "label": STATUS_LABEL[s]} for s in STATUSES],
        "priorities": [{"id": p, "label": PRIORITY_LABEL[p]} for p in PRIORITIES],
        "types": [{"id": t, "label": TYPE_LABEL[t]} for t in TYPES],
    })


@app.get("/api/bootstrap")
def bootstrap():
    with get_db() as db:
        return jsonify({
            "projects": [dict(r) for r in db.execute("SELECT * FROM projects ORDER BY name")],
            "members": [dict(r) for r in db.execute("SELECT * FROM members ORDER BY name")],
            "tasks": [dict(r) for r in db.execute(TASK_SELECT + " ORDER BY t.position")],
            "settings": get_settings(db),
            "today": today(),
        })


# ---------- Settings ----------
@app.get("/api/settings")
def read_settings():
    with get_db() as db:
        return jsonify(get_settings(db))


@app.put("/api/settings")
def write_settings():
    data = body()
    with get_db() as db:
        for k, v in data.items():
            if k not in DEFAULT_SETTINGS:
                continue
            db.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (k, json.dumps(v, ensure_ascii=False)))
        return jsonify(get_settings(db))


# ---------- Projects ----------
@app.get("/api/projects")
def list_projects():
    with get_db() as db:
        return jsonify([dict(r) for r in db.execute("SELECT * FROM projects ORDER BY name")])


@app.post("/api/projects")
def create_project():
    data = body()
    name = str(data.get("name", "")).strip()
    if not name:
        return bad("El nombre es obligatorio")
    key = (str(data.get("key", "")).strip().upper() or make_key(name))[:6]
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO projects (name, key, description, color, status, owner, area, due_date, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (name, key, data.get("description", ""), data.get("color", "#2a78d6"), data.get("status", "active"),
             data.get("owner", ""), data.get("area", ""), data.get("due_date", ""), now()))
        log(db, "project_created", project_id=cur.lastrowid, new=name)
        return jsonify(dict(db.execute("SELECT * FROM projects WHERE id=?", (cur.lastrowid,)).fetchone())), 201


@app.put("/api/projects/<int:pid>")
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


@app.delete("/api/projects/<int:pid>")
def delete_project(pid):
    with get_db() as db:
        row = db.execute("SELECT name FROM projects WHERE id=?", (pid,)).fetchone()
        if not row:
            return bad("No existe", 404)
        db.execute("DELETE FROM projects WHERE id=?", (pid,))
        log(db, "project_deleted", project_id=None, old=row["name"])
        return jsonify({"ok": True})


# ---------- Members ----------
@app.get("/api/members")
def list_members():
    with get_db() as db:
        return jsonify([dict(r) for r in db.execute("SELECT * FROM members ORDER BY name")])


@app.post("/api/members")
def create_member():
    data = body()
    name = str(data.get("name", "")).strip()
    if not name:
        return bad("El nombre es obligatorio")
    with get_db() as db:
        if db.execute("SELECT 1 FROM members WHERE lower(name)=lower(?)", (name,)).fetchone():
            return bad("Ya existe una persona con ese nombre")
        cur = db.execute("INSERT INTO members (name, email, role, team, capacity) VALUES (?,?,?,?,?)",
                         (name, data.get("email", ""), data.get("role", ""), data.get("team", ""),
                          int(data.get("capacity") or 8)))
        return jsonify(dict(db.execute("SELECT * FROM members WHERE id=?", (cur.lastrowid,)).fetchone())), 201


@app.put("/api/members/<int:mid>")
def update_member(mid):
    data = body()
    with get_db() as db:
        old = db.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone()
        if not old:
            return bad("No existe", 404)
        sets, vals = [], []
        for f in MEMBER_FIELDS:
            if f in data:
                v = data[f]
                if f == "name":
                    v = str(v).strip()
                    if not v:
                        return bad("El nombre es obligatorio")
                    clash = db.execute("SELECT 1 FROM members WHERE lower(name)=lower(?) AND id<>?", (v, mid)).fetchone()
                    if clash:
                        return bad("Ya existe una persona con ese nombre")
                if f == "capacity":
                    v = int(v or 0)
                sets.append(f"{f}=?")
                vals.append(v)
        if not sets:
            return bad("Nada que actualizar")
        db.execute(f"UPDATE members SET {', '.join(sets)} WHERE id=?", [*vals, mid])
        if "name" in data and data["name"].strip() != old["name"]:
            # Mantiene las asignaciones al renombrar a una persona
            db.execute("UPDATE tasks SET assignee=? WHERE assignee=?", (data["name"].strip(), old["name"]))
            db.execute("UPDATE projects SET owner=? WHERE owner=?", (data["name"].strip(), old["name"]))
        return jsonify(dict(db.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone()))


@app.delete("/api/members/<int:mid>")
def delete_member(mid):
    with get_db() as db:
        row = db.execute("SELECT name FROM members WHERE id=?", (mid,)).fetchone()
        if not row:
            return bad("No existe", 404)
        db.execute("DELETE FROM members WHERE id=?", (mid,))
        db.execute("UPDATE tasks SET assignee='' WHERE assignee=? AND status<>'done'", (row["name"],))
        return jsonify({"ok": True})


# ---------- Tasks ----------
@app.get("/api/tasks")
def list_tasks():
    where, vals = [], []
    for key, col in (("project_id", "t.project_id"), ("status", "t.status"), ("assignee", "t.assignee"),
                     ("priority", "t.priority"), ("type", "t.type")):
        if request.args.get(key):
            where.append(f"{col}=?")
            vals.append(request.args[key])
    if request.args.get("q"):
        where.append("(t.title LIKE ? OR t.notes LIKE ? OR t.tags LIKE ?)")
        vals += [f"%{request.args['q']}%"] * 3
    sql = TASK_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY t.position"
    with get_db() as db:
        return jsonify([dict(r) for r in db.execute(sql, vals)])


@app.get("/api/tasks/<int:tid>")
def get_task(tid):
    with get_db() as db:
        task = fetch_task(db, tid)
        if not task:
            return bad("No existe", 404)
        task["checklist"] = [dict(r) for r in db.execute(
            "SELECT * FROM checklist_items WHERE task_id=? ORDER BY position, id", (tid,))]
        task["comments"] = [dict(r) for r in db.execute(
            "SELECT * FROM comments WHERE task_id=? ORDER BY created_at, id", (tid,))]
        task["activity"] = [dict(r) for r in db.execute(
            "SELECT * FROM activity WHERE task_id=? ORDER BY created_at DESC, id DESC LIMIT 60", (tid,))]
        return jsonify(task)


@app.post("/api/tasks")
def create_task():
    data = body()
    data.setdefault("title", "")
    err = validate_task(data)
    if err:
        return bad(err)
    vals = {f: clean_task_value(f, data[f]) for f in TASK_FIELDS if f in data}
    vals.setdefault("status", "todo")
    vals.setdefault("priority", "medium")
    vals.setdefault("type", "task")
    stamp = now()
    with get_db() as db:
        if "position" not in vals:
            top = db.execute("SELECT MIN(position) FROM tasks WHERE status=?", (vals["status"],)).fetchone()[0]
            bottom = db.execute("SELECT MAX(position) FROM tasks WHERE status=?", (vals["status"],)).fetchone()[0]
            vals["position"] = ((top or 1024) - 1024) if data.get("at_top") else ((bottom or 0) + 1024)
        vals["number"] = next_number(db, vals.get("project_id"))
        vals["created_at"] = vals["updated_at"] = stamp
        if vals["status"] in ("in_progress", "review"):
            vals["started_at"] = stamp
        if vals["status"] == "done":
            vals["started_at"] = vals["completed_at"] = stamp
        cols = list(vals)
        cur = db.execute(f"INSERT INTO tasks ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                         [vals[c] for c in cols])
        task = fetch_task(db, cur.lastrowid)
        log(db, "created", task)
        return jsonify(task), 201


def apply_task_update(db, tid, data, log_changes=True):
    old = fetch_task(db, tid)
    if not old:
        return None
    changes = {}
    for f in TASK_FIELDS:
        if f in data:
            v = clean_task_value(f, data[f])
            if v != old[f]:
                changes[f] = v
    if not changes:
        return old
    stamp = now()
    if "status" in changes:
        new_status = changes["status"]
        if new_status in ("in_progress", "review", "done") and not old["started_at"]:
            changes["started_at"] = stamp
        changes["completed_at"] = stamp if new_status == "done" else None
    if "project_id" in changes:
        changes["number"] = next_number(db, changes["project_id"])
    changes["updated_at"] = stamp
    db.execute(f"UPDATE tasks SET {', '.join(f'{k}=?' for k in changes)} WHERE id=?", [*changes.values(), tid])
    task = fetch_task(db, tid)
    if log_changes:
        for f in ("title", "status", "priority", "type", "assignee", "due_date", "start_date", "project_id", "estimate", "tags"):
            if f in changes:
                log(db, "updated", task, field=f, old=old[f], new=changes[f])
        if "notes" in changes:
            log(db, "updated", task, field="notes")
    return task


@app.put("/api/tasks/<int:tid>")
def update_task(tid):
    data = body()
    err = validate_task(data)
    if err:
        return bad(err)
    with get_db() as db:
        task = apply_task_update(db, tid, data)
        if not task:
            return bad("No existe", 404)
        return jsonify(task)


@app.post("/api/tasks/bulk")
def bulk_tasks():
    data = body()
    ids = [int(i) for i in data.get("ids", []) if str(i).isdigit()]
    if not ids:
        return bad("No hay tareas seleccionadas")
    with get_db() as db:
        if data.get("delete"):
            for tid in ids:
                t = fetch_task(db, tid)
                if t:
                    log(db, "deleted", t)
            db.execute(f"DELETE FROM tasks WHERE id IN ({','.join('?' * len(ids))})", ids)
            return jsonify({"ok": True, "deleted": len(ids)})
        changes = {k: v for k, v in (data.get("changes") or {}).items() if k in ("status", "priority", "assignee", "project_id", "due_date", "type")}
        err = validate_task(changes)
        if err:
            return bad(err)
        updated = [apply_task_update(db, tid, changes) for tid in ids]
        return jsonify([t for t in updated if t])


@app.post("/api/tasks/<int:tid>/duplicate")
def duplicate_task(tid):
    with get_db() as db:
        src = fetch_task(db, tid)
        if not src:
            return bad("No existe", 404)
        stamp = now()
        cur = db.execute(
            """INSERT INTO tasks (project_id, number, title, notes, status, priority, type, assignee, start_date, due_date,
               estimate, tags, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (src["project_id"], next_number(db, src["project_id"]), f"{src['title']} (copia)", src["notes"], "todo",
             src["priority"], src["type"], src["assignee"], src["start_date"], src["due_date"], src["estimate"], src["tags"],
             src["position"] + 1, stamp, stamp))
        new_id = cur.lastrowid
        db.execute("INSERT INTO checklist_items (task_id, text, done, position) SELECT ?, text, 0, position FROM checklist_items WHERE task_id=?",
                   (new_id, tid))
        task = fetch_task(db, new_id)
        log(db, "created", task, field="duplicate", old=src["id"])
        return jsonify(task), 201


@app.delete("/api/tasks/<int:tid>")
def delete_task(tid):
    with get_db() as db:
        t = fetch_task(db, tid)
        if not t:
            return bad("No existe", 404)
        log(db, "deleted", t)
        db.execute("DELETE FROM tasks WHERE id=?", (tid,))
        return jsonify({"ok": True})


# ---------- Checklist ----------
@app.post("/api/tasks/<int:tid>/checklist")
def add_check_item(tid):
    text = str(body().get("text", "")).strip()
    if not text:
        return bad("El texto es obligatorio")
    with get_db() as db:
        if not db.execute("SELECT 1 FROM tasks WHERE id=?", (tid,)).fetchone():
            return bad("No existe", 404)
        pos = (db.execute("SELECT MAX(position) FROM checklist_items WHERE task_id=?", (tid,)).fetchone()[0] or 0) + 1
        cur = db.execute("INSERT INTO checklist_items (task_id, text, position) VALUES (?,?,?)", (tid, text, pos))
        db.execute("UPDATE tasks SET updated_at=? WHERE id=?", (now(), tid))
        return jsonify(dict(db.execute("SELECT * FROM checklist_items WHERE id=?", (cur.lastrowid,)).fetchone())), 201


@app.put("/api/checklist/<int:cid>")
def update_check_item(cid):
    data = body()
    with get_db() as db:
        item = db.execute("SELECT * FROM checklist_items WHERE id=?", (cid,)).fetchone()
        if not item:
            return bad("No existe", 404)
        if "text" in data and str(data["text"]).strip():
            db.execute("UPDATE checklist_items SET text=? WHERE id=?", (str(data["text"]).strip(), cid))
        if "done" in data:
            db.execute("UPDATE checklist_items SET done=? WHERE id=?", (1 if data["done"] else 0, cid))
            if data["done"]:
                t = fetch_task(db, item["task_id"])
                log(db, "checked", t, new=item["text"])
        db.execute("UPDATE tasks SET updated_at=? WHERE id=?", (now(), item["task_id"]))
        return jsonify(dict(db.execute("SELECT * FROM checklist_items WHERE id=?", (cid,)).fetchone()))


@app.delete("/api/checklist/<int:cid>")
def delete_check_item(cid):
    with get_db() as db:
        db.execute("DELETE FROM checklist_items WHERE id=?", (cid,))
        return jsonify({"ok": True})


# ---------- Comments ----------
@app.post("/api/tasks/<int:tid>/comments")
def add_comment(tid):
    text = str(body().get("body", "")).strip()
    if not text:
        return bad("El comentario está vacío")
    with get_db() as db:
        t = fetch_task(db, tid)
        if not t:
            return bad("No existe", 404)
        cur = db.execute("INSERT INTO comments (task_id, author, body, created_at) VALUES (?,?,?,?)", (tid, actor(), text, now()))
        log(db, "commented", t, new=text[:140])
        return jsonify(dict(db.execute("SELECT * FROM comments WHERE id=?", (cur.lastrowid,)).fetchone())), 201


@app.delete("/api/comments/<int:cid>")
def delete_comment(cid):
    with get_db() as db:
        db.execute("DELETE FROM comments WHERE id=?", (cid,))
        return jsonify({"ok": True})


# ---------- Activity ----------
@app.get("/api/activity")
def recent_activity():
    limit = min(int(request.args.get("limit", 30)), 200)
    with get_db() as db:
        rows = db.execute("SELECT * FROM activity ORDER BY created_at DESC, id DESC LIMIT ?", (limit,)).fetchall()
        return jsonify([dict(r) for r in rows])


# ---------- Metrics ----------
def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("T", " ")[:19])
    except ValueError:
        return None


def week_start(d):
    return d - timedelta(days=d.weekday())


@app.get("/api/metrics")
def metrics():
    weeks = min(max(int(request.args.get("weeks", 12)), 4), 52)
    pid = request.args.get("project_id")
    with get_db() as db:
        sql = "SELECT * FROM tasks" + (" WHERE project_id=?" if pid else "")
        tasks = [dict(r) for r in db.execute(sql, (pid,) if pid else ())]
        projects = [dict(r) for r in db.execute("SELECT * FROM projects ORDER BY name")]
        members = [dict(r) for r in db.execute("SELECT * FROM members ORDER BY name")]

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

    # Tiempo de ciclo (inicio de trabajo -> cierre) de lo cerrado en 30 días
    cycle = []
    for t in completed_between(t0 - timedelta(days=29), t0):
        start = parse_dt(t["started_at"]) or parse_dt(t["created_at"])
        end = parse_dt(t["completed_at"])
        if start and end and end >= start:
            cycle.append((end - start).total_seconds() / 86400)
    cycle.sort()
    median_cycle = round(cycle[len(cycle) // 2], 1) if cycle else None

    # Flujo semanal: creadas vs. completadas
    first_week = week_start(t0) - timedelta(weeks=weeks - 1)
    flow = []
    for i in range(weeks):
        ws = first_week + timedelta(weeks=i)
        we = ws + timedelta(days=6)
        created = sum(1 for t in tasks if (d := parse_dt(t["created_at"])) and ws <= d.date() <= we)
        done = sum(1 for t in tasks if (d := parse_dt(t["completed_at"])) and ws <= d.date() <= we)
        flow.append({"week": ws.isoformat(), "created": created, "completed": done})

    # Carga por responsable
    people = {m["name"]: m for m in members}
    workload = {}
    for t in open_tasks:
        name = t["assignee"] or "Sin asignar"
        w = workload.setdefault(name, {"name": name, "todo": 0, "in_progress": 0, "review": 0, "blocked": 0,
                                       "overdue": 0, "estimate": 0.0,
                                       "capacity": people.get(name, {}).get("capacity")})
        w[t["status"]] += 1
        w["estimate"] += t["estimate"] or 0
        if t in overdue:
            w["overdue"] += 1
    for name, m in people.items():
        workload.setdefault(name, {"name": name, "todo": 0, "in_progress": 0, "review": 0, "blocked": 0,
                                   "overdue": 0, "estimate": 0.0, "capacity": m["capacity"]})
    workload = sorted(workload.values(), key=lambda w: -(w["todo"] + w["in_progress"] + w["review"] + w["blocked"]))

    # Salud de proyectos
    health = []
    for p in projects:
        pt = [t for t in tasks if t["project_id"] == p["id"]]
        if pid and str(p["id"]) != str(pid):
            continue
        done = sum(1 for t in pt if t["status"] == "done")
        p_over = sum(1 for t in pt if t["status"] != "done" and t["due_date"] and t["due_date"] < t_str)
        blocked = sum(1 for t in pt if t["status"] == "blocked")
        if p_over >= 3 or blocked >= 2:
            state = "risk"
        elif p_over or blocked:
            state = "watch"
        else:
            state = "ok"
        health.append({"id": p["id"], "name": p["name"], "key": p["key"], "color": p["color"], "owner": p["owner"],
                       "due_date": p["due_date"], "total": len(pt), "done": done, "overdue": p_over,
                       "blocked": blocked, "state": state,
                       "progress": round(100 * done / len(pt)) if pt else 0})

    by_status = {s: sum(1 for t in tasks if t["status"] == s) for s in STATUSES}
    by_type = {ty: sum(1 for t in open_tasks if t["type"] == ty) for ty in TYPES}
    by_priority = {p: sum(1 for t in open_tasks if t["priority"] == p) for p in PRIORITIES}

    return jsonify({
        "today": t_str,
        "kpis": {
            "open": len(open_tasks),
            "done_7d": len(last7),
            "done_prev_7d": len(prev7),
            "overdue": len(overdue),
            "blocked": by_status["blocked"],
            "due_soon": len(due_soon),
            "median_cycle_days": median_cycle,
            "critical_open": by_priority["critical"],
        },
        "flow": flow,
        "workload": workload,
        "projects": health,
        "by_status": by_status,
        "by_type": by_type,
        "by_priority": by_priority,
    })


# ---------- CSV ----------
@app.get("/api/export/tasks.csv")
def export_tasks_csv():
    with get_db() as db:
        projects = {p["id"]: p for p in db.execute("SELECT * FROM projects")}
        rows = db.execute("SELECT * FROM tasks ORDER BY project_id, number").fetchall()
    out = io.StringIO()
    out.write("﻿")
    w = csv.writer(out, delimiter=";")
    w.writerow(["Clave", "Título", "Proyecto", "Tipo", "Estado", "Prioridad", "Responsable", "Inicio", "Vence",
                "Estimación (h)", "Etiquetas", "Creada", "Cerrada"])
    for t in rows:
        p = projects.get(t["project_id"])
        w.writerow([f"{p['key'] if p else 'TI'}-{t['number']}", t["title"], p["name"] if p else "",
                    TYPE_LABEL.get(t["type"], t["type"]), STATUS_LABEL[t["status"]], PRIORITY_LABEL[t["priority"]],
                    t["assignee"], t["start_date"], t["due_date"], t["estimate"] or "", t["tags"], t["created_at"],
                    t["completed_at"] or ""])
    return Response(out.getvalue(), mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename=tareas-{today()}.csv"})


# ---------- Reports ----------
def build_report_json(start=None, end=None):
    t0 = date.today()
    start = start or str(t0 - timedelta(days=30))
    end = end or str(t0)

    with get_db() as db:
        tasks = db.execute(
            "SELECT * FROM tasks WHERE date(created_at) BETWEEN ? AND ? OR date(updated_at) BETWEEN ? AND ? "
            "OR status <> 'done'", (start, end, start, end)).fetchall()
        projects = {p["id"]: dict(p) for p in db.execute("SELECT * FROM projects")}
        tasks = [dict(t) for t in tasks]

    total = len(tasks)
    by_status = {s: 0 for s in STATUSES}
    by_priority = {p: 0 for p in PRIORITIES}
    by_project = {}
    overdue = []
    closed_in_period = []

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

    def key_of(t):
        p = projects.get(t["project_id"])
        return f"{p['key'] if p else 'TI'}-{t['number']}"

    completion = round(100 * by_status["done"] / total, 1) if total else 0
    return {
        "title": "Informe de Comité de TI",
        "period": {"start": start, "end": end},
        "generated_at": now(),
        "kpis": {
            "total_tasks": total,
            "done": by_status["done"],
            "closed_in_period": len(closed_in_period),
            "in_progress": by_status["in_progress"],
            "review": by_status["review"],
            "blocked": by_status["blocked"],
            "todo": by_status["todo"],
            "completion_pct": completion,
            "overdue": len(overdue),
            "projects_tracked": len(by_project),
        },
        "by_priority": by_priority,
        "by_project": list(by_project.values()),
        "overdue_tasks": [{"key": key_of(t), "title": t["title"], "due_date": t["due_date"], "priority": t["priority"],
                           "assignee": t["assignee"]} for t in sorted(overdue, key=lambda t: t["due_date"])],
        "blocked_tasks": [{"key": key_of(t), "title": t["title"], "assignee": t["assignee"], "priority": t["priority"],
                           "notes": t["notes"]} for t in tasks if t["status"] == "blocked"],
    }


@app.get("/api/report")
def build_report():
    return jsonify(build_report_json(request.args.get("start"), request.args.get("end")))


@app.get("/api/export/docx")
def export_docx_route():
    report = build_report_json(request.args.get("start") or None, request.args.get("end") or None)
    return send_file(build_docx(report), as_attachment=True, download_name="informe-comite-ti.docx",
                     mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@app.get("/api/export/xlsx")
def export_xlsx_route():
    report = build_report_json(request.args.get("start") or None, request.args.get("end") or None)
    return send_file(build_xlsx(report), as_attachment=True, download_name="informe-comite-ti.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.post("/api/reports")
def save_report():
    data = body()
    if "period" not in data:
        return bad("Informe no válido")
    with get_db() as db:
        cur = db.execute("INSERT INTO report_snapshots (title, period_start, period_end, payload, created_at) VALUES (?,?,?,?,?)",
                         (data.get("title", "Informe"), data["period"]["start"], data["period"]["end"],
                          json.dumps(data, ensure_ascii=False), now()))
        return jsonify({"id": cur.lastrowid, "ok": True}), 201


@app.get("/api/reports")
def saved_reports():
    with get_db() as db:
        rows = db.execute("SELECT id, title, period_start, period_end, created_at FROM report_snapshots ORDER BY id DESC").fetchall()
        return jsonify([dict(r) for r in rows])


@app.get("/api/reports/<int:rid>")
def get_report(rid):
    with get_db() as db:
        row = db.execute("SELECT payload FROM report_snapshots WHERE id=?", (rid,)).fetchone()
        if not row:
            return bad("No existe", 404)
        return jsonify(json.loads(row["payload"]))


@app.delete("/api/reports/<int:rid>")
def delete_report(rid):
    with get_db() as db:
        db.execute("DELETE FROM report_snapshots WHERE id=?", (rid,))
        return jsonify({"ok": True})


init_db()
seed_demo_data()

if __name__ == "__main__":
    import os
    app.run(debug=False, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", 5000)))
