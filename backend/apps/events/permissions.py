from rest_framework import permissions


class EventPermission(permissions.BasePermission):
    """Implements the full event access matrix:

    - Staff: may create events and edit only their own (FR3, FR5); their event
      list is limited to their own, but any event can be opened read-only.
    - Communications: read-only across all events (needed to action Stage 3
      support requests and view the Calendar/Dashboard).
    - Leadership: read-only across all events (viewer role, Section 17).

    Object-level editing is further restricted to the owner AND only while
    the event is still editable (no Event Status Report submitted yet).
    """

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False

        if request.method in permissions.SAFE_METHODS:
            return True

        # Only Staff-level (incl. Admin) may create/update/delete events at all.
        return request.user.is_staff_role

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True

        # Write access: must be the owner, and the event must still be editable.
        if obj.owner_id != request.user.id:
            return False
        return obj.is_editable
