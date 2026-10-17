"""ONE-OFF helper - not used by the running app.

Points Django at the OLD SQLite file so `dumpdata` can read it while copying
everything into PostgreSQL (see scripts/copy_sqlite_to_postgres.py). Once your
data is in PostgreSQL you can delete this file and the scripts/ folder.
"""
import os
from pathlib import Path

from .settings import *  # noqa: F401,F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": Path(os.environ.get("SQLITE_SOURCE", BASE_DIR / "db.sqlite3")),  # noqa: F405
    }
}
