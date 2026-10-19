# Deploying EMS with Docker (full stack: frontend + backend + PostgreSQL)

For whoever deploys and maintains the server. This covers the `docker-compose.yml` at the
project root: the React frontend, the Django backend and PostgreSQL, as three containers.

Companion documents:

| Doc | Use it for |
|---|---|
| `DOCKER.md` | Same stack written for a Windows/PowerShell machine |
| `HANDOVER.md` | Platform-neutral notes: email, permissions, risks, smoke tests |
| `deploy/DEPLOY.md` | The alternative install **without** Docker (systemd + nginx) |
| `deploy/PRE_DEPLOYMENT_CHECKLIST.md` | Go-live checklist to tick off on the real server |

> **Verification status.** Every command below was run end-to-end on a Linux host on
> 2026-10-19 (Docker 29.7, Compose v5.5): image build, first start, health chain, login
> through nginx, multipart uploads into both `media` and `private_media`, `/admin/` and
> static files, database dump, restore, media backup, and a backend `--force-recreate`
> with uploaded files surviving. One blocker was found and fixed: the backend entrypoint
> script had lost its executable bit, so the container could not start on Linux
> (`exec: "./docker-entrypoint.sh": permission denied`); `backend/Dockerfile` now runs
> `chmod +x` on it. Keep that line if you edit the Dockerfile.

## Quick start (from the project folder, once `.env` exists — see 3.2)

```sh
docker compose up -d --build          # first time: several minutes
docker compose ps                     # wait for db and backend: (healthy)
docker compose exec backend python manage.py createsuperuser
```

---

## 1. What gets deployed

| Service | Image | Where it listens | Notes |
|---|---|---|---|
| `db` | `postgres:16-alpine` | not published | Data in volume `postgres_data` |
| `backend` | built from `backend/Dockerfile` (python 3.12 slim, gunicorn, 3 workers) | not published | Runs `migrate` on every start; waits for `db` to be healthy |
| `frontend` | built from `frontend/Dockerfile` (Node 22 build → nginx 1.27) | `HTTP_PORT` (default 80) | Serves the React build; proxies `/api`, `/admin`, `/static` to `backend`; serves `/media/` |

Request flow:

```
Browser ──► frontend (nginx :80) ──/api /admin /static──► backend (gunicorn :8000) ──► db (:5432)
                 │
                 └──/media/──► media volume (uploaded photos — public by URL, by design)
```

| Volume | Contents | Exposure |
|---|---|---|
| `postgres_data` | The database | none |
| `media` | Photos (event, home content, TV slides, report photos, profile) | public under `/media/` |
| `private_media` | Support-request message attachments | only through the authenticated API |

`private_media` is deliberately **not** mapped to any URL — verified: the same path that
works through the API with a token returns 401 without one, and no nginx location can
reach the files.

> Docker Compose derives the project name — and therefore volume names — from the
> **folder name**, lowercased. Checkout folder `jeems` → `jeems_postgres_data`,
> `jeems_media`, `jeems_private_media`. Find the real names any time with:
> `docker volume ls | grep -E 'postgres_data|media'`

## 2. Host requirements

- Linux with Docker Engine and the Compose v2 plugin (`docker compose version` must work).
- Internet access on first start (images and packages are downloaded; ~1.5 GB).
- A free port for `HTTP_PORT` (default 80).
- A DNS name for the site and a TLS-terminating layer in front (section 5).
- An SMTP account — without it users cannot register or reset passwords (`HANDOVER.md` §5).
- Backup space **off** this host (section 7).

## 3. First deployment

### 3.1 Get the project onto the server

Copy or clone the project to e.g. `/srv/jeems` and `cd` there. The folder name matters
only for the volume names (see above) — decide it before the first start, changing it
later means renaming volumes.

### 3.2 Create `.env` (once, on the server only)

```sh
cp .env.example .env
chmod 600 .env
nano .env
```

`docker compose` reads `.env` for both build and runtime. Values that matter:

