"""Activos, adjuntos, campos personalizados, plantillas, administración, IA y entrada por correo/webhook."""
import json
import mimetypes
import os
import secrets
import uuid
from datetime import date

from flask import Blueprint, abort, jsonify, request, send_file
from werkzeug.utils import secure_filename

import ai
import backup
from api_tasks import TASK_SELECT, RuleError, create_task_record, decorate, raw_task
from auth import require_admin
from core import actor, bad, body, current_user, get_settings, get_state, is_admin, log, now, task_key
from db import DB, get_db
from notify import notify

bp = Blueprint("misc", __name__)

UPLOAD_DIR = os.environ.get("PANEL_TI_UPLOADS", os.path.join(os.path.dirname(os.path.abspath(DB)), "uploads"))
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".txt", ".log", ".csv", ".json", ".xml", ".yaml", ".yml",
               ".zip", ".7z", ".docx", ".xlsx", ".pptx", ".doc", ".xls", ".msg", ".eml", ".md", ".pcap", ".cfg", ".conf", ".ini"}
INLINE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"}
ASSET_KINDS = {"server", "laptop", "desktop", "application", "network", "database", "cloud", "mobile", "printer", "other"}
ASSET_FIELDS = ["name", "kind", "identifier", "owner", "location", "status", "criticality", "notes"]
FIELD_TYPES = {"text", "number", "select", "date", "checkbox", "url"}


# ---------- Activos ----------
@bp.get("/api/assets")
def list_assets():
    with get_db() as db:
        rows = db.execute("""SELECT a.*, (SELECT COUNT(*) FROM task_assets ta JOIN tasks t ON t.id=ta.task_id
                             WHERE ta.asset_id=a.id AND t.status<>'done') AS open_tasks,
                             (SELECT COUNT(*) FROM task_assets ta JOIN tasks t ON t.id=ta.task_id
                             WHERE ta.asset_id=a.id AND t.type='incident') AS incidents
                             FROM assets a ORDER BY a.name""").fetchall()
        return jsonify([dict(r) for r in rows])


@bp.get("/api/assets/<int:aid>")
def get_asset(aid):
    with get_db() as db:
        row = db.execute("SELECT * FROM assets WHERE id=?", (aid,)).fetchone()
        if not row:
            return bad("No existe", 404)
        out = dict(row)
        out["tasks"] = decorate(db, db.execute(TASK_SELECT + " WHERE t.id IN (SELECT task_id FROM task_assets WHERE asset_id=?) "
                                               "ORDER BY t.created_at DESC", (aid,)).fetchall())
        return jsonify(out)


def _asset_values(data):
    vals = {}
    for f in ASSET_FIELDS:
        if f in data:
            v = str(data[f] or "").strip()
            if f == "kind" and v not in ASSET_KINDS:
                v = "other"
            if f == "criticality" and v not in ("low", "medium", "high", "critical"):
                v = "medium"
            if f == "status" and v not in ("active", "maintenance", "retired"):
                v = "active"
            vals[f] = v
    return vals


@bp.post("/api/assets")
def create_asset():
    vals = _asset_values(body())
    if not vals.get("name"):
        return bad("El nombre es obligatorio")
    with get_db() as db:
        cols = list(vals)
        aid = db.execute(f"INSERT INTO assets ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", [vals[c] for c in cols]).lastrowid
        return jsonify(dict(db.execute("SELECT * FROM assets WHERE id=?", (aid,)).fetchone())), 201


@bp.put("/api/assets/<int:aid>")
def update_asset(aid):
    vals = _asset_values(body())
    if "name" in vals and not vals["name"]:
        return bad("El nombre es obligatorio")
    if not vals:
        return bad("Nada que actualizar")
    with get_db() as db:
        if not db.execute("SELECT 1 FROM assets WHERE id=?", (aid,)).fetchone():
            return bad("No existe", 404)
        db.execute(f"UPDATE assets SET {', '.join(f'{k}=?' for k in vals)} WHERE id=?", [*vals.values(), aid])
        return jsonify(dict(db.execute("SELECT * FROM assets WHERE id=?", (aid,)).fetchone()))


@bp.delete("/api/assets/<int:aid>")
@require_admin
def delete_asset(aid):
    with get_db() as db:
        db.execute("DELETE FROM assets WHERE id=?", (aid,))
        return jsonify({"ok": True})


