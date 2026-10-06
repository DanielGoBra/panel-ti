# Panel TI · Gestión tipo Notion para Comité de Tecnología

Aplicación web completa (frontend + backend + base de datos) para gestionar proyectos y tareas de TI y generar informes ejecutivos para el comité.

## Capacidades

- **Dashboard ejecutivo**: KPIs en tiempo real (tareas totales, % completado, en curso, bloqueadas, vencidas) y barras de avance por proyecto.
- **Proyectos**: crear, editar y eliminar proyectos con color, responsable y descripción.
- **Tareas**: kanban de 4 columnas (Por hacer, En curso, Bloqueada, Hecha) con **arrastrar y soltar** para cambiar de estado, prioridad, responsable, fecha límite, etiquetas y notas. Filtros por proyecto y estado.
- **Informes de comité**: genera un informe ejecutivo por período con **gráficos visuales** (donut de completado, barras por estado y por prioridad), KPIs, avance por proyecto, tareas vencidas y bloqueos que requieren atención del comité. Se puede **guardar** en el histórico, **imprimir o exportar a PDF** desde el navegador, y **exportar a Word (.docx) y Excel (.xlsx)**.
- **Exportación Word/Excel**: el servidor genera documentos .docx (con resumen ejecutivo redactado automáticamente, tablas de KPIs y barras de avance) y .xlsx (4 hojas: Resumen con gráfico de barras nativo, Proyectos, Alertas y Prioridades con gráfico circular nativo).
- **API REST** completa (`/api/projects`, `/api/tasks`, `/api/report`, `/api/reports`) sobre SQLite.

## Ejecutar

```bash
pip install flask
python3 app.py
```

Abrir `http://127.0.0.1:5000`. La base de datos `data.db` se crea automáticamente con datos de demostración.

## Estructura

```
notion-ti/
├── app.py            # Backend Flask (API REST + informes)
├── db.py             # Esquema SQLite y conexión
├── export_docx.py    # Generador de informes Word (.docx)
├── export_xlsx.py    # Generador de informes Excel (.xlsx)
├── data.db           # Base de datos (se genera sola)
└── static/
    ├── index.html    # Interfaz de 4 vistas
    ├── style.css     # Estética tipo Notion (tema oscuro)
    └── app.js        # Lógica del cliente (kanban drag&drop, informes)
```
