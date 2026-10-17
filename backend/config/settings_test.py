"""Settings override for the automated test suite: faster password hashing,
in-memory email, and disposable media folders.

The database is the same PostgreSQL server as development; Django
automatically creates a throwaway `test_<DB_NAME>` database for the run and
drops it afterwards, so your real data is never touched. The DB_USER in .env
therefore needs the CREATEDB privilege (see README > Setup).

Media safety: BOTH `MEDIA_ROOT` and `PRIVATE_MEDIA_ROOT` are redirected to a
freshly created temporary directory for every test run, regardless of what
`.env` or the environment says. Some tests delete these folders when they
finish, so they must never point at real uploads. A guard below refuses to
start the test run if either path is outside that disposable folder.

Use with: python manage.py test --settings=config.settings_test
"""
import atexit
import shutil
import tempfile
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

from .settings import *  # noqa: F401,F403

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]  # faster tests

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

# One disposable parent folder per test process; removed again at exit.
_TEST_MEDIA_BASE = Path(tempfile.mkdtemp(prefix="jeems-test-media-")).resolve()
atexit.register(shutil.rmtree, _TEST_MEDIA_BASE, True)

MEDIA_ROOT = str(_TEST_MEDIA_BASE / "media")
PRIVATE_MEDIA_ROOT = str(_TEST_MEDIA_BASE / "private_media")


def _assert_disposable(name, value):
    """Only paths inside this run's own `jeems-test-media-*` temp folder pass."""
    path = Path(value).resolve()
    if _TEST_MEDIA_BASE not in path.parents or not _TEST_MEDIA_BASE.name.startswith("jeems-test-media-"):
        raise ImproperlyConfigured(
            f"Refusing to run tests: {name}={path} is not a disposable temporary folder."
        )


_assert_disposable("MEDIA_ROOT", MEDIA_ROOT)
_assert_disposable("PRIVATE_MEDIA_ROOT", PRIVATE_MEDIA_ROOT)