# ---------- Adjuntos ----------
def _store_upload(task_id=None, page_id=None):
    f = request.files.get("file")
    if not f or not f.filename:
        return bad("No se ha recibido ningún archivo")
    name = secure_filename(f.filename) or "archivo"
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_EXT:
        return bad(f"Tipo de archivo no permitido ({ext or 'sin extensión'})")
    sub = date.today().strftime("%Y-%m")
    os.makedirs(os.path.join(UPLOAD_DIR, sub), exist_ok=True)
    stored = f"{sub}/{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, stored)
    f.save(path)
    size = os.path.getsize(path)
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    with get_db() as db:
        fid = db.execute("INSERT INTO attachments (task_id, page_id, filename, stored_name, mime, size, uploaded_by, created_at) "
                         "VALUES (?,?,?,?,?,?,?,?)", (task_id, page_id, f.filename[:200], stored, mime, size, actor(), now())).lastrowid
        if task_id:
            t = raw_task(db, task_id)
            log(db, "attached", t, new=f.filename[:200])
            db.execute("UPDATE tasks SET updated_at=? WHERE id=?", (now(), task_id))
        return jsonify(dict(db.execute("SELECT * FROM attachments WHERE id=?", (fid,)).fetchone())), 201


@bp.post("/api/tasks/<int:tid>/attachments")
def upload_task_file(tid):
    with get_db() as db:
        if not raw_task(db, tid):
            return bad("No existe", 404)
    return _store_upload(task_id=tid)


@bp.post("/api/pages/<int:pid>/attachments")
def upload_page_file(pid):
    with get_db() as db:
        if not db.execute("SELECT 1 FROM pages WHERE id=?", (pid,)).fetchone():
            return bad("No existe", 404)
    return _store_upload(page_id=pid)


@bp.get("/api/files/<int:fid>")
def get_file(fid):
    with get_db() as db:
        row = db.execute("SELECT * FROM attachments WHERE id=?", (fid,)).fetchone()
    if not row:
        abort(404)
    path = os.path.realpath(os.path.join(UPLOAD_DIR, row["stored_name"]))
    if not path.startswith(os.path.realpath(UPLOAD_DIR)) or not os.path.exists(path):
        abort(404)
    inline = row["mime"] in INLINE_TYPES and request.args.get("download") != "1"
    resp = send_file(path, mimetype=row["mime"] if inline else "application/octet-stream",
                     as_attachment=not inline, download_name=row["filename"])
    resp.headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
    return resp


@bp.delete("/api/files/<int:fid>")
def delete_file(fid):
    with get_db() as db:
        row = db.execute("SELECT * FROM attachments WHERE id=?", (fid,)).fetchone()
        if not row:
            return bad("No existe", 404)
        if row["uploaded_by"] != actor() and not is_admin():
            return bad("Solo quien subió el archivo o administración pueden borrarlo", 403)
        db.execute("DELETE FROM attachments WHERE id=?", (fid,))
    try:
        os.remove(os.path.join(UPLOAD_DIR, row["stored_name"]))
    except OSError:
        pass
    return jsonify({"ok": True})


# ---------- Campos personalizados ----------
@bp.get("/api/custom-fields")
def list_fields():
    with get_db() as db:
        return jsonify([dict(r, options=json.loads(r["options"] or "[]")) for r in db.execute("SELECT * FROM custom_fields ORDER BY position, id")])


def _field_values(data):
    vals = {}
    if "name" in data:
        vals["name"] = str(data["name"]).strip()[:60]
    if "type" in data:
        vals["type"] = data["type"] if data["type"] in FIELD_TYPES else "text"
    if "options" in data:
        opts = data["options"] if isinstance(data["options"], list) else str(data["options"]).split(",")
        vals["options"] = json.dumps([str(o).strip() for o in opts if str(o).strip()][:40], ensure_ascii=False)
    if "project_id" in data:
        vals["project_id"] = data["project_id"] or None
    return vals


@bp.post("/api/custom-fields")
@require_admin
def create_field():
    vals = _field_values(body())
    if not vals.get("name"):
        return bad("El nombre es obligatorio")
    vals.setdefault("type", "text")
    with get_db() as db:
        vals["position"] = (db.execute("SELECT MAX(position) FROM custom_fields").fetchone()[0] or 0) + 1
        cols = list(vals)
        fid = db.execute(f"INSERT INTO custom_fields ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", [vals[c] for c in cols]).lastrowid
        r = db.execute("SELECT * FROM custom_fields WHERE id=?", (fid,)).fetchone()
        return jsonify(dict(r, options=json.loads(r["options"]))), 201


