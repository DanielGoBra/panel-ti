"""Páginas tipo Notion: wiki, procedimientos, actas y base de conocimiento.

El contenido se guarda como una lista de bloques JSON:
  {"id": "...", "type": "p|h1|h2|h3|bullet|number|todo|quote|callout|code|divider|task", "text": "...",
   "checked": bool, "task_id": int}
El texto admite un subconjunto de markdown en línea (negrita, cursiva, código, enlaces) que el
cliente muestra escapado. Las claves de tarea (NUB-12) se enlazan solas.
"""
import json
import re
import secrets

from flask import Blueprint, jsonify, request

from core import actor, bad, body, is_admin, log, now
from db import get_db

bp = Blueprint("pages", __name__)

BLOCK_TYPES = {"p", "h1", "h2", "h3", "bullet", "number", "todo", "quote", "callout", "code", "divider", "task", "image"}
KINDS = {"page", "kb", "minutes", "procedure"}
KEY_RE = re.compile(r"\b([A-Z]{1,6})-(\d+)\b")
MAX_BLOCKS = 2000


def clean_blocks(blocks):
    if not isinstance(blocks, list):
        raise ValueError("Contenido no válido")
    out = []
    for b in blocks[:MAX_BLOCKS]:
        if not isinstance(b, dict):
            continue
        t = b.get("type", "p")
        if t not in BLOCK_TYPES:
            t = "p"
        item = {"id": str(b.get("id") or secrets.token_hex(4))[:16], "type": t, "text": str(b.get("text", ""))[:20000]}
        if t == "todo":
            item["checked"] = bool(b.get("checked"))
        if t == "task" and str(b.get("task_id", "")).isdigit():
            item["task_id"] = int(b["task_id"])
        if t == "image" and str(b.get("file_id", "")).isdigit():
            item["file_id"] = int(b["file_id"])
        if t == "code" and b.get("lang"):
            item["lang"] = str(b["lang"])[:20]
        out.append(item)
    return out


def linked_task_ids(db, blocks):
    projects = {r["key"]: r["id"] for r in db.execute("SELECT id, key FROM projects")}
    ids = {b["task_id"] for b in blocks if b.get("task_id")}
    for b in blocks:
        for key, num in KEY_RE.findall(b.get("text", "")):
            if key == "TI":
                row = db.execute("SELECT id FROM tasks WHERE project_id IS NULL AND number=?", (int(num),)).fetchone()
            elif key in projects:
                row = db.execute("SELECT id FROM tasks WHERE project_id=? AND number=?", (projects[key], int(num))).fetchone()
            else:
                row = None
            if row:
                ids.add(row["id"])
    return ids


def save_links(db, page_id, blocks):
    db.execute("DELETE FROM page_tasks WHERE page_id=?", (page_id,))
    for tid in linked_task_ids(db, blocks):
        db.execute("INSERT INTO page_tasks (page_id, task_id) SELECT ?, id FROM tasks WHERE id=? ON CONFLICT DO NOTHING", (page_id, tid))


def page_out(db, row, full=True):
    p = dict(row)
    p["blocks"] = json.loads(p["blocks"] or "[]") if full else None
    if full:
        p["children"] = [dict(r) for r in db.execute("SELECT id, title, icon, kind FROM pages WHERE parent_id=? ORDER BY position, id", (p["id"],))]
        p["linked_tasks"] = [r["task_id"] for r in db.execute("SELECT task_id FROM page_tasks WHERE page_id=?", (p["id"],))]
        p["attachments"] = [dict(r) for r in db.execute("SELECT * FROM attachments WHERE page_id=? ORDER BY id", (p["id"],))]
    return p


def create_page_record(db, data):
    try:
        blocks = clean_blocks(data.get("blocks") or [{"type": "p", "text": ""}])
    except ValueError as e:
        raise ValueError(str(e))
    kind = data.get("kind") if data.get("kind") in KINDS else "page"
    parent = data.get("parent_id") or None
    if parent and not db.execute("SELECT 1 FROM pages WHERE id=?", (parent,)).fetchone():
        raise ValueError("La página superior no existe")
    pos = (db.execute("SELECT MAX(position) FROM pages WHERE " + ("parent_id=?" if parent else "parent_id IS NULL"),
                      (parent,) if parent else ()).fetchone()[0] or 0) + 1024
    stamp = now()
    pid = db.execute(
        "INSERT INTO pages (parent_id, project_id, title, icon, kind, blocks, position, created_by, updated_by, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (parent, data.get("project_id") or None, str(data.get("title", "")).strip()[:200], str(data.get("icon", ""))[:8], kind,
         json.dumps(blocks, ensure_ascii=False), pos, actor(), actor(), stamp, stamp)).lastrowid
    save_links(db, pid, blocks)
    return pid


