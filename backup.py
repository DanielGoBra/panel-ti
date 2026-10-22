"""Copias de seguridad, exportación e importación de datos.

SQLite: copia en caliente del archivo (.db, API de backup de sqlite3).
PostgreSQL: exportación de todas las tablas a JSON comprimido (.json.gz).
Las copias van al almacén de copias: carpeta local o Supabase Storage (ver storage.py).
PANEL_TI_BACKUP_KEEP: cuántas copias conservar (14 por defecto).
"""
import gzip
import json
import os
import re
import sqlite3
import tempfile
from datetime import datetime

import storage
from db import DB, DIALECT, ID_TABLES, PG_SCHEMA, TABLES, SqliteConnection, _columns, connect

KEEP = int(os.environ.get("PANEL_TI_BACKUP_KEEP", 14))
NAME_RE = re.compile(r"^panel-ti-\d{8}-\d{6}\.(db|json\.gz)$")
FORMAT = "panel-ti"


# ---------- Exportar / importar ----------
def export_data(conn):
    """Todas las tablas como {tabla: {columns, rows}}; sirve para cualquier motor."""
    tables = {}
    for t in TABLES:
        rows = conn.execute(f"SELECT * FROM {t}" + (" ORDER BY id" if t in ID_TABLES else "")).fetchall()
        cols = list(rows[0].keys()) if rows else []
        tables[t] = {"columns": cols, "rows": [list(r) for r in rows]}
    return {"format": FORMAT, "version": 1, "created_at": datetime.now().isoformat(sep=" ", timespec="seconds"),
            "source": conn.dialect, "tables": tables}


def has_data(conn):
    return any(conn.execute(f"SELECT 1 FROM {t} LIMIT 1").fetchone() for t in ("members", "projects", "tasks", "pages"))


def import_data(conn, data, replace=False):
    """Carga una exportación en la base actual. Devuelve {tabla: filas}."""
    if data.get("format") != FORMAT:
        raise ValueError("El archivo no es una exportación de Panel TI")
    if has_data(conn) and not replace:
        raise ValueError("La base de destino ya tiene datos. Usa --replace para sustituirlos.")
    if conn.dialect == "postgres":
        conn.execute("SET CONSTRAINTS ALL DEFERRED")
    else:
        conn.execute("PRAGMA defer_foreign_keys = ON")
    for t in reversed(TABLES):
        conn.execute(f"DELETE FROM {t}")
    counts = {}
    for t in TABLES:
        src = data["tables"].get(t) or {}
        cols = [c for c in src.get("columns", []) if c in _columns(conn, t)]
        if not cols or not src.get("rows"):
            continue
        pick = [src["columns"].index(c) for c in cols]
        rows = [[r[i] for i in pick] for r in src["rows"]]
        per = max(1, min(200, 30000 // len(cols)))  # varias filas por sentencia: menos viajes a la red
        for i in range(0, len(rows), per):
            chunk = rows[i:i + per]
            values = ", ".join(["(" + ", ".join("?" * len(cols)) + ")"] * len(chunk))
            conn.execute(f"INSERT INTO {t} ({', '.join(cols)}) VALUES {values}", [v for r in chunk for v in r])
        counts[t] = len(rows)
    if conn.dialect == "postgres":
        # Los ids importados son explícitos: el contador debe seguir desde el mayor
        for t in ID_TABLES:
            conn.execute(f"SELECT setval(pg_get_serial_sequence(?, 'id'), COALESCE((SELECT MAX(id) FROM {t}), 0) + 1, false)",
                         (f"{PG_SCHEMA}.{t}",))
    return counts


def read_export(path):
    """Lee una exportación (.json o .json.gz) o una base SQLite (.db) y devuelve la exportación."""
    with open(path, "rb") as f:
        head = f.read(16)
    if head.startswith(b"SQLite format 3"):
        src = sqlite3.connect(f"file:{path}?mode=ro", uri=True, factory=SqliteConnection)
        src.row_factory = sqlite3.Row
        try:
            return export_data(src)
        finally:
            src.close()
    with open(path, "rb") as f:
        raw = f.read()
    return json.loads(gzip.decompress(raw) if head[:2] == b"\x1f\x8b" else raw)


# ---------- Copias ----------
def _snapshot():
    stamp = f"{datetime.now():%Y%m%d-%H%M%S}"
    if DIALECT == "postgres":
        conn = connect()
        try:
            data = export_data(conn)
        finally:
            conn.close()
        return f"panel-ti-{stamp}.json.gz", gzip.compress(json.dumps(data, ensure_ascii=False).encode()), "application/gzip"
    with tempfile.TemporaryDirectory() as tmp:
        dest = os.path.join(tmp, "copia.db")
        src = sqlite3.connect(DB)
        try:
            out = sqlite3.connect(dest)
            try:
                src.backup(out)
            finally:
                out.close()
        finally:
            src.close()
        with open(dest, "rb") as f:
            return f"panel-ti-{stamp}.db", f.read(), "application/vnd.sqlite3"


def create_backup():
    name, data, mime = _snapshot()
    storage.backups().put(name, data, mime)
    prune()
    return {"name": name, "size": len(data), "created_at": datetime.now().isoformat(sep=" ", timespec="seconds")}


def list_backups():
    return [b for b in storage.backups().list() if NAME_RE.match(b["name"])]


def prune():
    store = storage.backups()
    for b in list_backups()[KEEP:]:
        try:
            store.delete(b["name"])
        except storage.StorageError:
            pass


def read_backup(name):
    if not NAME_RE.match(name or ""):
        return None
    return storage.backups().get(name)
