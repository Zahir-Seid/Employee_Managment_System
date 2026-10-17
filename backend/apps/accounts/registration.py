"""User Registration Update: the OTP-verified self-registration flow.

Kept separate from views.py/serializers.py because this is genuinely a
different concern (generating/hashing/emailing/checking a short-lived
code) from request validation — views.py/serializers.py stay thin
wrappers around the functions here, same split as
apps.events.services.notifications vs. apps.events.views.
"""
import hashlib
import logging
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from .models import RegistrationOTP, User

logger = logging.getLogger(__name__)

OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 10
OTP_RESEND_COOLDOWN_SECONDS = 60
OTP_MAX_ATTEMPTS = 5
# Window to finish the rest of the form after the OTP is verified.
VERIFICATION_TOKEN_EXPIRY_MINUTES = 15


class OTPError(Exception):
    """Base for every user-facing registration/OTP failure — views.py
    catches this one class and returns {"detail": str(exc)} rather than
    needing a case for each subclass.
    """


class CooldownError(OTPError):
    def __init__(self, seconds_remaining):
        self.seconds_remaining = seconds_remaining
        super().__init__(f"Please wait {seconds_remaining} seconds before requesting another code.")


class EmailSendError(OTPError):
    def __init__(self):
        super().__init__("We couldn't send the verification email just now. Please try again shortly.")


def normalize_email(email):
    return (email or "").strip().lower()


def get_allowed_domains():
    """Reads the admin-configurable allow-list (Configuration > System
    Settings > Registration) — see apps.configuration.models.SystemSettings.
    Comma-separated, case-insensitive, leading "@" optional either way
    ("ee.org" and "@ee.org" both work) so an admin can't lock everyone
    out by a stray typo in formatting.
    """
    from apps.configuration.models import SystemSettings

    raw = SystemSettings.get_settings().registration_allowed_domains or ""
    domains = [d.strip().lstrip("@").lower() for d in raw.split(",")]
    return [d for d in domains if d]


def is_domain_allowed(email):
    email = normalize_email(email)
    if "@" not in email:
        return False
    domain = email.rsplit("@", 1)[-1]
    return domain in get_allowed_domains()


def _hash_code(code):
    # SHA-256 suffices: the code is random, short-lived and rate-limited.
    return hashlib.sha256(code.encode()).hexdigest()


def _generate_code():
    return f"{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}"


def _send_otp_email(email, code, purpose="registration"):
    from apps.configuration.models import SystemSettings

    sys_settings = SystemSettings.get_settings()
    from_email = sys_settings.notification_from_email or settings.DEFAULT_FROM_EMAIL
    what = "password reset" if purpose == "password_reset" else "registration"
    send_mail(
        subject=f"[EMS] Your {what} verification code",
        message=(
            f"Your EMS {what} verification code is: {code}\n\n"
            f"This code expires in {OTP_EXPIRY_MINUTES} minutes. "
            "If you didn't request this, you can safely ignore this email."
        ),
        from_email=from_email,
        recipient_list=[email],
        fail_silently=False,
    )


def request_otp(email, purpose="registration"):
    """Generates a fresh code, emails it, and (over)writes the one row of
    RegistrationOTP state for this email. Raises CooldownError if the
    last one was sent too recently, or EmailSendError if the send itself
    fails (in which case the row is rolled back rather than left behind —
    a user who never received a code shouldn't be stuck waiting out a
    cooldown for it).

    Returns (expiry_seconds, cooldown_seconds) for the frontend's
    countdown timers.
    """
    email = normalize_email(email)
    now = timezone.now()
    existing = RegistrationOTP.objects.filter(email=email).first()
    if existing:
        elapsed = (now - existing.last_sent_at).total_seconds()
        if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
            raise CooldownError(int(OTP_RESEND_COOLDOWN_SECONDS - elapsed))

    code = _generate_code()
    otp, _ = RegistrationOTP.objects.update_or_create(
        email=email,
        defaults=dict(
            code_hash=_hash_code(code),
            attempts=0,
            is_verified=False,
            verification_token="",
            verification_token_expires_at=None,
            expires_at=now + timedelta(minutes=OTP_EXPIRY_MINUTES),
            last_sent_at=now,
        ),
    )
    try:
        _send_otp_email(email, code, purpose)
    except Exception:
        logger.exception("Failed to send %s OTP email to %s", purpose, email)
        # Don't leave the user in a cooldown for a code that never arrived.
        otp.delete()
        raise EmailSendError()

    return OTP_EXPIRY_MINUTES * 60, OTP_RESEND_COOLDOWN_SECONDS


