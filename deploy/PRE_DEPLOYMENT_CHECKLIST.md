# EMS pre-deployment checklist

Use this with `HANDOVER.md` (Docker path) or `deploy/DEPLOY.md` (non-Docker path).
Tick an item only when you have **seen it work on the real server**. Nothing below has been
configured or tested on a real host by whoever prepared this package.

Legend: **[BLOCKER]** do not go live without it. **[DECIDE]** needs the owner's decision.

## 0. Decisions first
- [ ] **[DECIDE]** The four open business questions in `HANDOVER.md` section 12-A (TV settings
      permission, announcement end dates, partner participation total, Pillow 12 upgrade),
      plus React Router 7. Until decided, 4 backend tests fail by design.
- [ ] **[DECIDE]** Which package method: Docker Compose (recommended in `HANDOVER.md`) or
      non-Docker (`deploy/DEPLOY.md`). Do not mix them; database names differ (`jeems_db` / `jeems`).

## 1. Secrets and configuration  [BLOCKER]
- [ ] Real `.env` created **on the server only** from `.env.example` / `deploy/production.env.example`.
- [ ] `DEBUG=False` is set (the code default is `True`).
- [ ] `DJANGO_SECRET_KEY` is a new long random value (`python3 -c "import secrets; print(secrets.token_urlsafe(60))"`).
- [ ] `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` (with `https://`), `FRONTEND_URL` match the public address.
- [ ] A strong database password, identical where the database and the app both use it. Not the example one.
- [ ] `TIME_ZONE` decided and set (template uses `Africa/Addis_Ababa`, default is `UTC`).
- [ ] `.env` is not in the web root, not in Git, not in any ZIP you send around.

## 2. HTTPS and proxy  [BLOCKER]
- [ ] A TLS certificate is installed (certbot for the non-Docker path; your own proxy for Docker,
      which publishes plain HTTP only).
- [ ] The proxy sends `X-Forwarded-Proto: https`; `USE_X_FORWARDED_PROTO=True`, `SECURE_SSL_REDIRECT=True`.
- [ ] `http://` redirects to `https://`; the site loads with a valid certificate.
- [ ] Django admin login works over HTTPS (it cannot over plain HTTP: secure cookies).
- [ ] Only after all this works: raise `SECURE_HSTS_SECONDS` in stages (3600, then longer). Hard to undo.
- [ ] `manage.py check --deploy` shows nothing except the HSTS notice until you enable HSTS.

## 3. Admin and API documentation exposure  [DECIDE]
Verified in testing: the API documentation pages are open to anonymous visitors.
- [ ] Block `/api/docs/`, `/api/schema/`, `/api/redoc/` at the proxy (return 404) **or** accept the exposure knowingly.
      Example for nginx, inside the server block, above the `/api` rule:
      `location ~ ^/api/(docs|schema|redoc)/ { return 404; }`
      (Not applied in the package; it is a deployment-configuration change.)
- [ ] `/admin/` restricted (VPN/IP allow-list) if possible; otherwise strong admin passwords.
- [ ] First admin account created (the app does not create one): see `DOCKER.md` / `DEPLOY.md`.

## 4. Media: public and private
- [ ] `/media/` (photos) is understood to be public to anyone with the URL.
- [ ] `private_media/` (message attachments) is **not** exposed by the proxy. Test: a known
      attachment path under `/media/` returns 404, but the authenticated download works for a permitted user.
- [ ] Both folders (or Docker volumes) are writable by the app user and are included in backups.
- [ ] Never run `docker compose down -v` / `docker volume rm` on a live host.

## 5. Email (SMTP): registration codes and password resets  [BLOCKER]
Variables (see `HANDOVER.md` section 5): `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS`,
`EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`, `COMMS_TEAM_EMAIL`, `FRONTEND_URL`.
- [ ] Credentials come from your mail provider (none are supplied here). Provider offers STARTTLS on 587.
- [ ] The sender address is authorised at the provider (SPF/DKIM as the provider requires).
- [ ] Registration-allowed domains in the app are correct (default `ee.org, ee.com`).
- [ ] **Test:** request a registration code with an allowed address and confirm the email *arrives*
      (check spam). **Test:** password reset the same way.
- [ ] Decide who watches for failures: a wrong setting shows as an error on the registration page.

## 6. Daily reminder job (`send_overdue_report_reminders`)  [BLOCKER]
- [ ] Scheduler chosen (host cron or systemd timer). Docker does not schedule it.
- [ ] Log file created **and writable by the job's user before** the schedule is installed
      (otherwise the command silently never runs).
- [ ] Ran it once by hand and saw "Sent N overdue report reminder(s)."
- [ ] Time chosen in Addis Ababa working hours; host time zone known (`timedatectl`).
- [ ] No `--force` in the schedule.
- [ ] The day after the first scheduled run, the log shows a new "Sent" line.
- [ ] Someone is named to check it (it has no failure alert).
Commands: `HANDOVER.md` section 7 (Docker) or `deploy/DEPLOY.md` step 9 (non-Docker).

## 7. Database and migrations
- [ ] **Backup taken before the first start of this version** (see section 8).
- [ ] Single backend instance only (migrations run on start).
- [ ] After start: `python manage.py showmigrations audit events` shows `audit.0002` and `events.0008` applied;
      `python manage.py migrate --check` reports nothing pending.
- [ ] If you are moving data from another database, restore into a **new, empty** database, never over a live one.

## 8. Backups and restore  [BLOCKER]
Back up **three** things: the database, `media/`, and `private_media/`.
- [ ] A schedule exists (at least daily) and copies are stored **off the server**.
- [ ] Retention decided (for example 7 daily, 4 weekly, 3 monthly).
- [ ] **A restore was rehearsed on a separate machine** and the app opened with the restored data.
Non-Docker example (run as a user that can read the database; adjust names/paths):
```bash
sudo -u postgres pg_dump -Fc jeems > /backup/jeems-$(date +%Y%m%d-%H%M%S).dump
tar czf /backup/media-$(date +%Y%m%d).tgz -C /srv/jeems/backend media
tar czf /backup/private-media-$(date +%Y%m%d).tgz -C /srv/jeems/backend private_media
pg_restore --list /backup/jeems-YYYYMMDD-HHMMSS.dump | head   # proves the file is readable
```
Restore rehearsal (new empty database, never the live one):
```bash
sudo -u postgres createdb jeems_restore_test
sudo -u postgres pg_restore -d jeems_restore_test --no-owner /backup/jeems-YYYYMMDD-HHMMSS.dump
```
Docker commands: `HANDOVER.md` section 9 and `DOCKER.md` section 5. A dump from PostgreSQL 18 cannot be
restored into the PostgreSQL 16 image.

## 9. Smoke tests after deployment
- [ ] `HANDOVER.md` section 11, steps 1-7, all pass on the real host.
- [ ] Log in as each role (Admin, Communications, Leadership, Staff) and confirm each sees only what is expected.
- [ ] Upload a photo; it displays and survives a restart.
- [ ] Generate and download a PDF/Word/Excel report.

## 10. Do not say "production-ready" until
- [ ] Sections 1, 2, 5, 6, 8 are all ticked on the real server, and
- [ ] the four open decisions are settled and the test suite is green, and
- [ ] Pillow 11 and React Router 6 advisories are either upgraded (with approval) or consciously accepted in writing.
