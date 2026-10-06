import json
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory, send_file
from db import get_db, init_db
from export_docx import build_docx
from export_xlsx import build_xlsx

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["JSON_AS_ASCII"] = False

@app.before_request
def ensure_db():
    init_db()

# ---------- Pages ----------
@app.route("/")
def index():
    return send_from_directory("static", "index.html")

# ---------- Projects ----------
@app.get("/api/projects")
def list_projects():
    with get_db() as db:
        rows = db.execute("SELECT * FROM projects ORDER BY id DESC").fetchall()
        return jsonify([dict(r) for r in rows])

@app.post("/api/projects")
def create_project():
    data = request.get_json(force=True)
    if not data.get("name", "").strip():
        return jsonify({"error": "El nombre es obligatorio"}), 400
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO projects (name, description, color, status, owner) VALUES (?,?,?,?,?)",
            (data["name"].strip(), data.get("description", ""), data.get("color", "#5b5bd6"),
             data.get("status", "active"), data.get("owner", "")))
        row = db.execute("SELECT * FROM projects WHERE id=?", (cur.lastrowid,)).fetchone()
        return jsonify(dict(row)), 201

@app.put("/api/projects/<int:pid>")
def update_project(pid):
    data = request.get_json(force=True)
    fields = ["name", "description", "color", "status", "owner"]
    sets, vals = [], []
    for f in fields:
        if f in data:
            sets.append(f"{f}=?")
            vals.append(data[f])
    if not sets:
        return jsonify({"error": "Nada que actualizar"}), 400
    vals.append(pid)
    with get_db() as db:
        db.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id=?", vals)
        row = db.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        return jsonify(dict(row))

@app.delete("/api/projects/<int:pid>")
def delete_project(pid):
    with get_db() as db:
        db.execute("DELETE FROM projects WHERE id=?", (pid,))
        return jsonify({"ok": True})

# ---------- Tasks ----------
@app.get("/api/tasks")
def list_tasks():
    pid = request.args.get("project_id")
    with get_db() as db:
        if pid:
            rows = db.execute("SELECT * FROM tasks WHERE project_id=? ORDER BY id DESC", (pid,)).fetchall()
        else:
            rows = db.execute("SELECT * FROM tasks ORDER BY id DESC").fetchall()
        return jsonify([dict(r) for r in rows])

@app.post("/api/tasks")
def create_task():
    data = request.get_json(force=True)
    if not data.get("title", "").strip():
        return jsonify({"error": "El título es obligatorio"}), 400
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO tasks (project_id, title, notes, status, priority, assignee, due_date, tags)
               VALUES (?,?,?,?,?,?,?,?)""",
            (data.get("project_id"), data["title"].strip(), data.get("notes", ""),
             data.get("status", "todo"), data.get("priority", "medium"),
             data.get("assignee", ""), data.get("due_date", ""), data.get("tags", "")))
        row = db.execute("SELECT * FROM tasks WHERE id=?", (cur.lastrowid,)).fetchone()
        return jsonify(dict(row)), 201

@app.put("/api/tasks/<int:tid>")
def update_task(tid):
    data = request.get_json(force=True)
    fields = ["project_id", "title", "notes", "status", "priority", "assignee", "due_date", "tags"]
    sets, vals = [], []
    for f in fields:
        if f in data:
            sets.append(f"{f}=?")
            vals.append(data[f])
    if "status" in data:
        sets.append("completed_at=?")
        vals.append(datetime.now().isoformat(timespec="seconds") if data["status"] == "done" else None)
    if not sets:
        return jsonify({"error": "Nada que actualizar"}), 400
    sets.append("updated_at=?")
    vals.append(datetime.now().isoformat(timespec="seconds"))
    vals.append(tid)
    with get_db() as db:
        db.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id=?", vals)
        row = db.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        return jsonify(dict(row))

@app.delete("/api/tasks/<int:tid>")
def delete_task(tid):
    with get_db() as db:
        db.execute("DELETE FROM tasks WHERE id=?", (tid,))
        return jsonify({"ok": True})

# ---------- Reports ----------
def build_report_json(start=None, end=None):
    today = datetime.now().date()
    start = start or str(today - timedelta(days=30))
    end = end or str(today)

    with get_db() as db:
        tasks = db.execute("SELECT * FROM tasks WHERE date(created_at) BETWEEN ? AND ? OR date(updated_at) BETWEEN ? AND ?",
                           (start, end, start, end)).fetchall()
        projects = db.execute("SELECT * FROM projects").fetchall()
        tasks = [dict(t) for t in tasks]
        projects = {p["id"]: dict(p) for p in projects}

    total = len(tasks)
    by_status = {"todo": 0, "in_progress": 0, "done": 0, "blocked": 0}
    by_priority = {"low": 0, "medium": 0, "high": 0, "critical": 0}
    by_project = {}
    overdue = []
    done_last_period = []

    for t in tasks:
        by_status[t["status"]] = by_status.get(t["status"], 0) + 1
        by_priority[t["priority"]] = by_priority.get(t["priority"], 0) + 1
        pid = t["project_id"] or 0
        bucket = by_project.setdefault(pid, {"name": projects.get(pid, {}).get("name", "Sin proyecto"), "total": 0, "done": 0, "open": 0, "blocked": 0})
        bucket["total"] += 1
        if t["status"] == "done":
            bucket["done"] += 1
            done_last_period.append(t)
        else:
            bucket["open"] += 1
            if t["status"] == "blocked":
                bucket["blocked"] += 1
            if t["due_date"] and t["due_date"] < end:
                overdue.append(t)

    completion = round(100 * by_status["done"] / total, 1) if total else 0
    report = {
        "title": "Informe de Comité de TI",
        "period": {"start": start, "end": end},
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "kpis": {
            "total_tasks": total,
            "done": by_status["done"],
            "in_progress": by_status["in_progress"],
            "blocked": by_status["blocked"],
            "todo": by_status["todo"],
            "completion_pct": completion,
            "overdue": len(overdue),
            "projects_tracked": len(by_project),
        },
        "by_priority": by_priority,
        "by_project": list(by_project.values()),
        "overdue_tasks": [{"title": t["title"], "due_date": t["due_date"], "priority": t["priority"]} for t in overdue],
        "blocked_tasks": [{"title": t["title"], "assignee": t["assignee"], "priority": t["priority"]} for t in tasks if t["status"] == "blocked"],
    }
    return report

@app.get("/api/report")
def build_report():
    return jsonify(build_report_json(request.args.get("start"), request.args.get("end")))

@app.get("/api/export/docx")
def export_docx_route():
    report = build_report_json(request.args.get("start"), request.args.get("end"))
    buf = build_docx(report)
    return send_file(buf, as_attachment=True, download_name="informe-comite-ti.docx",
                     mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")

@app.get("/api/export/xlsx")
def export_xlsx_route():
    report = build_report_json(request.args.get("start"), request.args.get("end"))
    buf = build_xlsx(report)
    return send_file(buf, as_attachment=True, download_name="informe-comite-ti.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

@app.post("/api/reports")
def save_report():
    data = request.get_json(force=True)
    with get_db() as db:
        cur = db.execute("INSERT INTO report_snapshots (title, period_start, period_end, payload) VALUES (?,?,?,?)",
                         (data.get("title", "Informe"), data["period"]["start"], data["period"]["end"], json.dumps(data, ensure_ascii=False)))
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
            return jsonify({"error": "No existe"}), 404
        return jsonify(json.loads(row["payload"]))

if __name__ == "__main__":
    app.run(debug=False, port=5000)
