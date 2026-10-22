-- Panel TI en Supabase: un rol propio que solo puede tocar su esquema «panel_ti».
--
-- 1. Cambia la contraseña de abajo por una larga y aleatoria (guárdala: va en DATABASE_URL).
-- 2. Ajusta la zona horaria si no estáis en Colombia.
-- 3. Ejecútalo en Supabase → SQL Editor → New query → Run.
--
-- Las tablas las crea la aplicación al arrancar. No añadas «panel_ti» a los «Exposed schemas»
-- de la API de Supabase: así nadie puede leerlas con la clave publicable.

create role panel_ti login password 'CAMBIA-ESTA-CONTRASEÑA';
grant panel_ti to postgres;  -- necesario para crear el esquema a su nombre
create schema if not exists panel_ti authorization panel_ti;

-- Valen aunque la conexión pase por un pooler en modo transacción
alter role panel_ti set search_path = panel_ti;
alter role panel_ti set timezone = 'America/Bogota';
