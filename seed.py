"""Datos de demostración. Las fechas se calculan respecto al día de hoy para que
el tablero, el calendario y las métricas siempre muestren un escenario vigente."""
import json
import logging
import os
import random
from datetime import datetime, timedelta

from auth import hash_password
from db import get_db

DEMO_PASSWORD = os.environ.get("PANEL_TI_DEMO_PASSWORD", "demo-panel-ti")

# nombre, correo, puesto, equipo, capacidad, rol, miembro del CAB
MEMBERS = [
    ("Ana Torres", "ana.torres@empresa.com", "Arquitecta cloud", "Infraestructura", 8, "admin", 1),
    ("Luis Pérez", "luis.perez@empresa.com", "Responsable de seguridad", "Seguridad", 7, "member", 1),
    ("Marta Ruiz", "marta.ruiz@empresa.com", "Coordinadora de soporte", "Mesa de ayuda", 10, "member", 0),
    ("Jorge Salinas", "jorge.salinas@empresa.com", "Administrador de sistemas", "Infraestructura", 8, "member", 0),
    ("Carla Méndez", "carla.mendez@empresa.com", "Analista funcional ERP", "Aplicaciones", 6, "member", 1),
    ("Diego Herrera", "diego.herrera@empresa.com", "Técnico de soporte N2", "Mesa de ayuda", 10, "member", 0),
    ("Elena Vidal", "elena.vidal@empresa.com", "Directora financiera", "Dirección", 1, "viewer", 0),
]

PROJECTS = [
    ("Migración a la nube", "NUB", "Traslado de servicios on-premise a AWS con landing zone y cuentas separadas por entorno.",
     "#2a78d6", "Ana Torres", "Infraestructura", 60),
    ("Ciberseguridad 2026", "SEG", "Endurecimiento de servidores, MFA corporativo y gestión de vulnerabilidades.",
     "#e34948", "Luis Pérez", "Seguridad", 75),
    ("Mesa de ayuda", "MDA", "Catálogo de servicios, SLA y medición de satisfacción de usuarios internos.",
     "#1baf7a", "Marta Ruiz", "Soporte", 40),
    ("ERP corporativo", "ERP", "Actualización del ERP financiero y conexión con nómina y compras.",
     "#6250d6", "Carla Méndez", "Aplicaciones", 120),
    ("Renovación de equipos", "REN", "Sustitución de 180 portátiles fuera de garantía y alta en Intune.",
     "#eb6834", "Jorge Salinas", "Puesto de trabajo", 30),
]

