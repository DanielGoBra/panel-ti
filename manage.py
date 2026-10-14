"""Tareas de administración por línea de comandos.

  python3 manage.py create-admin "Nombre Apellido" correo@empresa.com
  python3 manage.py set-password correo@empresa.com
  python3 manage.py set-role correo@empresa.com admin|member|viewer
  python3 manage.py list-users
  python3 manage.py backup
  python3 manage.py run-jobs [sla|due|recurrence|backup|imap]
"""
import envfile  # noqa: F401  (debe ir primero)
import getpass
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
        info = backup.create_backup()
        print(f"Copia creada: {os.path.join(backup.BACKUP_DIR, info['name'])}")
    elif cmd == "run-jobs":
        import automation
        print(automation.run_due_jobs(force=args[0] if args else None))
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
