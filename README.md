# Panel TI

Espacio de trabajo propio, al estilo Notion, para que los equipos de TI y las áreas corporativas gestionen tareas, incidentes, cambios y documentación, y preparen los informes del comité de tecnología. Está hecho con Flask, SQLite y JavaScript sin paso de compilación.

## Qué incluye

**Trabajo diario**
- **Inicio**: indicadores del día (abiertas, cerradas en la semana, vencidas, bloqueadas, cumplimiento de SLA y riesgo de retraso), flujo semanal, carga por persona, salud de proyectos, lo que requiere atención, cambios pendientes del CAB y actividad reciente.
- **Tablero kanban**: se arrastra para cambiar el estado y el orden. Admite límites WIP, alta rápida en cada columna y motivo obligatorio al bloquear. Cada tarjeta muestra SLA, dependencias, aprobación, subtareas, adjuntos y riesgo de retraso.
- **Lista**: se puede agrupar, ordenar, editar en línea y aplicar acciones masivas, que respetan las reglas del flujo.
- **Calendario** con reprogramación por arrastre, y **Mis tareas** agrupadas por vencimiento.
- **Detalle de tarea**:
  - Propiedades y campos personalizados.
  - Subtareas y dependencias («espera a…»).
  - Checklist y adjuntos: arrastrar, pegar capturas o elegir archivo.
  - Activos vinculados.
  - Comentarios con @menciones.
  - Repetición.
  - Historial completo.

**Documentación tipo Notion**
- **Páginas** anidadas para la wiki del área, procedimientos, actas del comité y base de conocimiento.
- **Editor de bloques**:
  - Atajos markdown: `#`, `-`, `1.`, `[]`, `>`, `!!`, `` ``` ``, `---`.
  - Menú `/` para insertar bloques.
  - Negrita y cursiva.
  - Tareas enlazadas con su estado en vivo e imágenes.
  - Reordenación arrastrando, autoguardado y aviso si otra persona edita a la vez.
- Las claves de tarea escritas en una página (`NUB-12`) se enlazan solas, y la tarea muestra las páginas que la mencionan.
- Plantillas de página (acta de comité, procedimiento, post-mortem) y exportación a Markdown.

**Específico de TI**
- **SLA de incidentes**: plazo de respuesta y de resolución por prioridad, con cuenta atrás, avisos al 75 % del plazo y al superarlo, y cumplimiento en el inicio y en el informe.
- **Aprobación de cambios (CAB)**: un cambio no puede pasar a «En curso» sin aprobación registrada. Quien solicita no puede aprobar su propio cambio, y el rechazo exige motivo.
- **Inventario de activos** (servidores, aplicaciones, equipos…) con el historial de incidentes y cambios de cada uno.
- **Plantillas de tarea** con checklist y subtareas, por ejemplo alta de empleado, baja o parcheo mensual.
- **Tareas recurrentes**: semanal, quincenal, mensual, trimestral o anual. Se crean solas antes de su vencimiento.
- **Campos personalizados** (texto, número, lista, fecha, casilla, enlace), globales o por proyecto.

**Equipo y control**
- Inicio de sesión con **Google** (Gmail o Workspace), **Microsoft Entra ID** o contraseña. Se puede limitar a una lista de correos y desactivar las contraseñas. Roles de **administración**, **miembro** y **lectura**, y marca de **CAB**.
- **Avisos** dentro de la app (campana), por **correo** y en un canal de **Teams**: asignaciones, menciones, comentarios, vencimientos, bloqueos, aprobaciones y SLA.
- **Actualización en vivo**: los cambios de otras personas aparecen en unos segundos sin recargar.
- **Entrada de solicitudes** desde el correo (IMAP) o desde cualquier sistema mediante un webhook (Power Automate, Teams, formularios). Se clasifican y asignan solas.

**Asistencia (con o sin IA)**
- **Sugerir campos** al crear una tarea: propone tipo, prioridad, responsable y proyecto, y muestra las tareas parecidas ya resueltas.
- **Preguntas en lenguaje natural** desde `Ctrl/⌘ K`, por ejemplo «¿qué tiene bloqueado Carla?» o «cambios de esta semana sin aprobar». La respuesta se convierte en un filtro de la lista.
- **Riesgo de retraso**: compara lo que falta con lo que suele tardar cada tipo de trabajo y cada persona, y avisa antes de que la tarea venza.
- **Artículo de conocimiento** a partir de un incidente resuelto.
- **Informe del comité redactado** con tendencias, riesgos, recomendaciones y orden del día (requiere IA).

Sin clave de API todo esto funciona con métodos locales: similitud de texto, palabras clave e intérprete de preguntas en español. Con `ANTHROPIC_API_KEY` se usa Claude.

**Informes**: KPIs, SLA, avance por proyecto, bloqueos con su motivo, vencidas, riesgo de retraso y cambios pendientes. Se guardan en un histórico y se exportan a Word, Excel e impresión/PDF, además de un CSV con todas las tareas.

## Probarlo en local

```bash
pip install -r requirements.txt
python3 app.py            # servidor de desarrollo en http://127.0.0.1:5000
```

La primera vez se crea `data.db` con datos de demostración fechados respecto a hoy. Todas las cuentas de la demo usan la contraseña `demo-panel-ti`:

| Cuenta | Rol |
|---|---|
| ana.torres@empresa.com | Administración y CAB |
| luis.perez@empresa.com | Miembro y CAB |
| marta.ruiz@empresa.com, jorge.salinas@empresa.com, diego.herrera@empresa.com | Miembro |
| carla.mendez@empresa.com | Miembro y CAB |
| elena.vidal@empresa.com | Lectura (dirección financiera) |

Si ya tenías un `data.db` de una versión anterior, se migra solo al arrancar, sin perder datos. Las personas existentes no tienen contraseña: la primera vez que abras la app te pedirá crear la cuenta de administración, y desde **Equipo** podrás dar acceso al resto (se genera una contraseña temporal). Para empezar con la demo nueva, renombra antes `data.db`.

## Puesta en producción

**Sin coste**: con un subdominio de un dominio que ya tengas, Cloudflare Tunnel y el acceso con Google se puede publicar desde un equipo propio sin pagar servidor. La guía paso a paso está en [`deploy/PUBLICAR.md`](deploy/PUBLICAR.md).

Usa `serve.py` (servidor **waitress**, funciona en Windows y en Linux) detrás de un proxy con HTTPS. Copia `.env.example` como `.env` y define al menos `SECRET_KEY` y `PANEL_TI_NO_SEED=1`.

**Opción A · Docker con HTTPS automático** (Linux con un dominio que apunte al servidor):
```bash
cp .env.example .env        # define SECRET_KEY y PANEL_TI_DOMAIN=panel-ti.empresa.com
docker compose up -d        # Caddy obtiene el certificado y redirige a HTTPS
docker compose exec app python manage.py create-admin "Nombre Apellido" correo@empresa.com
```
Los datos, adjuntos y copias quedan en el volumen `panel-data`.

**Opción B · Servidor Windows** (lo habitual en un área de TI corporativa):
```powershell
pip install -r requirements.txt
python manage.py create-admin "Nombre Apellido" correo@empresa.com
.\deploy\instalar-servicio-windows.ps1     # lo registra como servicio con NSSM (puerto 8000)
```
Para HTTPS, publícalo con **IIS** (módulos URL Rewrite y ARR) como proxy inverso hacia `http://localhost:8000` con el certificado de la empresa, y define `TRUST_PROXY=1` y `COOKIE_SECURE=1`.

