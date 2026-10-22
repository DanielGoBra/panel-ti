"""Adjuntos y copias en Supabase Storage (servidor simulado), tareas programadas por URL y exportar/importar."""
import gzip
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dbenv  # noqa: E402

H = {"X-Requested-With": "panel-ti"}
KEY = "sb_secret_prueba"
CRON = "secreto-de-cron-para-pruebas"


class FakeStorage(BaseHTTPRequestHandler):
    """Lo justo de la API de Storage de Supabase: buckets, objetos y listado."""
    objects, buckets = {}, set()

    def log_message(self, *a):
        pass

    def _reply(self, code, body=b"", ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _auth(self):
        if self.headers.get("apikey") != KEY or self.headers.get("Authorization") != f"Bearer {KEY}":
            self._reply(403, {"error": "Unauthorized"})
            return False
        return True

    def _body(self):
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def do_POST(self):
        if not self._auth():
            return
        path, data = unquote(self.path), self._body()
        if path == "/storage/v1/bucket":
            b = json.loads(data)
            if b["id"] in self.buckets:
                return self._reply(400, {"statusCode": "409", "error": "Duplicate", "message": "The resource already exists"})
            assert b["public"] is False
            self.buckets.add(b["id"])
            return self._reply(200, {"name": b["id"]})
        if path.startswith("/storage/v1/object/list/"):
            bucket, prefix = path.rsplit("/", 1)[1], json.loads(data)["prefix"].rstrip("/") + "/"
            rows = [{"name": k[len(bucket) + 1 + len(prefix):], "id": k, "created_at": "2026-10-22T10:00:00Z",
                     "metadata": {"size": len(v)}} for k, v in self.objects.items() if k.startswith(f"{bucket}/{prefix}")]
            return self._reply(200, rows)
        key = path[len("/storage/v1/object/"):]
        if key.split("/")[0] not in self.buckets:
            return self._reply(400, {"statusCode": "404", "error": "Bucket not found"})
        self.objects[key] = data
        return self._reply(200, {"Key": key})

    def do_GET(self):
        if not self._auth():
            return
        key = unquote(self.path)[len("/storage/v1/object/"):]
        if key not in self.objects:
            return self._reply(400, {"statusCode": "404", "error": "not_found", "message": "Object not found"})
        return self._reply(200, self.objects[key], "application/octet-stream")

    def do_DELETE(self):
        if not self._auth():
            return
        bucket = unquote(self.path).rsplit("/", 1)[1]
        for p in json.loads(self._body())["prefixes"]:
            self.objects.pop(f"{bucket}/{p}", None)
        return self._reply(200, [])


class StorageCronTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeStorage)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.tmp = tempfile.TemporaryDirectory()
        dbenv.configure(cls.tmp.name)
        os.environ.update({"SUPABASE_URL": f"http://127.0.0.1:{cls.server.server_port}", "SUPABASE_SECRET_KEY": KEY,
                           "CRON_SECRET": CRON, "PANEL_TI_AI": "0"})
        os.environ.pop("PANEL_TI_NO_SEED", None)
        cls.app = dbenv.reload_app()
        cls.c = cls.app.app.test_client()
        r = cls.c.post("/api/auth/login", json={"email": "ana.torres@empresa.com", "password": "demo-panel-ti"}, headers=H)
        assert r.status_code == 200, r.get_json()

    @classmethod
    def tearDownClass(cls):
        dbenv.cleanup()
        for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "CRON_SECRET"):
            os.environ.pop(k, None)
        cls.server.shutdown()
        cls.tmp.cleanup()

    def task_id(self):
        return self.c.get("/api/bootstrap").get_json()["tasks"][0]["id"]

    def test_attachments_go_to_private_bucket(self):
        r = self.c.post(f"/api/tasks/{self.task_id()}/attachments", data={"file": (io.BytesIO(b"%PDF-1.4 acta"), "acta.pdf")},
                        headers=H, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 201, r.get_json())
        f = r.get_json()
        self.assertIn("panel-ti", FakeStorage.buckets)
        self.assertEqual(FakeStorage.objects[f"panel-ti/adjuntos/{f['stored_name']}"], b"%PDF-1.4 acta")
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "uploads")))
        got = self.c.get(f"/api/files/{f['id']}")
        self.assertEqual(got.data, b"%PDF-1.4 acta")
        self.assertEqual(got.mimetype, "application/pdf")
        self.assertEqual(self.c.delete(f"/api/files/{f['id']}", headers=H).status_code, 200)
        self.assertNotIn(f"panel-ti/adjuntos/{f['stored_name']}", FakeStorage.objects)

    def test_storage_failure_is_reported(self):
        os.environ["SUPABASE_SECRET_KEY"] = "otra"
        import storage
        storage.SUPABASE_KEY = "otra"
        try:
            r = self.c.post(f"/api/tasks/{self.task_id()}/attachments", data={"file": (io.BytesIO(b"x"), "a.txt")},
                            headers=H, content_type="multipart/form-data")
            self.assertEqual(r.status_code, 502)
        finally:
            os.environ["SUPABASE_SECRET_KEY"] = storage.SUPABASE_KEY = KEY

    def test_backups_in_storage(self):
        r = self.c.post("/api/admin/backup", headers=H)
        self.assertEqual(r.status_code, 201, r.get_json())
        name = r.get_json()["name"]
        self.assertIn(f"panel-ti/copias/{name}", FakeStorage.objects)
        st = self.c.get("/api/admin/status").get_json()
        self.assertIn(name, [b["name"] for b in st["backups"]])
        self.assertIn("Supabase Storage", st["backup_dir"])
        data = self.c.get(f"/api/admin/backups/{name}").data
        if name.endswith(".json.gz"):
            self.assertEqual(json.loads(gzip.decompress(data))["format"], "panel-ti")
        else:
            self.assertTrue(data.startswith(b"SQLite format 3"))
        self.assertEqual(self.c.get("/api/admin/backups/..%2Fsecreto").status_code, 404)

    def test_cron_endpoint(self):
        anon = self.app.app.test_client()
        self.assertEqual(anon.post("/api/cron").status_code, 401)
        self.assertEqual(anon.post("/api/cron", headers={"Authorization": "Bearer otro"}).status_code, 401)
        auth = {"Authorization": f"Bearer {CRON}"}
        self.assertEqual(anon.post("/api/cron?job=nada", headers=auth).status_code, 400)
        r = anon.post("/api/cron?job=sla", headers=auth)
        self.assertEqual(r.status_code, 200)
        self.assertIn("sla", r.get_json())
        # Sin forzar, un trabajo recién ejecutado espera a su intervalo
        self.assertNotIn("sla", anon.post("/api/cron", headers=auth).get_json())

    def test_export_import_roundtrip(self):
        import backup
        from db import get_db
        before = self.c.get("/api/bootstrap").get_json()
        with get_db() as db:
            data = backup.export_data(db)
        data = json.loads(json.dumps(data))  # como si viniera de un archivo
        with get_db() as db:
            with self.assertRaises(ValueError):
                backup.import_data(db, data)
        with get_db() as db:
            counts = backup.import_data(db, data, replace=True)
        self.assertEqual(counts["tasks"], len(before["tasks"]))
        after = self.c.get("/api/bootstrap").get_json()
        self.assertEqual({t["id"]: t["title"] for t in after["tasks"]}, {t["id"]: t["title"] for t in before["tasks"]})
        # Tras importar ids explícitos, las altas nuevas siguen numerando sin chocar
        r = self.c.post("/api/tasks", json={"title": "Alta tras importar"}, headers=H)
        self.assertEqual(r.status_code, 201, r.get_json())
        self.assertGreater(r.get_json()["id"], max(t["id"] for t in before["tasks"]))


if __name__ == "__main__":
    unittest.main()
