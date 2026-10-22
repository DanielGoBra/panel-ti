"""Almacén de archivos (adjuntos y copias de seguridad): carpeta local o Supabase Storage.

Con SUPABASE_URL y SUPABASE_SECRET_KEY los archivos van a un bucket privado
(SUPABASE_BUCKET, por defecto «panel-ti»), en las carpetas «adjuntos/» y «copias/».
Sin ellas se guardan en disco: PANEL_TI_UPLOADS y PANEL_TI_BACKUP_DIR.
"""
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

from db import DATA_DIR

UPLOAD_DIR = os.environ.get("PANEL_TI_UPLOADS", os.path.join(DATA_DIR, "uploads"))
BACKUP_DIR = os.environ.get("PANEL_TI_BACKUP_DIR", os.path.join(DATA_DIR, "backups"))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
BUCKET = os.environ.get("SUPABASE_BUCKET", "panel-ti").strip()


class StorageError(Exception):
    pass


class LocalStore:
    kind = "local"

    def __init__(self, root):
        self.root = root

    @property
    def location(self):
        return self.root

    def path(self, key):
        root = os.path.realpath(self.root)
        p = os.path.realpath(os.path.join(root, key))
        if not p.startswith(root + os.sep):
            raise StorageError("Ruta no válida")
        return p

    def put(self, key, data, mime="application/octet-stream"):
        p = self.path(key)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data)

    def get(self, key):
        p = self.path(key)
        if not os.path.isfile(p):
            return None
        with open(p, "rb") as f:
            return f.read()

    def delete(self, key):
        try:
            os.remove(self.path(key))
        except OSError:
            pass

    def list(self):
        """Archivos del primer nivel, del más reciente al más antiguo."""
        if not os.path.isdir(self.root):
            return []
        out = []
        for n in os.listdir(self.root):
            p = os.path.join(self.root, n)
            if os.path.isfile(p):
                out.append({"name": n, "size": os.path.getsize(p),
                            "created_at": datetime.fromtimestamp(os.path.getmtime(p)).isoformat(sep=" ", timespec="seconds")})
        return sorted(out, key=lambda x: x["name"], reverse=True)


class SupabaseStore:
    """Cliente mínimo de la API de Storage de Supabase (bucket privado, clave secreta del servidor)."""
    kind = "supabase"
    _bucket_ready = False
    _bucket_lock = threading.Lock()

    def __init__(self, prefix):
        self.prefix = prefix

    @property
    def location(self):
        return f"Supabase Storage · {BUCKET}/{self.prefix}"

    def _object(self, key):
        if ".." in key.split("/"):
            raise StorageError("Ruta no válida")
        return urllib.parse.quote(f"{self.prefix}/{key}")

    def _call(self, method, path, data=None, headers=None, missing_ok=False):
        h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", **(headers or {})}
        if isinstance(data, (dict, list)):
            data = json.dumps(data).encode()
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(f"{SUPABASE_URL}/storage/v1/{path}", data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode("utf-8", "replace")
            if missing_ok and (e.code == 404 or (e.code == 400 and "not" in detail.lower() and "found" in detail.lower())):
                return None
            raise StorageError(f"Supabase Storage respondió {e.code}: {detail}") from None
        except urllib.error.URLError as e:
            raise StorageError(f"No se pudo conectar con Supabase Storage: {e.reason}") from None

    def _ensure_bucket(self):
        if SupabaseStore._bucket_ready:
            return
        with SupabaseStore._bucket_lock:
            if SupabaseStore._bucket_ready:
                return
            try:
                self._call("POST", "bucket", {"id": BUCKET, "name": BUCKET, "public": False})
            except StorageError as e:
                if "already exists" not in str(e).lower() and "duplicate" not in str(e).lower():
                    raise
            SupabaseStore._bucket_ready = True

    def put(self, key, data, mime="application/octet-stream"):
        self._ensure_bucket()
        self._call("POST", f"object/{BUCKET}/{self._object(key)}", data,
                   {"Content-Type": mime or "application/octet-stream", "x-upsert": "true"})

    def get(self, key):
        return self._call("GET", f"object/{BUCKET}/{self._object(key)}", missing_ok=True)

    def delete(self, key):
        self._call("DELETE", f"object/{BUCKET}", {"prefixes": [f"{self.prefix}/{key}"]}, missing_ok=True)

    def list(self):
        rows = self._call("POST", f"object/list/{BUCKET}", {"prefix": self.prefix, "limit": 1000, "offset": 0,
                                                             "sortBy": {"column": "name", "order": "desc"}}, missing_ok=True)
        out = []
        for r in json.loads(rows or b"[]"):
            if r.get("id") is None:  # subcarpeta
                continue
            created = (r.get("created_at") or "")[:19].replace("T", " ")
            out.append({"name": r["name"], "size": (r.get("metadata") or {}).get("size", 0), "created_at": created})
        return sorted(out, key=lambda x: x["name"], reverse=True)


def supabase_enabled():
    return bool(SUPABASE_URL and SUPABASE_KEY)


def uploads():
    return SupabaseStore("adjuntos") if supabase_enabled() else LocalStore(UPLOAD_DIR)


def backups():
    return SupabaseStore("copias") if supabase_enabled() else LocalStore(BACKUP_DIR)
