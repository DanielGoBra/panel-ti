"""Carga variables desde un archivo .env junto al proyecto (sin sobrescribir las ya definidas).

Se importa antes que el resto de módulos para que rutas y claves estén disponibles al arrancar.
"""
import os

_path = os.environ.get("PANEL_TI_ENV", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
if os.path.exists(_path):
    with open(_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            os.environ.setdefault(key.strip(), value)
