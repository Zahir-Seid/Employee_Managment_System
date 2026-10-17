# Running EMS with Docker

Three containers, started together by `docker-compose.yml`:

| Service | What it is |
|---|---|
| `db` | PostgreSQL 16 (`postgres:16-alpine`), database `jeems_db`, data in the `postgres_data` volume. Not published to the host or the network. |
| `backend` | Django + gunicorn. Connects to PostgreSQL at host `db`, port 5432. Runs migrations at start. |
| `frontend` | nginx serving the built React app and proxying `/api`, `/admin` and `/static` to the backend. |

Uploaded files live in two volumes: `media` (photos and images; the backend writes, nginx serves `/media/`) and `private_media` (support request message attachments; only the backend can read them, through the logged-in download). HTTPS, when used, is terminated in front of these containers by a load balancer or reverse proxy that sends `X-Forwarded-Proto`.

## 1. Create `.env` (once)

PowerShell, from the project folder (the one containing `docker-compose.yml`):

```powershell
if (Test-Path .env) { "A .env already exists - open it and compare with .env.example instead of overwriting" } else { Copy-Item .env.example .env }
notepad .env
```

Required values:

| Variable | Set it to |
|---|---|
| `DJANGO_SECRET_KEY` | A long random string. `python -c "import secrets; print(secrets.token_urlsafe(60))"` |
| `DB_PASSWORD` | A password for the database user. Avoid `$ # " '` and spaces |
| `ALLOWED_HOSTS` | Addresses users open the site on, no scheme or port. Local test: `localhost,127.0.0.1` |
| `CSRF_TRUSTED_ORIGINS` | The same address with scheme, e.g. `http://localhost` (add the port if `HTTP_PORT` is not 80) |
| `FRONTEND_URL` | Base URL used in notification emails, e.g. `http://localhost` |
| `USE_X_FORWARDED_PROTO`, `SECURE_SSL_REDIRECT` | `False` for a plain-HTTP local test; `True` behind an HTTPS proxy |

`DB_NAME` (`jeems_db`) and `DB_USER` (`jeems`) can stay as they are. `DB_HOST` and `DB_PORT` are set by `docker-compose.yml` (`db`, `5432`), so they cannot point the backend at `localhost` by mistake.

The database, user and password are created only the first time the `postgres_data` volume is created. Changing `DB_PASSWORD` in `.env` afterwards does not change an existing database; see "Changing the database password".

## 2. Start

```powershell
docker compose up -d --build
docker compose ps
```

The first start takes a few minutes. The backend waits for PostgreSQL to report healthy, applies migrations, and the frontend waits for the backend. Open http://localhost (or your `HTTP_PORT`).

Create the first admin account (the app does not create one for you):

```powershell
docker compose exec backend python manage.py createsuperuser
```

## 3. Everyday commands

```powershell
docker compose ps                         # status and health of all three containers
docker compose logs -f backend            # follow backend logs (Ctrl+C to stop following)
docker compose logs --tail 50 db          # last 50 lines of the database log
docker compose stop                       # stop, keep everything
docker compose start                      # start again
docker compose up -d --build              # apply an updated project (data is kept)
docker compose up -d --force-recreate backend   # re-read .env after editing it
docker compose exec db psql -U jeems -d jeems_db   # open a database prompt
```

**Never run `docker compose down -v` (or `docker volume rm`) unless you want to delete the database and uploaded files.** Plain `docker compose down` is safe: it removes the containers but keeps the `postgres_data` and `media` volumes.

## 4. Back up

PowerShell, from the project folder. This saves the database and the uploaded files into `backups\`:

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

# Database
docker compose exec -T db sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -f /tmp/jeems.dump'
docker compose cp db:/tmp/jeems.dump ".\backups\jeems-$stamp.dump"
docker compose exec -T db rm /tmp/jeems.dump

# Uploaded files: photos (media) and support request attachments (private_media).
# The volumes are named <project folder>_media and <project folder>_private_media; check with: docker volume ls
docker run --rm -v jeems-project_media:/media -v "${PWD}\backups:/backup" alpine tar czf "/backup/media-$stamp.tgz" -C /media .
docker run --rm -v jeems-project_private_media:/media -v "${PWD}\backups:/backup" alpine tar czf "/backup/private-media-$stamp.tgz" -C /media .
```

Keep copies of `backups\` somewhere other than this PC.

## 5. Restore

This **replaces** the current database contents with the backup. Make a fresh backup first if the current data matters.

```powershell
docker compose stop frontend backend
docker compose cp ".\backups\jeems-YYYYMMDD-HHMMSS.dump" db:/tmp/restore.dump
docker compose exec -T db sh -c 'pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists --no-owner /tmp/restore.dump'
docker compose exec -T db rm /tmp/restore.dump
docker compose start backend frontend
```

To restore uploaded files from `media-*.tgz` or `private-media-*.tgz`, extract them back into the matching volume the same way they were archived (`tar xzf ... -C /media` in a throwaway `alpine` container with that volume mounted).

## 6. Bringing existing data into the container

A new container starts with an **empty** database. It does not contain records from any earlier setup.

- **From another PostgreSQL 16 database:** make a dump there with `pg_dump -Fc`, then use the restore steps above.
- **From the PostgreSQL 18 installed on Windows:** a dump made by a newer `pg_dump` generally cannot be restored into a PostgreSQL 16 container. If you need to carry that data over, tell whoever maintains this to switch the image to `postgres:18-alpine` before the first start (the data path changes slightly for 18).
- **From the old SQLite file:** `backend/scripts/copy_sqlite_to_postgres.py` copies a SQLite database into an empty PostgreSQL database. It has not been run inside a container for this setup.

Uploaded photos and files are not in the database; copy them into the `media` and `private_media` volumes as well.

## 7. Changing the database password

Edit `DB_PASSWORD` in `.env`, then update the existing database user to match, otherwise the backend cannot log in:

```powershell
docker compose exec db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "ALTER USER jeems WITH PASSWORD ''new-password''"'
docker compose up -d --force-recreate backend
```

## 8. Troubleshooting

- **"Unexpected response from the server (HTTP 400)" on login:** `ALLOWED_HOSTS` does not include the address in the browser. Check `docker compose logs --tail 30 backend` for `Invalid HTTP_HOST header`, fix `.env`, then `docker compose up -d --force-recreate backend`.
- **Backend keeps restarting:** `docker compose logs --tail 50 backend`. Typical causes: `DB_PASSWORD` differs from the one the database was created with (see section 7), or a required `.env` value is empty.
- **`required variable DB_PASSWORD is missing`:** `.env` does not exist or `DB_PASSWORD` is empty.
- **The Django admin (`/admin/`) will not log in over http:** production cookies are secure-only, so the admin needs HTTPS. The main app works over http.
- **Django check:** `docker compose exec backend python manage.py check --deploy`.