@bp.put("/api/custom-fields/<int:fid>")
@require_admin
def update_field(fid):
    vals = _field_values(body())
    if not vals:
        return bad("Nada que actualizar")
    with get_db() as db:
        db.execute(f"UPDATE custom_fields SET {', '.join(f'{k}=?' for k in vals)} WHERE id=?", [*vals.values(), fid])
        r = db.execute("SELECT * FROM custom_fields WHERE id=?", (fid,)).fetchone()
        if not r:
            return bad("No existe", 404)
        return jsonify(dict(r, options=json.loads(r["options"])))


@bp.delete("/api/custom-fields/<int:fid>")
@require_admin
def delete_field(fid):
    with get_db() as db:
        db.execute("DELETE FROM custom_fields WHERE id=?", (fid,))
        return jsonify({"ok": True})


# ---------- Plantillas ----------
@bp.get("/api/templates")
def list_templates():
    with get_db() as db:
        return jsonify([dict(r, payload=json.loads(r["payload"] or "{}")) for r in db.execute("SELECT * FROM templates ORDER BY kind, name")])


@bp.post("/api/templates")
def create_template():
    data = body()
    name = str(data.get("name", "")).strip()
    if not name:
        return bad("El nombre es obligatorio")
    kind = data.get("kind") if data.get("kind") in ("task", "page") else "task"
    payload = data.get("payload") or {}
    if data.get("from_task"):
        with get_db() as db:
            t = raw_task(db, int(data["from_task"]))
            if not t:
                return bad("No existe", 404)
            payload = {k: t[k] for k in ("title", "notes", "type", "priority", "assignee", "project_id", "tags", "estimate")}
            payload["checklist"] = [r["text"] for r in db.execute("SELECT text FROM checklist_items WHERE task_id=? ORDER BY position", (t["id"],))]
            payload["subtasks"] = [r["title"] for r in db.execute("SELECT title FROM tasks WHERE parent_id=? ORDER BY position", (t["id"],))]
    with get_db() as db:
        tid = db.execute("INSERT INTO templates (kind, name, description, payload, created_at) VALUES (?,?,?,?,?)",
                         (kind, name, str(data.get("description", "")), json.dumps(payload, ensure_ascii=False), now())).lastrowid
        r = db.execute("SELECT * FROM templates WHERE id=?", (tid,)).fetchone()
        return jsonify(dict(r, payload=json.loads(r["payload"]))), 201


@bp.delete("/api/templates/<int:tid>")
@require_admin
def delete_template(tid):
    with get_db() as db:
        db.execute("DELETE FROM templates WHERE id=?", (tid,))
        return jsonify({"ok": True})


@bp.post("/api/templates/<int:tpl_id>/apply")
def apply_template(tpl_id):
    """Crea una tarea (con checklist y subtareas) desde una plantilla."""
    overrides = body()
    with get_db() as db:
        tpl = db.execute("SELECT * FROM templates WHERE id=? AND kind='task'", (tpl_id,)).fetchone()
        if not tpl:
            return bad("No existe", 404)
        payload = json.loads(tpl["payload"] or "{}")
        data = {**{k: v for k, v in payload.items() if k not in ("subtasks",)}, **{k: v for k, v in overrides.items() if v not in (None, "")}}
        data.setdefault("title", tpl["name"])
        try:
            task = create_task_record(db, data)
            for title in payload.get("subtasks") or []:
                create_task_record(db, {"title": title, "parent_id": task["id"], "assignee": data.get("assignee", ""),
                                        "type": data.get("type", "task")}, notify_assignee=False)
        except RuleError as e:
            return bad(str(e), e.code)
        return jsonify(decorate(db, [db.execute(TASK_SELECT + " WHERE t.id=?", (task["id"],)).fetchone()])[0]), 201


# ---------- Administración ----------
@bp.get("/api/admin/status")
@require_admin
def admin_status():
    with get_db() as db:
        jobs = {k[4:]: v for k, v in ((r["key"], json.loads(r["value"])) for r in db.execute("SELECT * FROM state WHERE key LIKE 'job:%'"))}
    size = os.path.getsize(DB) if os.path.exists(DB) else 0
    return jsonify({
        "db_path": DB, "db_size": size, "uploads_dir": UPLOAD_DIR, "backups": backup.list_backups()[:20],
        "backup_dir": backup.BACKUP_DIR, "jobs": jobs, "ai_model": ai.MODEL if ai.available() else None,
    })


