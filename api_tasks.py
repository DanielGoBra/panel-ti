"""Tareas: CRUD, reglas de flujo (dependencias, subtareas, aprobación CAB),
checklist, comentarios, recurrencia y avisos asociados."""
import json
from datetime import date, timedelta

from flask import Blueprint, jsonify, request

from core import (PRIORITY_LABEL, STATUS_LABEL, actor, bad, body, current_user, get_settings, is_admin, log, now,
                  parse_dt, task_key, today)
from db import PRIORITIES, STATUSES, TYPES, get_db, next_number
from notify import find_mentions, notify
from sla import compute_sla, delay_model, predict_delay

bp = Blueprint("tasks", __name__)

TASK_FIELDS = ["project_id", "parent_id", "title", "notes", "status", "priority", "type", "assignee",
               "start_date", "due_date", "estimate", "tags", "position", "custom"]
WORKING = ("in_progress", "review", "done")
RECURRENCE_RULES = {"weekly": 7, "biweekly": 14, "monthly": "1m", "quarterly": "3m", "yearly": "12m"}

TASK_SELECT = """
SELECT t.*,
  (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id=t.id) AS checklist_total,
  (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id=t.id AND c.done=1) AS checklist_done,
  (SELECT COUNT(*) FROM comments m WHERE m.task_id=t.id) AS comment_count,
  (SELECT COUNT(*) FROM tasks s WHERE s.parent_id=t.id) AS subtask_total,
  (SELECT COUNT(*) FROM tasks s WHERE s.parent_id=t.id AND s.status='done') AS subtask_done,
  (SELECT COUNT(*) FROM attachments a WHERE a.task_id=t.id) AS attachment_count,
  (SELECT r.rule FROM recurrences r WHERE r.id=t.recurrence_id AND r.active=1) AS recurrence_rule
FROM tasks t
"""


class RuleError(Exception):
    def __init__(self, msg, code=409):
        super().__init__(msg)
        self.code = code


# ---------- Serialización ----------
def decorate(db, rows, settings=None, model=None):
    """Añade a cada tarea: campos personalizados, SLA, dependencias y riesgo de retraso."""
    settings = settings or get_settings(db)
    tasks = [dict(r) for r in rows]
    if not tasks:
        return tasks
    status = {r["id"]: r["status"] for r in db.execute("SELECT id, status FROM tasks")}
    deps = {}
    for r in db.execute("SELECT task_id, depends_on FROM task_deps"):
        deps.setdefault(r["task_id"], []).append(r["depends_on"])
    assets = {}
    for r in db.execute("SELECT task_id, asset_id FROM task_assets"):
        assets.setdefault(r["task_id"], []).append(r["asset_id"])
    if model is None:
        model = delay_model([dict(r) for r in db.execute("SELECT type, assignee, status, created_at, started_at, completed_at FROM tasks WHERE status='done'")])
    t0 = date.today()
    for t in tasks:
        try:
            t["custom"] = json.loads(t.get("custom") or "{}")
        except ValueError:
            t["custom"] = {}
        t["depends_on"] = deps.get(t["id"], [])
        t["blocked_by"] = [d for d in t["depends_on"] if status.get(d) != "done"]
        t["asset_ids"] = assets.get(t["id"], [])
        t["sla"] = compute_sla(t, settings)
        t["delay"] = predict_delay(t, model, t0)
        t.pop("alert_flags", None)
    return tasks


def fetch_task(db, tid, settings=None):
    row = db.execute(TASK_SELECT + " WHERE t.id=?", (tid,)).fetchone()
    return decorate(db, [row], settings)[0] if row else None


def raw_task(db, tid):
    row = db.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    return dict(row) if row else None


# ---------- Validación ----------
def validate(data):
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
    if "custom" in data and not isinstance(data["custom"], dict):
        return "Campos personalizados no válidos"
    return None


def clean(field, value):
    if field in ("project_id", "parent_id"):
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
    if field == "custom":
        return json.dumps(value or {}, ensure_ascii=False)
    return value if value is not None else ""


