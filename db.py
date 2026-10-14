import os
import sqlite3

STATUSES = ("todo", "in_progress", "review", "blocked", "done")
PRIORITIES = ("low", "medium", "high", "critical")
TYPES = ("task", "incident", "change", "request", "improvement")

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key TEXT DEFAULT '',
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#2a78d6',
    status TEXT DEFAULT 'active',
    owner TEXT DEFAULT '',
    area TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    email TEXT DEFAULT '',
    role TEXT DEFAULT '',
    team TEXT DEFAULT '',
    capacity INTEGER DEFAULT 8,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER DEFAULT 0,
    title TEXT NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'todo' CHECK(status IN ({",".join(f"'{s}'" for s in STATUSES)})),
    priority TEXT DEFAULT 'medium' CHECK(priority IN ({",".join(f"'{p}'" for p in PRIORITIES)})),
    type TEXT DEFAULT 'task',
    assignee TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    estimate REAL,
    tags TEXT DEFAULT '',
    position REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    position REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author TEXT DEFAULT '',
    body TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    project_id INTEGER,
    actor TEXT DEFAULT '',
    action TEXT NOT NULL,
    field TEXT DEFAULT '',
    old_value TEXT DEFAULT '',
    new_value TEXT DEFAULT '',
    task_title TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, position);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist_items(task_id);
"""

DB = os.environ.get("PANEL_TI_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.db"))


def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _columns(conn, table):
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


def _migrate(conn):
    """Actualiza bases creadas por versiones anteriores sin perder datos."""
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "tasks" in tables:
        sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='tasks'").fetchone()["sql"]
        if "'review'" not in sql:
            # El CHECK de estado antiguo no admite 'review': se reconstruye la tabla.
            old_cols = _columns(conn, "tasks")
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("ALTER TABLE tasks RENAME TO tasks_old")
            conn.executescript(SCHEMA)
            new_cols = _columns(conn, "tasks")
            shared = ", ".join(sorted(old_cols & new_cols))
            conn.execute(f"INSERT INTO tasks ({shared}) SELECT {shared} FROM tasks_old")
            conn.execute("DROP TABLE tasks_old")
            conn.execute("PRAGMA foreign_keys = ON")

    conn.executescript(SCHEMA)

    add = {
        "projects": {"key": "TEXT DEFAULT ''", "area": "TEXT DEFAULT ''", "due_date": "TEXT DEFAULT ''"},
    }
    for table, cols in add.items():
        existing = _columns(conn, table)
        for name, decl in cols.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")

    # Valores derivados para datos heredados
    for p in conn.execute("SELECT id, name FROM projects WHERE key IS NULL OR key=''").fetchall():
        conn.execute("UPDATE projects SET key=? WHERE id=?", (make_key(p["name"]), p["id"]))
    conn.execute("UPDATE tasks SET position = id * 1024 WHERE position IS NULL OR position = 0")
    for t in conn.execute("SELECT id, project_id FROM tasks WHERE number IS NULL OR number = 0 ORDER BY id").fetchall():
        conn.execute("UPDATE tasks SET number=? WHERE id=?", (next_number(conn, t["project_id"]), t["id"]))
    conn.execute("UPDATE tasks SET type='task' WHERE type IS NULL OR type=''")
    # Directorio de personas a partir de responsables ya usados
    if not conn.execute("SELECT COUNT(*) FROM members").fetchone()[0]:
        names = {r[0].strip() for r in conn.execute(
            "SELECT assignee FROM tasks UNION SELECT owner FROM projects") if r[0] and r[0].strip()}
        for n in sorted(names):
            conn.execute("INSERT OR IGNORE INTO members (name) VALUES (?)", (n,))


def make_key(name):
    words = [w for w in "".join(c if c.isalpha() or c == " " else " " for c in name).split() if len(w) > 2] or name.split()
    if len(words) >= 2:
        key = "".join(w[0] for w in words[:3])
    else:
        key = (words[0] if words else "TI")[:3]
    key = key.upper()
    for a, b in zip("ÁÉÍÓÚÑ", "AEIOUN"):
        key = key.replace(a, b)
    return key or "TI"


def next_number(conn, project_id):
    if project_id:
        row = conn.execute("SELECT COALESCE(MAX(number),0) FROM tasks WHERE project_id=?", (project_id,)).fetchone()
    else:
        row = conn.execute("SELECT COALESCE(MAX(number),0) FROM tasks WHERE project_id IS NULL").fetchone()
    return row[0] + 1


def init_db():
    conn = get_db()
    try:
        _migrate(conn)
        conn.commit()
    finally:
        conn.close()
