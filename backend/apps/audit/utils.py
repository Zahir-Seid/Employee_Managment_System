import re

from .middleware import get_current_user
from .models import AuditLog


def _camel_to_snake(name):
    """Converts a model class name like 'PostEventReport' into the
    snake_case form used by AuditLog.object_type's choices ('post_event_report'),
    so stored values always match ObjectType.choices exactly.
    """
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def log_action(action_type, obj, user=None, description="", metadata=None, object_type=None):
    """Writes a single audit trail entry (FR49).

    `obj` is normally a model instance — its class name is converted to
    the matching ObjectType choice and its `id` becomes `object_id`. For
    actions with no natural model instance (e.g. a generated report that
    isn't itself a stored row), pass a string as `obj` (used as the
    object_id) together with an explicit `object_type` override.

    `user` should be passed explicitly wherever possible — since EMS uses
    JWT authentication, `request.user` is only resolved when DRF evaluates
    it inside the view, not by Django's base middleware. Callers inside
    views/services have `request.user` on hand and should pass it directly.
    The thread-local fallback exists only for code paths (e.g. signal
    handlers) with no direct access to the request.
    """
    resolved_user = user or get_current_user()
    if resolved_user is not None and not getattr(resolved_user, "is_authenticated", False):
        resolved_user = None

    if object_type is not None:
        resolved_object_type = object_type
    elif isinstance(obj, str):
        raise ValueError("object_type must be provided explicitly when obj is a plain string.")
    else:
        resolved_object_type = _camel_to_snake(obj.__class__.__name__)

    resolved_object_id = obj if isinstance(obj, str) else str(getattr(obj, "id", obj))

    return AuditLog.objects.create(
        user=resolved_user,
        action_type=action_type,
        object_type=resolved_object_type,
        object_id=resolved_object_id,
        description=description,
        metadata=metadata or {},
    )