def verify_otp(email, code):
    """Checks `code` against the live RegistrationOTP row for `email`.
    Returns a fresh verification_token on success (also stored on the
    row); raises OTPError with a specific, user-facing message otherwise.
    """
    email = normalize_email(email)
    now = timezone.now()
    try:
        otp = RegistrationOTP.objects.get(email=email)
    except RegistrationOTP.DoesNotExist:
        raise OTPError("No verification code was requested for this email. Request a new one.")

    if now > otp.expires_at:
        raise OTPError("This code has expired. Request a new one.")

    if otp.attempts >= OTP_MAX_ATTEMPTS:
        raise OTPError("Too many incorrect attempts. Request a new code.")

    if otp.code_hash != _hash_code(code.strip()):
        otp.attempts += 1
        otp.save(update_fields=["attempts"])
        remaining = OTP_MAX_ATTEMPTS - otp.attempts
        if remaining <= 0:
            raise OTPError("Too many incorrect attempts. Request a new code.")
        raise OTPError(f"Incorrect code. {remaining} attempt{'s' if remaining != 1 else ''} remaining.")

    otp.is_verified = True
    otp.attempts = 0
    otp.verification_token = secrets.token_urlsafe(32)
    otp.verification_token_expires_at = now + timedelta(minutes=VERIFICATION_TOKEN_EXPIRY_MINUTES)
    otp.save(update_fields=["is_verified", "attempts", "verification_token", "verification_token_expires_at"])
    return otp.verification_token


def check_verification_token(email, token):
    """Used by RegistrationCompleteSerializer to confirm the email was
    actually OTP-verified (and that verification hasn't gone stale)
    before letting a User row be created. Returns the RegistrationOTP row
    on success; raises OTPError otherwise.
    """
    email = normalize_email(email)
    try:
        otp = RegistrationOTP.objects.get(email=email)
    except RegistrationOTP.DoesNotExist:
        raise OTPError("Email verification is required before completing registration.")

    if not otp.is_verified or not token or otp.verification_token != token:
        raise OTPError("Email verification is required before completing registration.")

    if not otp.verification_token_expires_at or timezone.now() > otp.verification_token_expires_at:
        raise OTPError("Your email verification has expired. Please verify your email again.")

    return otp


def generate_username(email):
    """Registration doesn't ask for a separate username field (the email
    already uniquely identifies the account, same as everywhere else in
    EMS logs in) — derived from the email's local part instead, with a
    numeric suffix if that's already taken.
    """
    base = re.sub(r"[^a-zA-Z0-9._-]", "", email.split("@")[0]).lower() or "user"
    candidate = base
    suffix = 1
    while User.objects.filter(username__iexact=candidate).exists():
        suffix += 1
        candidate = f"{base}{suffix}"
    return candidate


# ---------------------------------------------------------------------------
# Forgot password: same emailed 6-digit code as registration, then a new
# password. Only accounts that already exist (active, allowed EE email) can
# use it. The responses never reveal whether an email has an account.
# ---------------------------------------------------------------------------


def get_resettable_user(email):
    """The active account for `email`, if its domain is on the allow-list."""
    email = normalize_email(email)
    if not is_domain_allowed(email):
        return None
    return User.objects.filter(email__iexact=email, is_active=True).first()


def request_password_reset_otp(email):
    """Emails a reset code when the email belongs to an eligible account.
    Returns (expiry_seconds, cooldown_seconds) either way, so the response
    looks identical for emails with no account.
    """
    email = normalize_email(email)
    if get_resettable_user(email) is None:
        return OTP_EXPIRY_MINUTES * 60, OTP_RESEND_COOLDOWN_SECONDS
    try:
        return request_otp(email, purpose="password_reset")
    except CooldownError as exc:
        return OTP_EXPIRY_MINUTES * 60, exc.seconds_remaining
