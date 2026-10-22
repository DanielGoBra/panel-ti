"""Pruebas del acceso con Google: lista de correos, administradores y validación del token."""
import importlib
import os
import sys
import tempfile
import time
import unittest
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
H = {"X-Requested-With": "panel-ti"}
ENV = {
    "GOOGLE_CLIENT_ID": "cliente-prueba.apps.googleusercontent.com",
    "GOOGLE_CLIENT_SECRET": "secreto",
    "ALLOWED_EMAILS": "jefa@gmail.com, compa@gmail.com",
    "ADMIN_EMAILS": "jefa@gmail.com",
    "PASSWORD_LOGIN": "0",
}


class GoogleLoginTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved = {k: os.environ.get(k) for k in [*ENV, "PANEL_TI_DB", "PANEL_TI_NO_SEED", "PANEL_TI_SCHEDULER"]}
        os.environ.update(ENV)
        os.environ.update({"PANEL_TI_DB": os.path.join(cls.tmp.name, "sso.db"), "PANEL_TI_NO_SEED": "1", "PANEL_TI_SCHEDULER": "0"})
        for mod in ("db", "core", "auth", "sla", "notify", "ai", "backup", "api_tasks", "api_core", "api_pages",
                    "api_misc", "automation", "seed", "app"):
            if mod in sys.modules:
                importlib.reload(sys.modules[mod])
        import app
        import auth
        cls.app, cls.auth = app, auth

    @classmethod
    def tearDownClass(cls):
        for k, v in cls.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        cls.tmp.cleanup()

    def google(self, email, verified=True, tamper_nonce=False, sub=None):
        """Recorre el flujo completo con la respuesta de Google simulada."""
        c = self.app.app.test_client()
        r = c.get("/auth/google/login")
        self.assertEqual(r.status_code, 302)
        q = parse_qs(urlparse(r.headers["Location"]).query)
        self.assertTrue(r.headers["Location"].startswith("https://accounts.google.com/"))
        nonce = q["nonce"][0]
        claims = {"aud": ENV["GOOGLE_CLIENT_ID"], "iss": "https://accounts.google.com", "exp": time.time() + 300,
                  "nonce": "otro" if tamper_nonce else nonce, "sub": sub or f"id-{email}", "email": email,
                  "email_verified": verified, "name": email.split("@")[0].title()}
        original = self.auth.exchange_code
        self.auth.exchange_code = lambda name, code: claims
        try:
            r = c.get(f"/auth/google/callback?state={q['state'][0]}&code=abc")
        finally:
            self.auth.exchange_code = original
        return c, r.headers["Location"]

    def test_01_admin_email_enters_as_admin(self):
        c, loc = self.google("jefa@gmail.com")
        self.assertEqual(loc, "/")
        st = c.get("/api/auth/status").get_json()
        self.assertTrue(st["authenticated"])
        self.assertEqual(st["user"]["role"], "admin")
        self.assertEqual(st["providers"], [{"id": "google", "label": "Google"}])
        self.assertFalse(st["password"])

    def test_02_allowed_email_enters_as_member(self):
        c, _ = self.google("compa@gmail.com")
        self.assertEqual(c.get("/api/auth/status").get_json()["user"]["role"], "member")

    def test_03_other_accounts_are_rejected(self):
        c, loc = self.google("intruso@gmail.com")
        self.assertIn("error=notallowed", loc)
        self.assertFalse(c.get("/api/auth/status").get_json()["authenticated"])

    def test_04_token_checks(self):
        _, loc = self.google("compa@gmail.com", verified=False)
        self.assertIn("error=sso", loc)
        _, loc = self.google("compa@gmail.com", tamper_nonce=True)
        self.assertIn("error=sso", loc)
        c = self.app.app.test_client()
        self.assertIn("error=sso", c.get("/auth/google/callback?state=falso&code=abc").headers["Location"])

    def test_05_password_login_disabled(self):
        c = self.app.app.test_client()
        self.assertEqual(c.post("/api/auth/login", json={"email": "jefa@gmail.com", "password": "x"}, headers=H).status_code, 403)
        self.assertEqual(c.post("/api/auth/setup", json={"name": "X", "email": "x@x.com", "password": "larga-123"}, headers=H).status_code, 403)

    def test_06_person_added_by_admin_can_enter(self):
        admin, _ = self.google("jefa@gmail.com")
        r = admin.post("/api/members", json={"name": "Nueva Persona", "email": "nueva@gmail.com"}, headers=H).get_json()
        self.assertIsNone(r["temp_password"])
        c, loc = self.google("nueva@gmail.com")
        self.assertEqual(loc, "/")
        self.assertEqual(c.get("/api/auth/status").get_json()["user"]["name"], "Nueva Persona")

    def test_07_same_google_account_keeps_its_profile(self):
        c, _ = self.google("compa@gmail.com", sub="estable-1")
        first = c.get("/api/auth/status").get_json()["user"]["id"]
        c, _ = self.google("compa@gmail.com", sub="estable-1")
        self.assertEqual(c.get("/api/auth/status").get_json()["user"]["id"], first)


if __name__ == "__main__":
    unittest.main()