# (proyecto, título, tipo, prioridad, responsable, estado, días_creada, días_cerrada_o_None, vence_en_días, estimación, etiquetas, notas, checklist)
TASKS = [
    ("NUB", "Inventario de servidores y dependencias", "task", "high", "Ana Torres", "done", 80, 70, -68, 16, "inventario",
     "Exportado desde vCenter y validado con cada responsable de aplicación.", ["Exportar VMs", "Mapear dependencias", "Validar con negocio"]),
    ("NUB", "Diseño de landing zone (VPC, subredes, IAM)", "task", "critical", "Ana Torres", "done", 66, 41, -40, 24, "arquitectura",
     "Tres cuentas: prod, no-prod y shared services. Transit Gateway central.", ["VPC y subredes", "Roles IAM", "Revisión con seguridad"]),
    ("NUB", "Pipeline de infraestructura con Terraform", "task", "high", "Jorge Salinas", "done", 50, 22, -20, 20, "iac, terraform", "", []),
    ("NUB", "Migrar base de datos de facturación a RDS", "change", "critical", "Ana Torres", "in_progress", 30, None, 6, 32, "bd, rds",
     "Ventana de corte prevista en fin de semana. Requiere aprobación del CAB.",
     ["Réplica con DMS", "Prueba de rendimiento", "Plan de vuelta atrás", "Aprobación CAB"]),
    ("NUB", "Copias de seguridad cruzadas entre regiones", "task", "high", "Jorge Salinas", "review", 21, None, 3, 12, "backup", "", ["Política de retención", "Prueba de restauración"]),
    ("NUB", "Monitorización con CloudWatch y alertas a Teams", "task", "medium", "Jorge Salinas", "todo", 14, None, 18, 10, "observabilidad", "", []),
    ("NUB", "Apagado del CPD secundario", "change", "medium", "Ana Torres", "todo", 10, None, 45, 8, "cpd", "", []),
    ("NUB", "Coste mensual por encima del presupuesto", "incident", "high", "Ana Torres", "blocked", 9, None, -2, 6, "finops",
     "Bloqueado: falta acceso a la consola de facturación consolidada (pedido a Finanzas).", []),

    ("SEG", "Auditoría externa de vulnerabilidades", "task", "critical", "Luis Pérez", "done", 84, 63, -60, 40, "auditoría", "", []),
    ("SEG", "Parcheo de servidores Windows 2016", "change", "high", "Jorge Salinas", "blocked", 35, None, -5, 18, "parcheo",
     "Bloqueado: ventana de mantenimiento pendiente de aprobación por Operaciones.", ["Inventario de parches", "Piloto en preproducción", "Ventana aprobada"]),
    ("SEG", "MFA para todos los usuarios corporativos", "task", "critical", "Luis Pérez", "in_progress", 42, None, 10, 30, "identidad, mfa",
     "Fase 2: personal de planta. Las cuentas de servicio quedan fuera.", ["Directivos", "Oficinas centrales", "Planta", "Cuentas de servicio excluidas"]),
    ("SEG", "Campaña de phishing simulado T4", "task", "medium", "Luis Pérez", "todo", 12, None, 25, 6, "concienciación", "", []),
    ("SEG", "Revisión de cuentas privilegiadas", "task", "high", "Luis Pérez", "review", 18, None, 2, 8, "identidad", "", []),
    ("SEG", "Alerta EDR en portátil de Compras", "incident", "critical", "Luis Pérez", "done", 6, 5, -5, 3, "edr", "Falso positivo confirmado. Regla ajustada.", []),
    ("SEG", "Política de contraseñas alineada con ENS", "improvement", "low", "Luis Pérez", "done", 58, 36, -30, 4, "normativa", "", []),
    ("SEG", "Cifrado de discos en equipos de dirección", "task", "high", "Jorge Salinas", "done", 40, 15, -14, 10, "cifrado", "", []),

    ("MDA", "Actualizar catálogo de servicios", "task", "medium", "Marta Ruiz", "in_progress", 25, None, 8, 12, "procesos", "", ["Servicios de identidad", "Servicios de puesto", "Servicios de aplicaciones"]),
    ("MDA", "Encuesta de satisfacción tras cierre de ticket", "improvement", "medium", "Marta Ruiz", "done", 45, 28, -25, 6, "satisfacción", "", []),
    ("MDA", "Definir SLA por categoría de incidente", "task", "high", "Marta Ruiz", "review", 20, None, 1, 8, "sla", "", []),
    ("MDA", "Base de conocimiento: 20 artículos de autoservicio", "improvement", "low", "Diego Herrera", "todo", 16, None, 30, 15, "autoservicio", "", []),
    ("MDA", "Impresoras de planta 2 sin servicio", "incident", "high", "Diego Herrera", "done", 4, 3, -3, 2, "impresión", "", []),
    ("MDA", "Alta de 12 usuarios de nueva oficina", "request", "medium", "Diego Herrera", "in_progress", 5, None, 4, 6, "altas", "", ["Cuentas AD", "Licencias M365", "Equipos asignados"]),
    ("MDA", "Correo lento en sede Norte", "incident", "medium", "Diego Herrera", "done", 11, 9, -9, 3, "correo", "", []),
    ("MDA", "Informe mensual de tickets para dirección", "task", "low", "Marta Ruiz", "done", 33, 30, -30, 3, "reportes", "", []),
    ("MDA", "Integrar chat de soporte en Teams", "improvement", "medium", "Marta Ruiz", "todo", 7, None, None, 10, "teams", "", []),

    ("ERP", "Análisis de brechas versión actual vs. nueva", "task", "high", "Carla Méndez", "done", 70, 48, -45, 30, "análisis", "", []),
    ("ERP", "Entorno de pruebas del ERP", "request", "high", "Jorge Salinas", "done", 52, 40, -38, 12, "entornos", "", []),
    ("ERP", "Conector con nómina", "task", "critical", "Carla Méndez", "in_progress", 34, None, -3, 40, "integración",
     "Retraso por cambios en el formato de exportación del proveedor de nómina.", ["Mapeo de campos", "Desarrollo", "Pruebas con RR.HH."]),
    ("ERP", "Pruebas de aceptación con Finanzas", "task", "high", "Carla Méndez", "todo", 15, None, 21, 24, "uat", "", []),
    ("ERP", "Migración de maestros de proveedores", "change", "medium", "Carla Méndez", "todo", 12, None, 35, 16, "datos", "", []),
    ("ERP", "Licencias adicionales para Compras", "request", "low", "Carla Méndez", "blocked", 19, None, 5, 2, "licencias",
     "Bloqueado: pendiente de firma del pedido por Compras.", []),
    ("ERP", "Formación a usuarios clave", "task", "medium", "Carla Méndez", "todo", 6, None, 50, 12, "formación", "", []),

    ("REN", "Selección de modelo y proveedor", "task", "high", "Jorge Salinas", "done", 60, 44, -42, 8, "compras", "", []),
    ("REN", "Imagen corporativa con Autopilot", "task", "high", "Diego Herrera", "done", 42, 20, -18, 16, "intune", "", []),
    ("REN", "Entrega lote 1 (60 equipos)", "task", "medium", "Diego Herrera", "done", 24, 8, -7, 30, "despliegue", "", []),
    ("REN", "Entrega lote 2 (60 equipos)", "task", "medium", "Diego Herrera", "in_progress", 10, None, 9, 30, "despliegue", "", ["Calendario por áreas", "Copia de datos", "Recogida de equipos antiguos"]),
    ("REN", "Entrega lote 3 (60 equipos)", "task", "medium", "Diego Herrera", "todo", 3, None, 24, 30, "despliegue", "", []),
    ("REN", "Borrado certificado de equipos retirados", "task", "high", "Jorge Salinas", "todo", 8, None, -1, 6, "residuos, rgpd", "", []),
    ("REN", "Portátil sin arranque tras actualización de BIOS", "incident", "high", "Diego Herrera", "review", 2, None, 1, 2, "hardware", "", []),
]

