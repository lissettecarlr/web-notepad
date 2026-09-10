FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NOTES_DIR=/app/notes \
    PORT=12345

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py docker-entrypoint.sh ./
COPY public ./public

# 以 root 启动 → entrypoint 修正 notes 目录所有权 → setpriv 降权到 PUID/PGID（默认 1000）运行
RUN sed -i 's/\r$//' docker-entrypoint.sh \
    && chmod +x docker-entrypoint.sh \
    && mkdir -p /app/notes

EXPOSE 12345

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:12345/').status == 200 else 1)"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["gunicorn", "--bind", "0.0.0.0:12345", "--workers", "2", "--threads", "4", "--access-logfile", "-", "app:app"]
