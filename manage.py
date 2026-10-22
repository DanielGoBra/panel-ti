"""Tareas de administración por línea de comandos.

  python3 manage.py create-admin "Nombre Apellido" correo@empresa.com
  python3 manage.py set-password correo@empresa.com
  python3 manage.py set-role correo@empresa.com admin|member|viewer
  python3 manage.py list-users
  python3 manage.py backup
  python3 manage.py export copia.json.gz
  python3 manage.py import data.db|copia.json.gz [--replace]
  python3 manage.py upload-files
  python3 manage.py run-jobs [sla|due|recurrence|backup|imap]
"""
import envfile  # noqa: F401  (debe ir primero)
import getpass
import gzip
import json
import os
import sys

os.environ.setdefault("PANEL_TI_SCHEDULER", "0")
os.environ.setdefault("PANEL_TI_NO_SEED", "1")

from auth import check_password_policy, hash_password  # noqa: E402
from db import ROLES, get_db, init_db  # noqa: E402


def ask_password():
    while True:
        pw = getpass.getpass("Contraseña: ")
        err = check_password_policy(pw)
        if err:
            print(err)
            continue
        if pw != getpass.getpass("Repite la contraseña: "):
            print("No coinciden.")
            continue
        return pw


def main(argv):
    init_db()
    if len(argv) < 2:
        print(__doc__)
        return 1
    cmd, args = argv[1], argv[2:]
    if cmd == "create-admin" and len(args) == 2:
        name, email = args
        pw = ask_password()
        with get_db() as db:
            row = db.execute("SELECT id FROM members WHERE lower(name)=lower(?) OR lower(email)=lower(?)", (name, email)).fetchone()
            if row:
                db.execute("UPDATE members SET name=?, email=?, password_hash=?, role='admin', active=1 WHERE id=?",
                           (name, email.lower(), hash_password(pw), row["id"]))
            else:
                db.execute("INSERT INTO members (name, email, password_hash, role) VALUES (?,?,?,'admin')", (name, email.lower(), hash_password(pw)))
        print(f"Cuenta de administración lista para {email}.")
    elif cmd == "set-password" and len(args) == 1:
        pw = ask_password()
        with get_db() as db:
            n = db.execute("UPDATE members SET password_hash=? WHERE lower(email)=lower(?)", (hash_password(pw), args[0])).rowcount
        print("Contraseña actualizada." if n else "No hay ninguna persona con ese correo.")
    elif cmd == "set-role" and len(args) == 2 and args[1] in ROLES:
        with get_db() as db:
            n = db.execute("UPDATE members SET role=? WHERE lower(email)=lower(?)", (args[1], args[0])).rowcount
        print("Rol actualizado." if n else "No hay ninguna persona con ese correo.")
    elif cmd == "list-users":
        with get_db() as db:
            for m in db.execute("SELECT name, email, role, active, password_hash<>'' AS pw FROM members ORDER BY name"):
                print(f"{m['name']:<28} {m['email'] or '-':<34} {m['role']:<7} {'activa' if m['active'] else 'inactiva':<9} {'con contraseña' if m['pw'] else 'sin contraseña'}")
    elif cmd == "backup":
        import backup
        import storage
        info = backup.create_backup()
        print(f"Copia creada: {info['name']} en {storage.backups().location}")
    elif cmd == "export" and len(args) == 1:
        import backup
        from db import connect
        conn = connect()
        try:
            data = backup.export_data(conn)
        finally:
            conn.close()
        raw = json.dumps(data, ensure_ascii=False).encode()
        with open(args[0], "wb") as f:
            f.write(gzip.compress(raw) if args[0].endswith(".gz") else raw)
        print(f"Exportadas {sum(len(t['rows']) for t in data['tables'].values())} filas a {args[0]}.")
    elif cmd == "import" and len(args) in (1, 2) and args[1:] in ([], ["--replace"]):
        import backup
        data = backup.read_export(args[0])
        try:
            with get_db() as db:
                counts = backup.import_data(db, data, replace=bool(args[1:]))
        except ValueError as e:
            print(e)
            return 1
        print("Importado: " + ", ".join(f"{t} {n}" for t, n in counts.items()))
    elif cmd == "upload-files":
        # Sube a Supabase Storage los adjuntos que estaban en la carpeta local
        import storage
        if not storage.supabase_enabled():
            print("Define SUPABASE_URL y SUPABASE_SECRET_KEY para usar este comando.")
            return 1
        local, remote = storage.LocalStore(storage.UPLOAD_DIR), storage.uploads()
        done = missing = 0
        with get_db() as db:
            rows = db.execute("SELECT stored_name, mime FROM attachments").fetchall()
        for r in rows:
            data = local.get(r["stored_name"])
            if data is None:
                missing += 1
                continue
            remote.put(r["stored_name"], data, r["mime"])
            done += 1
        print(f"Subidos {done} adjuntos a {remote.location}." + (f" {missing} no estaban en {storage.UPLOAD_DIR}." if missing else ""))
    elif cmd == "run-jobs":
        import automation
        print(automation.run_due_jobs(force=args[0] if args else None))
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
