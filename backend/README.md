# EMS Backend (Django + DRF)

## Setup

EMS uses **PostgreSQL** for everything (users, events, support requests, reports, the audit trail and the login-token tables). Install PostgreSQL, then create the database and user once (in `psql`, as the postgres admin user):

```sql
CREATE USER jeems WITH PASSWORD 'jeems' CREATEDB;
CREATE DATABASE jeems OWNER jeems;
```

(`CREATEDB` lets the automated tests create their own temporary database. Use your own user/password in production and put the same values in `.env`.)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # DB_NAME / DB_USER / DB_PASSWORD / DB_HOST / DB_PORT - defaults match the SQL above
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

**Note on default option lists:** Category, Status, Support Level, Support Type, Thematic Area, Engagement Level, and Lead Organization are all validated against the admin-managed `ConfigOption` table (Configuration page) rather than fixed choices. `migrate` above automatically seeds sensible defaults for all of them (via a `post_migrate` signal, see `apps/configuration/apps.py`), so Create Event/Support Request work immediately — no separate step needed. You can also run `python manage.py seed_config_options` by hand any time; it's idempotent and only ever adds options that don't already exist.

### Moving existing data from the old SQLite file

If you have data in the old `db.sqlite3`, copy it into PostgreSQL once (your SQLite file is only read, never changed). With the virtualenv active and `.env` pointing at the new, empty PostgreSQL database:

```bash
python scripts/copy_sqlite_to_postgres.py                       # uses ./db.sqlite3
python scripts/copy_sqlite_to_postgres.py --source path/to/db.sqlite3
```

It exports the SQLite data, runs `migrate` on PostgreSQL, clears the rows `migrate` pre-seeds, loads your data and resets the ID counters. Uploaded photos stay in `media/`. After checking everything, you can delete `sqlite_dump.json`, the `scripts/` folder and `config/settings_sqlite_export.py`.

## Running tests

Tests use the same PostgreSQL server but their own temporary `test_<DB_NAME>` database (created and dropped automatically by Django) via the `config.settings_test` override, so they never touch your real data:

```bash
python manage.py test --settings=config.settings_test
```

Run a single app's tests:

```bash
python manage.py test apps.events --settings=config.settings_test
```

## API docs

Once the server is running:
- Swagger UI: `http://localhost:8000/api/docs/`
- ReDoc: `http://localhost:8000/api/redoc/`
- OpenAPI schema: `http://localhost:8000/api/schema/`

## Scheduled jobs

Nothing in this project runs a background scheduler itself — the one
periodic task needed (`send_overdue_report_reminders`, FR37) is a plain
Django management command meant to be triggered by whatever scheduler
your host provides (cron, Celery beat, a systemd timer, etc.). It's not
wired up to anything automatically, since that's infra-specific and
outside what code alone can configure. Example crontab entry (once a
day, 7am):

```
0 7 * * * cd /path/to/backend && /path/to/venv/bin/python manage.py send_overdue_report_reminders
```

Run with `--force` to re-notify every currently-overdue event regardless
of whether it was already reminded before (useful for a one-off
catch-up run).

## Project layout

```
config/            Django project settings, root urls, wsgi
apps/
  core/             Shared base model, exception handler, permission classes
  accounts/         Custom User model, JWT auth, roles, profile
  events/           Event logging, category decision flow (Stage 2)
  communications/   Support Requests, To-Do lists, Calendar (Stage 3/3A/3B)
  reports/          Post-Event Reports, PDF/Excel generation (Stage 4/6)
  dashboard/        Aggregate stats and charts (Stage 5)
  audit/            Immutable audit trail (Stage 8)
```

## Key architectural decisions (for reference)

- **PostgreSQL only.** All data, including the JWT token blacklist, lives in one PostgreSQL database configured from `.env` (`DB_*` settings, driver `psycopg2-binary`). SQLite is no longer used (it is only read once, by `scripts/copy_sqlite_to_postgres.py`, to move old data across).
- **`support_types` is a `JSONField`** (a plain list) — portable and simple; no need for Postgres-specific `ArrayField`.
- **UUID primary keys** everywhere, to avoid leaking sequential record counts via the API.
- **JWT auth** (djangorestframework-simplejwt) with the user's role embedded in the token for frontend routing; every request is still re-authorized server-side via DRF permission classes, never trusting the token's role claim alone for access control.
- **Dashboard/Reports are organization-wide** for every role; only "My Events" is owner-scoped to Staff (FR3). This was a deliberate resolution of an apparent conflict between FR3 and FR35 — see the architecture discussion for details.
- **Post-Event Reports have a Draft/Submitted lifecycle** (not just exists/doesn't-exist), matching the UI's separate Save and Submit buttons. Only Submitted reports lock the event and count toward FR33/FR34/FR37.
- **Sensitive flag (FR32/FR38)** is a single checkbox on the whole report (matching the UI spec exactly), masking the narrative fields for anyone who isn't the event owner, Communications, or Leadership — enforced identically in the API serializer, PDF export, and Excel export.
- **Comms Support Requests apply to every event category** (updated requirement, reversing the original Internal-only scoping), and the Calendar was updated to match.
- **Report/Dashboard Scope** (Generic / Thematic Area / Single Event) is independent of and combinable with the Weekly/Monthly/Quarterly Period, except Single Event scope ignores Period entirely.

## Known follow-ups / open questions for the product owner

1. Whether the Dashboard should ever offer a "Single Event" scope beyond what `GET /api/events/{id}/` already returns.
2. Whether Thematic Area Excel reports should be one workbook with multiple sheets (current implementation) or a single sheet with stacked sections.
