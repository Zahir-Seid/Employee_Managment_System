"""
Django settings for the Event Management System (EMS).
"""
from datetime import timedelta
from pathlib import Path

from decouple import Csv, config
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

# DEBUG defaults to True for local development. Deployments must set DEBUG=False,
# which makes the settings below fail fast on missing configuration.
DEBUG = config("DEBUG", default=True, cast=bool)

if DEBUG:
    SECRET_KEY = config("DJANGO_SECRET_KEY", default="change-me-in-production")
    ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="localhost,127.0.0.1", cast=Csv())
else:
    SECRET_KEY = config("DJANGO_SECRET_KEY", default="")
    ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="", cast=Csv())
    _required = {
        "DJANGO_SECRET_KEY": SECRET_KEY and not SECRET_KEY.startswith("change-me"),
        "ALLOWED_HOSTS": ALLOWED_HOSTS,
        "DB_PASSWORD": config("DB_PASSWORD", default=""),
    }
    _missing = [name for name, value in _required.items() if not value]
    if _missing:
        raise ImproperlyConfigured(f"Set these environment variables when DEBUG=False: {', '.join(_missing)}")

# ------------------------------------------------------------------
# Applications
# ------------------------------------------------------------------
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt",
    "django_filters",
    "drf_spectacular",
    "corsheaders",
]

LOCAL_APPS = [
    "apps.core",
    "apps.accounts",
    "apps.events",
    "apps.communications",
    "apps.reports",
    "apps.dashboard",
    "apps.audit",
    "apps.notifications",
    "apps.configuration",
    "apps.tv_display",
    "apps.content",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.audit.middleware.CurrentUserMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# ------------------------------------------------------------------
# Database
# ------------------------------------------------------------------
# PostgreSQL only; connection details come from .env (see .env.example).
# scripts/copy_sqlite_to_postgres.py is a one-off migration from the old SQLite file.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": config("DB_NAME", default="jeems"),
        "USER": config("DB_USER", default="jeems"),
        "PASSWORD": config("DB_PASSWORD", default=""),
        "HOST": config("DB_HOST", default="localhost"),
        "PORT": config("DB_PORT", default="5432"),
        "OPTIONS": {"sslmode": config("DB_SSLMODE", default="prefer")},
        "CONN_MAX_AGE": config("DB_CONN_MAX_AGE", default=60, cast=int),
        "CONN_HEALTH_CHECKS": True,
    }
}

# ------------------------------------------------------------------
# Password validation
# ------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ------------------------------------------------------------------
# Internationalization
# ------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = config("TIME_ZONE", default="UTC")
USE_I18N = False
USE_TZ = True

# ------------------------------------------------------------------
# Static & media files
# ------------------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": (
            "django.contrib.staticfiles.storage.StaticFilesStorage"
            if DEBUG
            else "whitenoise.storage.CompressedManifestStaticFilesStorage"
        )
    },
}

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# Support Request message attachments are private: unlike MEDIA_ROOT (served
# publicly at /media/ by Nginx / the dev server) this folder is NOT exposed
# by any web server. Files are only reachable through the authenticated
# download endpoint, which checks the requester's access to the Support
# Request. Back it up together with MEDIA_ROOT.
PRIVATE_MEDIA_ROOT = config("PRIVATE_MEDIA_ROOT", default=str(BASE_DIR / "private_media"))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ------------------------------------------------------------------
# REST Framework / JWT / Docs
# ------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.AnonRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "user": "1000/hour",
        "anon": "20/hour",
        # Login and token refresh get their own, higher anonymous scope: shared
        # office IPs and an always-on TV screen refreshing its token would
        # otherwise exceed the global "anon" rate.
        "auth": "60/min",
        # Finding #9: independent per-*attempted-email* login rate — an
        # attacker guessing passwords for one account hits this bucket no
        # matter which IP the guesses come from (see
        # apps/accounts/throttling.py AttemptedUsernameThrottle).
        "login_user": "10/min",
        # Registration OTP limits are per-IP; request-otp is stricter since it
        # sends an email.
        "otp_request": "5/hour",
        "otp_verify": "20/hour",
    },
    "EXCEPTION_HANDLER": "apps.core.exceptions.custom_exception_handler",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=config("JWT_ACCESS_MIN", default=30, cast=int)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=config("JWT_REFRESH_DAYS", default=7, cast=int)),
    # Rotation is off: with it on, two tabs sharing a login can race to refresh
    # the same token and log each other out.
    "ROTATE_REFRESH_TOKENS": False,
    "BLACKLIST_AFTER_ROTATION": False,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