@bp.post("/api/admin/backup")
@require_admin
def admin_backup():
    try:
        info = backup.create_backup()
    except OSError as e:
        return bad(f"No se pudo crear la copia: {e}", 500)
    return jsonify(info), 201


@bp.get("/api/admin/backups/<name>")
@require_admin
def download_backup(name):
    path = backup.backup_path(name)
    if not path:
        abort(404)
    return send_file(path, as_attachment=True, download_name=name)


# ---------- IA ----------
def _context(db):
    members = [dict(r) for r in db.execute("SELECT id, name, title, team FROM members WHERE active=1 AND role<>'viewer' ORDER BY name")]
    projects = [dict(r) for r in db.execute("SELECT id, name, key, area FROM projects WHERE status<>'closed'")]
    tasks = [dict(r) for r in db.execute("SELECT id, title, notes, tags, type, priority, assignee, project_id, status, number FROM tasks")]
    load = {}
    for t in tasks:
        if t["status"] != "done" and t["assignee"]:
            load[t["assignee"]] = load.get(t["assignee"], 0) + 1
    return members, projects, tasks, load


@bp.post("/api/ai/classify")
def ai_classify():
    data = body()
    title = str(data.get("title", "")).strip()
    notes = str(data.get("notes", "")).strip()
    if len(title) < 3:
        return bad("Escribe primero un título")
    with get_db() as db:
        members, projects, tasks, load = _context(db)
        pmap = {p["id"]: p for p in db.execute("SELECT id, key FROM projects")}
    similar = ai.similar_tasks(tasks, f"{title} {notes}", exclude_id=data.get("exclude_id"))
    source = "local"
    try:
        suggestion = ai.classify(title, notes, members, projects, similar, load) if ai.available() else None
        if suggestion:
            source = "ai"
    except ai.AIError as e:
        suggestion = None
        source = f"local ({e})"
    if not suggestion:
        suggestion = ai.heuristic_classify(f"{title} {notes}", similar)
    return jsonify({"suggestion": suggestion, "source": source,
                    "similar": [{"id": t["id"], "key": task_key(pmap, t), "title": t["title"], "status": t["status"],
                                 "assignee": t["assignee"]} for t in similar]})


@bp.post("/api/ai/query")
def ai_query():
    q = str(body().get("q", "")).strip()
    if not q:
        return bad("Escribe una pregunta")
    with get_db() as db:
        members, projects, _, _ = _context(db)
        members = [dict(r) for r in db.execute("SELECT name FROM members WHERE active=1")]
    if ai.available():
        try:
            return jsonify({"filters": ai.ai_query(q, members, projects), "source": "ai"})
        except ai.AIError:
            pass
    return jsonify({"filters": ai.local_query(q, members, projects), "source": "local"})


@bp.post("/api/ai/report")
def ai_report():
    from api_core import build_report_json, weekly_flow
    data = body()
    if not ai.available():
        return bad("La redacción con IA no está configurada. Define ANTHROPIC_API_KEY en el servidor.", 501)
    report = data.get("report") or build_report_json(data.get("start"), data.get("end"))
    with get_db() as db:
        flow = weekly_flow([dict(r) for r in db.execute("SELECT created_at, completed_at FROM tasks")], 8)
    try:
        return jsonify(ai.report_narrative(report, flow))
    except ai.AIError as e:
        return bad(str(e), 502)