COMMENTS = [
    ("Migrar base de datos de facturación a RDS", "Luis Pérez", "Antes del corte necesito revisar los grupos de seguridad de la instancia."),
    ("Migrar base de datos de facturación a RDS", "Ana Torres", "Hecho. La réplica va con 40 s de retraso medio; aceptable para el corte."),
    ("Parcheo de servidores Windows 2016", "Jorge Salinas", "Operaciones propone el sábado 02:00-06:00. Falta su confirmación por escrito."),
    ("Conector con nómina", "Carla Méndez", "El proveedor confirma el nuevo formato para el día 20. Ajusto el mapeo en cuanto lo recibamos."),
    ("MFA para todos los usuarios corporativos", "Marta Ruiz", "Mesa de ayuda tiene preparado el guion para las llamadas de enrolamiento."),
]


# Incidentes recientes (horas desde su apertura) para ver el SLA en marcha
# título, prioridad, responsable, estado, horas, horas_hasta_respuesta (None = sin responder), activo
INCIDENTS = [
    ("VPN no conecta para el personal en teletrabajo", "critical", "Jorge Salinas", "in_progress", 3, 0.3, "Firewall perimetral FW-01"),
    ("Portal de empleados devuelve error 502", "high", "Ana Torres", "todo", 7.5, None, "Portal de empleados"),
    ("Impresora de la sala de juntas no imprime en color", "low", "Diego Herrera", "todo", 20, 2, "Impresora sala de juntas"),
    ("Correo no sincroniza en móviles de Comercial", "medium", "Marta Ruiz", "review", 18, 1, "Microsoft 365"),
]

