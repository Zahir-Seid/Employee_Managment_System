import logging

from django.conf import settings
from rest_framework.views import exception_handler as drf_exception_handler
from rest_framework.response import Response
from rest_framework import status

logger = logging.getLogger(__name__)


def _first_message(value):
    """Extracts a single human-readable message from a DRF error value,
    which can be a plain string, a list of strings, or (for nested list
    serializers like follow_up_actions) a list of per-item error dicts.
    """
    if isinstance(value, str):
        return value
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            inner_key = next(iter(first), None)
            if inner_key:
                return f"{inner_key}: {_first_message(first[inner_key])}"
        return str(first)
    if isinstance(value, dict):
        inner_key = next(iter(value), None)
        if inner_key:
            return f"{inner_key}: {_first_message(value[inner_key])}"
    return str(value)


def custom_exception_handler(exc, context):
    """Wraps DRF's default exception handler to produce a consistent
    error envelope for the frontend: { "detail": str, "errors": dict|None }.
    Unhandled exceptions are logged and converted into a generic 500
    response instead of leaking stack traces to the client.
    """
    response = drf_exception_handler(exc, context)

    if response is not None:
        errors = None
        detail = response.data

        if isinstance(response.data, dict):
            if "detail" in response.data:
                # Plain APIException / PermissionDenied / NotFound etc.
                detail = response.data["detail"]
                errors = {k: v for k, v in response.data.items() if k != "detail"} or None
            else:
                # Field-level validation errors have no top-level "detail"; build one
                # from the first field error instead of a generic fallback.
                errors = response.data
                first_key = next(iter(errors), None)
                detail = f"{first_key}: {_first_message(errors[first_key])}" if first_key else "Validation failed."
        elif isinstance(response.data, list):
            detail = "Validation failed."
            errors = {"non_field_errors": response.data}

        response.data = {"detail": detail, "errors": errors}
        return response

    logger.exception("Unhandled exception in view: %s", exc, extra={"context": str(context)})

    if settings.DEBUG:
        # In development, let Django render the full traceback.
        raise exc

    return Response(
        {"detail": "An unexpected server error occurred.", "errors": None},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