INSTALLED_APPS += ["rest_framework_simplejwt.token_blacklist"]

SPECTACULAR_SETTINGS = {
    "TITLE": "Event Management System API",
    "DESCRIPTION": "API for logging events, communications support requests, post-event reporting, dashboards and reports.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# ------------------------------------------------------------------
# CORS
# ------------------------------------------------------------------
# The production frontend is served from the same origin through Nginx, so no
# cross-origin access is needed unless CORS_ALLOWED_ORIGINS is set explicitly.
CORS_ALLOWED_ORIGINS = config(
    "CORS_ALLOWED_ORIGINS",
    default="http://localhost:5173,http://127.0.0.1:5173" if DEBUG else "",
    cast=Csv(),
)
# Origins (with scheme) allowed to submit CSRF-protected requests such as the
# Django admin login, e.g. https://jeems.example.org when behind HTTPS.
CSRF_TRUSTED_ORIGINS = config("CSRF_TRUSTED_ORIGINS", default="", cast=Csv())
if DEBUG:
    # Vite moves to the next free port when 5173 is taken; allow any local port in dev.
    CORS_ALLOWED_ORIGIN_REGEXES = [
        r"^http://localhost:\d+$",
        r"^http://127\.0\.0\.1:\d+$",
    ]
CORS_ALLOW_CREDENTIALS = True
# Lets the frontend read the filename from download responses.
CORS_EXPOSE_HEADERS = ["Content-Disposition"]

# ------------------------------------------------------------------
# Email
# ------------------------------------------------------------------
# In DEBUG without SMTP credentials, emails print to the console instead of
# failing against a nonexistent mail server. Send failures are logged and never
# surfaced in the UI, so set EMAIL_HOST* in .env for real delivery.
_email_backend_default = "django.core.mail.backends.smtp.EmailBackend"
if DEBUG and not config("EMAIL_HOST_USER", default=""):
    _email_backend_default = "django.core.mail.backends.console.EmailBackend"

EMAIL_BACKEND = config("EMAIL_BACKEND", default=_email_backend_default)
EMAIL_HOST = config("EMAIL_HOST", default="localhost")
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default="EMS <noreply@ee.local>")
COMMS_TEAM_EMAIL = config("COMMS_TEAM_EMAIL", default="communications@ee.local")

# Base URL of the deployed frontend, used for links in notification emails.
FRONTEND_URL = config("FRONTEND_URL", default="")

# ------------------------------------------------------------------
# File upload constraints
# ------------------------------------------------------------------
# Hard upload ceilings, read once at startup. The editable per-report and
# per-photo limits live in SystemSettings (apps/configuration/models.py) and
# must stay below these.
HARD_MAX_PHOTO_SIZE_MB = config("HARD_MAX_PHOTO_SIZE_MB", default=25, cast=int)
HARD_MAX_PHOTOS_PER_EVENT = config("HARD_MAX_PHOTOS_PER_EVENT", default=30, cast=int)
ALLOWED_PHOTO_EXTENSIONS = ["jpg", "jpeg", "png"]

DATA_UPLOAD_MAX_MEMORY_SIZE = HARD_MAX_PHOTO_SIZE_MB * 1024 * 1024 * (HARD_MAX_PHOTOS_PER_EVENT + 1)
FILE_UPLOAD_MAX_MEMORY_SIZE = HARD_MAX_PHOTO_SIZE_MB * 1024 * 1024

# ------------------------------------------------------------------
# Logging
# ------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {"format": "[{asctime}] {levelname} {name}: {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "verbose"},
    },
    "root": {"handlers": ["console"], "level": config("LOG_LEVEL", default="INFO")},
}

SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

if not DEBUG:
    # Set USE_X_FORWARDED_PROTO and SECURE_SSL_REDIRECT when HTTPS is terminated
    # in front of the containers by a proxy that sends X-Forwarded-Proto.
    SECURE_SSL_REDIRECT = config("SECURE_SSL_REDIRECT", default=False, cast=bool)
    SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]
    if config("USE_X_FORWARDED_PROTO", default=False, cast=bool):
        SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_HSTS_SECONDS = config("SECURE_HSTS_SECONDS", default=0, cast=int)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
    SECURE_HSTS_PRELOAD = config("SECURE_HSTS_PRELOAD", default=False, cast=bool)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
