import threading

_thread_locals = threading.local()


def get_current_user():
    """Returns the user attached to the in-flight request, or None.

    Some audit entries are written from inside model signals / service
    functions that don't have direct access to the request object. Rather
    than threading `request.user` through every function signature, we
    stash it here for the duration of the request.
    """
    return getattr(_thread_locals, "user", None)


class CurrentUserMiddleware:
    """Stores the authenticated user on a thread-local for the duration of
    the request/response cycle so audit logging helpers can access it
    without every call site needing to accept and forward `request`.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _thread_locals.user = getattr(request, "user", None)
        try:
            response = self.get_response(request)
        finally:
            _thread_locals.user = None
        return response
