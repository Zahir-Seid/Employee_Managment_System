#!/bin/sh
# Run on the server after uploading a new version of the project:
#   sh deploy/update.sh
set -e
cd "$(dirname "$0")/.."

cd backend
venv/bin/pip install -r requirements.txt
venv/bin/python manage.py migrate --noinput
venv/bin/python manage.py collectstatic --noinput
cd ../frontend
npm ci
npm run build
sudo systemctl restart jeems-backend
echo "Updated."
