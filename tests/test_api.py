"""Pruebas de la API. Ejecutar con: python3 -m unittest discover tests"""
import importlib
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ["PANEL_TI_DB"] = os.path.join(cls.tmp.name, "test.db")
        for mod in ("db", "seed", "app"):
            if mod in sys.modules:
                importlib.reload(sys.modules[mod])
        import app
        cls.app = app
        cls.c = app.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_bootstrap_has_demo_data(self):
        b = self.c.get("/api/bootstrap").get_json()
        self.assertGreater(len(b["projects"]), 0)
        self.assertGreater(len(b["members"]), 0)
        self.assertGreater(len(b["tasks"]), 0)
        self.assertIn("wip_limits", b["settings"])

    def test_task_lifecycle_and_activity(self):
        h = {"X-User": "Ana%20Torres"}
        t = self.c.post("/api/tasks", json={"title": "Renovar certificado", "project_id": 1}, headers=h).get_json()
        self.assertEqual(t["status"], "todo")
        self.assertGreater(t["number"], 0)
        t = self.c.put(f"/api/tasks/{t['id']}", json={"status": "in_progress"}, headers=h).get_json()
        self.assertIsNotNone(t["started_at"])
        t = self.c.put(f"/api/tasks/{t['id']}", json={"status": "done"}, headers=h).get_json()
        self.assertIsNotNone(t["completed_at"])
        d = self.c.get(f"/api/tasks/{t['id']}").get_json()
        actions = [(a["action"], a["field"], a["actor"]) for a in d["activity"]]
        self.assertIn(("updated", "status", "Ana Torres"), actions)
        self.assertIn(("created", "", "Ana Torres"), actions)
        self.assertEqual(self.c.delete(f"/api/tasks/{t['id']}").status_code, 200)
        self.assertEqual(self.c.get(f"/api/tasks/{t['id']}").status_code, 404)

    def test_validation(self):
        self.assertEqual(self.c.post("/api/tasks", json={"title": "  "}).status_code, 400)
        self.assertEqual(self.c.put("/api/tasks/1", json={"status": "archivada"}).status_code, 400)
        self.assertEqual(self.c.put("/api/tasks/1", json={"estimate": "mucho"}).status_code, 400)

    def test_checklist_and_comments_counts(self):
        t = self.c.post("/api/tasks", json={"title": "Con checklist"}).get_json()
        item = self.c.post(f"/api/tasks/{t['id']}/checklist", json={"text": "Paso 1"}).get_json()
        self.c.put(f"/api/checklist/{item['id']}", json={"done": True})
        self.c.post(f"/api/tasks/{t['id']}/comments", json={"body": "Hecho el paso 1"})
        rows = self.c.get("/api/tasks?q=Con%20checklist").get_json()
        self.assertEqual((rows[0]["checklist_total"], rows[0]["checklist_done"], rows[0]["comment_count"]), (1, 1, 1))
        dup = self.c.post(f"/api/tasks/{t['id']}/duplicate").get_json()
        self.assertEqual(self.c.get(f"/api/tasks/{dup['id']}").get_json()["checklist"][0]["done"], 0)

    def test_project_change_renumbers(self):
        t = self.c.post("/api/tasks", json={"title": "Mover", "project_id": 1}).get_json()
        moved = self.c.put(f"/api/tasks/{t['id']}", json={"project_id": 2}).get_json()
        others = [x["number"] for x in self.c.get("/api/tasks?project_id=2").get_json() if x["id"] != t["id"]]
        self.assertNotIn(moved["number"], others)

    def test_bulk(self):
        ids = [t["id"] for t in self.c.get("/api/tasks").get_json()[:3]]
        res = self.c.post("/api/tasks/bulk", json={"ids": ids, "changes": {"priority": "low"}}).get_json()
        self.assertTrue(all(t["priority"] == "low" for t in res))

    def test_member_rename_updates_assignments(self):
        m = self.c.post("/api/members", json={"name": "Persona Temporal"}).get_json()
        t = self.c.post("/api/tasks", json={"title": "Asignada", "assignee": "Persona Temporal"}).get_json()
        self.c.put(f"/api/members/{m['id']}", json={"name": "Persona Renombrada"})
        self.assertEqual(self.c.get(f"/api/tasks/{t['id']}").get_json()["assignee"], "Persona Renombrada")
        self.assertEqual(self.c.post("/api/members", json={"name": "persona renombrada"}).status_code, 400)

    def test_metrics_and_reports(self):
        m = self.c.get("/api/metrics").get_json()
        self.assertEqual(len(m["flow"]), 12)
        self.assertIn("median_cycle_days", m["kpis"])
        r = self.c.get("/api/report").get_json()
        self.assertIn("review", r["kpis"])
        for fmt in ("docx", "xlsx"):
            res = self.c.get(f"/api/export/{fmt}")
            self.assertEqual(res.status_code, 200)
            self.assertGreater(len(res.data), 1000)
        csv = self.c.get("/api/export/tasks.csv").data.decode("utf-8-sig")
        self.assertTrue(csv.startswith("Clave;Título"))

    def test_settings(self):
        s = self.c.put("/api/settings", json={"wip_limits": {"in_progress": 3}, "ignorado": 1}).get_json()
        self.assertEqual(s["wip_limits"]["in_progress"], 3)
        self.assertNotIn("ignorado", s)


if __name__ == "__main__":
    unittest.main()