@bp.get("/api/pages")
def list_pages():
    with get_db() as db:
        rows = db.execute("SELECT id, parent_id, project_id, title, icon, kind, position, updated_at, updated_by FROM pages ORDER BY position, id")
        return jsonify([dict(r) for r in rows])


@bp.get("/api/pages/search")
def search_pages():
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify([])
    with get_db() as db:
        rows = db.execute("SELECT id, title, icon, kind, blocks FROM pages WHERE lower(title) LIKE lower(?) OR lower(blocks) LIKE lower(?) ORDER BY updated_at DESC LIMIT 12",
                          (f"%{q}%", f"%{q}%")).fetchall()
    out = []
    low = q.lower()
    for r in rows:
        snippet = ""
        for b in json.loads(r["blocks"] or "[]"):
            i = b.get("text", "").lower().find(low)
            if i >= 0:
                t = b["text"]
                snippet = ("…" if i > 40 else "") + t[max(0, i - 40): i + 80]
                break
        out.append({"id": r["id"], "title": r["title"], "icon": r["icon"], "kind": r["kind"], "snippet": snippet})
    return jsonify(out)


@bp.get("/api/pages/<int:pid>")
def get_page(pid):
    with get_db() as db:
        row = db.execute("SELECT * FROM pages WHERE id=?", (pid,)).fetchone()
        if not row:
            return bad("No existe", 404)
        return jsonify(page_out(db, row))


@bp.post("/api/pages")
def create_page():
    data = body()
    with get_db() as db:
        if data.get("template_id"):
            tpl = db.execute("SELECT * FROM templates WHERE id=? AND kind='page'", (data["template_id"],)).fetchone()
            if tpl:
                payload = json.loads(tpl["payload"] or "{}")
                data.setdefault("blocks", payload.get("blocks"))
                data.setdefault("icon", payload.get("icon", ""))
                data.setdefault("kind", payload.get("kind", "page"))
                if not data.get("title"):
                    data["title"] = payload.get("title", tpl["name"])
        try:
            pid = create_page_record(db, data)
        except ValueError as e:
            return bad(str(e))
        return jsonify(page_out(db, db.execute("SELECT * FROM pages WHERE id=?", (pid,)).fetchone())), 201


@bp.put("/api/pages/<int:pid>")
def update_page(pid):
    data = body()
    with get_db() as db:
        row = db.execute("SELECT * FROM pages WHERE id=?", (pid,)).fetchone()
        if not row:
            return bad("No existe", 404)
        if data.get("base_updated_at") and data["base_updated_at"] != row["updated_at"] and row["updated_by"] != actor():
            return jsonify({"error": f"{row['updated_by']} ha modificado esta página mientras la editabas.",
                            "conflict": True, "page": page_out(db, row)}), 409
        sets, vals = [], []
        if "title" in data:
            sets.append("title=?")
            vals.append(str(data["title"]).strip()[:200])
        if "icon" in data:
            sets.append("icon=?")
            vals.append(str(data["icon"])[:8])
        if "kind" in data and data["kind"] in KINDS:
            sets.append("kind=?")
            vals.append(data["kind"])
        if "project_id" in data:
            sets.append("project_id=?")
            vals.append(data["project_id"] or None)
        if "parent_id" in data:
            parent = data["parent_id"] or None
            cur = parent
            while cur:  # evita ciclos al mover
                if cur == pid:
                    return bad("No puedes mover una página dentro de sí misma")
                r = db.execute("SELECT parent_id FROM pages WHERE id=?", (cur,)).fetchone()
                cur = r["parent_id"] if r else None
            sets.append("parent_id=?")
            vals.append(parent)
        if "position" in data:
            sets.append("position=?")
            vals.append(float(data["position"]))
        blocks = None
        if "blocks" in data:
            try:
                blocks = clean_blocks(data["blocks"])
            except ValueError as e:
                return bad(str(e))
            sets.append("blocks=?")
            vals.append(json.dumps(blocks, ensure_ascii=False))
        if not sets:
            return bad("Nada que actualizar")
        stamp = now()
        sets += ["updated_at=?", "updated_by=?"]
        vals += [stamp, actor()]
        db.execute(f"UPDATE pages SET {', '.join(sets)} WHERE id=?", [*vals, pid])
        if blocks is not None:
            save_links(db, pid, blocks)
        return jsonify(page_out(db, db.execute("SELECT * FROM pages WHERE id=?", (pid,)).fetchone()))


@bp.delete("/api/pages/<int:pid>")
def delete_page(pid):
    with get_db() as db:
        row = db.execute("SELECT * FROM pages WHERE id=?", (pid,)).fetchone()
        if not row:
            return bad("No existe", 404)
        if row["created_by"] != actor() and not is_admin():
            return bad("Solo quien creó la página o administración pueden eliminarla", 403)
        db.execute("DELETE FROM pages WHERE id=?", (pid,))
        log(db, "page_deleted", project_id=row["project_id"], old=row["title"])
        return jsonify({"ok": True})
