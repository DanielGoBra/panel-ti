"""Pruebas de la API. Ejecutar con: python3 -m unittest discover tests"""
import io
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dbenv  # noqa: E402
H = {"X-Requested-With": "panel-ti"}
PW = "demo-panel-ti"


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        dbenv.configure(cls.tmp.name)
        os.environ["PANEL_TI_AI"] = "0"
        os.environ.pop("PANEL_TI_NO_SEED", None)
        cls.app = dbenv.reload_app()
        cls.c = cls.login("ana.torres@empresa.com")

    @classmethod
    def login(cls, email):
        c = cls.app.app.test_client()
        r = c.post("/api/auth/login", json={"email": email, "password": PW}, headers=H)
        assert r.status_code == 200, r.get_json()
        return c

    @classmethod
    def tearDownClass(cls):
        dbenv.cleanup()
        cls.tmp.cleanup()

    def tasks(self):
        return {t["title"]: t for t in self.c.get("/api/bootstrap").get_json()["tasks"]}

    # ---------- Acceso ----------
    def test_requires_login_and_csrf(self):
        anon = self.app.app.test_client()
        self.assertEqual(anon.get("/api/bootstrap").status_code, 401)
        self.assertEqual(anon.post("/api/auth/login", json={"email": "ana.torres@empresa.com", "password": "mal"}, headers=H).status_code, 401)
        self.assertEqual(self.c.post("/api/tasks", json={"title": "Sin cabecera"}).status_code, 403)
        self.assertNotIn("password_hash", self.c.get("/api/members").get_json()[0])

    def test_viewer_is_read_only(self):
        v = self.login("elena.vidal@empresa.com")
        self.assertEqual(v.get("/api/bootstrap").status_code, 200)
        self.assertEqual(v.post("/api/tasks", json={"title": "x"}, headers=H).status_code, 403)
        self.assertEqual(v.post("/api/notifications/read", json={"all": True}, headers=H).status_code, 200)

    def test_member_cannot_admin(self):
        m = self.login("diego.herrera@empresa.com")
        self.assertEqual(m.post("/api/members", json={"name": "Otra"}, headers=H).status_code, 403)
        self.assertEqual(m.put("/api/settings", json={"workspace": "X"}, headers=H).status_code, 403)
        self.assertEqual(m.put("/api/settings", json={"wip_limits": {"in_progress": 5}}, headers=H).status_code, 200)

    def test_password_change_invalidates_old_session(self):
        r = self.c.post("/api/members", json={"name": "Prueba Clave", "email": "prueba.clave@empresa.com"}, headers=H).get_json()
        u = self.app.app.test_client()
        u.post("/api/auth/login", json={"email": "prueba.clave@empresa.com", "password": r["temp_password"]}, headers=H)
        other = self.app.app.test_client()
        other.post("/api/auth/login", json={"email": "prueba.clave@empresa.com", "password": r["temp_password"]}, headers=H)
        self.assertEqual(u.put("/api/auth/me", json={"current_password": r["temp_password"], "new_password": "nueva-clave-1"}, headers=H).status_code, 200)
        self.assertEqual(u.get("/api/bootstrap").status_code, 200)
        self.assertEqual(other.get("/api/bootstrap").status_code, 401)

    # ---------- Tareas y reglas ----------
    def test_task_lifecycle_and_activity(self):
        t = self.c.post("/api/tasks", json={"title": "Renovar certificado", "project_id": 1}, headers=H).get_json()
        self.assertEqual(t["created_by"], "Ana Torres")
        t = self.c.put(f"/api/tasks/{t['id']}", json={"status": "in_progress"}, headers=H).get_json()
        self.assertIsNotNone(t["started_at"])
        t = self.c.put(f"/api/tasks/{t['id']}", json={"status": "done"}, headers=H).get_json()
        self.assertIsNotNone(t["completed_at"])
        d = self.c.get(f"/api/tasks/{t['id']}").get_json()
        self.assertIn(("updated", "status", "Ana Torres"), [(a["action"], a["field"], a["actor"]) for a in d["activity"]])
        self.assertEqual(self.c.delete(f"/api/tasks/{t['id']}", headers=H).status_code, 200)

    def test_validation(self):
        self.assertEqual(self.c.post("/api/tasks", json={"title": "  "}, headers=H).status_code, 400)
        self.assertEqual(self.c.put("/api/tasks/1", json={"status": "archivada"}, headers=H).status_code, 400)

    def test_dependencies_block_progress_and_detect_cycles(self):
        a = self.c.post("/api/tasks", json={"title": "Dep A"}, headers=H).get_json()
        b = self.c.post("/api/tasks", json={"title": "Dep B"}, headers=H).get_json()
        self.assertEqual(self.c.post(f"/api/tasks/{b['id']}/deps", json={"depends_on": a["id"]}, headers=H).status_code, 200)
        self.assertEqual(self.c.post(f"/api/tasks/{a['id']}/deps", json={"depends_on": b["id"]}, headers=H).status_code, 400)
        self.assertEqual(self.c.put(f"/api/tasks/{b['id']}", json={"status": "in_progress"}, headers=H).status_code, 409)
        self.c.put(f"/api/tasks/{a['id']}", json={"status": "done"}, headers=H)
        self.assertEqual(self.c.put(f"/api/tasks/{b['id']}", json={"status": "in_progress"}, headers=H).status_code, 200)

    def test_subtasks_must_close_first(self):
        p = self.c.post("/api/tasks", json={"title": "Principal"}, headers=H).get_json()
        s = self.c.post("/api/tasks", json={"title": "Sub", "parent_id": p["id"]}, headers=H).get_json()
        self.assertEqual(self.c.post("/api/tasks", json={"title": "Nieta", "parent_id": s["id"]}, headers=H).status_code, 400)
        self.assertEqual(self.c.put(f"/api/tasks/{p['id']}", json={"status": "done"}, headers=H).status_code, 409)
        self.c.put(f"/api/tasks/{s['id']}", json={"status": "done"}, headers=H)
        self.assertEqual(self.c.put(f"/api/tasks/{p['id']}", json={"status": "done"}, headers=H).status_code, 200)

    def test_change_requires_cab_approval_by_someone_else(self):
        t = self.c.post("/api/tasks", json={"title": "Cambio de prueba", "type": "change"}, headers=H).get_json()
        self.assertEqual(self.c.put(f"/api/tasks/{t['id']}", json={"status": "in_progress"}, headers=H).status_code, 409)
        self.c.post(f"/api/tasks/{t['id']}/approval", json={"action": "request"}, headers=H)
        self.assertEqual(self.c.post(f"/api/tasks/{t['id']}/approval", json={"action": "approve"}, headers=H).status_code, 403)
        diego = self.login("diego.herrera@empresa.com")
        self.assertEqual(diego.post(f"/api/tasks/{t['id']}/approval", json={"action": "approve"}, headers=H).status_code, 403)
        luis = self.login("luis.perez@empresa.com")
        self.assertEqual(luis.post(f"/api/tasks/{t['id']}/approval", json={"action": "reject"}, headers=H).status_code, 400)
        r = luis.post(f"/api/tasks/{t['id']}/approval", json={"action": "approve", "comment": "Adelante"}, headers=H).get_json()
        self.assertEqual(r["approval_status"], "approved")
        self.assertEqual(self.c.put(f"/api/tasks/{t['id']}", json={"status": "in_progress"}, headers=H).status_code, 200)

    def test_sla_is_computed_for_incidents(self):
        t = self.c.post("/api/tasks", json={"title": "Caída", "type": "incident", "priority": "critical"}, headers=H).get_json()
        self.assertEqual(t["sla"]["state"], "ok")
        self.assertEqual(t["sla"]["policy"]["resolve_h"], 4)
        self.assertIsNone(self.c.post("/api/tasks", json={"title": "Normal"}, headers=H).get_json()["sla"])

    def test_mentions_notify(self):
        t = self.c.post("/api/tasks", json={"title": "Con mención"}, headers=H).get_json()
        self.c.post(f"/api/tasks/{t['id']}/comments", json={"body": "@Marta Ruiz échale un ojo"}, headers=H)
        marta = self.login("marta.ruiz@empresa.com")
        kinds = [n["kind"] for n in marta.get("/api/notifications").get_json()["items"]]
        self.assertIn("mention", kinds)

    def test_recurrence_creates_next_task(self):
        import automation
        t = self.c.post("/api/tasks", json={"title": "Copia semanal", "due_date": "2000-01-03"}, headers=H).get_json()
        self.c.put(f"/api/tasks/{t['id']}/recurrence", json={"rule": "weekly"}, headers=H)
        automation.run_due_jobs(force="recurrence")
        copies = [x for x in self.c.get("/api/tasks?q=Copia%20semanal").get_json() if x["id"] != t["id"]]
        self.assertGreater(len(copies), 0)

    def test_bulk_reports_rule_errors(self):
        t = self.c.post("/api/tasks", json={"title": "Cambio bulk", "type": "change"}, headers=H).get_json()
        res = self.c.post("/api/tasks/bulk", json={"ids": [t["id"]], "changes": {"status": "in_progress"}}, headers=H).get_json()
        self.assertEqual(len(res["errors"]), 1)

    # ---------- Páginas, archivos, activos ----------
    def test_pages_link_task_keys(self):
        p = self.c.post("/api/pages", json={"title": "Notas", "blocks": [{"type": "p", "text": "Ver NUB-1 y SEG-2"}]}, headers=H).get_json()
        self.assertEqual(len(p["linked_tasks"]), 2)
        bad = self.c.put(f"/api/pages/{p['id']}", json={"parent_id": p["id"]}, headers=H)
        self.assertEqual(bad.status_code, 400)

    def test_attachments(self):
        t = self.c.post("/api/tasks", json={"title": "Con adjunto"}, headers=H).get_json()
        r = self.c.post(f"/api/tasks/{t['id']}/attachments", data={"file": (io.BytesIO(b"linea de log"), "error.log")},
                        headers=H, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 201)
        f = self.c.get(f"/api/files/{r.get_json()['id']}")
        self.assertEqual(f.data, b"linea de log")
        f.close()
        r = self.c.post(f"/api/tasks/{t['id']}/attachments", data={"file": (io.BytesIO(b"x"), "malo.exe")},
                        headers=H, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 400)

    def test_template_creates_checklist_and_subtasks(self):
        tpl = next(x for x in self.c.get("/api/templates").get_json() if x["name"] == "Parcheo mensual de servidores")
        t = self.c.post(f"/api/templates/{tpl['id']}/apply", json={}, headers=H).get_json()
        self.assertEqual(t["subtask_total"], 3)
        self.assertGreater(t["checklist_total"], 0)

    def test_assets(self):
        a = self.c.post("/api/assets", json={"name": "SRV-TEST", "kind": "server"}, headers=H).get_json()
        t = self.c.post("/api/tasks", json={"title": "En activo"}, headers=H).get_json()
        self.c.put(f"/api/tasks/{t['id']}/assets", json={"asset_ids": [a["id"]]}, headers=H)
        self.assertEqual(len(self.c.get(f"/api/assets/{a['id']}").get_json()["tasks"]), 1)

    # ---------- IA local, entrada externa, informes ----------
    def test_local_query_and_classify(self):
        f = self.c.post("/api/ai/query", json={"q": "qué tiene bloqueado Carla"}, headers=H).get_json()["filters"]
        self.assertEqual((f["assignee"], f["statuses"]), ("Carla Méndez", ["blocked"]))
        s = self.c.post("/api/ai/classify", json={"title": "La VPN no funciona", "notes": "urgente"}, headers=H).get_json()
        self.assertEqual(s["suggestion"]["type"], "incident")

    def test_inbound_requires_token(self):
        self.assertEqual(self.app.app.test_client().post("/api/inbound/nada", json={"subject": "x"}).status_code, 403)
        tok = self.c.put("/api/settings", json={"inbound_token": "regenerate"}, headers=H).get_json()["inbound_token"]
        r = self.app.app.test_client().post(f"/api/inbound/{tok}", json={"subject": "Pantalla rota", "from": "x@y.com"})
        self.assertEqual(r.status_code, 201)

    def test_metrics_reports_exports_backup(self):
        m = self.c.get("/api/metrics").get_json()
        self.assertEqual(len(m["flow"]), 12)
        self.assertIn("compliance_pct", m["sla"])
        r = self.c.get("/api/report").get_json()
        self.assertIn("delay_risks", r)
        for fmt in ("docx", "xlsx"):
            self.assertGreater(len(self.c.get(f"/api/export/{fmt}").data), 1000)
        self.assertTrue(self.c.get("/api/export/tasks.csv").data.decode("utf-8-sig").startswith("Clave;Título"))
        self.assertEqual(self.c.post("/api/admin/backup", headers=H).status_code, 201)

    def test_sync_revision_increments(self):
        r0 = self.c.get("/api/sync").get_json()["revision"]
        self.c.post("/api/tasks", json={"title": "Rev"}, headers=H)
        self.assertGreater(self.c.get("/api/sync").get_json()["revision"], r0)


if __name__ == "__main__":
    unittest.main()