ASSETS = [
    ("SRV-DB-01", "database", "srv-db-01.empresa.local", "Ana Torres", "CPD principal · rack 3", "active", "critical", "SQL Server 2019 de facturación"),
    ("Firewall perimetral FW-01", "network", "fw-01", "Luis Pérez", "CPD principal", "active", "critical", "Pareja en alta disponibilidad"),
    ("Portal de empleados", "application", "https://portal.empresa.com", "Carla Méndez", "AWS eu-west-1", "active", "high", ""),
    ("ERP financiero", "application", "erp.empresa.local", "Carla Méndez", "CPD principal", "active", "critical", "Versión 2019, en actualización"),
    ("Microsoft 365", "cloud", "empresa.onmicrosoft.com", "Marta Ruiz", "Nube", "active", "high", "Correo, Teams y OneDrive"),
    ("Impresora sala de juntas", "printer", "PRN-SJ-02", "Diego Herrera", "Planta 2", "active", "low", ""),
    ("Portátil Lenovo T14 · Compras", "laptop", "SN PF3K2L9", "Diego Herrera", "Planta 1 · Compras", "active", "medium", "Lote de renovación 1"),
    ("SRV-FS-02", "server", "srv-fs-02.empresa.local", "Jorge Salinas", "CPD secundario", "maintenance", "medium", "Servidor de ficheros; se apaga con el CPD secundario"),
]

TASK_TEMPLATES = [
    ("Alta de empleado", "Cuentas, equipo y accesos para una incorporación", {
        "title": "Alta de empleado: ", "type": "request", "priority": "high", "tags": "altas",
        "notes": "Fecha de incorporación, departamento y responsable directo.",
        "checklist": ["Crear cuenta en Active Directory", "Asignar licencia de Microsoft 365", "Preparar portátil con Autopilot",
                      "Alta en el ERP con el rol del puesto", "Añadir a grupos de Teams del departamento", "Entregar equipo y credenciales"]}),
    ("Baja de empleado", "Retirada de accesos y recuperación de equipos", {
        "title": "Baja de empleado: ", "type": "request", "priority": "high", "tags": "bajas, seguridad",
        "checklist": ["Deshabilitar cuenta el último día", "Retirar licencias", "Convertir buzón en compartido",
                      "Revocar accesos a aplicaciones", "Recoger portátil y móvil", "Borrado certificado del equipo"]}),
    ("Parcheo mensual de servidores", "Ciclo estándar de actualizaciones", {
        "title": "Parcheo mensual de servidores", "type": "change", "priority": "high", "tags": "parcheo",
        "checklist": ["Revisar boletines del mes", "Aplicar en preproducción", "Comprobar servicios críticos",
                      "Aplicar en producción en ventana", "Verificar y cerrar"],
        "subtasks": ["Parches Windows Server", "Parches Linux", "Firmware de hipervisores"]}),
    ("Cambio estándar", "Cambio de bajo riesgo con plan de vuelta atrás", {
        "title": "Cambio: ", "type": "change", "priority": "medium",
        "notes": "Descripción del cambio:\nImpacto:\nVentana propuesta:\nPlan de vuelta atrás:",
        "checklist": ["Plan de vuelta atrás documentado", "Aprobación del CAB", "Comunicación a usuarios", "Verificación posterior"]}),
]

PAGE_TEMPLATES = [
    ("Acta de comité", "Orden del día, decisiones y acuerdos", {"icon": "🗂", "kind": "minutes", "title": "Acta del comité de TI", "blocks": [
        {"type": "callout", "text": "Fecha: · Asistentes: · Próxima reunión:"},
        {"type": "h2", "text": "Orden del día"}, {"type": "number", "text": ""},
        {"type": "h2", "text": "Decisiones"}, {"type": "bullet", "text": ""},
        {"type": "h2", "text": "Acuerdos y responsables"}, {"type": "todo", "text": ""}]}),
    ("Procedimiento operativo", "Pasos repetibles para el equipo", {"icon": "🧭", "kind": "procedure", "title": "Procedimiento: ", "blocks": [
        {"type": "h2", "text": "Objetivo"}, {"type": "p", "text": ""},
        {"type": "h2", "text": "Requisitos"}, {"type": "bullet", "text": ""},
        {"type": "h2", "text": "Pasos"}, {"type": "number", "text": ""},
        {"type": "h2", "text": "Verificación"}, {"type": "todo", "text": ""}]}),
    ("Post-mortem de incidente", "Análisis tras un incidente grave", {"icon": "🔎", "kind": "page", "title": "Post-mortem: ", "blocks": [
        {"type": "callout", "text": "Incidente: · Duración: · Impacto:"},
        {"type": "h2", "text": "Cronología"}, {"type": "bullet", "text": ""},
        {"type": "h2", "text": "Causa raíz"}, {"type": "p", "text": ""},
        {"type": "h2", "text": "Qué funcionó y qué no"}, {"type": "bullet", "text": ""},
        {"type": "h2", "text": "Acciones"}, {"type": "todo", "text": ""}]}),
]


