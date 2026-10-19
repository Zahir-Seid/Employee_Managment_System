from django.conf import settings
from django.core.exceptions import ValidationError


def validate_photo_file(file):
    """FR45: photo uploads up to the admin-configured limit (Configuration
    > System Settings), JPG or PNG format only. The size limit is looked
    up fresh on every call (not cached at import time) so an admin's
    change takes effect immediately, no restart — see SystemSettings and
    settings.HARD_MAX_PHOTO_SIZE_MB for the fixed technical ceiling this
    always stays under.

    Security review finding #5: the extension alone used to decide the
    type, so a polyglot named `evil.png` slipped in. Maybe-lying
    browsers aside, we now ALSO check the leading bytes, exactly like
    the support-message attachment pipeline does (same signature rules,
    JPEG SOI marker / PNG IHDR magic). The stored/served content type
    still comes from the extension table, not from the upload.
    """
    from apps.communications.attachments import signature_ok
    from apps.configuration.models import SystemSettings

    ext = file.name.rsplit(".", 1)[-1].lower() if "." in file.name else ""
    if ext not in settings.ALLOWED_PHOTO_EXTENSIONS:
        raise ValidationError(
            f"Unsupported file type '.{ext}'. Only JPG and PNG images are allowed."
        )
    kind = "jpeg" if ext in ("jpg", "jpeg") else "png"
    try:
        if not signature_ok(kind, file):
            raise ValidationError(
                f"'{file.name}' doesn't look like a real {ext.upper()} image."
            )
    except ValidationError:
        raise
    except Exception:
        # Signature reading must never fail an upload of a genuinely
        # fine image on an IO hiccup — but don't silently accept either.
        raise ValidationError(f"'{file.name}' couldn't be read as a {ext.upper()} image.")
    max_mb = SystemSettings.get_settings().max_photo_size_mb
    max_bytes = max_mb * 1024 * 1024
    if file.size > max_bytes:
        raise ValidationError(f"File exceeds the maximum allowed size of {max_mb}MB.")
