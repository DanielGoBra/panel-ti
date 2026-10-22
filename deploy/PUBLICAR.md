# Publicar Panel TI sin coste

Guía para un equipo pequeño que quiere entrar desde cualquier lugar con sus cuentas de Google, sin pagar servidor ni dominio nuevo.

## Qué se usa

| Pieza | Coste | Para qué |
|---|---|---|
| Un **subdominio** del dominio que ya tienes (p. ej. `panel.tudominio.com`) | 0 | La dirección de la app. Tu web actual sigue igual. |
| **Cloudflare** (plan gratuito) | 0 | DNS, HTTPS y el túnel. |
| **Cloudflare Tunnel** | 0 | Publica la app desde un equipo tuyo sin abrir puertos ni tener IP fija. |
| **Google Cloud** (cliente OAuth) | 0 | El botón «Continuar con Google». |
| Un **equipo que esté encendido** (tu PC, un portátil viejo o una Raspberry Pi) | 0 | Donde corre Panel TI. |

Si no quieres depender de un equipo encendido, la alternativa sin coste es una máquina **Oracle Cloud Always Free** (pide tarjeta para verificar la identidad, pero no cobra). Los pasos 2 a 5 son iguales.

## 1. Pasar el DNS del dominio a Cloudflare

1. Crea una cuenta en cloudflare.com y añade tu dominio (plan **Free**).
2. Cloudflare importa los registros DNS actuales. **Compáralos con los de tu proveedor** antes de seguir, sobre todo los de la web (A/CNAME) y los del correo (MX, TXT). Si falta alguno, añádelo.
3. Cambia los servidores de nombres (nameservers) en el sitio donde compraste el dominio por los dos que indica Cloudflare. La propagación tarda de minutos a unas horas.

Tu web actual no se ve afectada si los registros se copiaron bien.

## 2. Crear el túnel

1. En Cloudflare: **Zero Trust → Networks → Tunnels → Create a tunnel** → tipo *Cloudflared*.
2. Elige el sistema operativo del equipo y sigue la instrucción que aparece:
   - **Windows**: descarga `cloudflared` y ejecuta en PowerShell como administrador `cloudflared.exe service install <TOKEN>`. Queda como servicio y arranca solo.
   - **Docker**: copia el token en `.env` como `TUNNEL_TOKEN=...` y usa `docker-compose.tunnel.yml`.
3. En **Public Hostname** añade:
   - Subdomain: `panel` · Domain: tu dominio
   - Service: `HTTP` → `localhost:8000` (o `app:8000` si usas Docker)

## 3. Crear el acceso con Google

1. Entra en console.cloud.google.com y crea un proyecto (p. ej. «Panel TI»).
2. **APIs y servicios → Pantalla de consentimiento de OAuth**:
   - Tipo de usuario: **Externo**.
   - Nombre de la app, correo de asistencia y correo del desarrollador: los tuyos.
   - Permisos: deja solo los básicos (`openid`, `email`, `profile`).
   - **Usuarios de prueba**: añade los correos del equipo. Mientras la app esté en modo *Prueba* solo ellos pueden usar el botón, y no hace falta que Google la verifique (admite hasta 100 usuarios).
3. **Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - URI de redireccionamiento autorizados:
     - `https://panel.tudominio.com/auth/google/callback`
     - `http://localhost:8000/auth/google/callback` (para probar en tu equipo)
4. Copia el **ID de cliente** y el **secreto**.

## 4. Configurar Panel TI

Crea un archivo `.env` en la carpeta del proyecto:

```ini
SECRET_KEY=pon-aqui-una-cadena-larga-y-aleatoria
PANEL_TI_NO_SEED=1
PUBLIC_URL=https://panel.tudominio.com
TRUST_PROXY=1
COOKIE_SECURE=1
HOST=127.0.0.1
PORT=8000

# Acceso solo con Google y solo para estas cuentas
PASSWORD_LOGIN=0
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
ALLOWED_EMAILS=persona1@gmail.com,persona2@gmail.com,persona3@gmail.com
ADMIN_EMAILS=persona1@gmail.com
```

- `ALLOWED_EMAILS`: las únicas cuentas que pueden entrar. Las personas que administración dé de alta después en **Equipo** también podrán entrar con su correo.
- `ADMIN_EMAILS`: quién tiene rol de administración desde el primer acceso.
- `HOST=127.0.0.1`: la app solo escucha en el propio equipo; el túnel es la única entrada.
- Para generar `SECRET_KEY`: `python -c "import secrets; print(secrets.token_hex(32))"`.

Arranca el servidor de producción:

```bash
pip install -r requirements.txt
python serve.py
```

En Windows puedes dejarlo como servicio con `deploy\instalar-servicio-windows.ps1`.

## 5. Comprobar

1. Abre `https://panel.tudominio.com`. Debe aparecer solo el botón **Continuar con Google**.
2. Entra con la cuenta de administración y revisa en **Ajustes** que figure «Acceso con Google» y «Solo acceso con cuenta externa».
3. Prueba con una cuenta que no esté en la lista: debe mostrar «Esa cuenta no tiene acceso».

## Recomendable: una segunda puerta con Cloudflare Access

En **Zero Trust → Access → Applications → Add an application (Self-hosted)** para `panel.tudominio.com`, con una política *Allow* para los mismos correos. Cloudflare pedirá un código o la cuenta de Google **antes** de llegar a Panel TI, así nadie de fuera llega a ver la app. Es gratis hasta 50 usuarios.

## Copias de seguridad

Panel TI hace una copia diaria en la carpeta `backups/` del mismo equipo. Sincroniza esa carpeta y `uploads/` con Google Drive u OneDrive (con su aplicación de escritorio) para tener una copia fuera del equipo sin coste. Si usas Supabase (`deploy/SUPABASE.md`), las copias y los adjuntos ya quedan fuera del equipo.
