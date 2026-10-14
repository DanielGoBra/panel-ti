"""Servidor de producción (waitress): funciona igual en Windows y en Linux.

  python3 serve.py

Variables: HOST (0.0.0.0 para la red local), PORT (8000), THREADS (16).
Para HTTPS, pon delante un proxy inverso (Caddy, Nginx o IIS) y define
TRUST_PROXY=1 y COOKIE_SECURE=1. Ver README, sección «Despliegue».
"""
import envfile  # noqa: F401  (debe ir primero)
import logging
import os

from waitress import serve

from app import app

if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8000))
    threads = int(os.environ.get("THREADS", 16))
    logging.getLogger("panel-ti").info("Panel TI escuchando en http://%s:%s (%s hilos)", host, port, threads)
    # Las cabeceras X-Forwarded-* del proxy las interpreta la app cuando TRUST_PROXY=1
    serve(app, host=host, port=port, threads=threads, ident="panel-ti")