@bp.post("/api/ai/kb/<int:tid>")
def ai_kb(tid):
    """Crea un borrador de artículo de la base de conocimiento a partir de una tarea resuelta."""
    from api_pages import create_page_record, page_out
    with get_db() as db:
        t = raw_task(db, tid)
        if not t:
            return bad("No existe", 404)
        comments = [dict(r) for r in db.execute("SELECT author, body FROM comments WHERE task_id=? ORDER BY id", (tid,))]
        checklist = [r["text"] for r in db.execute("SELECT text FROM checklist_items WHERE task_id=? ORDER BY position", (tid,))]
        key = task_key(db, t)
    source = "local"
    art = None
    if ai.available():
        try:
            art = ai.kb_article(t, comments, checklist)
            source = "ai"
        except ai.AIError:
            art = None
    art = art or ai.kb_local(t, comments, checklist)
    blocks = [{"type": "callout", "text": f"Basado en {key}. " + ("Autoservicio: la persona usuaria puede seguir estos pasos."
                                                                 if art["self_service"] else "Procedimiento para el equipo de TI.")}]
    if art["symptoms"]:
        blocks.append({"type": "h2", "text": "Síntomas"})
        blocks += [{"type": "bullet", "text": s} for s in art["symptoms"]]
    blocks.append({"type": "h2", "text": "Causa"})
    blocks.append({"type": "p", "text": art["cause"] or "Pendiente de documentar."})
    blocks.append({"type": "h2", "text": "Solución"})
    blocks += [{"type": "number", "text": s} for s in art["steps"]] or [{"type": "p", "text": ""}]
    if art["notes"]:
        blocks.append({"type": "quote", "text": art["notes"]})
    with get_db() as db:
        kb_root = db.execute("SELECT id FROM pages WHERE kind='kb' AND parent_id IS NULL ORDER BY id LIMIT 1").fetchone()
        pid = create_page_record(db, {"title": art["title"], "icon": "📘", "kind": "kb", "blocks": blocks,
                                      "parent_id": kb_root["id"] if kb_root else None, "project_id": t["project_id"]})
        db.execute("INSERT OR IGNORE INTO page_tasks (page_id, task_id) VALUES (?,?)", (pid, tid))
        log(db, "kb_created", t, new=art["title"])
        page = page_out(db, db.execute("SELECT * FROM pages WHERE id=?", (pid,)).fetchone())
    return jsonify({"page": page, "source": source}), 201


# ---------- Entrada externa (correo reenviado, Power Automate, Teams) ----------
def create_inbound_task(db, subject, text, sender="", priority=None, ttype=None):
    settings = get_settings(db)
    sender = (sender or "").strip()
    m = db.execute("SELECT name FROM members WHERE lower(email)=lower(?)", (sender,)).fetchone() if sender else None
    who = m["name"] if m else (f"Externo: {sender}" if sender else "Entrada externa")
    data = {"title": (subject or "Solicitud sin asunto").strip()[:200],
            "notes": ((text or "").strip() + (f"\n\nRemitente: {sender}" if sender and not m else ""))[:20000],
            "type": ttype if ttype in ("task", "incident", "change", "request", "improvement") else settings.get("inbound_default_type", "request"),
            "priority": priority if priority in ("low", "medium", "high", "critical") else "medium",
            "project_id": settings.get("inbound_project_id")}
    triage = "Sin clasificar"
    members, projects, tasks, load = _context(db)
    similar = ai.similar_tasks(tasks, f"{data['title']} {data['notes']}")
    sug = None
    if ai.available():
        try:
            sug = ai.classify(data["title"], data["notes"], members, projects, similar, load)
            triage = "Clasificada con IA"
        except ai.AIError:
            sug = None
    if not sug:
        sug = ai.heuristic_classify(f"{data['title']} {data['notes']}", similar)
        triage = "Clasificada por reglas"
    if not ttype:
        data["type"] = sug["type"]
    if not priority:
        data["priority"] = sug["priority"]
    data["assignee"] = sug["assignee"]
    data["project_id"] = data["project_id"] or sug["project_id"]
    data["notes"] += f"\n\n— {triage}: {sug['reason']}"
    task = create_task_record(db, data, who=who)
    admins = [r["id"] for r in db.execute("SELECT id FROM members WHERE active=1 AND role='admin'")]
    notify(db, admins, "inbound", f"{task_key(db, task)} · {task['title']} (de {who})", task, skip_actor=False)
    return task


@bp.post("/api/inbound/<token>")
def inbound(token):
    with get_db() as db:
        expected = get_settings(db).get("inbound_token")
        if not expected or not secrets.compare_digest(token, expected):
            return bad("No autorizado", 403)
        data = request.get_json(silent=True) or request.form.to_dict() or {}
        subject = data.get("subject") or data.get("title")
        text = data.get("body") or data.get("text") or data.get("description") or ""
        if not subject and not text:
            return bad("Faltan asunto y texto")
        task = create_inbound_task(db, subject, text, data.get("from") or data.get("email") or "",
                                   data.get("priority"), data.get("type"))
        return jsonify({"id": task["id"], "key": task_key(db, task)}), 201
