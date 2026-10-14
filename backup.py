"""Copias de seguridad en caliente de la base SQLite (API de backup de sqlite3).

PANEL_TI_BACKUP_DIR: carpeta de destino (por defecto ./backups junto a la base).
PANEL_TI_BACKUP_KEEP: cuántas copias conservar (14 por defecto).
"""
import os
import re
import sqlite3
from datetime import datetime

from db import DB

BACKUP_DIR = os.environ.get("PANEL_TI_BACKUP_DIR", os.path.join(os.path.dirname(os.path.abspath(DB)), "backups"))
KEEP = int(os.environ.get("PANEL_TI_BACKUP_KEEP", 14))
NAME_RE = re.compile(r"^panel-ti-\d{8}-\d{6}\.db$")


def create_backup():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    name = f"panel-ti-{datetime.now():%Y%m%d-%H%M%S}.db"
    dest = os.path.join(BACKUP_DIR, name)
    src = sqlite3.connect(DB)
    try:
        out = sqlite3.connect(dest)
        try:
            src.backup(out)
        finally:
            out.close()
    finally:
        src.close()
    prune()
    return {"name": name, "size": os.path.getsize(dest), "created_at": datetime.now().isoformat(sep=" ", timespec="seconds")}


def list_backups():
    if not os.path.isdir(BACKUP_DIR):
        return []
    items = []
    for n in sorted(os.listdir(BACKUP_DIR), reverse=True):
        if NAME_RE.match(n):
            p = os.path.join(BACKUP_DIR, n)
            items.append({"name": n, "size": os.path.getsize(p),
                          "created_at": datetime.fromtimestamp(os.path.getmtime(p)).isoformat(sep=" ", timespec="seconds")})
    return items


def prune():
    for b in list_backups()[KEEP:]:
        try:
            os.remove(os.path.join(BACKUP_DIR, b["name"]))
        except OSError:
            pass


def backup_path(name):
    if not NAME_RE.match(name or ""):
        return None
    p = os.path.join(BACKUP_DIR, name)
    return p if os.path.exists(p) else None