def check_rules(db, old, new_status, new_type, settings):
    """Reglas que impiden avanzar una tarea. Lanza RuleError con el motivo."""
    if new_status not in WORKING or (old and old["status"] == new_status and old["type"] == new_type):
        return
    if old:
        projects = {p["id"]: p for p in db.execute("SELECT id, key FROM projects")}
        pend = db.execute("""SELECT t.* FROM task_deps d JOIN tasks t ON t.id=d.depends_on
                             WHERE d.task_id=? AND t.status<>'done'""", (old["id"],)).fetchall()
        if pend:
            names = ", ".join(f"{task_key(projects, p)} «{p['title']}»" for p in pend[:3])
            raise RuleError(f"No puede avanzar: depende de {names}, que aún no está terminada.")
        if new_status == "done":
            open_subs = db.execute("SELECT COUNT(*) FROM tasks WHERE parent_id=? AND status<>'done'", (old["id"],)).fetchone()[0]
            if open_subs:
                raise RuleError(f"Cierra antes sus {open_subs} subtareas abiertas.")
    approval_status = old["approval_status"] if old else ""
    if new_type in (settings.get("approval_types") or []) and approval_status != "approved":
        raise RuleError("Este cambio necesita la aprobación del CAB antes de empezar. Solicítala desde el detalle de la tarea.")


def creates_cycle(db, task_id, depends_on):
    stack, seen = [depends_on], set()
    while stack:
        cur = stack.pop()
        if cur == task_id:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack += [r[0] for r in db.execute("SELECT depends_on FROM task_deps WHERE task_id=?", (cur,))]
    return False