| Variable | Set to | Why it matters |
|---|---|---|
| `DJANGO_SECRET_KEY` | `python3 -c "import secrets; print(secrets.token_urlsafe(60))"` | Backend **refuses to start** when empty (it also refuses for the two below) |
| `ALLOWED_HOSTS` | Your domain(s), comma-separated, no scheme/port | Wrong value = login page gets HTTP 400 |
| `CSRF_TRUSTED_ORIGINS` | `https://your-domain` | Needed for the Django admin login over HTTPS |
| `FRONTEND_URL` | `https://your-domain` | Links inside notification emails |
| `HTTP_PORT` | `80`, or another free port | Published port of the frontend |
| `DB_PASSWORD` | A strong password. Avoid `$ # " '` and spaces | Required; **baked into the database volume on first start** |
| `DB_NAME` / `DB_USER` | Keep defaults (`jeems_db` / `jeems`) | |
| `TIME_ZONE` | e.g. `Africa/Addis_Ababa` | Decide one value; affects dates and the overdue window |
| `EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL` | Your SMTP details (uncomment the two login lines) | Registration codes, password resets, notifications |
| `COMMS_TEAM_EMAIL` | A real mailbox | Communications-team notices |
| `USE_X_FORWARDED_PROTO`, `SECURE_SSL_REDIRECT` | `True` in production (behind the TLS proxy) | Set both `False` **only** for a plain-HTTP test |
| `SECURE_HSTS_SECONDS` | `0` until HTTPS is confirmed, then raise in stages | HSTS is hard to undo once browsers cache it |

Never commit `.env` or email it around; it is already in `.gitignore`.

### 3.3 Build and start

```sh
docker compose up -d --build
docker compose ps
```

First build takes a few minutes (image downloads + `pip install` + `npm ci`). Then the
start order is automatic: `db` becomes healthy → `backend` waits, applies migrations,
starts gunicorn → `frontend` waits for the backend healthcheck (`GET /api/health/`) and
starts nginx. Wait until `db` and `backend` show `(healthy)` and `frontend` shows `Up`.

### 3.4 Create the first administrator

The app does not create one. From a terminal:

```sh
docker compose exec backend python manage.py createsuperuser
```

Non-interactive variant (verified; replace the values):

```sh
docker compose exec -T -e DJANGO_SUPERUSER_PASSWORD='change-me' \
  backend python manage.py createsuperuser --noinput \
  --email admin@example.com --username admin
```

### 3.5 Review once logged in

- Registration allowed email domains — default `ee.org, ee.com` (system settings).
- "Notification from email" if the sender must differ from `DEFAULT_FROM_EMAIL`.
- Home content / TV display settings as needed.

## 4. Verify the deployment