def _blocks(items):
    return json.dumps([{"id": f"b{i}", **b} for i, b in enumerate(items)], ensure_ascii=False)


def seed_demo_data(force=False):
    if os.environ.get("PANEL_TI_NO_SEED") and not force:
        return
    with get_db() as db:
        if db.execute("SELECT COUNT(*) FROM projects").fetchone()[0] and not force:
            return
        rnd = random.Random(7)
        now = datetime.now().replace(microsecond=0)
        iso = lambda d: d.isoformat(sep=" ") if d else None

        def ts(days_ago, hour=None):
            d = now - timedelta(days=days_ago)
            return d.replace(hour=hour if hour is not None else rnd.randint(8, 18), minute=rnd.randint(0, 59), second=0)

        pw = hash_password(DEMO_PASSWORD)
        for name, email, title, team, cap, role, cab in MEMBERS:
            db.execute("INSERT INTO members (name, email, title, team, capacity, role, is_cab, password_hash) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                       (name, email, title, team, cap, role, cab, pw))

        pids = {}
        for name, key, desc, color, owner, area, due in PROJECTS:
            pids[key] = db.execute(
                "INSERT INTO projects (name, key, description, color, owner, area, due_date, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (name, key, desc, color, owner, area, (now + timedelta(days=due)).date().isoformat(), iso(ts(90)))).lastrowid

        numbers, tids = {}, {}

        def add_task(pk, title, ttype, prio, who, status, created_at, completed_at, due_date, est, tags, notes, checklist,
                     creator=None, responded_at=None, approval="", parent=None, position=None):
            numbers[pk] = numbers.get(pk, 0) + 1
            started_at = None
            if status != "todo":
                span = (completed_at or now) - created_at
                started_at = created_at + span * rnd.uniform(0.1, 0.4)
            if responded_at is None and status != "todo":
                responded_at = started_at
            updated_at = completed_at or (now - timedelta(hours=rnd.randint(1, 48)))
            if updated_at < created_at:
                updated_at = created_at
            tid = db.execute(
                """INSERT INTO tasks (project_id, parent_id, number, title, notes, status, priority, type, assignee, created_by,
                   start_date, due_date, estimate, tags, approval_status, position, created_at, updated_at, started_at,
                   responded_at, completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (pids.get(pk), parent, numbers[pk], title, notes, status, prio, ttype, who, creator or who,
                 (created_at + timedelta(days=0 if (now - created_at).days < 2 else 1)).date().isoformat(), due_date, est, tags, approval,
                 position or (len(tids) + 1) * 1024, iso(created_at), iso(updated_at),
                 iso(started_at.replace(microsecond=0)) if started_at else None,
                 iso(responded_at.replace(microsecond=0)) if responded_at else None, iso(completed_at))).lastrowid
            tids[title] = (tid, pids.get(pk))
            for j, text in enumerate(checklist):
                done = 1 if status == "done" or j < len(checklist) // 2 else 0
                db.execute("INSERT INTO checklist_items (task_id, text, done, position) VALUES (?,?,?,?)", (tid, text, done, j + 1))
            db.execute("INSERT INTO activity (task_id, project_id, actor, action, task_title, created_at) VALUES (?,?,?,?,?,?)",
                       (tid, pids.get(pk), creator or who, "created", title, iso(created_at)))
            if status != "todo":
                db.execute("""INSERT INTO activity (task_id, project_id, actor, action, field, old_value, new_value, task_title, created_at)
                              VALUES (?,?,?,?,?,?,?,?,?)""",
                           (tid, pids.get(pk), who, "updated", "status", "in_progress" if completed_at else "todo", status, title, iso(updated_at)))
            return tid

        approvals = {"Migrar base de datos de facturación a RDS": "approved", "Parcheo de servidores Windows 2016": "pending",
                     "Apagado del CPD secundario": "", "Migración de maestros de proveedores": "rejected"}
        for pk, title, ttype, prio, who, status, created, closed, due, est, tags, notes, checklist in TASKS:
            created_at = ts(created)
            completed_at = ts(closed) if closed is not None else None
            if completed_at and completed_at < created_at:
                completed_at = created_at + timedelta(hours=4)
            responded = None
            if ttype == "incident" and completed_at:
                # Incidentes cerrados dentro de su SLA, salvo uno que se pasó de plazo
                hours = 30 if title == "Correo lento en sede Norte" else {"critical": 3, "high": 6, "medium": 18, "low": 40}[prio]
                completed_at = created_at + timedelta(hours=hours)
                responded = created_at + timedelta(minutes=10)
            approval = approvals.get(title, "approved" if ttype == "change" and status != "todo" else "")
            add_task(pk, title, ttype, prio, who, status, created_at, completed_at,
                     (now + timedelta(days=due)).date().isoformat() if due is not None else "", est, tags, notes, checklist,
                     approval=approval, responded_at=responded)

        for title, prio, who, status, hours, resp_h, _asset in INCIDENTS:
            created_at = now - timedelta(hours=hours)
            add_task("MDA", title, "incident", prio, who, status, created_at, None, now.date().isoformat(), 2, "incidente", "",
                     [], creator="Marta Ruiz" if who != "Marta Ruiz" else "Diego Herrera",
                     responded_at=created_at + timedelta(hours=resp_h) if resp_h is not None else None)

        # Subtareas, dependencias y aprobaciones
        lote2, _ = tids["Entrega lote 2 (60 equipos)"]
        for i, (sub, st) in enumerate([("Lote 2 · Administración y Finanzas", "done"), ("Lote 2 · Comercial", "in_progress"),
                                       ("Lote 2 · Operaciones", "todo")]):
            add_task("REN", sub, "task", "medium", "Diego Herrera", st, ts(9), ts(3) if st == "done" else None,
                     (now + timedelta(days=4 + 2 * i)).date().isoformat(), 10, "despliegue", "", [], parent=lote2)
        deps = [("Pruebas de aceptación con Finanzas", "Conector con nómina"),
                ("Apagado del CPD secundario", "Migrar base de datos de facturación a RDS"),
                ("Entrega lote 3 (60 equipos)", "Entrega lote 2 (60 equipos)")]
        for a, b in deps:
            db.execute("INSERT INTO task_deps (task_id, depends_on) VALUES (?,?)", (tids[a][0], tids[b][0]))
        for title, decision, who, comment, hours in [
            ("Migrar base de datos de facturación a RDS", "requested", "Ana Torres", "Ventana del sábado 22:00-04:00 con plan de vuelta atrás.", 120),
            ("Migrar base de datos de facturación a RDS", "approved", "Luis Pérez", "Aprobado. Revisar grupos de seguridad antes del corte.", 110),
            ("Parcheo de servidores Windows 2016", "requested", "Jorge Salinas", "Parches de seguridad acumulados de tres meses.", 30),
            ("Migración de maestros de proveedores", "requested", "Carla Méndez", "", 60),
            ("Migración de maestros de proveedores", "rejected", "Ana Torres", "Falta el plan de vuelta atrás y la validación de Compras.", 50)]:
            db.execute("INSERT INTO approvals (task_id, actor, decision, comment, created_at) VALUES (?,?,?,?,?)",
                       (tids[title][0], who, decision, comment, iso(now - timedelta(hours=hours))))

        for k, (title, author, text) in enumerate(COMMENTS):
            tid, pid = tids[title]
            stamp = iso(now - timedelta(hours=30 - k * 5))
            db.execute("INSERT INTO comments (task_id, author, body, created_at) VALUES (?,?,?,?)", (tid, author, text, stamp))
            db.execute("""INSERT INTO activity (task_id, project_id, actor, action, new_value, task_title, created_at)
                          VALUES (?,?,?,?,?,?,?)""", (tid, pid, author, "commented", text[:140], title, stamp))

        # Activos y vínculos
        aids = {}
        for a in ASSETS:
            aids[a[0]] = db.execute("INSERT INTO assets (name, kind, identifier, owner, location, status, criticality, notes) VALUES (?,?,?,?,?,?,?,?)", a).lastrowid
        links = [("Migrar base de datos de facturación a RDS", "SRV-DB-01"), ("Parcheo de servidores Windows 2016", "SRV-DB-01"),
                 ("Apagado del CPD secundario", "SRV-FS-02"), ("Alerta EDR en portátil de Compras", "Portátil Lenovo T14 · Compras"),
                 ("Conector con nómina", "ERP financiero"), ("Pruebas de aceptación con Finanzas", "ERP financiero"),
                 ("Correo lento en sede Norte", "Microsoft 365"), ("Impresoras de planta 2 sin servicio", "Impresora sala de juntas")]
        links += [(i[0], i[6]) for i in INCIDENTS]
        for t, a in links:
            db.execute("INSERT INTO task_assets (task_id, asset_id) VALUES (?,?) ON CONFLICT DO NOTHING", (tids[t][0], aids[a]))

        # Campos personalizados
        db.execute("INSERT INTO custom_fields (name, type, options, position) VALUES (?,?,?,?)", ("Impacto", "select", json.dumps(["Bajo", "Medio", "Alto"]), 1))
        db.execute("INSERT INTO custom_fields (name, type, options, position) VALUES (?,?,?,?)", ("Usuarios afectados", "number", "[]", 2))
        db.execute("INSERT INTO custom_fields (name, type, options, position) VALUES (?,?,?,?)", ("Proveedor", "text", "[]", 3))
        db.execute("UPDATE tasks SET custom=? WHERE id=?", (json.dumps({"1": "Alto", "2": 85}), tids["VPN no conecta para el personal en teletrabajo"][0]))
        db.execute("UPDATE tasks SET custom=? WHERE id=?", (json.dumps({"3": "Proveedor de nómina"}), tids["Conector con nómina"][0]))

        # Plantillas
        for name, desc, payload in TASK_TEMPLATES:
            db.execute("INSERT INTO templates (kind, name, description, payload) VALUES ('task',?,?,?)", (name, desc, json.dumps(payload, ensure_ascii=False)))
        for name, desc, payload in PAGE_TEMPLATES:
            db.execute("INSERT INTO templates (kind, name, description, payload) VALUES ('page',?,?,?)", (name, desc, json.dumps(payload, ensure_ascii=False)))

        # Tarea recurrente: revisión trimestral de accesos
        rid = db.execute("INSERT INTO recurrences (payload, rule, next_date, due_offset_days, created_by) VALUES (?,?,?,?,?)",
                         (json.dumps({"title": "Revisión trimestral de cuentas privilegiadas", "type": "task", "priority": "high",
                                      "assignee": "Luis Pérez", "project_id": pids["SEG"], "tags": "identidad",
                                      "checklist": ["Exportar miembros de grupos privilegiados", "Validar con responsables", "Retirar accesos sobrantes"]},
                                     ensure_ascii=False), "quarterly", (now + timedelta(days=80)).date().isoformat(), 7, "Luis Pérez")).lastrowid
        db.execute("UPDATE tasks SET recurrence_id=? WHERE id=?", (rid, tids["Revisión de cuentas privilegiadas"][0]))

        # Páginas
        stamp = iso(now - timedelta(days=2))

        def page(title, icon, kind, blocks, parent=None, project=None, who="Ana Torres", pos=1024):
            return db.execute("INSERT INTO pages (parent_id, project_id, title, icon, kind, blocks, position, created_by, updated_by, created_at, updated_at) "
                              "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (parent, project, title, icon, kind, _blocks(blocks), pos, who, who, stamp, stamp)).lastrowid

        wiki = page("Wiki del área de TI", "🏠", "page", [
            {"type": "p", "text": "Punto de partida del equipo: cómo trabajamos, procedimientos y contactos."},
            {"type": "h2", "text": "Cómo trabajamos"},
            {"type": "bullet", "text": "Toda petición entra como tarea: **incidente** si algo ha dejado de funcionar, **solicitud** para altas y accesos."},
            {"type": "bullet", "text": "Los **cambios** en sistemas productivos necesitan aprobación del CAB antes de empezar."},
            {"type": "bullet", "text": "Los incidentes tienen SLA de respuesta y resolución según prioridad."},
            {"type": "h2", "text": "Contactos de guardia"},
            {"type": "p", "text": "Infraestructura: Jorge Salinas · Seguridad: Luis Pérez · Mesa de ayuda: Marta Ruiz"}], pos=1024)
        page("Procedimiento de alta de empleados", "🧭", "procedure", [
            {"type": "p", "text": "Se inicia con la plantilla «Alta de empleado» al recibir la comunicación de RR. HH."},
            {"type": "h2", "text": "Pasos"},
            {"type": "number", "text": "Crear la cuenta en Active Directory en la OU del departamento."},
            {"type": "number", "text": "Asignar licencia de Microsoft 365 E3."},
            {"type": "number", "text": "Preparar el portátil con Autopilot y comprobar el cifrado."},
            {"type": "number", "text": "Entregar el equipo y las credenciales en persona."},
            {"type": "callout", "text": "Nunca envíes contraseñas iniciales por correo."}], parent=wiki, who="Marta Ruiz")
        page("Acta del comité de TI · mes anterior", "🗂", "minutes", [
            {"type": "callout", "text": "Asistentes: Dirección financiera, Ana Torres, Luis Pérez, Carla Méndez"},
            {"type": "h2", "text": "Decisiones"},
            {"type": "bullet", "text": "Se aprueba la ventana de migración de facturación (NUB-4)."},
            {"type": "bullet", "text": "Se prioriza el MFA para el personal de planta (SEG-3)."},
            {"type": "h2", "text": "Acuerdos"},
            {"type": "todo", "text": "Presentar coste mensual real de AWS frente a presupuesto", "checked": False},
            {"type": "todo", "text": "Cerrar la selección de proveedor de portátiles", "checked": True}], parent=wiki)
        kb = page("Base de conocimiento", "📚", "kb", [
            {"type": "p", "text": "Soluciones a problemas frecuentes. Los artículos nuevos se pueden generar al cerrar un incidente."}], pos=2048)
        page("El correo va lento en Outlook", "📘", "kb", [
            {"type": "callout", "text": "Basado en MDA-7. Autoservicio: la persona usuaria puede seguir estos pasos."},
            {"type": "h2", "text": "Síntomas"}, {"type": "bullet", "text": "Outlook tarda en enviar o recibir y muestra «Intentando conectar»."},
            {"type": "h2", "text": "Solución"},
            {"type": "number", "text": "Cierra Outlook y vuelve a abrirlo."},
            {"type": "number", "text": "Comprueba en la esquina inferior si indica «Trabajar sin conexión» y desactívalo."},
            {"type": "number", "text": "Si persiste, abre una solicitud indicando tu sede."}], parent=kb, who="Diego Herrera")
        db.execute("INSERT INTO page_tasks (page_id, task_id) SELECT p.id, ? FROM pages p WHERE p.title LIKE 'Acta del comité%'",
                   (tids["Migrar base de datos de facturación a RDS"][0],))
        db.execute("INSERT INTO page_tasks (page_id, task_id) SELECT p.id, ? FROM pages p WHERE p.title LIKE 'Acta del comité%'",
                   (tids["MFA para todos los usuarios corporativos"][0],))
        logging.getLogger("panel-ti").info("Datos de demostración creados. Contraseña de las cuentas demo: %s", DEMO_PASSWORD)