# ---------- Operaciones ----------
def create_task_record(db, data, settings=None, who=None, notify_assignee=True):
    settings = settings or get_settings(db)
    vals = {f: clean(f, data[f]) for f in TASK_FIELDS if f in data}
    vals.setdefault("status", "todo")
    vals.setdefault("priority", "medium")
    vals.setdefault("type", "task")
    if vals.get("parent_id"):
        parent = raw_task(db, vals["parent_id"])
        if not parent:
            raise RuleError("La tarea principal no existe", 400)
        if parent["parent_id"]:
            raise RuleError("Las subtareas no pueden tener a su vez subtareas", 400)
        vals.setdefault("project_id", parent["project_id"])
    check_rules(db, None, vals["status"], vals["type"], settings)
    stamp = now()
    if "position" not in vals:
        top = db.execute("SELECT MIN(position) FROM tasks WHERE status=?", (vals["status"],)).fetchone()[0]
        bottom = db.execute("SELECT MAX(position) FROM tasks WHERE status=?", (vals["status"],)).fetchone()[0]
        vals["position"] = ((top or 1024) - 1024) if data.get("at_top") else ((bottom or 0) + 1024)
    vals["number"] = next_number(db, vals.get("project_id"))
    vals["created_at"] = vals["updated_at"] = stamp
    vals["created_by"] = who or actor()
    if vals["status"] != "todo":
        vals["started_at"] = vals["responded_at"] = stamp
    if vals["status"] == "done":
        vals["completed_at"] = stamp
    cols = list(vals)
    tid = db.execute(f"INSERT INTO tasks ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                     [vals[c] for c in cols]).lastrowid
    for i, text in enumerate(data.get("checklist") or []):
        if str(text).strip():
            db.execute("INSERT INTO checklist_items (task_id, text, position) VALUES (?,?,?)", (tid, str(text).strip(), i + 1))
    task = fetch_task(db, tid, settings)
    log(db, "created", task, who=who)
    if notify_assignee and task["assignee"]:
        notify(db, [task["assignee"]], "assigned", f"{task_key(db, task)} · {task['title']}", task)
    return task


def apply_update(db, tid, data, settings=None):
    settings = settings or get_settings(db)
    old = raw_task(db, tid)
    if not old:
        return None
    changes = {}
    for f in TASK_FIELDS:
        if f in data:
            v = clean(f, data[f])
            if v != old[f]:
                changes[f] = v
    if not changes:
        return fetch_task(db, tid, settings)
    if "parent_id" in changes and changes["parent_id"]:
        if changes["parent_id"] == tid:
            raise RuleError("Una tarea no puede ser subtarea de sí misma", 400)
        parent = raw_task(db, changes["parent_id"])
        if not parent or parent["parent_id"]:
            raise RuleError("La tarea principal no es válida", 400)
        if db.execute("SELECT 1 FROM tasks WHERE parent_id=?", (tid,)).fetchone():
            raise RuleError("Esta tarea ya tiene subtareas; no puede ser subtarea de otra", 400)
    new_status = changes.get("status", old["status"])
    new_type = changes.get("type", old["type"])
    if "status" in changes or "type" in changes:
        check_rules(db, old, new_status, new_type, settings)
    stamp = now()
    if "status" in changes:
        if new_status != "todo" and not old["started_at"] and new_status != "blocked":
            changes["started_at"] = stamp
        if new_status != "todo" and not old["responded_at"]:
            changes["responded_at"] = stamp
        changes["completed_at"] = stamp if new_status == "done" else None
    if "project_id" in changes:
        changes["number"] = next_number(db, changes["project_id"])
    changes["updated_at"] = stamp
    db.execute(f"UPDATE tasks SET {', '.join(f'{k}=?' for k in changes)} WHERE id=?", [*changes.values(), tid])
    task = fetch_task(db, tid, settings)
    for f in ("title", "status", "priority", "type", "assignee", "due_date", "start_date", "project_id", "estimate", "tags", "parent_id"):
        if f in changes:
            log(db, "updated", task, field=f, old=old[f], new=changes[f])
    if "notes" in changes:
        log(db, "updated", task, field="notes")
    if "custom" in changes:
        log(db, "updated", task, field="custom")

    key = task_key(db, task)
    if changes.get("assignee"):
        notify(db, [changes["assignee"]], "assigned", f"{key} · {task['title']}", task)
    if changes.get("status") == "blocked":
        owner = db.execute("SELECT owner FROM projects WHERE id=?", (task["project_id"],)).fetchone() if task["project_id"] else None
        notify(db, [task["created_by"], owner["owner"] if owner else ""], "blocked", f"{key} · {task['title']}", task)
    if changes.get("status") == "done" and task["created_by"] and task["created_by"] != task["assignee"]:
        notify(db, [task["created_by"]], "resolved", f"{key} · {task['title']}", task)
    return task


def _rule_response(e):
    return bad(str(e), e.code)


# ---------- Endpoints de tareas ----------
@bp.get("/api/tasks")
def list_tasks():
    where, vals = [], []
    for key, col in (("project_id", "t.project_id"), ("status", "t.status"), ("assignee", "t.assignee"),
                     ("priority", "t.priority"), ("type", "t.type"), ("parent_id", "t.parent_id")):
        if request.args.get(key):
            where.append(f"{col}=?")
            vals.append(request.args[key])
    if request.args.get("q"):
        where.append("(lower(t.title) LIKE lower(?) OR lower(t.notes) LIKE lower(?) OR lower(t.tags) LIKE lower(?))")
        vals += [f"%{request.args['q']}%"] * 3
    sql = TASK_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY t.position"
    with get_db() as db:
        return jsonify(decorate(db, db.execute(sql, vals).fetchall()))


@bp.get("/api/tasks/<int:tid>")
def get_task(tid):
    with get_db() as db:
        task = fetch_task(db, tid)
        if not task:
            return bad("No existe", 404)
        task["checklist"] = [dict(r) for r in db.execute("SELECT * FROM checklist_items WHERE task_id=? ORDER BY position, id", (tid,))]
        task["comments"] = [dict(r) for r in db.execute("SELECT * FROM comments WHERE task_id=? ORDER BY created_at, id", (tid,))]
        task["activity"] = [dict(r) for r in db.execute("SELECT * FROM activity WHERE task_id=? ORDER BY created_at DESC, id DESC LIMIT 80", (tid,))]
        task["approvals"] = [dict(r) for r in db.execute("SELECT * FROM approvals WHERE task_id=? ORDER BY id", (tid,))]
        task["attachments"] = [dict(r) for r in db.execute("SELECT * FROM attachments WHERE task_id=? ORDER BY id", (tid,))]
        task["subtasks"] = decorate(db, db.execute(TASK_SELECT + " WHERE t.parent_id=? ORDER BY t.position", (tid,)).fetchall())
        task["pages"] = [dict(r) for r in db.execute(
            "SELECT p.id, p.title, p.icon, p.kind FROM page_tasks pt JOIN pages p ON p.id=pt.page_id WHERE pt.task_id=?", (tid,))]
        return jsonify(task)


@bp.post("/api/tasks")
def create_task():
    data = body()
    data.setdefault("title", "")
    err = validate(data)
    if err:
        return bad(err)
    try:
        with get_db() as db:
            return jsonify(create_task_record(db, data)), 201
    except RuleError as e:
        return _rule_response(e)


@bp.put("/api/tasks/<int:tid>")
def update_task(tid):
    data = body()
    err = validate(data)
    if err:
        return bad(err)
    try:
        with get_db() as db:
            task = apply_update(db, tid, data)
            if not task:
                return bad("No existe", 404)
            return jsonify(task)
    except RuleError as e:
        return _rule_response(e)


@bp.post("/api/tasks/bulk")
def bulk_tasks():
    data = body()
    ids = [int(i) for i in data.get("ids", []) if str(i).isdigit()]
    if not ids:
        return bad("No hay tareas seleccionadas")
    with get_db() as db:
        if data.get("delete"):
            for tid in ids:
                t = raw_task(db, tid)
                if t:
                    log(db, "deleted", t)
            db.execute(f"DELETE FROM tasks WHERE id IN ({','.join('?' * len(ids))})", ids)
            return jsonify({"deleted": len(ids), "updated": [], "errors": []})
        changes = {k: v for k, v in (data.get("changes") or {}).items()
                   if k in ("status", "priority", "assignee", "project_id", "due_date", "type")}
        err = validate(changes)
        if err:
            return bad(err)
        settings = get_settings(db)
        updated, errors = [], []
        for tid in ids:
            try:
                t = apply_update(db, tid, changes, settings)
                if t:
                    updated.append(t)
            except RuleError as e:
                errors.append({"id": tid, "error": str(e)})
        return jsonify({"updated": updated, "errors": errors})


@bp.post("/api/tasks/<int:tid>/duplicate")
def duplicate_task(tid):
    with get_db() as db:
        src = raw_task(db, tid)
        if not src:
            return bad("No existe", 404)
        checklist = [r["text"] for r in db.execute("SELECT text FROM checklist_items WHERE task_id=? ORDER BY position", (tid,))]
        data = {k: src[k] for k in ("project_id", "parent_id", "notes", "priority", "type", "assignee", "start_date",
                                    "due_date", "estimate", "tags")}
        data.update(title=f"{src['title']} (copia)", status="todo", position=src["position"] + 1,
                    custom=json.loads(src["custom"] or "{}"), checklist=checklist)
        task = create_task_record(db, data, notify_assignee=False)
        return jsonify(task), 201


@bp.delete("/api/tasks/<int:tid>")
def delete_task(tid):
    with get_db() as db:
        t = raw_task(db, tid)
        if not t:
            return bad("No existe", 404)
        if t["created_by"] != actor() and not is_admin() and t["assignee"] != actor():
            return bad("Solo quien la creó, su responsable o administración pueden eliminarla", 403)
        log(db, "deleted", t)
        db.execute("DELETE FROM tasks WHERE id=?", (tid,))
        return jsonify({"ok": True})


# ---------- Dependencias ----------
@bp.post("/api/tasks/<int:tid>/deps")
def add_dep(tid):
    dep = body().get("depends_on")
    try:
        dep = int(dep)
    except (TypeError, ValueError):
        return bad("Indica la tarea de la que depende")
    if dep == tid:
        return bad("Una tarea no puede depender de sí misma")
    with get_db() as db:
        t, d = raw_task(db, tid), raw_task(db, dep)
        if not t or not d:
            return bad("No existe", 404)
        if creates_cycle(db, tid, dep):
            return bad("Esa dependencia crearía un ciclo (A espera a B y B espera a A)")
        db.execute("INSERT INTO task_deps (task_id, depends_on) VALUES (?,?) ON CONFLICT DO NOTHING", (tid, dep))
        log(db, "updated", t, field="depends_on", new=task_key(db, d))
        return jsonify(fetch_task(db, tid))


@bp.delete("/api/tasks/<int:tid>/deps/<int:dep>")
def remove_dep(tid, dep):
    with get_db() as db:
        db.execute("DELETE FROM task_deps WHERE task_id=? AND depends_on=?", (tid, dep))
        return jsonify(fetch_task(db, tid))


# ---------- Aprobación de cambios (CAB) ----------
@bp.post("/api/tasks/<int:tid>/approval")
def approval(tid):
    data = body()
    action = data.get("action")
    comment = str(data.get("comment", "")).strip()
    u = current_user()
    with get_db() as db:
        t = raw_task(db, tid)
        if not t:
            return bad("No existe", 404)
        key = task_key(db, t)
        if action == "request":
            if t["approval_status"] == "pending":
                return bad("Ya hay una solicitud pendiente")
            db.execute("UPDATE tasks SET approval_status='pending', updated_at=? WHERE id=?", (now(), tid))
            db.execute("INSERT INTO approvals (task_id, actor, decision, comment, created_at) VALUES (?,?,?,?,?)",
                       (tid, u["name"], "requested", comment, now()))
            log(db, "approval", t, field="requested", new=comment)
            cab = [r["id"] for r in db.execute("SELECT id FROM members WHERE active=1 AND is_cab=1")] or \
                  [r["id"] for r in db.execute("SELECT id FROM members WHERE active=1 AND role='admin'")]
            notify(db, cab, "approval_requested", f"{key} · {t['title']}" + (f" — {comment}" if comment else ""), t)
        elif action in ("approve", "reject"):
            if not (u["is_cab"] or u["role"] == "admin"):
                return bad("Solo los miembros del CAB pueden decidir sobre cambios", 403)
            if t["approval_status"] != "pending":
                return bad("No hay una solicitud de aprobación pendiente")
            req = db.execute("SELECT actor FROM approvals WHERE task_id=? AND decision='requested' ORDER BY id DESC LIMIT 1", (tid,)).fetchone()
            others = db.execute("SELECT COUNT(*) FROM members WHERE active=1 AND (is_cab=1 OR role='admin') AND id<>?", (u["id"],)).fetchone()[0]
            if req and req["actor"] == u["name"] and others:
                return bad("No puedes aprobar un cambio que solicitaste tú. Debe decidir otra persona del CAB.", 403)
            if action == "reject" and not comment:
                return bad("Indica el motivo del rechazo")
            status = "approved" if action == "approve" else "rejected"
            db.execute("UPDATE tasks SET approval_status=?, updated_at=? WHERE id=?", (status, now(), tid))
            db.execute("INSERT INTO approvals (task_id, actor, decision, comment, created_at) VALUES (?,?,?,?,?)",
                       (tid, u["name"], status, comment, now()))
            log(db, "approval", t, field=status, new=comment)
            verdict = "aprobado" if status == "approved" else "rechazado"
            notify(db, [t["created_by"], t["assignee"], req["actor"] if req else ""], "approval_decided",
                   f"{key} · {t['title']} — {verdict} por {u['name']}" + (f": {comment}" if comment else ""), t)
        else:
            return bad("Acción no válida")
        return jsonify(fetch_task(db, tid))


# ---------- Recurrencia ----------
def add_rule(d, rule):
    step = RECURRENCE_RULES[rule]
    if isinstance(step, int):
        return d + timedelta(days=step)
    months = int(step[:-1])
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    last = [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return date(y, m, min(d.day, last))


@bp.put("/api/tasks/<int:tid>/recurrence")
def set_recurrence(tid):
    rule = body().get("rule") or "none"
    with get_db() as db:
        t = raw_task(db, tid)
        if not t:
            return bad("No existe", 404)
        if rule == "none":
            if t["recurrence_id"]:
                db.execute("UPDATE recurrences SET active=0 WHERE id=?", (t["recurrence_id"],))
                db.execute("UPDATE tasks SET recurrence_id=NULL WHERE recurrence_id=?", (t["recurrence_id"],))
            log(db, "updated", t, field="recurrence", new="")
            return jsonify(fetch_task(db, tid))
        if rule not in RECURRENCE_RULES:
            return bad("Frecuencia no válida")
        checklist = [r["text"] for r in db.execute("SELECT text FROM checklist_items WHERE task_id=? ORDER BY position", (tid,))]
        payload = {k: t[k] for k in ("title", "notes", "type", "priority", "assignee", "project_id", "tags", "estimate")}
        payload["checklist"] = checklist
        payload["custom"] = json.loads(t["custom"] or "{}")
        base = date.fromisoformat(t["due_date"]) if t["due_date"] else date.today()
        nxt = add_rule(base, rule)
        lead = 2 if rule == "weekly" else 5 if rule == "biweekly" else 7
        if t["recurrence_id"]:
            db.execute("UPDATE recurrences SET payload=?, rule=?, next_date=?, due_offset_days=?, active=1 WHERE id=?",
                       (json.dumps(payload, ensure_ascii=False), rule, nxt.isoformat(), lead, t["recurrence_id"]))
        else:
            rid = db.execute("INSERT INTO recurrences (payload, rule, next_date, due_offset_days, created_by, last_task_id) VALUES (?,?,?,?,?,?)",
                             (json.dumps(payload, ensure_ascii=False), rule, nxt.isoformat(), lead, actor(), tid)).lastrowid
            db.execute("UPDATE tasks SET recurrence_id=? WHERE id=?", (rid, tid))
        log(db, "updated", t, field="recurrence", new=rule)
        return jsonify(fetch_task(db, tid))


# ---------- Checklist ----------
@bp.post("/api/tasks/<int:tid>/checklist")
def add_check_item(tid):
    text = str(body().get("text", "")).strip()
    if not text:
        return bad("El texto es obligatorio")
    with get_db() as db:
        if not raw_task(db, tid):
            return bad("No existe", 404)
        pos = (db.execute("SELECT MAX(position) FROM checklist_items WHERE task_id=?", (tid,)).fetchone()[0] or 0) + 1
        cid = db.execute("INSERT INTO checklist_items (task_id, text, position) VALUES (?,?,?)", (tid, text, pos)).lastrowid
        db.execute("UPDATE tasks SET updated_at=? WHERE id=?", (now(), tid))
        return jsonify(dict(db.execute("SELECT * FROM checklist_items WHERE id=?", (cid,)).fetchone())), 201


@bp.put("/api/checklist/<int:cid>")
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
                log(db, "checked", raw_task(db, item["task_id"]), new=item["text"])
        db.execute("UPDATE tasks SET updated_at=? WHERE id=?", (now(), item["task_id"]))
        return jsonify(dict(db.execute("SELECT * FROM checklist_items WHERE id=?", (cid,)).fetchone()))


@bp.delete("/api/checklist/<int:cid>")
def delete_check_item(cid):
    with get_db() as db:
        db.execute("DELETE FROM checklist_items WHERE id=?", (cid,))
        return jsonify({"ok": True})


# ---------- Comentarios ----------
@bp.post("/api/tasks/<int:tid>/comments")
def add_comment(tid):
    text = str(body().get("body", "")).strip()
    if not text:
        return bad("El comentario está vacío")
    who = actor()
    with get_db() as db:
        t = raw_task(db, tid)
        if not t:
            return bad("No existe", 404)
        stamp = now()
        cid = db.execute("INSERT INTO comments (task_id, author, body, created_at) VALUES (?,?,?,?)", (tid, who, text, stamp)).lastrowid
        if not t["responded_at"] and who != t["created_by"]:
            db.execute("UPDATE tasks SET responded_at=? WHERE id=?", (stamp, tid))
        db.execute("UPDATE tasks SET updated_at=? WHERE id=?", (stamp, tid))
        log(db, "commented", t, new=text[:140])
        key = task_key(db, t)
        mentioned = find_mentions(db, text)
        notify(db, mentioned, "mention", f"{who} en {key}: {text[:160]}", t)
        rest = [n for n in (t["assignee"], t["created_by"]) if n and n not in mentioned]
        notify(db, rest, "comment", f"{who} en {key}: {text[:160]}", t)
        return jsonify(dict(db.execute("SELECT * FROM comments WHERE id=?", (cid,)).fetchone())), 201


@bp.delete("/api/comments/<int:cid>")
def delete_comment(cid):
    with get_db() as db:
        c = db.execute("SELECT * FROM comments WHERE id=?", (cid,)).fetchone()
        if not c:
            return bad("No existe", 404)
        if c["author"] != actor() and not is_admin():
            return bad("Solo puedes borrar tus propios comentarios", 403)
        db.execute("DELETE FROM comments WHERE id=?", (cid,))
        return jsonify({"ok": True})


# ---------- Vinculación con activos ----------
@bp.put("/api/tasks/<int:tid>/assets")
def set_task_assets(tid):
    ids = [int(i) for i in body().get("asset_ids", []) if str(i).isdigit()]
    with get_db() as db:
        t = raw_task(db, tid)
        if not t:
            return bad("No existe", 404)
        db.execute("DELETE FROM task_assets WHERE task_id=?", (tid,))
        for a in ids:
            db.execute("INSERT INTO task_assets (task_id, asset_id) SELECT ?, id FROM assets WHERE id=? ON CONFLICT DO NOTHING", (tid, a))
        log(db, "updated", t, field="assets", new=str(len(ids)))
        return jsonify(fetch_task(db, tid))


# Exportados para otros módulos
__all__ = ["bp", "decorate", "fetch_task", "raw_task", "create_task_record", "apply_update", "RuleError",
           "TASK_SELECT", "add_rule", "STATUS_LABEL", "PRIORITY_LABEL", "today", "parse_dt"]
