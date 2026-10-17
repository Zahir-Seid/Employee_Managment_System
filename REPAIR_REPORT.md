# EMS repair report

Prepared from `jeems-project-clean.zip` (original untouched; SHA-256 `8804ac2b…c3fe10` recorded
before any work). All work was done in a separate copy. No real `.env`, database, Docker volume or
uploaded file was used; none is included.

**Verdict: NOT declared production-ready.** Four tests fail pending business decisions, 17 Pillow
advisories and 2 React Router advisories remain pending approval, and HTTPS, SMTP delivery, the
reminder schedule and backups have **not** been configured or tested on any server.

## 1. How it was tested (and the limits)

- Python 3.12, Node 22, a **throwaway PostgreSQL 16.15** installed from Ubuntu packages inside the
  sandbox (local port, data in `/tmp`, discarded afterwards). **Docker was not available**, so the
  Docker images/Compose stack were never built or run, and PostgreSQL ran natively, not in the
  `postgres:16-alpine` image.
- Media was isolated for every test run (see 3.1). The default `backend/media`, `private_media`,
  `test_media` folders were verified absent after the final run.

## 2. Files changed and why

| File | Change | Why |
|---|---|---|
| `backend/config/settings_test.py` | Both `MEDIA_ROOT` and `PRIVATE_MEDIA_ROOT` go to a fresh temp folder each run; guard refuses to run otherwise | A test deleted `PRIVATE_MEDIA_ROOT` and settings did not redirect it |
| `backend/apps/communications/tests/test_message_features.py` | Teardown deletes only inside a `jeems-test-media-*` temp folder | Defence in depth against deleting real attachments |
| `backend/apps/content/tests/test_content.py` | `featured` to `announcements` | Test read a removed response key |
| `backend/apps/tv_display/tests/test_settings.py` | `sections` to `sections_display` (one test) | `is_automatic` exists only there |
| `backend/apps/reports/tests/test_communications_report.py` | Helper reuses the to-do created by the signal | Helper created duplicates (counts doubled) |
| `backend/apps/reports/tests/test_event_activity_report.py` | Second user given a distinct name | Both users were "Test", so the name search matched both |
| `backend/apps/audit/migrations/0002_alter_auditlog_object_type_choices.py` | **New** | Model choices ahead of migrations (no SQL) |
| `backend/apps/events/migrations/0008_rename_indexes_and_expected_participants_help_text.py` | **New** | Two index renames; help text (renames are metadata only) |
| `backend/requirements.txt` | Django 5.2.18, DRF 3.17.2, simplejwt 5.5.1 | Security advisories (section 5) |
| `frontend/package-lock.json` | Patch/minor updates; `package.json` unchanged | npm advisories with non-breaking fixes |
| `.gitignore`, `backend/.dockerignore` | Added `private_media/` etc. | Backend Dockerfile does `COPY . .`; real attachments could enter an image or repo |
| `deploy/DEPLOY.md` | Step 9 (cron log file trap) and a backups pointer | Documentation only |
| `HANDOVER.md` | Status, SMTP table, scheduling, sections 12 and appendix rewritten | Reflect verified results |
| `deploy/PRE_DEPLOYMENT_CHECKLIST.md` | **New** | Practical go-live checklist |
| `REPAIR_REPORT.md` | **New** | This document |

**Not changed:** application source code (no permission, model, view or business-rule change),
`docker-compose.yml`, both Dockerfiles, `production.env.example`, `.env.example`, nginx/systemd/cron files,
any existing migration.

## 3. Phase 1: backend tests

3.1 **Data-safety.** Verified with a decoy "real" folder: setting `PRIVATE_MEDIA_ROOT` to it in the
environment is ignored by the test settings, the decoy file stayed intact, and the guard rejected
look-alike paths (`/tmp/FAKE_REAL_PRIVATE`, `/tmp`, `…/private_media`, `…/media`).

3.2 **Results.** Before: 362 run, 7 failures + 2 errors. After: 362 run, **4 failures, 0 errors**
(`Ran 362 tests`, `FAILED (failures=4)`). The after-state is identical on Django 5.2.18 + DRF 3.17.2 +
simplejwt 5.5.1, and also with Pillow 12.3.0 in a scratch environment.

3.3 **Root cause per test.**

| # | Test | Root cause | Result |
|---|---|---|---|
| 1 | `test_featured_respects_date_window` | Stale `featured` key; then a rule conflict (announcements deliberately have no dates) | key fixed; **still fails (decision 2)** |
| 2 | `test_only_automatic_queues_are_enabled_by_default` | Wrong key | fixed |
| 3-5 | communications report: `test_admin_sees_all_activities`, `test_staff_scoped_to_own_events_only`, `test_support_type_filter` | Helper duplicated the signal-created to-do | fixed |
| 6 | `test_responsible_person_filter` | Fixture names identical; filter is a correct substring search | fixed |
| 7 | `test_partner_rollup_and_participation` | KPI counts each event once (35); test expects sum of partner rows (45) | **still fails (decision 3)** |
| 8-9 | TV settings 403 for Communications / Leadership | Permission deliberately widened ("widened on request"; React panel agrees) | **still fail (decision 1)** |