**Opción C · Linux sin Docker**: hay un servicio systemd de ejemplo en `deploy/panel-ti.service`. Ponle delante Nginx o Caddy para el HTTPS.

**Copias de seguridad**: la app hace una copia en caliente de la base cada 24 h y conserva las 14 últimas en `backups/` (variables `PANEL_TI_BACKUP_HOURS` y `PANEL_TI_BACKUP_KEEP`). También se pueden crear y descargar desde **Ajustes** o con `python manage.py backup`. Incluye la carpeta `uploads/` en la copia del servidor.

**Base de datos**: SQLite en modo WAL soporta sin problema un área de TI de decenas de personas. Si el uso crece mucho (cientos de usuarios concurrentes o varios servidores), el siguiente paso es migrar a PostgreSQL. Ese cambio aún no está hecho.

**Un solo proceso**: los avisos programados, las recurrencias y las copias corren en un hilo del propio servidor. `serve.py` ya usa un único proceso con varios hilos; no lo arranques con varios workers de gunicorn.

## Integraciones

| Integración | Cómo activarla |
|---|---|
| **Google** | En Google Cloud, crea un *ID de cliente de OAuth* de tipo aplicación web con la URI `https://TU-DOMINIO/auth/google/callback` y define `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Con cuentas de Gmail, limita el acceso con `ALLOWED_EMAILS`; con Google Workspace, con `ALLOWED_DOMAINS`. `ADMIN_EMAILS` indica quién entra como administración. Pasos completos en [`deploy/PUBLICAR.md`](deploy/PUBLICAR.md). |
| **Microsoft Entra ID** | En Azure, *Registros de aplicaciones → Nuevo registro*, con URI de redirección web `https://TU-DOMINIO/auth/microsoft/callback`. Crea un secreto de cliente y define `MS_TENANT_ID`, `MS_CLIENT_ID` y `MS_CLIENT_SECRET`. Al entrar, la persona se vincula por correo con su ficha; si no existe, se crea con el rol `MS_DEFAULT_ROLE` (o desactívalo con `MS_AUTO_PROVISION=0`). |
| **Correo de avisos** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Cada persona puede desactivarlo desde su perfil. Define `PUBLIC_URL` para que los enlaces apunten bien. |
| **Teams** | En el canal, *Workflows → Publicar en un canal cuando se recibe una solicitud de webhook*. Pega la URL en **Ajustes → Avisos en Microsoft Teams** y pulsa *Probar*. |
| **Solicitudes por correo** | Opción 1: define `IMAP_HOST`, `IMAP_USER` e `IMAP_PASSWORD` del buzón de soporte; cada correo no leído se convierte en tarea. Opción 2: genera la dirección en **Ajustes → Entrada de solicitudes** y envía un POST JSON con `subject`, `body` y `from` (desde Power Automate, un formulario o un bot de Teams). |
| **IA (Claude)** | `ANTHROPIC_API_KEY` (y opcionalmente `PANEL_TI_AI_MODEL`). Se envían al modelo el texto de la tarea o del informe y la lista de personas y proyectos; no se envían adjuntos. Sin clave, se usan las alternativas locales. |

