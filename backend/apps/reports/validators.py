from django.conf import settings
from django.core.exceptions import ValidationError


def validate_photo_file(file):
    """FR45: photo uploads up to the admin-configured limit (Configuration
    > System Settings), JPG or PNG format only. The size limit is looked
    up fresh on every call (not cached at import time) so an admin's
    change takes effect immediately, no restart — see SystemSettings and
    settings.HARD_MAX_PHOTO_SIZE_MB for the fixed technical ceiling this
    always stays under.
    """
    from apps.configuration.models import SystemSettings

    ext = file.name.rsplit(".", 1)[-1].lower() if "." in file.name else ""
    if ext not in settings.ALLOWED_PHOTO_EXTENSIONS:
        raise ValidationError(
            f"Unsupported file type '.{ext}'. Only JPG and PNG images are allowed."
        )
    max_mb = SystemSettings.get_settings().max_photo_size_mb
    max_bytes = max_mb * 1024 * 1024
    if file.size > max_bytes:
        raise ValidationError(f"File exceeds the maximum allowed size of {max_mb}MB.")
