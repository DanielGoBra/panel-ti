"""Notificaciones: aviso dentro de la app, correo (SMTP) y canal de Teams.

El envío externo va por una cola en segundo plano para no frenar las peticiones.
Variables de entorno para correo: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
SMTP_FROM, SMTP_TLS (starttls|ssl|none). PUBLIC_URL se usa para los enlaces.
"""
import json
import logging
import os
import queue
import smtplib
import threading
import urllib.request
from email.message import EmailMessage
from html import escape

from flask import Blueprint, jsonify

from core import actor, bad, body, current_user, get_settings, now
from db import get_db

log = logging.getLogger("panel-ti.notify")
bp = Blueprint("notify", __name__)

KIND_TITLES = {
    "assigned": "Te han asignado una tarea",
    "mention": "Te han mencionado",
    "comment": "Nuevo comentario",
    "due_soon": "Vence pronto",
    "overdue": "Tarea vencida",
    "blocked": "Tarea bloqueada",
    "resolved": "Tarea resuelta",
    "approval_requested": "Aprobación de cambio pendiente",
    "approval_decided": "Decisión del CAB",
    "sla_risk": "SLA en riesgo",
    "sla_breach": "SLA incumplido",
    "recurring": "Tarea recurrente creada",
    "inbound": "Nueva solicitud recibida",
}
# Eventos que también se publican en el canal de Teams
TEAMS_KINDS = {"assigned", "approval_requested", "approval_decided", "sla_risk", "sla_breach", "blocked", "inbound"}

_queue = queue.Queue()
_worker = None
_lock = threading.Lock()
sent_log = []  # últimos envíos (útil para diagnóstico y pruebas)


def public_url(path=""):
    base = os.environ.get("PUBLIC_URL", "http://127.0.0.1:5000").rstrip("/")
    return f"{base}/{path.lstrip('/')}" if path else base


def smtp_configured():
    return bool(os.environ.get("SMTP_HOST"))


def _ensure_worker():
    global _worker
    with _lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="notify-sender", daemon=True)
            _worker.start()


def _run():
    while True:
        job = _queue.get()
        try:
            if job["channel"] == "email":
                _send_email(job["to"], job["subject"], job["text"], job["html"])
            elif job["channel"] == "teams":
                _send_teams(job["url"], job["card"])
            sent_log.append({k: job[k] for k in ("channel", "subject") if k in job})
            del sent_log[:-50]
        except Exception as e:  # el fallo de un envío no debe tumbar el hilo
            log.warning("No se pudo enviar la notificación por %s: %s", job["channel"], e)
        finally:
            _queue.task_done()


def _send_email(to, subject, text, html):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USER", "panel-ti@localhost")
    msg["To"] = to
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", 587))
    mode = os.environ.get("SMTP_TLS", "starttls").lower()
    cls = smtplib.SMTP_SSL if mode == "ssl" else smtplib.SMTP
    with cls(host, port, timeout=20) as s:
        if mode == "starttls":
            s.starttls()
        if os.environ.get("SMTP_USER"):
            s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
        s.send_message(msg)


def _send_teams(url, card):
    payload = {"type": "message", "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": card}]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        r.read()


def _task_link(task_id):
    return public_url(f"#/tablero?t={task_id}") if task_id else public_url()