## Seguridad

- Acceso con Google o Microsoft validando audiencia, emisor, `nonce`, caducidad y correo verificado. Con `ALLOWED_EMAILS`/`ALLOWED_DOMAINS` solo entran esas cuentas o las que administración da de alta, y con `PASSWORD_LOGIN=0` se desactivan las contraseñas.
- Contraseñas con hash (scrypt) y bloqueo temporal tras 5 intentos fallidos. Cambiar la contraseña cierra las demás sesiones.
- Cookies `HttpOnly` y `SameSite=Lax` (`Secure` con `COOKIE_SECURE=1`). Las escrituras exigen una cabecera propia contra CSRF.
- Política de seguridad de contenido (CSP) estricta, sin scripts en línea. El contenido de páginas y comentarios se escapa siempre.
- Adjuntos con lista de extensiones permitidas y límite de tamaño (`MAX_UPLOAD_MB`, 25 MB por defecto). Se sirven con una CSP aislada.
- Permisos comprobados en el servidor: el rol de lectura no puede escribir, solo administración gestiona personas y ajustes, y solo el CAB decide sobre los cambios.

## Línea de comandos

```bash
python manage.py create-admin "Nombre Apellido" correo@empresa.com
python manage.py set-password correo@empresa.com
python manage.py set-role correo@empresa.com admin|member|viewer
python manage.py list-users
python manage.py backup
python manage.py run-jobs [sla|due|recurrence|backup|imap]
```

## Pruebas

```bash
python3 -m unittest discover tests
```

## API (resumen)

Todas las rutas `/api/*` requieren sesión, salvo `/api/auth/status|login|setup` y `/api/inbound/<token>`. Las escrituras necesitan la cabecera `X-Requested-With: panel-ti`.

| Área | Rutas |
|---|---|
| Sesión | `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/setup`, `POST /api/auth/logout`, `PUT /api/auth/me`, `/auth/google/login`, `/auth/microsoft/login` |
| Arranque y vivo | `GET /api/bootstrap`, `GET /api/sync` |
| Tareas | `/api/tasks[/<id>]`, `/api/tasks/bulk`, `/duplicate`, `/deps`, `/approval`, `/recurrence`, `/assets`, `/checklist`, `/comments`, `/attachments` |
| Páginas | `/api/pages[/<id>]`, `/api/pages/search`, `/api/pages/<id>/attachments` |
| Catálogos | `/api/projects`, `/api/members` (y `/reset-password`), `/api/assets`, `/api/custom-fields`, `/api/templates` (y `/apply`) |
| Avisos | `GET /api/notifications`, `POST /api/notifications/read`, `POST /api/notifications/test` |
| Métricas e informes | `/api/metrics`, `/api/activity`, `/api/report`, `/api/reports`, `/api/export/docx|xlsx|tasks.csv` |
| Asistencia | `POST /api/ai/classify`, `/api/ai/query`, `/api/ai/report`, `/api/ai/kb/<id>` |
| Administración | `GET /api/admin/status`, `POST /api/admin/backup`, `GET /api/admin/backups/<nombre>`, `PUT /api/settings` |
| Entrada externa | `POST /api/inbound/<token>` |

## Estructura

```
panel-ti/
├── app.py            Aplicación Flask: sesión, seguridad y registro de módulos
├── serve.py          Servidor de producción (waitress)
├── manage.py         Administración por línea de comandos
├── envfile.py        Carga del archivo .env
├── db.py             Esquema SQLite y migraciones
├── core.py           Utilidades comunes y ajustes
├── auth.py           Contraseñas, roles, CSRF y acceso con Google y Microsoft
├── api_tasks.py      Tareas y reglas de flujo (dependencias, subtareas, CAB, recurrencia)
├── api_core.py       Proyectos, personas, métricas e informes
├── api_pages.py      Páginas y bloques
├── api_misc.py       Activos, adjuntos, campos, plantillas, IA, administración y entrada externa
├── notify.py         Avisos en la app, correo y Teams
├── sla.py            SLA y predicción de retrasos
├── ai.py             Claude y alternativas locales
├── automation.py     Trabajos programados
├── backup.py         Copias de seguridad
├── seed.py           Datos de demostración
├── export_docx.py    Informe Word
├── export_xlsx.py    Informe Excel
├── deploy/           Guía de publicación gratuita, Caddyfile, servicio systemd y servicio de Windows
├── tests/            Pruebas de la API
└── static/           Interfaz (index.html, css/, js/ y js/views/)
```
