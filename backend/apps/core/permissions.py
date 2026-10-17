from rest_framework import permissions

from apps.accounts.models import Role


class IsStaffRole(permissions.BasePermission):
    """Allows access only to users with Staff-level permissions (FR3, FR5,
    FR29) — Staff and Admin both qualify (see User.is_staff_role).
    """

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff_role)


class IsCommunicationsRole(permissions.BasePermission):
    """Allows access only to Communications team members (Stage 3A, 3B).
    Includes Communications Lead — see User.is_communications.
    """

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_communications)


class IsCommunicationsLead(permissions.BasePermission):
    """Support Requests Enhancement: gates Lead-only actions — assigning
    (or reassigning) Communications staff to a Support Request, including
    the Lead assigning themselves, and declining a request. Regular
    Communications accounts can still view everything and progress the
    status of requests assigned to them (see SupportRequestDetailView /
    SupportRequestAssignView in communications/views.py); only
    assignment and declining are Lead-restricted.
    """

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_communications_lead)


class IsLeadershipRole(permissions.BasePermission):
    """Allows access only to Leadership/SMT viewers."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_leadership)


class IsCommunicationsOrLeadership(permissions.BasePermission):
    """Used for the Calendar (Stage 3B) and other views shared by both
    Communications and Leadership per the UI/UX permission matrix (Section 17).
    Admin included too — same "sees more, not less" reasoning as Audit Trail.
    """

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and (request.user.is_communications or request.user.has_role(Role.LEADERSHIP, Role.ADMIN))
        )


class IsEventOwner(permissions.BasePermission):
    """Object-level permission restricting edit/delete to the staff member
    who owns the event (FR3). Read access for Communications/Leadership is
    handled separately at the queryset level, not here.
    """

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        owner_id = getattr(obj, "owner_id", None) or getattr(getattr(obj, "event", None), "owner_id", None)
        return owner_id == request.user.id


class ReadOnly(permissions.BasePermission):
    """Grants read-only (safe method) access unconditionally; used to
    compose with role permissions using OR (|) so e.g. Leadership can
    always view but never write.
    """

    def has_permission(self, request, view):
        return request.method in permissions.SAFE_METHODS


class IsCommunicationsOrAdmin(permissions.BasePermission):
    """TV Display slide management (Staff Spotlight, Celebrations,
    Announcements, Recognitions, Quick Information): Communications and
    Admin can add/edit/delete slides. Deliberately narrower than
    IsAdminOrLeadership (which still gates the master TVDisplaySettings
    on/off + ordering) — Leadership doesn't get slide-authoring access,
    only Communications/Admin do, per how this was scoped.
    """

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and (request.user.is_communications or request.user.is_admin_role or request.user.is_superuser)
        )


class IsAdminOrLeadershipOrCommunications(permissions.BasePermission):
    """Gate for the master TVDisplaySettings (on/off, ordering, timing).

    Originally Admin/Leadership only (see IsAdminOrLeadership); widened
    on request so Communications has the same full control over the TV
    Display settings as Admin, rather than being limited to slide
    authoring via IsCommunicationsOrAdmin. Scoped to this one endpoint
    rather than changing IsAdminOrLeadership itself, since that class
    also gates the unrelated Configuration admin area.
    """

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and (
                request.user.has_role(Role.ADMIN, Role.LEADERSHIP)
                or request.user.is_communications
                or request.user.is_superuser
            )
        )


class IsAdminOrLeadership(permissions.BasePermission):
    """Gate for the Configuration admin area (all 8 dropdown lists plus
    System Settings). Originally superuser-only (no dedicated Admin
    business role existed yet); now checks the Admin role too, added on
    request — `is_superuser` is kept as a fallback so an existing Django
    superuser never gets locked out just because nobody's gotten around
    to setting their role to Admin yet. Name kept as-is rather than
    renamed, to avoid unrelated import churn across the app.
    """

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and (request.user.is_admin_role or request.user.is_superuser)
        )