def notify(db, recipients, kind, body_text, task=None, page_id=None, title=None, skip_actor=True):
    """Crea avisos para personas (nombres o ids) y encola correo/Teams.

    Devuelve la lista de ids de miembros notificados.
    """
    who = actor()
    title = title or KIND_TITLES.get(kind, "Aviso")
    names = {r for r in recipients if isinstance(r, str) and r}
    ids = {r for r in recipients if isinstance(r, int)}
    rows = []
    if names:
        rows += db.execute(f"SELECT * FROM members WHERE active=1 AND name IN ({','.join('?' * len(names))})", list(names)).fetchall()
    if ids:
        rows += db.execute(f"SELECT * FROM members WHERE active=1 AND id IN ({','.join('?' * len(ids))})", list(ids)).fetchall()
    seen, notified = set(), []
    task_id = task["id"] if task else None
    for m in rows:
        if m["id"] in seen or (skip_actor and m["name"] == who):
            continue
        seen.add(m["id"])
        db.execute("INSERT INTO notifications (member_id, kind, title, body, task_id, page_id, actor, created_at) VALUES (?,?,?,?,?,?,?,?)",
                   (m["id"], kind, title, body_text, task_id, page_id, who, now()))
        notified.append(m["id"])
        if m["notify_email"] and m["email"] and smtp_configured():
            link = _task_link(task_id)
            html = (f"<div style='font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d1d1b'>"
                    f"<p style='margin:0 0 6px;color:#585752'>{escape(title)}</p>"
                    f"<p style='margin:0 0 14px;font-size:15px'>{escape(body_text)}</p>"
                    f"<a href='{escape(link)}' style='background:#2a78d6;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none'>Abrir en Panel TI</a>"
                    f"<p style='margin:18px 0 0;font-size:12px;color:#8b8a84'>Puedes desactivar estos correos en tu perfil.</p></div>")
            _queue.put({"channel": "email", "to": m["email"], "subject": f"[Panel TI] {title}",
                        "text": f"{body_text}\n\n{link}", "html": html})
    if kind in TEAMS_KINDS:
        url = get_settings(db).get("teams_webhook_url")
        if url:
            mention = ", ".join(m["name"] for m in rows if m["id"] in seen)
            card = {
                "type": "AdaptiveCard", "version": "1.4", "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "body": [
                    {"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium"},
                    {"type": "TextBlock", "text": body_text, "wrap": True},
                    *([{"type": "TextBlock", "text": f"Para: {mention}", "isSubtle": True, "spacing": "Small"}] if mention else []),
                ],
                "actions": [{"type": "Action.OpenUrl", "title": "Abrir en Panel TI", "url": _task_link(task_id)}],
            }
            _queue.put({"channel": "teams", "url": url, "card": card, "subject": title})
    if not _queue.empty():
        _ensure_worker()
    return notified


def find_mentions(db, text):
    """Nombres de personas mencionadas con @Nombre Apellido."""
    if "@" not in text:
        return []
    members = [r["name"] for r in db.execute("SELECT name FROM members WHERE active=1")]
    found = []
    low = text.lower()
    for name in sorted(members, key=len, reverse=True):
        if f"@{name.lower()}" in low and name not in found:
            found.append(name)
    return found


# ---------- API ----------
@bp.get("/api/notifications")
def list_notifications():
    u = current_user()
    with get_db() as db:
        rows = db.execute("SELECT * FROM notifications WHERE member_id=? ORDER BY id DESC LIMIT 60", (u["id"],)).fetchall()
        unread = db.execute("SELECT COUNT(*) FROM notifications WHERE member_id=? AND read_at IS NULL", (u["id"],)).fetchone()[0]
        return jsonify({"items": [dict(r) for r in rows], "unread": unread})


@bp.post("/api/notifications/read")
def mark_read():
    u = current_user()
    data = body()
    with get_db() as db:
        if data.get("all"):
            db.execute("UPDATE notifications SET read_at=? WHERE member_id=? AND read_at IS NULL", (now(), u["id"]))
        else:
            ids = [int(i) for i in data.get("ids", []) if str(i).isdigit()]
            if not ids:
                return bad("Nada que marcar")
            db.execute(f"UPDATE notifications SET read_at=? WHERE member_id=? AND id IN ({','.join('?' * len(ids))})",
                       [now(), u["id"], *ids])
        return jsonify({"ok": True})


@bp.post("/api/notifications/test")
def test_channels():
    """Envía un aviso de prueba al usuario actual por todos los canales configurados."""
    u = current_user()
    with get_db() as db:
        notify(db, [u["id"]], "assigned", "Mensaje de prueba de Panel TI: los avisos llegan correctamente.",
               title="Prueba de notificaciones", skip_actor=False)
    return jsonify({"ok": True, "email": smtp_configured() and bool(u["email"])})
