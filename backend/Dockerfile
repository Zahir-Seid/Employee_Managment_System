FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The executable bit on docker-entrypoint.sh is lost when the source is
# checked out or unzipped on Windows, which would make this container fail to
# start ("permission denied"). Set it explicitly so the image always runs.
RUN chmod +x docker-entrypoint.sh

RUN useradd --system --no-create-home jeems \
    && mkdir -p /app/media /app/private_media /app/staticfiles \
    && DEBUG=False DJANGO_SECRET_KEY=build-only ALLOWED_HOSTS=localhost DB_PASSWORD=build-only \
       python manage.py collectstatic --noinput \
    && chown -R jeems:jeems /app/media /app/private_media /app/staticfiles
USER jeems

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python docker-healthcheck.py

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120", "--access-logfile", "-"]
