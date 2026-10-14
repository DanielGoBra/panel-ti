# Panel TI

Espacio de trabajo propio, al estilo Notion, para que los equipos de TI y las áreas corporativas gestionen tareas y proyectos y preparen los informes del comité de tecnología. Flask, SQLite y JavaScript sin dependencias de compilación.

## Qué incluye

**Vistas de trabajo**
- **Inicio**: indicadores del día (abiertas, cerradas en 7 días frente a la semana anterior, vencidas, bloqueadas, vencimientos de la semana, tiempo de ciclo mediano), flujo semanal de tareas creadas y cerradas, carga por persona, salud de proyectos, lo que requiere atención, próximos vencimientos y actividad reciente.
- **Mis tareas**: lo asignado a la persona activa, agrupado en vencidas, hoy, próximos 7 días, más adelante y sin fecha. Se cierran con un clic y se pueden deshacer.
- **Tablero kanban**: cinco columnas (Por hacer, En curso, En revisión, Bloqueada, Hecha). Se arrastra para cambiar el estado y el orden. Admite límites de trabajo en curso (WIP) por columna y alta rápida en cada columna. Al bloquear una tarea se pide el motivo, que queda como comentario y llega al informe del comité. Las tareas cerradas hace más de 14 días se ocultan, aunque se pueden mostrar.
- **Lista**: tabla ordenable y agrupable por estado, proyecto, responsable o prioridad. Permite editar en línea y aplicar acciones masivas (estado, prioridad, responsable, proyecto o eliminar) sobre una selección.
- **Calendario** mensual por fecha de vencimiento. Se arrastra una tarea a otro día para reprogramarla.
- **Proyectos**: cada proyecto tiene clave propia (`NUB-12`), área, responsable, fecha objetivo y estado (activo, en pausa o cerrado). Muestra el avance y un semáforo: en plazo, vigilar o en riesgo.
- **Equipo**: personas con puesto, equipo y capacidad. Indica la ocupación (abiertas sobre capacidad), las vencidas y lo cerrado en los últimos 30 días.
- **Informes de comité**: periodos predefinidos o un rango libre, con un resumen redactado a partir de los datos, KPIs, gráficos, avance por proyecto, bloqueos con su motivo y tareas vencidas. Se puede guardar en el histórico o exportar a Word, Excel e impresión/PDF.

**Detalle de tarea** (panel lateral, con enlace propio `#/tablero?t=ID`): propiedades editables (estado, prioridad, tipo, responsable, proyecto, inicio, vencimiento, estimación y etiquetas), descripción, checklist con progreso, comentarios e historial de cambios con autor.

**Tipos de trabajo de TI**: tarea, incidente, cambio, solicitud y mejora.

**Productividad**: paleta de comandos con `Ctrl/⌘ K`, atajos (`C` crea una tarea, `/` filtra, `G` seguido de una letra navega y `?` muestra la ayuda), filtros persistentes, tema claro y oscuro, diseño adaptable a móvil y exportación de todas las tareas a CSV.

## Ejecutar

```bash
pip install -r requirements.txt
python3 app.py
```

Abre `http://127.0.0.1:5000`. La primera vez se crea `data.db` con datos de demostración fechados respecto al día actual. Variables opcionales:

| Variable | Uso |
|---|---|
| `PANEL_TI_DB` | Ruta de la base de datos SQLite |
| `PANEL_TI_NO_SEED=1` | Arrancar sin datos de demostración |
| `HOST`, `PORT` | Dirección y puerto del servidor |

Las bases de datos creadas con versiones anteriores se migran solas al arrancar sin perder información.

La persona activa se elige abajo a la izquierda. No hay inicio de sesión: el nombre se envía en la cabecera `X-User` y se usa como autor de comentarios y cambios.

## Pruebas

```bash
python3 -m unittest discover tests
```

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/bootstrap` | Proyectos, personas, tareas y ajustes en una sola llamada |
| GET/POST | `/api/tasks` | Listar (filtros `project_id`, `status`, `assignee`, `priority`, `type`, `q`) y crear |
| GET/PUT/DELETE | `/api/tasks/<id>` | Detalle con checklist, comentarios e historial; actualizar; eliminar |
| POST | `/api/tasks/<id>/duplicate` | Duplicar con su checklist |
| POST | `/api/tasks/bulk` | `{ids, changes}` o `{ids, delete: true}` |
| POST | `/api/tasks/<id>/checklist` · PUT/DELETE `/api/checklist/<id>` | Checklist |
| POST | `/api/tasks/<id>/comments` · DELETE `/api/comments/<id>` | Comentarios |
| GET/POST/PUT/DELETE | `/api/projects[/<id>]` | Proyectos |
| GET/POST/PUT/DELETE | `/api/members[/<id>]` | Personas (renombrar actualiza las asignaciones) |
| GET/PUT | `/api/settings` | Límites WIP y nombre del espacio |
| GET | `/api/metrics` | Indicadores, flujo semanal, carga y salud de proyectos |
| GET | `/api/activity` | Actividad reciente |
| GET | `/api/report` · `/api/export/docx` · `/api/export/xlsx` · `/api/export/tasks.csv` | Informes y exportaciones |
| GET/POST/DELETE | `/api/reports[/<id>]` | Histórico de informes guardados |

## Estructura

```
panel-ti/
├── app.py            API REST, métricas e informes
├── db.py             Esquema SQLite y migraciones
├── seed.py           Datos de demostración
├── export_docx.py    Informe Word
├── export_xlsx.py    Informe Excel
├── tests/            Pruebas de la API
└── static/
    ├── index.html
    ├── css/app.css   Sistema visual (tokens claro/oscuro)
    └── js/
        ├── main.js       Enrutado, barra lateral y atajos
        ├── store.js      Estado y operaciones con la API
        ├── taskpanel.js  Panel de detalle de tarea
        ├── charts.js     Gráficos SVG con tooltip y tabla de datos
        ├── palette.js    Paleta de comandos
        ├── ui.js         Componentes, modales y selectores
        └── views/        Inicio, Mis tareas, Tablero, Lista, Calendario, Proyectos, Equipo, Informes
```
