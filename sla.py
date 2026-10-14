"""Acuerdos de nivel de servicio y predicción de retrasos."""
from datetime import date, datetime, timedelta
from statistics import median

from core import parse_dt


def compute_sla(task, settings, at=None):
    """Estado de SLA de una tarea o None si no aplica.

    Respuesta: primera reacción (pasar a trabajo o comentario de alguien distinto
    de quien la abrió). Resolución: cierre. Se mide en horas naturales.
    """
    cfg = settings.get("sla") or {}
    if task["type"] not in (cfg.get("types") or []):
        return None
    pol = (cfg.get("policies") or {}).get(task["priority"])
    if not pol:
        return None
    at = at or datetime.now()
    created = parse_dt(task["created_at"])
    if not created:
        return None
    resp_due = created + timedelta(minutes=pol["response_min"])
    res_due = created + timedelta(hours=pol["resolve_h"])
    responded = parse_dt(task.get("responded_at"))
    completed = parse_dt(task.get("completed_at")) if task["status"] == "done" else None

    response_met = None if not responded else responded <= resp_due
    if responded is None and at > resp_due:
        response_met = False

    if completed:
        state = "met" if completed <= res_due and response_met is not False else "missed"
        remaining = None
    else:
        total = (res_due - created).total_seconds()
        elapsed = (at - created).total_seconds()
        remaining = int((res_due - at).total_seconds() // 60)
        if at > res_due:
            state = "breached"
        elif response_met is False or (total and elapsed / total >= 0.75):
            state = "risk"
        else:
            state = "ok"
    return {
        "state": state,
        "response_due": resp_due.isoformat(sep=" ", timespec="minutes"),
        "resolve_due": res_due.isoformat(sep=" ", timespec="minutes"),
        "responded_at": task.get("responded_at"),
        "response_met": response_met,
        "remaining_min": remaining,
        "policy": pol,
    }


def delay_model(tasks):
    """Duración típica (días) por tipo y persona, a partir de lo ya cerrado."""
    by_pair, by_type, all_d = {}, {}, []
    for t in tasks:
        if t["status"] != "done" or not t.get("completed_at"):
            continue
        start = parse_dt(t.get("started_at")) or parse_dt(t["created_at"])
        end = parse_dt(t["completed_at"])
        if not start or not end or end < start:
            continue
        d = (end - start).total_seconds() / 86400
        by_pair.setdefault((t["type"], t["assignee"]), []).append(d)
        by_type.setdefault(t["type"], []).append(d)
        all_d.append(d)
    return {
        "pair": {k: median(v) for k, v in by_pair.items() if len(v) >= 2},
        "type": {k: median(v) for k, v in by_type.items() if len(v) >= 2},
        "all": median(all_d) if all_d else 5.0,
    }


def predict_delay(task, model, today=None):
    """Devuelve {late_days, expected} si la tarea probablemente no llegue a su fecha."""
    if task["status"] == "done" or not task.get("due_date"):
        return None
    today = today or date.today()
    try:
        due = date.fromisoformat(task["due_date"])
    except ValueError:
        return None
    if due < today:
        return None  # ya vencida: se marca como tal, no como riesgo
    expected = model["pair"].get((task["type"], task["assignee"])) or model["type"].get(task["type"]) or model["all"]
    started = parse_dt(task.get("started_at"))
    if started and task["status"] in ("in_progress", "review"):
        elapsed = (datetime.now() - started).total_seconds() / 86400
        remaining = max(expected - elapsed, expected * 0.25)
    else:
        remaining = expected
    if task["status"] == "blocked":
        remaining += 2  # un bloqueo suele añadir espera
    finish = today + timedelta(days=round(remaining + 0.49))
    if finish <= due:
        return None
    return {"late_days": (finish - due).days, "expected": finish.isoformat(), "typical_days": round(expected, 1)}
