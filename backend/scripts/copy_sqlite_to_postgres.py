"""One-off: copy everything from the old SQLite file into PostgreSQL.

Run from the backend/ folder, with the virtualenv active and your .env DB_*
settings pointing at an EMPTY PostgreSQL database you've already created:

    python scripts/copy_sqlite_to_postgres.py
    python scripts/copy_sqlite_to_postgres.py --source path/to/db.sqlite3
    python scripts/copy_sqlite_to_postgres.py --yes          # skip the prompt

What it does (your SQLite file is only READ, never changed):
  1. Exports every table from the SQLite file to a JSON dump
     (users, events, support requests, reports, audit trail, JWT token
     tables, settings, TV Display content, ...).
  2. Runs `migrate` on PostgreSQL to create the tables.
  3. Empties any rows `migrate` seeded (default option lists, etc.) so the
     copied data isn't duplicated by them.
  4. Loads the dump into PostgreSQL and resets its ID counters.

Uploaded photos/files live in media/ on disk and aren't in the database -
keep that folder as it is.

Works the same on Windows, macOS and Linux (no shell required).
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
MANAGE = [sys.executable, "manage.py"]


def run(args, env=None, step=""):
    if step:
        print(f"\n{step}")
    result = subprocess.run(MANAGE + args, cwd=BACKEND_DIR, env=env)
    if result.returncode != 0:
        print(f"\nStopped: `manage.py {' '.join(args[:2])}` failed (see the error above).")
        print("Nothing in your SQLite file was changed. Fix the problem and run this script again.")
        sys.exit(result.returncode)


def main():
    parser = argparse.ArgumentParser(description="Copy the old SQLite data into PostgreSQL.")
    parser.add_argument("--source", default="db.sqlite3", help="path to the SQLite file (default: db.sqlite3)")
    parser.add_argument("--dump", default="sqlite_dump.json", help="where to write the temporary JSON dump")
    parser.add_argument("--yes", action="store_true", help="don't ask for confirmation")
    options = parser.parse_args()

    source = Path(options.source)
    if not source.is_absolute():
        source = BACKEND_DIR / source
    if not source.exists():
        sys.exit(f"Can't find the SQLite file at {source}. Pass its location with --source.")
    dump = Path(options.dump)
    if not dump.is_absolute():
        dump = BACKEND_DIR / dump

    print(f"Copy data from  {source}\n  into the PostgreSQL database configured in .env (DB_NAME / DB_HOST ...).")
    print("Anything already in that PostgreSQL database will be REPLACED by the SQLite data.")
    if not options.yes and input("Type YES to continue: ").strip() != "YES":
        sys.exit("Cancelled. Nothing was changed.")

    export_env = {**os.environ, "SQLITE_SOURCE": str(source)}
    run(
        ["dumpdata", "--settings=config.settings_sqlite_export", "--indent", "2", "--output", str(dump)],
        env=export_env,
        step="1/4  Exporting the SQLite data ...",
    )
    run(["migrate", "--noinput"], step="2/4  Creating the tables in PostgreSQL ...")
    run(
        [
            "shell",
            "-c",
            "from django.core.management import call_command; "
            "call_command('flush', interactive=False, inhibit_post_migrate=True)",
        ],
        step="3/4  Clearing the rows `migrate` pre-filled (so nothing is duplicated) ...",
    )
    run(["loaddata", str(dump)], step="4/4  Loading the data into PostgreSQL ...")
    run(["check"])

    print(f"\nDone. Your data is now in PostgreSQL. The JSON dump was kept at {dump}")
    print("(delete it when you're happy - it contains your data), and your SQLite file is untouched.")
    print("Start the server as usual: python manage.py runserver")


if __name__ == "__main__":
    main()
