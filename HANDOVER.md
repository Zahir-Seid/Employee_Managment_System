# EMS Deployment and Handover Guide

Platform-neutral guide for the IT team, based on the existing Docker Compose setup
(`docker-compose.yml`, `DOCKER.md`). It does not assume any hosting provider. Where the
hosting platform matters (TLS, scheduling, backup storage, email), this guide says what
EMS needs and leaves the choice to IT.

> Status of this document: updated after a repair pass (see `REPAIR_REPORT.md`). Backend
> tests, migrations, dependency audits and the frontend build were re-run in a scratch
> environment with a throwaway PostgreSQL 16, **not** on a real server and **without Docker**.
> Commands marked **(untested)** could not be run. **Nothing about HTTPS, SMTP delivery,
> scheduled reminders or backups has been configured or tested on a real host.** The project is
> **not** declared production-ready: four tests still fail pending business decisions
> (section 12). Work through `deploy/PRE_DEPLOYMENT_CHECKLIST.md` before go-live.

## 1. What is in this package

- `backend/` Django REST API, `frontend/` React app, `deploy/` files for a non-Docker
  (Ubuntu/systemd/nginx) install, `docker-compose.yml` for the Docker install.
- **No real secrets, no database data, no uploaded files and no real `.env` are included.**
  Only `.env.example` templates are provided. IT creates the real `.env` on the host.
- **Recommended method:** Docker Compose (this guide). The non-Docker method in
  `deploy/DEPLOY.md` is an alternative; note it uses database name `jeems`, while Docker
  uses `jeems_db` (see section 12).

## 2. Architecture (Docker Compose)

| Service | Role | Network exposure |
|---|---|---|
| `db` | PostgreSQL 16 (`postgres:16-alpine`), data in volume `postgres_data` | Not published |
| `backend` | Django + gunicorn (3 workers); runs `migrate` on every start | Not published; reached only by `frontend` |
| `frontend` | nginx: serves the React build, proxies `/api`, `/admin`, `/static` to the backend, serves `/media/` | Port `HTTP_PORT` (default 80), **plain HTTP** |

Named volumes:

| Volume | Contents | Exposure |
|---|---|---|
| `postgres_data` | The database | None |
| `media` | Photos and images (event photos, home content, TV slides, profile pictures) | **Public by URL** under `/media/` (no login required) |
| `private_media` | Support-request message attachments | Not served by nginx; only through the authenticated API |

All three volumes must be backed up (section 9).

## 3. Host requirements

- A host able to run Docker Engine with Compose v2 and reach container image registries
  (or a registry mirror) during the first build.
- Free port for `HTTP_PORT`, DNS name for the site, and a TLS-terminating layer (section 6).
- An SMTP account for outgoing email (section 5).
- Off-host storage for backups (section 9).
- CPU, memory and disk sizing has **not** been assessed. Size from expected user numbers
  and photo volume; the app limits are in `backend/config/settings.py`
  (`HARD_MAX_PHOTO_SIZE_MB` 25, `HARD_MAX_PHOTOS_PER_EVENT` 30) and nginx
  `client_max_body_size 100m`.

## 4. First deployment

1. Copy `.env.example` to `.env` **on the host** and fill it in. Never commit `.env`.
2. Required values: `DJANGO_SECRET_KEY` (long random string), `DB_PASSWORD`,
   `ALLOWED_HOSTS` (hostnames, no scheme/port), `CSRF_TRUSTED_ORIGINS` (with `https://`),
   `FRONTEND_URL`. Avoid `$ # " '` and spaces in `DB_PASSWORD`.
3. Email: set `EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`
   (section 5). Set `TIME_ZONE` (section 8).
4. Start: `docker compose up -d --build`, then `docker compose ps` until all are healthy.
5. Create the first administrator (the app does not create one):
   `docker compose exec backend python manage.py createsuperuser`
