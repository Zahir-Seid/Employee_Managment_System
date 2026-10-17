# Deploying EMS without Docker (Ubuntu server)

Layout used below (change the paths in the files in this folder if yours differ):

```
/srv/jeems/backend     Django project   (venv/, .env, media/ live here)
/srv/jeems/frontend    React project    (dist/ is built here)
```

## What you must change

| Where | What | Change it to |
|---|---|---|
| `backend/.env` (copied from `deploy/production.env.example`) | `DJANGO_SECRET_KEY` | A random key (command in the file) |
| | `DB_PASSWORD` | Your database password. **Must equal** the password in step 2 |
| | `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL` | Your domain (`jeems.example.org` is a placeholder) |
| | `EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` | Your SMTP details |
| PostgreSQL (step 2) | `PASSWORD 'CHANGE_ME'` | The same password as `DB_PASSWORD` |
| `deploy/nginx-jeems.conf` | `server_name` | Your domain |

Nothing else needs editing if you keep `/srv/jeems`. `frontend/.env.production` already uses the same-origin `/api`.

## 1. Server packages

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip postgresql nginx certbot python3-certbot-nginx nodejs npm
sudo adduser --system --group --home /srv/jeems jeems
```

Upload the project so you end up with `/srv/jeems/backend` and `/srv/jeems/frontend`, then `sudo chown -R jeems:jeems /srv/jeems`.

## 2. Database

```bash
sudo -u postgres psql
```
```sql
CREATE USER jeems WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE jeems OWNER jeems;
\q
```

## 3. Backend settings

```bash
sudo -u jeems cp /srv/jeems/deploy/production.env.example /srv/jeems/backend/.env
sudo -u jeems nano /srv/jeems/backend/.env     # edit every line marked <<< CHANGE
```
The backend refuses to start if `DJANGO_SECRET_KEY`, `ALLOWED_HOSTS` or `DB_PASSWORD` is empty.

## 4. Backend install

```bash
cd /srv/jeems/backend
sudo -u jeems python3 -m venv venv
sudo -u jeems venv/bin/pip install -r requirements.txt
sudo -u jeems venv/bin/python manage.py migrate
sudo -u jeems venv/bin/python manage.py collectstatic --noinput
sudo -u jeems venv/bin/python manage.py createsuperuser
```

## 5. Run the backend as a service

```bash
sudo cp /srv/jeems/deploy/jeems-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jeems-backend
sudo systemctl status jeems-backend
```

## 6. Build the frontend

```bash
cd /srv/jeems/frontend
sudo -u jeems npm ci
sudo -u jeems npm run build
```

## 7. Nginx

```bash
sudo cp /srv/jeems/deploy/nginx-jeems.conf /etc/nginx/sites-available/jeems
sudo nano /etc/nginx/sites-available/jeems       # set server_name to your domain
sudo ln -s /etc/nginx/sites-available/jeems /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
# Nginx (user www-data) must be able to read the built site and uploads:
sudo chmod o+x /srv/jeems /srv/jeems/frontend /srv/jeems/backend
sudo chmod -R o+rX /srv/jeems/frontend/dist /srv/jeems/backend/media
sudo nginx -t && sudo systemctl reload nginx
```

Open `http://your-domain` to check the site works before adding HTTPS.

## 8. HTTPS

Point your domain's DNS at the server, then:
```bash
sudo certbot --nginx -d jeems.example.org
```
`backend/.env` already has `USE_X_FORWARDED_PROTO=True` and `SECURE_SSL_REDIRECT=True`. Restart afterwards:
```bash
sudo systemctl restart jeems-backend
```
Once everything works over HTTPS you can set `SECURE_HSTS_SECONDS=31536000` and restart again.

## 9. Daily reminder emails

The cron line writes its output to `/var/log/jeems-reminders.log`. **Create that file first and
give it to the `jeems` user.** If the log file cannot be opened, the shell never starts the
reminder command and nothing reports an error, so reminders would silently never be sent
(verified in a test: the redirect fails with "Permission denied" and the command does not run).

```bash
sudo touch /var/log/jeems-reminders.log
sudo chown jeems:jeems /var/log/jeems-reminders.log
sudo cp /srv/jeems/deploy/jeems-cron /etc/cron.d/jeems
sudo chmod 644 /etc/cron.d/jeems      # cron ignores files that are group/world-writable
# Run it once by hand as the service user and read the result BEFORE trusting the schedule:
sudo -u jeems sh -c 'cd /srv/jeems/backend && venv/bin/python manage.py send_overdue_report_reminders'
```

Notes: cron uses the **server's** clock and time zone (`timedatectl`), not the `TIME_ZONE` value in
`.env`. Never add `--force` to the cron line (it re-sends to everyone overdue). After the first
scheduled day, check `/var/log/jeems-reminders.log` for a line starting "Sent". See
`deploy/PRE_DEPLOYMENT_CHECKLIST.md`.

## Updating later

Upload the new project files, then run `sh /srv/jeems/deploy/update.sh`.

## Backups

Back up the database (`sudo -u postgres pg_dump jeems > jeems.sql`), `/srv/jeems/backend/media/` (uploaded photos) and `/srv/jeems/backend/private_media/` (Support Request message attachments). `private_media/` must stay writable by the backend service user and must NOT be exposed by Nginx: attachments are only served through the authenticated API. Set `PRIVATE_MEDIA_ROOT` in `.env` to move it.

A single `pg_dump` typed by hand is not a backup plan. Schedule it, keep copies **off this server**,
and rehearse a restore on another machine before go-live. `pg_dump -Fc` (custom format) is preferred
over plain SQL because `pg_restore` can restore selectively. Restore replaces data, so take a fresh
backup first and never restore over the live database as a test. Step-by-step commands are in
`deploy/PRE_DEPLOYMENT_CHECKLIST.md` (section "Backups").

## Troubleshooting

- Backend logs: `sudo journalctl -u jeems-backend -f`
- Nginx logs: `/var/log/nginx/error.log`
- Config check: `cd /srv/jeems/backend && venv/bin/python manage.py check --deploy`
- 502 from Nginx: the backend service isn't running (see its status/logs).
- Admin login fails over HTTP: production uses secure cookies, so the Django admin needs HTTPS.
