"""Datos de demostración. Las fechas se calculan respecto al día de hoy para que
el tablero, el calendario y las métricas siempre muestren un escenario vigente."""
import os
import random
from datetime import datetime, timedelta

from db import get_db

MEMBERS = [
    ("Ana Torres", "ana.torres@empresa.com", "Arquitecta cloud", "Infraestructura", 8),
    ("Luis Pérez", "luis.perez@empresa.com", "Responsable de seguridad", "Seguridad", 7),
    ("Marta Ruiz", "marta.ruiz@empresa.com", "Coordinadora de soporte", "Mesa de ayuda", 10),
    ("Jorge Salinas", "jorge.salinas@empresa.com", "Administrador de sistemas", "Infraestructura", 8),
    ("Carla Méndez", "carla.mendez@empresa.com", "Analista funcional ERP", "Aplicaciones", 6),
    ("Diego Herrera", "diego.herrera@empresa.com", "Técnico de soporte N2", "Mesa de ayuda", 10),
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


def seed_demo_data(force=False):
    if os.environ.get("PANEL_TI_NO_SEED") and not force:
        return
    with get_db() as db:
        if db.execute("SELECT COUNT(*) FROM projects").fetchone()[0] and not force:
            return
        rnd = random.Random(7)
        now = datetime.now().replace(microsecond=0)

        def ts(days_ago, hour=None):
            d = now - timedelta(days=days_ago)
            return d.replace(hour=hour if hour is not None else rnd.randint(8, 18), minute=rnd.randint(0, 59), second=0)

        for name, email, role, team, cap in MEMBERS:
            db.execute("INSERT OR IGNORE INTO members (name, email, role, team, capacity) VALUES (?,?,?,?,?)",
                       (name, email, role, team, cap))

        pids = {}
        for name, key, desc, color, owner, area, due in PROJECTS:
            cur = db.execute(
                "INSERT INTO projects (name, key, description, color, owner, area, due_date, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (name, key, desc, color, owner, area, (now + timedelta(days=due)).date().isoformat(),
                 ts(90).isoformat(sep=" ")))
            pids[key] = cur.lastrowid

        numbers = {}
        tids = {}
        for i, (pk, title, ttype, prio, who, status, created, closed, due, est, tags, notes, checklist) in enumerate(TASKS):
            numbers[pk] = numbers.get(pk, 0) + 1
            created_at = ts(created)
            completed_at = ts(closed) if closed is not None else None
            if completed_at and completed_at < created_at:
                completed_at = created_at + timedelta(hours=4)
            started_at = None
            if status != "todo":
                span = (completed_at or now) - created_at
                started_at = created_at + span * rnd.uniform(0.1, 0.4)
            updated_at = completed_at or (now - timedelta(hours=rnd.randint(1, 72)))
            due_date = (now + timedelta(days=due)).date().isoformat() if due is not None else ""
            start_date = (created_at + timedelta(days=1)).date().isoformat()
            cur = db.execute(
                """INSERT INTO tasks (project_id, number, title, notes, status, priority, type, assignee, start_date, due_date,
                   estimate, tags, position, created_at, updated_at, started_at, completed_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (pids[pk], numbers[pk], title, notes, status, prio, ttype, who, start_date, due_date, est, tags,
                 (i + 1) * 1024, created_at.isoformat(sep=" "), updated_at.isoformat(sep=" "),
                 started_at.replace(microsecond=0).isoformat(sep=" ") if started_at else None,
                 completed_at.isoformat(sep=" ") if completed_at else None))
            tid = cur.lastrowid
            tids[title] = (tid, pids[pk])
            for j, text in enumerate(checklist):
                done = 1 if status == "done" or j < len(checklist) // 2 else 0
                db.execute("INSERT INTO checklist_items (task_id, text, done, position) VALUES (?,?,?,?)", (tid, text, done, j + 1))
            db.execute("INSERT INTO activity (task_id, project_id, actor, action, task_title, created_at) VALUES (?,?,?,?,?,?)",
                       (tid, pids[pk], who, "created", title, created_at.isoformat(sep=" ")))
            if completed_at:
                db.execute("""INSERT INTO activity (task_id, project_id, actor, action, field, old_value, new_value, task_title, created_at)
                              VALUES (?,?,?,?,?,?,?,?,?)""",
                           (tid, pids[pk], who, "updated", "status", "in_progress", "done", title, completed_at.isoformat(sep=" ")))
            elif status != "todo":
                db.execute("""INSERT INTO activity (task_id, project_id, actor, action, field, old_value, new_value, task_title, created_at)
                              VALUES (?,?,?,?,?,?,?,?,?)""",
                           (tid, pids[pk], who, "updated", "status", "todo", status, title, updated_at.isoformat(sep=" ")))

        for k, (title, author, text) in enumerate(COMMENTS):
            tid, pid = tids[title]
            stamp = (now - timedelta(hours=30 - k * 5)).isoformat(sep=" ")
            db.execute("INSERT INTO comments (task_id, author, body, created_at) VALUES (?,?,?,?)", (tid, author, text, stamp))
            db.execute("""INSERT INTO activity (task_id, project_id, actor, action, new_value, task_title, created_at)
                          VALUES (?,?,?,?,?,?,?)""", (tid, pid, author, "commented", text[:140], title, stamp))
        db.commit()
