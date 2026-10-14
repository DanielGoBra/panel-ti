import os
import sqlite3
from contextlib import contextmanager

STATUSES = ("todo", "in_progress", "review", "blocked", "done")
PRIORITIES = ("low", "medium", "high", "critical")
TYPES = ("task", "incident", "change", "request", "improvement")
ROLES = ("admin", "member", "viewer")

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
    role TEXT DEFAULT 'member',
    title TEXT DEFAULT '',
    team TEXT DEFAULT '',
    capacity INTEGER DEFAULT 8,
    password_hash TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    is_cab INTEGER DEFAULT 0,
    notify_email INTEGER DEFAULT 1,
    sso_subject TEXT DEFAULT '',
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    number INTEGER DEFAULT 0,
    title TEXT NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'todo' CHECK(status IN ({",".join(f"'{s}'" for s in STATUSES)})),
    priority TEXT DEFAULT 'medium' CHECK(priority IN ({",".join(f"'{p}'" for p in PRIORITIES)})),
    type TEXT DEFAULT 'task',
    assignee TEXT DEFAULT '',
    created_by TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    estimate REAL,
    tags TEXT DEFAULT '',
    custom TEXT DEFAULT '{{}}',
    approval_status TEXT DEFAULT '',
    recurrence_id INTEGER,
    position REAL DEFAULT 0,
    alert_flags TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    started_at TEXT,
    responded_at TEXT,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_deps (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on)
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

CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    actor TEXT DEFAULT '',
    decision TEXT NOT NULL,
    comment TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    uploaded_by TEXT DEFAULT '',
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

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    task_id INTEGER,
    page_id INTEGER,
    actor TEXT DEFAULT '',
    read_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    kind TEXT DEFAULT 'page',
    blocks TEXT DEFAULT '[]',
    position REAL DEFAULT 0,
    created_by TEXT DEFAULT '',
    updated_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS page_tasks (
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (page_id, task_id)
);

CREATE TABLE IF NOT EXISTS custom_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    options TEXT DEFAULT '[]',
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    position REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'task',
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{{}}',
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS recurrences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload TEXT NOT NULL,
    rule TEXT NOT NULL,
    next_date TEXT NOT NULL,
    due_offset_days INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_by TEXT DEFAULT '',
    last_task_id INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT DEFAULT 'server',
    identifier TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    location TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    criticality TEXT DEFAULT 'medium',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS task_assets (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, asset_id)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS state (
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
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist_items(task_id);
CREATE INDEX IF NOT EXISTS idx_notifications_member ON notifications(member_id, read_at);
CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
"""

DB = os.environ.get("PANEL_TI_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.db"))


def connect():
    conn = sqlite3.connect(DB, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    return conn


@contextmanager
def get_db():
    """Conexión por operación: confirma al salir, deshace si hay error y siempre cierra."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _columns(conn, table):
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


# Columnas añadidas después de la primera versión: (tabla, columna, declaración)
ADDED_COLUMNS = [
    ("projects", "key", "TEXT DEFAULT ''"),
    ("projects", "area", "TEXT DEFAULT ''"),
    ("projects", "due_date", "TEXT DEFAULT ''"),
    ("members", "title", "TEXT DEFAULT ''"),
    ("members", "password_hash", "TEXT DEFAULT ''"),
    ("members", "active", "INTEGER DEFAULT 1"),
    ("members", "is_cab", "INTEGER DEFAULT 0"),
    ("members", "notify_email", "INTEGER DEFAULT 1"),
    ("members", "sso_subject", "TEXT DEFAULT ''"),
    ("members", "last_login", "TEXT"),
    ("tasks", "parent_id", "INTEGER REFERENCES tasks(id) ON DELETE CASCADE"),
    ("tasks", "created_by", "TEXT DEFAULT ''"),
    ("tasks", "custom", "TEXT DEFAULT '{}'"),
    ("tasks", "approval_status", "TEXT DEFAULT ''"),
    ("tasks", "recurrence_id", "INTEGER"),
    ("tasks", "alert_flags", "TEXT DEFAULT ''"),
    ("tasks", "responded_at", "TEXT"),
]


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
            shared = ", ".join(sorted(old_cols & _columns(conn, "tasks")))
            conn.execute(f"INSERT INTO tasks ({shared}) SELECT {shared} FROM tasks_old")
            conn.execute("DROP TABLE tasks_old")
            conn.execute("PRAGMA foreign_keys = ON")

    # Columna 'role' de la versión anterior de members significaba "puesto"
    if "members" in tables:
        cols = _columns(conn, "members")
        if "role" in cols and "title" not in cols:
            conn.execute("ALTER TABLE members ADD COLUMN title TEXT DEFAULT ''")
            conn.execute("UPDATE members SET title = role, role = 'member'")

    for table, col, decl in ADDED_COLUMNS:
        if table in tables and col not in _columns(conn, table):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")

    conn.executescript(SCHEMA)

    # Valores derivados para datos heredados
    for p in conn.execute("SELECT id, name FROM projects WHERE key IS NULL OR key=''").fetchall():
        conn.execute("UPDATE projects SET key=? WHERE id=?", (make_key(p["name"]), p["id"]))
    conn.execute("UPDATE tasks SET position = id * 1024 WHERE position IS NULL OR position = 0")
    for t in conn.execute("SELECT id, project_id FROM tasks WHERE number IS NULL OR number = 0 ORDER BY id").fetchall():
        conn.execute("UPDATE tasks SET number=? WHERE id=?", (next_number(conn, t["project_id"]), t["id"]))
    conn.execute("UPDATE tasks SET type='task' WHERE type IS NULL OR type=''")
    conn.execute("UPDATE tasks SET custom='{}' WHERE custom IS NULL OR custom=''")
    conn.execute("UPDATE members SET role='member' WHERE role IS NULL OR role NOT IN ('admin','member','viewer')")
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
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        _migrate(conn)
        conn.commit()
    finally:
        conn.close()
