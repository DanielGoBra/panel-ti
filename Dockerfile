FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PANEL_TI_DB=/data/data.db \
    PANEL_TI_UPLOADS=/data/uploads \
    PANEL_TI_BACKUP_DIR=/data/backups \
    HOST=0.0.0.0 \
    PORT=8000

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home --uid 1000 panel && mkdir -p /data && chown -R panel /data
USER panel
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/auth/status')"
CMD ["python", "serve.py"]