Through the published port (replace `SERVER` with the host; `HTTP_PORT` if not 80):

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://SERVER/                          # 200 (React app)
curl -s -o /dev/null -w "%{http_code}\n" http://SERVER/login                     # 200 (SPA route)
curl -s -o /dev/null -w "%{http_code}\n" http://SERVER/api/health/               # 200
curl -s -o /dev/null -w "%{http_code}\n" http://SERVER/admin/                    # 302 → admin login
curl -s -o /dev/null -w "%{http_code}\n" http://SERVER/static/admin/css/base.css # 200 (static via backend)
```

Then in a browser: log in as the administrator; create/test data below. The full go-live
list is in `HANDOVER.md` §11 — in short:

1. Log in; the app is served entirely on one origin (no CORS involved).
2. Upload a photo and confirm it displays; re-run
   `docker compose up -d --force-recreate backend` and confirm it still displays
   (verified: uploads live on the volume, not in the container).
3. Send a support-request message with an attachment; download it as a permitted user
   (verified: 401 without a token; the file is never reachable via `/media/`).
4. Confirm registration emails arrive (SMTP settings).
5. Run the reminder job once by hand (section 6).
6. `docker compose exec backend python manage.py check --deploy` — with the production
   `.env` (HTTPS values) the only remaining warning is `security.W004` (HSTS not enabled
   yet), which disappears when you raise `SECURE_HSTS_SECONDS` after HTTPS works.

## 5. HTTPS

The stack serves plain HTTP. Terminate TLS in front of it — a load balancer or a host
nginx. Minimal host nginx site (certbot fills the certificate lines and can generate the
redirect from port 80):

```nginx
server {
    listen 443 ssl;
    server_name jeems.example.org;
    # ssl_certificate / ssl_certificate_key from certbot

    client_max_body_size 100m;        # same limit as the app's photo uploads

    location / {
        proxy_pass http://127.0.0.1:80;   # the compose HTTP_PORT
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

Then update `.env` (`ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL` with
`https://`, `USE_X_FORWARDED_PROTO=True`, `SECURE_SSL_REDIRECT=True`) and apply:

```sh
docker compose up -d --force-recreate backend
```

Notes:

- The **Django admin works only over HTTPS** in production — session/CSRF cookies are
  secure-only. The main app works over plain HTTP too, but production should always use
  HTTPS.
- Raise `SECURE_HSTS_SECONDS` in stages (3600, then longer) only after HTTPS is
  confirmed; browsers cache HSTS.
- `/api/health/` is exempt from the HTTPS redirect (for probes), but a probe must send a
  Host header that is in `ALLOWED_HOSTS` — a bare IP as Host gets HTTP 400. Probe `/`
  instead if unsure.

## 6. Scheduled reminder email (not scheduled by this stack)

The daily "event status report overdue" reminder must be scheduled on the host. Nothing
in Docker Compose does it.

```sh
# once: create a writable log file
sudo touch /var/log/jeems-reminders.log
sudo chown "$USER" /var/log/jeems-reminders.log
crontab -e
```

```cron
# Daily at 08:00 server time (cron uses the host clock, not TIME_ZONE)
0 8 * * * cd /srv/jeems && docker compose exec -T backend python manage.py send_overdue_report_reminders >> /var/log/jeems-reminders.log 2>&1
```

- `exec -T` (no terminal) is required inside cron.
- Run it once by hand first — it prints `Sent N overdue report reminder(s).` (verified in
  the container).
- Never add `--force` to the schedule (it re-notifies everyone overdue).
- If the log file is not writable, the shell refuses to start the command and nothing
  reports an error.

## 7. Backups (run on a schedule, copy off the host)

Pick a tool (cron script, backup software) and back up **all three volumes**; a database
dump alone misses uploaded files, and files alone miss the database.

```sh
mkdir -p backups
```

Database (verified):

```sh
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "backups/jeems-$(date +%Y%m%d-%H%M%S).dump"
```

Uploaded files (verified; discover the real volume names first):

```sh
docker volume ls | grep -E 'media|private_media'
# this checkout: <project>_media and <project>_private_media

docker run --rm -v <media-volume>:/data -v "$PWD/backups":/backup \
  alpine tar czf /backup/media-$(date +%Y%m%d).tgz -C /data .

docker run --rm -v <private-media-volume>:/data -v "$PWD/backups":/backup \
  alpine tar czf /backup/private-media-$(date +%Y%m%d).tgz -C /data .
```

- Take a database backup **before every update** and before restoring.
- A dump made by PostgreSQL 18 cannot be restored into this PostgreSQL 16 container.
- **Never** run `docker compose down -v` or `docker volume rm` unless you intend to
  delete the database and uploads. Plain `docker compose down` keeps the volumes.

## 8. Restore (verified)

This **replaces** current data — back up first if it matters.

```sh
docker compose stop frontend backend

docker compose cp backups/jeems-YYYYMMDD-HHMMSS.dump db:/tmp/restore.dump
docker compose exec -T db sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner /tmp/restore.dump'
docker compose exec -T db rm /tmp/restore.dump

docker compose start backend frontend
```

`--clean` drops and recreates only the objects contained in the dump; tables created
*after* the dump stay untouched (this surprises people — it is normal). Uploaded files:

```sh
docker run --rm -v <media-volume>:/data -v "$PWD/backups":/backup \
  alpine tar xzf /backup/media-YYYYMMDD.tgz -C /data
```

Test the whole procedure on a separate machine before go-live.

## 9. Updating to a new version

1. Database backup (section 7).
2. Replace the project files (keep `.env` and the volumes).
3. `docker compose up -d --build`
4. `docker compose ps` until healthy; check `docker compose logs -f backend`.

Migrations run automatically on backend start. Run **one** backend container — several
starting together could race on migrations. For rollback, restore the previous project
files and, if the new version had altered the schema, the database backup with it.
After editing `.env`, apply it with
`docker compose up -d --force-recreate backend` (and `frontend` if `HTTP_PORT` changed).

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Backend container exits instantly: `exec: "./docker-entrypoint.sh": permission denied` | The entrypoint script lost its executable bit (happens when the source is zipped on Windows). The shipped `backend/Dockerfile` now `chmod +x`es it — if you edited the Dockerfile, restore that line, or `chmod +x backend/docker-entrypoint.sh` and rebuild. |
| `required variable DB_PASSWORD is missing` | `.env` does not exist in the folder you run `docker compose` from, or `DB_PASSWORD` is empty. |
| Login page shows "Unexpected response from the server (HTTP 400)" | `ALLOWED_HOSTS` does not include the hostname in the browser. Check `docker compose logs --tail 30 backend` for `Invalid HTTP_HOST header`, fix `.env`, `docker compose up -d --force-recreate backend`. |
| Backend restart loop | `docker compose logs --tail 50 backend`. Typical: `DB_PASSWORD` no longer matches the password the volume was created with — see "Changing the database password" below. |
| Port already in use when starting | Another service holds `HTTP_PORT` (commonly a host nginx on 80). Set `HTTP_PORT` to a free port and `docker compose up -d`; put the TLS proxy in front of that port. |
| 502 from the proxy / frontend up but nothing works | Backend not healthy yet (migrations still running) or crash-looping. `docker compose ps`, `docker compose logs backend`. |
| Django admin will not log in over plain HTTP | By design: production cookies are secure-only. Use HTTPS (section 5). |
| Reminder job does nothing | Cron shell could not open the log file (create/chown it first) or wrong paths in the crontab line. Run the command by hand once. |

### Changing the database password later

`DB_PASSWORD` is frozen into the database volume when it is first created; editing
`.env` alone locks the backend out. Change it on both sides (verified command):

```sh
docker compose exec -T db sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \"ALTER USER jeems WITH PASSWORD 'new-password';\""
# then set the same value for DB_PASSWORD in .env and apply it:
docker compose up -d --force-recreate backend
```

## 11. Security notes (recommended, not applied)

- **Throttle identity is proxy-aware since the security review's finding #3 fix**:
  `TRUSTED_PROXY_COUNT` (default 1) makes DRF trust the last `X-Forwarded-For` hop —
  the address this stack's nginx appends — so rotating spoofed prefixes can't mint
  fresh rate-limit buckets, and `CACHE_BACKEND=filebased` (compose default) shares
  counters across gunicorn's 3 workers. If you ever expose the backend directly
  (no nginx), set `TRUSTED_PROXY_COUNT=0`; if you run several backend replicas,
  move the cache to Redis instead of the host-local file cache.
- **API documentation is currently public**: `/api/docs/`, `/api/schema/`, `/api/redoc/`
  return 200 to anonymous visitors (verified). To block, add **before** the existing
  `/api` location in `frontend/nginx.conf` (nginx checks regex locations in order):

  ```nginx
  location ~ ^/api/(docs|schema|redoc) { return 404; }
  ```

  then `docker compose up -d --build frontend`. This is a deployment decision — see
  `HANDOVER.md` §12-B.
- Restrict `/admin/` by network/VPN where possible.
- `.env` lives only on the server, mode `600`, never in git or chat.
- What is public by design: `/media/` (photos), `/api/health/`, the home feed.
  What is not: everything else requires authentication; support-request attachments are
  served only through the authenticated API (verified: 401 without a token).

## Appendix — facts verified for this checkout (2026-10-19)

- Project/volume names derived from the folder `Event_Managment_System`:
  `event_managment_system_postgres_data`, `event_managment_system_media`,
  `event_managment_system_private_media`.
- Images: backend `python:3.12-slim` + gunicorn 23 (3 workers), frontend multi-stage
  Node 22 → nginx 1.27. First build ≈ 5 minutes; `collectstatic` produced 154 files.
- Health chain db → backend → frontend works; `migrate --check` clean after first start.
- `manage.py check --deploy` on a plain-HTTP test `.env`: only `security.W004` (HSTS) and
  `security.W008` (SSL redirect deliberately off for that test) plus the pre-existing
  drf-spectacular warnings; with the shipped production values expect only `W004` until
  HSTS is enabled.
- Known, accepted items (from `REPAIR_REPORT.md` / `HANDOVER.md`): the four failing
  backend tests awaiting business decisions; public API docs (above); a leftover
  `host.docker.internal` entry in `docker-compose.yml` (harmless); the large production
  JS bundle (~8.7 MB one file).
