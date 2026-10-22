# Datos en Supabase (plan gratuito)

Con esta configuración, Panel TI guarda la base de datos en PostgreSQL de Supabase. Los adjuntos y las copias de seguridad van a Supabase Storage. El servidor de la aplicación no guarda nada, así que puede reiniciarse, cambiar de máquina o dormirse sin perder información.

Necesitas un proyecto de Supabase dedicado (o al menos sin otra aplicación que use el esquema `panel_ti`).

## 1. Crear el rol y el esquema

1. Abre `deploy/supabase.sql` y cambia `CAMBIA-ESTA-CONTRASEÑA` por una contraseña larga.
   - Usa solo letras y números: así no hay que codificarla en la URL.
   - Guárdala en tu gestor de contraseñas.
2. Si no estáis en Colombia, cambia la zona horaria (`America/Bogota`).
3. En Supabase, ve a **SQL Editor → New query**, pega el contenido y pulsa **Run**.

Esto crea el rol `panel_ti`, que solo tiene permisos sobre su propio esquema. Las tablas las crea la aplicación la primera vez que arranca.

> No añadas `panel_ti` a los **Exposed schemas** de la API de Supabase (*Project Settings → Data API*). Si no está ahí, la clave publicable no da acceso a ninguna tabla del panel.

## 2. Cadena de conexión

En Supabase, pulsa **Connect** (arriba) y elige **Session pooler**. Funciona con IPv4, que es lo que tienen casi todos los servidores y equipos. Copia la URI. Tiene esta forma:

```
postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<región>.pooler.supabase.com:5432/postgres
```

Cambia el usuario `postgres` por `panel_ti` (conserva el `.<ref>`) y pon la contraseña del paso 1:

```
DATABASE_URL=postgresql://panel_ti.<ref>:<contraseña>@aws-0-<región>.pooler.supabase.com:5432/postgres
```

La conexión va cifrada. Para validar además el certificado:
1. Descarga el certificado de *Project Settings → Database → SSL Configuration*.
2. Añade al final de la URI: `?sslmode=verify-full&sslrootcert=/ruta/prod-ca-2021.crt`.

## 3. Clave para Storage

En **Project Settings → API Keys**, crea o copia una clave **secreta** (`sb_secret_…`).

- No sirve la publicable (`sb_publishable_…`): el servidor necesita la secreta para el bucket privado.
- La clave secreta da acceso total al proyecto. Ponla solo en el `.env` del servidor o en los secretos de la plataforma. Nunca en el repositorio, en el navegador ni en un chat.

El bucket `panel-ti` (privado) se crea solo con la primera subida.

## 4. Variables del `.env`

```ini
DATABASE_URL=postgresql://panel_ti.<ref>:<contraseña>@aws-0-<región>.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
TZ=America/Bogota
PANEL_TI_NO_SEED=1
```

Arranca la aplicación (`python serve.py`). Para comprobar que usa Supabase, entra en **Ajustes → Copias de seguridad**. Debe decir:
- «PostgreSQL · esquema panel_ti».
- «Copias en Supabase Storage · panel-ti/copias».

## 5. Pasar los datos que ya tengas (opcional)

Si ya usabais Panel TI con el archivo SQLite, para la aplicación y ejecuta, con el `.env` anterior:

```bash
python manage.py import data.db          # copia todas las tablas a Supabase
python manage.py upload-files            # sube los adjuntos de la carpeta uploads/
```

`import` se niega si la base de destino ya tiene datos. Para sustituirlos, añade `--replace`.

## 6. Tareas programadas

Mientras el servidor esté siempre encendido, no hay que hacer nada: un hilo interno se encarga de los avisos de SLA y vencimiento, las tareas recurrentes y la copia diaria.

Si la plataforma duerme el servidor entre peticiones (servicios gratuitos, Cloudflare Workers):
1. Pon `PANEL_TI_SCHEDULER=0` y define `CRON_SECRET` con una cadena aleatoria larga.
2. Programa una llamada cada 5 minutos:

```
POST https://panel.tudominio.com/api/cron
Authorization: Bearer <CRON_SECRET>
```

## Límites del plan gratuito de Supabase

- **500 MB de base de datos y 1 GB de archivos.** Para un equipo pequeño dan para años; el tamaño actual se ve en **Ajustes**.
- **Pausa por inactividad:** el proyecto se pausa tras una semana sin uso. Se reactiva desde el panel de Supabase y los datos se conservan.
- **Copias propias:** el plan gratuito no ofrece copias que puedas descargar. Panel TI guarda cada día una exportación completa (`panel-ti-AAAAMMDD-HHMMSS.json.gz`) en Storage y conserva las 14 últimas.
  - Para restaurar una: `python manage.py import copia.json.gz --replace`.
  - Conviene descargar alguna de vez en cuando desde **Ajustes**, por si se pierde el acceso al proyecto.