6. Review the allowed registration email domains. The default is `ee.org, ee.com`
   (stored in the application's system settings; confirm where it is edited in the admin UI).
   Default option lists (categories, statuses and so on) are seeded automatically by `migrate`.
7. Run the smoke tests in section 11.

`docker-compose.yml` forces `DEBUG=False` for the backend. With `DEBUG=False` the backend
refuses to start if `DJANGO_SECRET_KEY`, `ALLOWED_HOSTS` or `DB_PASSWORD` is empty.

## 5. Email and one-time codes

Registration and password reset send a 6-digit code by email (valid 10 minutes, 60-second
resend cooldown, 5 attempts, rate-limited). Notification emails use the same SMTP settings.
All sends use `fail_silently=False`: a wrong SMTP setting shows up as an error to the user
(registration/reset fails) instead of being hidden.

| Variable (in `.env`) | Purpose | Notes |
|---|---|---|
| `EMAIL_HOST` | SMTP server name | Provided by your mail provider. No default that works (`localhost`). |
| `EMAIL_PORT` | SMTP port | Default `587` (STARTTLS). |
| `EMAIL_USE_TLS` | STARTTLS on/off | Default `True`. |
| `EMAIL_HOST_USER` | SMTP login | **Required.** With `DEBUG=False` and no user, nothing is delivered. |
| `EMAIL_HOST_PASSWORD` | SMTP password | **Required.** Secret: only in the real `.env`, never in the package. |
| `DEFAULT_FROM_EMAIL` | Sender shown to users | Usually must be an address your provider authorises. |
| `COMMS_TEAM_EMAIL` | Inbox for Communications-team notices | Set to a real mailbox. |
| `FRONTEND_URL` | Public site address used in email links | Must be `https://your-domain`. |
| `EMAIL_BACKEND` | Optional override | Leave unset in production. |

Other things that decide whether email works:

- **Not supported by the current settings:** implicit SSL on port 465 (`EMAIL_USE_SSL`) and an
  SMTP timeout (`EMAIL_TIMEOUT`). Use a provider/port that offers STARTTLS on 587. Supporting
  465 would be a small settings change that needs a decision; none was made.
- The sender can also be set inside the app (system settings, "notification from email"); if set,
  it overrides `DEFAULT_FROM_EMAIL` for code emails.
- **Who may register** is controlled in the app by "registration allowed domains" (default
  `ee.org, ee.com`). A person with another domain cannot request a code. Review before go-live.
- **Without working SMTP settings, users cannot register or reset passwords**, and the
  application does not check at startup that SMTP is configured. Test it (section 11).
- No credentials are included in this package and none were invented.

## 6. HTTPS and reverse proxy

The compose stack serves HTTP only. TLS must be provided in front of it (a reverse proxy
or load balancer chosen by IT) and that layer must send `X-Forwarded-Proto: https`.

Settings that must agree with the public address:
`ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` (with `https://`), `FRONTEND_URL`,
`USE_X_FORWARDED_PROTO=True`, `SECURE_SSL_REDIRECT=True`.

- For a plain-HTTP local test, set `USE_X_FORWARDED_PROTO=False` and `SECURE_SSL_REDIRECT=False`
  (the shipped `.env.example` has them `True`, which redirects http to https).
- HSTS is off by default (`SECURE_HSTS_SECONDS=0`). After HTTPS is confirmed, raise it in
  stages (for example 3600, then a longer value). It is hard to undo once browsers cache it.
- In production, session and CSRF cookies are marked secure-only, so the Django admin
  (`/admin/`) works only over HTTPS.
- **Health checks:** `/api/health/` is exempt from the HTTPS redirect, but it still needs a
  Host header that is in `ALLOWED_HOSTS`. A probe that sends a bare IP address as Host gets
  HTTP 400. Probe `/` instead, or send the real hostname.

## 7. Scheduled job (not scheduled by Docker Compose)

EMS sends a daily email reminder for Event Status Reports past their 5-day window, via
`send_overdue_report_reminders`. **Nothing in the compose stack schedules it, and it has not
been scheduled or tested anywhere.** IT must set it up.

What the command does (from the code): for each overdue event it sends one in-app notification
plus one email to the owner, then records `report_overdue_notified_at` so that event is **not**
reminded again. Running it twice in a day is therefore harmless. `--force` ignores that record
and re-notifies everyone currently overdue: use it only by hand, **never in the schedule**.
Users who open the app are also notified automatically via their notification bell, so the job
mainly reaches owners who have not logged in.

A reliable setup, in order of preference:

1. **Host cron or a systemd timer on the Docker host** running once a day **(untested)**:
   `cd /path/to/project && docker compose exec -T backend python manage.py send_overdue_report_reminders >> /var/log/jeems-reminders.log 2>&1`
   Use `exec -T` (no terminal). With a systemd timer, set `Persistent=true` so a run missed
   while the host was off is executed when it comes back; plain cron skips missed runs.
2. **Create the log file first and make it writable by the user the job runs as.** If the
   `>> logfile` redirect cannot be opened, the shell does not start the command and nothing
   reports an error (this was reproduced).
3. **Time:** cron uses the host's clock/time zone, not the app's `TIME_ZONE`. Pick an hour
   that is a working morning in Addis Ababa (08:00 EAT = 05:00 UTC) and say which zone the host uses.
4. **Prove it:** run it once by hand and read the output ("Sent N overdue report reminder(s)."),
   then check the log the day after the first scheduled run. Decide who is told if it stops
   (the job has no failure alert of its own).

The non-Docker `deploy/jeems-cron` file shows the intended schedule (daily at 08:00 server time).

## 8. Time zone

`TIME_ZONE` defaults to `UTC` in `.env.example` and in settings, while
`deploy/production.env.example` uses `Africa/Addis_Ababa`. Decide one value and set it in `.env`.
It affects dates and the overdue window.

## 9. Backups and restore

Back up all three volumes on a schedule and copy the results off the host. Do not rely on
the Docker host as the only copy. Test a restore on a separate host before go-live.

Database (adapted from `DOCKER.md`) **(untested)**:

```sh
mkdir -p backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/jeems-$(date +%Y%m%d-%H%M%S).dump"
```

Uploaded files: find the real volume names first, because they depend on the project folder name:

```sh
docker volume ls | grep -E 'media|private_media'
docker run --rm -v <media-volume-name>:/data -v "$PWD/backups":/backup alpine tar czf /backup/media-$(date +%Y%m%d).tgz -C /data .
docker run --rm -v <private-media-volume-name>:/data -v "$PWD/backups":/backup alpine tar czf /backup/private-media-$(date +%Y%m%d).tgz -C /data .
```

Restore: see `DOCKER.md` section 5 (it replaces current database contents, so back up first).
Dumps made by PostgreSQL 18 cannot be restored into the PostgreSQL 16 image.

**Never run `docker compose down -v` or `docker volume rm`** unless you intend to delete the
database and uploads. Plain `docker compose down` keeps the volumes.

## 10. Updating and rollback

- Update: replace the project files, then `docker compose up -d --build`. Volumes are kept.
- Migrations run automatically each time the backend container starts. Run **one** backend
  instance; several instances starting together could run migrations concurrently.
- Before every update: take a database backup. For rollback, restore the previous project
  version and, if migrations had altered the schema, restore the database backup too.

## 11. Smoke tests after deployment

1. `docker compose ps` shows `db`, `backend`, `frontend` healthy.
2. Open the site over HTTPS; log in as the administrator.
3. Request a registration code with an allowed email domain and confirm the email arrives.
4. Upload a photo, confirm it displays, confirm it survives `docker compose up -d --force-recreate backend`.
5. Send a support-request message with an attachment; confirm a different permitted user can
   download it and that it is **not** reachable through a `/media/` URL.
6. Run the reminder command once manually and check for errors.
7. `docker compose exec backend python manage.py check --deploy`

## 12. Known risks and open items

Status after the repair pass. Details, file list and raw numbers are in `REPAIR_REPORT.md`.

**A. Decisions needed from the owner (nothing was changed for these)**

Four backend tests still fail. Each is a conflict between the tests and a rule the application
implements consistently (backend, frontend and code comments agree). Either the rule or the test
is outdated, and that is a business decision.

1. **TV Display settings permission.** Communications and Leadership currently *can* change the
   master TV settings (`IsAdminOrLeadershipOrCommunications`, "widened on request"; the React panel
   agrees). Two tests still say they must get 403.
   Tests: `test_communications_cannot_update_master_settings`, `test_leadership_cannot_update_settings`.
2. **Announcement end dates.** The model and Home page deliberately ignore start/end dates for
   Announcements, and the admin form offers none. One test expects an expired announcement to hide.
   Test: `test_featured_respects_date_window`.
3. **Partner Engagement "participation_count".** The summary counts each event's participants once
   (35); the test expects the sum of per-partner rows (45), which counts a co-organised event's
   attendees twice. Test: `test_partner_rollup_and_participation`.
4. **Pillow 11.0.0 to 12.x (major).** 17 advisories, fixed only in Pillow 12.1.1+. In a scratch
   environment Pillow 12.3.0 gave the same test result as today (the same 4 failures, nothing
   new). It was **not** applied to the project; approval is needed. See `REPAIR_REPORT.md`.
5. **React Router 6.30.6 to 7.x (major).** 2 moderate advisories remain in a runtime package; the
   fix exists only in 7.18+. One (SSR hydration) does not apply to this client-only app; the other
   (open redirect through backslash in `Link`/`navigate`) is relevant in principle because the
   notification bell navigates to links supplied by the backend. Not applied.

**B. Configuration and exposure (verified by test under `DEBUG=False`, not changed)**

- `DEBUG` defaults to `True` when the variable is not set. Docker Compose forces `False`; a
  non-Docker host that omits it would run in debug mode.
- **Verified:** `/api/docs/`, `/api/schema/` and `/api/redoc/` return HTTP 200 to an anonymous
  visitor, and both shipped proxy configs forward them, as well as `/admin/`, to the public.
  Recommended: block the three documentation paths at the proxy (return 404), and restrict
  `/admin/` by network or VPN if possible. This is a deployment-configuration change and was left
  for approval. Everything else sampled returned 401 to anonymous users (`/api/events/`,
  `/api/dashboard/`, `/api/tv-display/settings/`); the public Home feed and `/api/health/` return 200 by design.
- `/media/` is public by URL (photos). `private_media/` is not mapped to any URL (probe returned 404);
  attachments are served only through the authenticated API.
- HTTP is redirected to HTTPS (301) and `/api/health/` is exempt; session/CSRF cookies are secure.
  `manage.py check --deploy` reports only `security.W004` (HSTS not yet enabled).
- The Compose stack publishes plain HTTP only; TLS must be supplied in front of it.
- Cron/log-file trap in the non-Docker setup: documented and fixed in `deploy/DEPLOY.md` step 9.
- No startup check that SMTP is configured; SMTP over implicit SSL (465) and an SMTP timeout are
  not supported by the settings (section 5).
- Leftover `host.docker.internal` entry in `docker-compose.yml` (harmless; left unchanged).
- `backend/.env.example` and `backend/README.md` use a weak placeholder database password equal to
  the username. Local development only. Never use it on a server.
- Database name differs: Docker uses `jeems_db`, the non-Docker documents use `jeems`.

**C. Repository hygiene (fixed)**

- `.gitignore` and `backend/.dockerignore` now exclude `private_media/` (the backend Dockerfile
  runs `COPY . .`, so real attachments could previously be copied into an image), plus
  `test_media/`, SQLite files, `venv/`, logs, `*.pem`, `*.key`. No Dockerfile or Compose change.
- Git history was not available, so tracked-file safety could not be checked.

**D. Data and migrations (resolved and tested)**

- Added `audit/0002_alter_auditlog_object_type_choices` (new choices only, no SQL) and
  `events/0008_rename_indexes_and_expected_participants_help_text` (two `ALTER INDEX ... RENAME`;
  help-text change has no SQL). Tested on PostgreSQL 16.15: upgrade of a seeded database (row
  counts and content hash unchanged), rollback and re-apply, fresh install of all 89 migrations,
  `makemigrations --check` and `migrate --check` clean. No existing migration was edited,
  squashed or removed.
- **Migrations run automatically when the backend container starts**, so these two will be applied
  on the first start after upgrade. Take a database backup first (section 9/10).
- One-off SQLite helpers (`backend/scripts/copy_sqlite_to_postgres.py`,
  `backend/config/settings_sqlite_export.py`) stay in the package; they are not used at runtime.

**E. Dependencies**

- Applied: Django 5.1.4 to 5.2.18 LTS (5.1 is end-of-life), djangorestframework 3.15.2 to 3.17.2,
  djangorestframework-simplejwt 5.3.1 to 5.5.1; frontend lockfile patch/minor updates
  (axios, react-router(-dom) 6.30.x, postcss, nanoid, js-yaml, brace-expansion, source-map-js).
- Backend audit of all 30 installed packages (including transitive): **40 unique advisories before,
  17 after**, all 17 in Pillow 11.0.0 (held). Django, DRF and simplejwt: 0 remaining.
- Frontend `npm audit`: **15 findings before (10 high, 5 moderate), 9 after (5 high, 4 moderate)**.
  Remaining: `tailwindcss` and its build-time helpers (`braces`, `micromatch`, `chokidar`,
  `fast-glob`, `postcss-selector-parser`, `postcss-nested`; `fast-glob` and `postcss-nested` are
  flagged only because they depend on the vulnerable helpers; the fix needs Tailwind 4, a major
  rewrite, and these packages run at build time, not in the delivered bundle) and `react-router(-dom)` (runtime,
  item 5 above). `npm audit --omit=dev` still reports 2 moderate (react-router only).
- Not claimed fixed: anything listed as remaining above.
- The production JavaScript bundle is large (one file about 8.7 MB).

**F. Tests**

- Backend suite: 362 tests; **4 fail** (section A); was 9 (7 failures, 2 errors).
- `config/settings_test.py` now redirects both `MEDIA_ROOT` and `PRIVATE_MEDIA_ROOT` to a fresh
  temporary folder every run and refuses to start otherwise; the test that deletes the private
  folder can now only delete inside that temporary folder. Still prefer not to run tests on a
  machine that holds real attachments.
- No frontend tests or ESLint configuration exist (`npm run lint` has nothing to run).

## Appendix: results of the checks

Run in a disposable copy with a throwaway PostgreSQL 16.15 (installed from Ubuntu packages, not
Docker), Python 3.12, Node 22. Not run on a real server.

| Check | Before | After |
|---|---|---|
| Backend tests (`manage.py test --settings=config.settings_test`) | 362 run; 7 failures, 2 errors | 362 run; **4 failures**, 0 errors |
| `makemigrations --check` | pending changes in `audit` and `events` | clean |
| `migrate --check` / fresh migrate | not run | clean; 89 migrations apply on an empty DB |
| `manage.py check --deploy` (production-style variables) | only `security.W004` | only `security.W004` |
| `pip-audit`, 30 installed packages | 40 unique advisories | 17 (all Pillow 11.0.0) |
| `npm audit` | 15 (10 high, 5 moderate) | 9 (5 high, 4 moderate) |
| `npm ci` + `npm run build` | succeeded | succeeded (817 modules, about 15 s) |
| API schema generation (`spectacular`) | 219,699 bytes, 38 messages | identical output and messages |

Tests still failing, with root cause:

- `apps.content.tests.test_content.HomeFeedTests.test_featured_respects_date_window`: test read a
  removed `featured` key (fixed to `announcements`); underneath, it expects announcements to honour
  dates, which the app deliberately does not (decision 2).
- `apps.tv_display.tests.test_settings.TVDisplaySettingsTests.test_communications_cannot_update_master_settings`
  and `...test_leadership_cannot_update_settings`: tests expect 403, code allows (decision 1).
- `apps.reports.tests.test_partner_engagement_report.PartnerEngagementReportDataTests.test_partner_rollup_and_participation`:
  summary 35 vs expected 45 (decision 3).

Fixed (test or fixture was wrong, application unchanged):

- `...test_only_automatic_queues_are_enabled_by_default`: read `sections` instead of `sections_display`.
- `...CommunicationsReportAccessTests` (3 tests): helper added a second to-do on top of the one the
  application already creates automatically.
- `...EventActivityReportAccessTests.test_responsible_person_filter`: both users were named "Test",
  so a name search correctly matched both.
