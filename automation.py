"""Trabajos periódicos: avisos de vencimiento y de SLA, tareas recurrentes,
copias de seguridad y lectura del buzón de entrada (IMAP).

Corren en un hilo del propio servidor. Cada trabajo reclama su turno en la base de
datos, así que si hay varios procesos solo uno lo ejecuta.
"""
import email
import email.utils
import imaplib
import json
import logging
import os
import threading
import time
from datetime import date, datetime, timedelta
from email.header import decode_header, make_header

import backup
from api_tasks import TASK_SELECT, add_rule, create_task_record, decorate
from core import bump_revision, get_settings, now, task_key
from db import get_db
from notify import notify

log = logging.getLogger("panel-ti.automation")

JOBS = {
    # nombre: segundos entre ejecuciones
    "sla": 300,
    "due": 3600,
    "recurrence": 1800,
    "backup": int(float(os.environ.get("PANEL_TI_BACKUP_HOURS", 24)) * 3600),
    "imap": int(os.environ.get("IMAP_POLL_SECONDS", 120)),
}
_started = False


def _claim(job, interval):
    """Devuelve True si toca ejecutar el trabajo y lo marca como en curso."""
    with get_db() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT value FROM state WHERE key=?", (f"job:{job}",)).fetchone()
        last = json.loads(row["value"]).get("at") if row else None
        if last and (datetime.now() - datetime.fromisoformat(last)).total_seconds() < interval:
            return False
        db.execute("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   (f"job:{job}", json.dumps({"at": now(), "status": "running"})))
        return True


def _finish(job, status, detail=""):
    with get_db() as db:
        db.execute("UPDATE state SET value=? WHERE key=?", (json.dumps({"at": now(), "status": status, "detail": detail}), f"job:{job}"))


def _fmt(d):
    """Fecha ISO a formato local dd/mm/aaaa (con hora si la trae)."""
    try:
        dt = datetime.fromisoformat(str(d).replace(" ", "T"))
    except ValueError:
        return str(d)
    return dt.strftime("%d/%m/%Y %H:%M") if len(str(d)) > 10 else dt.strftime("%d/%m/%Y")


def _flag(db, task_id, flag):
    """Marca que un aviso ya se envió para no repetirlo. Devuelve True si es nuevo."""
    row = db.execute("SELECT alert_flags FROM tasks WHERE id=?", (task_id,)).fetchone()
    flags = set(filter(None, (row["alert_flags"] or "").split(","))) if row else set()
    if flag in flags:
        return False
    flags.add(flag)
    db.execute("UPDATE tasks SET alert_flags=? WHERE id=?", (",".join(sorted(flags))[-500:], task_id))
    return True


# ---------- Trabajos ----------
def job_sla():
    sent = 0
    with get_db() as db:
        settings = get_settings(db)
        types = settings["sla"].get("types") or []
        if not types:
            return "sin tipos con SLA"
        rows = db.execute(TASK_SELECT + f" WHERE t.status<>'done' AND t.type IN ({','.join('?' * len(types))})", types).fetchall()
        for t in decorate(db, rows, settings, model={"pair": {}, "type": {}, "all": 5}):
            s = t["sla"]
            if not s or s["state"] not in ("risk", "breached"):
                continue
            kind = "sla_breach" if s["state"] == "breached" else "sla_risk"
            if not _flag(db, t["id"], kind):
                continue
            key = task_key(db, t)
            msg = (f"{key} · {t['title']} ha superado el plazo de resolución ({_fmt(s['resolve_due'])})" if kind == "sla_breach"
                   else f"{key} · {t['title']} tiene de plazo para resolverse hasta el {_fmt(s['resolve_due'])}")
            owners = [t["assignee"]] + [r["name"] for r in db.execute("SELECT name FROM members WHERE active=1 AND role='admin'")]
            notify(db, owners, kind, msg, t, skip_actor=False)
            sent += 1
        if sent:
            bump_revision(db)
    return f"{sent} avisos"


def job_due():
    t0 = date.today()
    if datetime.now().hour < 7:
        return "fuera de horario"
    sent = 0
    with get_db() as db:
        rows = db.execute("SELECT * FROM tasks WHERE status<>'done' AND due_date<>'' AND due_date<=? AND assignee<>''",
                          ((t0 + timedelta(days=1)).isoformat(),)).fetchall()
        for t in rows:
            if t["due_date"] < t0.isoformat():
                if _flag(db, t["id"], f"over:{t['due_date']}"):
                    notify(db, [t["assignee"]], "overdue", f"{task_key(db, t)} · {t['title']} venció el {_fmt(t['due_date'])}", t, skip_actor=False)
                    sent += 1
            elif _flag(db, t["id"], f"due:{t['due_date']}"):
                when = "hoy" if t["due_date"] == t0.isoformat() else "mañana"
                notify(db, [t["assignee"]], "due_soon", f"{task_key(db, t)} · {t['title']} vence {when}", t, skip_actor=False)
                sent += 1
        if sent:
            bump_revision(db)
    return f"{sent} avisos"


def job_recurrence():
    created = 0
    t0 = date.today()
    with get_db() as db:
        for r in db.execute("SELECT * FROM recurrences WHERE active=1").fetchall():
            nxt = date.fromisoformat(r["next_date"])
            guard = 0
            while nxt - timedelta(days=r["due_offset_days"] or 0) <= t0 and guard < 12:
                payload = json.loads(r["payload"])
                data = {**payload, "due_date": nxt.isoformat(), "status": "todo"}
                task = create_task_record(db, data, who="Recurrencia")
                db.execute("UPDATE tasks SET recurrence_id=? WHERE id=?", (r["id"], task["id"]))
                if task["assignee"]:
                    notify(db, [task["assignee"]], "recurring", f"{task_key(db, task)} · {task['title']} (vence el {_fmt(nxt.isoformat())})", task, skip_actor=False)
                nxt = add_rule(nxt, r["rule"])
                db.execute("UPDATE recurrences SET next_date=?, last_task_id=? WHERE id=?", (nxt.isoformat(), task["id"], r["id"]))
                created += 1
                guard += 1
        if created:
            bump_revision(db)
    return f"{created} tareas creadas"


def job_backup():
    info = backup.create_backup()
    return info["name"]


def _decode(s):
    try:
        return str(make_header(decode_header(s or "")))
    except Exception:
        return s or ""


def _plain_body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and "attachment" not in str(part.get("Content-Disposition", "")):
                return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
        return ""
    return msg.get_payload(decode=True).decode(msg.get_content_charset() or "utf-8", "replace")


def job_imap():
    host = os.environ.get("IMAP_HOST")
    if not host:
        return "no configurado"
    from api_misc import create_inbound_task
    created = 0
    with imaplib.IMAP4_SSL(host, int(os.environ.get("IMAP_PORT", 993))) as m:
        m.login(os.environ["IMAP_USER"], os.environ["IMAP_PASSWORD"])
        m.select(os.environ.get("IMAP_FOLDER", "INBOX"))
        _, data = m.search(None, "UNSEEN")
        for num in (data[0].split() if data and data[0] else [])[:25]:
            _, parts = m.fetch(num, "(RFC822)")
            msg = email.message_from_bytes(parts[0][1])
            sender = email.utils.parseaddr(msg.get("From", ""))[1]
            with get_db() as db:
                create_inbound_task(db, _decode(msg.get("Subject")), _plain_body(msg)[:20000], sender)
                bump_revision(db)
            m.store(num, "+FLAGS", "\\Seen")
            created += 1
    return f"{created} correos convertidos"


RUNNERS = {"sla": job_sla, "due": job_due, "recurrence": job_recurrence, "backup": job_backup, "imap": job_imap}


def run_due_jobs(force=None):
    """Ejecuta los trabajos a los que les toca. force=nombre ejecuta uno ya."""
    results = {}
    for name, interval in JOBS.items():
        if force and name != force:
            continue
        if name == "backup" and interval <= 0:
            continue
        if name == "imap" and not os.environ.get("IMAP_HOST"):
            continue
        if not _claim(name, 0 if force else interval):
            continue
        try:
            detail = RUNNERS[name]()
            _finish(name, "ok", detail)
            results[name] = detail
        except Exception as e:
            log.exception("Fallo en el trabajo %s", name)
            _finish(name, "error", str(e)[:300])
            results[name] = f"error: {e}"
    return results


def _loop():
    time.sleep(5)
    while True:
        try:
            run_due_jobs()
        except Exception:
            log.exception("Fallo en el planificador")
        time.sleep(60)


def start():
    global _started
    if _started or os.environ.get("PANEL_TI_SCHEDULER", "1") == "0":
        return
    _started = True
    threading.Thread(target=_loop, name="panel-ti-scheduler", daemon=True).start()