No test was deleted, skipped or weakened, and no permission was changed.

## 4. Phase 2: migrations

Review: `audit.object_type` gained four choices (no schema effect); `events` two index names were
hand-written placeholders that differ from Django's generated names (rename); `expected_participants`
help text. Tested on PostgreSQL 16.15:

- Existing DB built from the **original** migrations, seeded (3 events, 1 audit row, 1 user), then upgraded:
  row counts and a content hash identical before/after; indexes renamed.
- Rollback to `events 0007` / `audit 0001` and re-apply: data intact.
- Fresh empty DB: 89 migrations apply; seeded 46 configuration options.
- `makemigrations --check --dry-run`, `migrate --check`, `manage.py check`: clean.

Note: an existing database whose indexes were manually renamed would make the rename fail
(transactional, so no data loss). Normal databases built by these migrations are unaffected.

## 5. Phase 3: dependencies

| Package | From | To | Notes |
|---|---|---|---|
| Django | 5.1.4 | **5.2.18 (LTS)** | 5.1 is end-of-life; newest fixes only exist from 5.2.17. Same major version, a feature release. Revert = one line. |
| djangorestframework | 3.15.2 | 3.17.2 | Minimum version carrying the fixes |
| djangorestframework-simplejwt | 5.3.1 | 5.5.1 | |
| frontend (lockfile only) | axios 1.18.1→1.20.0, react-router(-dom) 6.30.4→6.30.6, postcss 8.5.21→8.5.30, nanoid, js-yaml, brace-expansion, source-map-js, @remix-run/router | | No major jumps; `package.json` unchanged; 0 packages added/removed |

Order applied, each group tested before the next: (A) Django → (B) DRF + simplejwt → (C) frontend lockfile.
After each: full backend suite (unchanged: same 4 failures), schema generation byte-identical
(219,699 bytes, same 38 pre-existing messages), `check` clean, frontend build OK.

| Audit | Before | After |
|---|---|---|
| `pip-audit` (30 installed packages incl. transitive) | 40 unique advisories (Django 20, Pillow 17, DRF 2, simplejwt 1) | **17** (all Pillow 11.0.0) |
| `npm audit` | 15 (10 high, 5 moderate) | **9 (5 high, 4 moderate)** |
| `npm audit --omit=dev` (runtime only) | axios + react-router-dom | **2 moderate** (react-router(-dom) only) |

Fixed: 23 backend advisories (Django, DRF, simplejwt) and 6 frontend findings (axios, postcss, nanoid,
js-yaml, brace-expansion, source-map-js). **Not fixed:** Pillow (17), react-router (2), the Tailwind 3
build-tool chain (7 entries; fix is Tailwind 4, a major rewrite; build-time only).
The Python project has no lockfile; `requirements.txt` pins only direct dependencies, so transitive
versions can drift between installs (consider adding a lock file as a separate task).

**Potential breaking changes to watch:** The test suite shows no Django-5.2 failures; with warnings enabled it printed two
deprecation warnings from third-party libraries (reportlab, and DRF's URL converter, a Django 6.0 notice). DRF 3.16/3.17 and simplejwt 5.4/5.5
changed minor behaviours; the suite and schema output are unchanged, but exercise login, token refresh
and file uploads manually on staging.

## 6. Phase 4: deployment review

See `HANDOVER.md` sections 5-7 and 12-B and `deploy/PRE_DEPLOYMENT_CHECKLIST.md`. Verified under
`DEBUG=False` with placeholder values: anonymous requests to the API return 401; **API docs/schema/redoc
return 200 anonymously and are proxied publicly (recommendation: block at the proxy; not applied)**; HTTP
redirects to HTTPS with `/api/health/` exempt; cookies secure; private media not mapped to a URL;
`check --deploy` only HSTS notice. Found and documented a silent-failure trap in the non-Docker cron setup
(log file not creatable by the job user, so the command never runs).

## 7. Decisions needed from you

1. **TV Display settings**: keep Communications/Leadership able to edit (update 2 tests) or restrict (code + UI change).
2. **Announcement end dates**: keep "no dates" (update 1 test) or enforce expiry (code + admin form).
3. **Partner participation total**: recommend keeping 35 (every other report counts each event once), then update the test.
4. **Pillow 12.x** (major): approve applying it (scratch run: same results). 
5. **React Router 7** (major): approve a tested migration, or accept the risk in writing.
6. **Block API docs / restrict admin** at the proxy.

## 8. Still requires a real server or credentials

HTTPS certificate and proxy; SMTP credentials and a delivery test; scheduler for the reminder job and a
first-day check; backup schedule, off-server storage and a rehearsed restore; first admin account; Docker
build and `docker compose up` smoke test (never run here); staging test of login/token/upload after the
dependency upgrades; real `.env` creation; confirming the registration-allowed domains.
