from django.utils.dateparse import parse_date
from rest_framework import generics, mixins, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts.models import Role, User, role_q
from apps.audit.models import ActionType, AuditLog
from apps.audit.models import ObjectType as AuditObjectType
from apps.audit.serializers import AuditLogSerializer
from apps.audit.utils import log_action
from apps.core.permissions import IsAdminOrLeadership
from apps.notifications.models import NotificationType
from apps.notifications.utils import notify_users

from .filters import EventFilter
from .models import Event, EventStatus
from .permissions import EventPermission
from .serializers import (
    AdminEventCreateSerializer,
    AdminEventUpdateSerializer,
    EventDetailSerializer,
    EventListSerializer,
    EventWriteSerializer,
)
from .services.notifications import notify_communications_of_new_event


class EventViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Stage 2 (event logging) + the read/edit surface for My Events and
    Event Details. Deletion is intentionally unsupported: FR44 requires
    indefinite retention of all event records, and no UI/UX action exists
    for deleting an event.
    """

    permission_classes = [EventPermission]
    filterset_class = EventFilter
    search_fields = ["title", "venue", "city", "country", "organization_lead_agency"]
    ordering_fields = ["start_date", "end_date", "created_at", "title"]
    ordering = ["-start_date"]

    def get_queryset(self):
        user = self.request.user
        # post_event_report is joined to avoid N+1 queries in list serializers.
        qs = Event.objects.select_related("owner", "post_event_report").all()

        if user.is_staff_only and self.action == "list":
            # Staff lists show only events they logged; any event can still be
            # opened read-only (e.g. from Upcoming or Big Events).
            return qs.filter(owner=user)
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return EventListSerializer
        if self.action in ("create", "update", "partial_update"):
            return EventWriteSerializer
        return EventDetailSerializer

    def perform_create(self, serializer):
        event = serializer.save(owner=self.request.user)
        notify_communications_of_new_event(event)
        if event.needs_comms_support:
            notify_users(
                User.objects.filter(role_q(Role.COMMUNICATIONS, Role.COMMS_LEAD)),
                NotificationType.NEW_EVENT,
                f"New {event.get_category_label()} event '{event.title}' was logged and needs Communications support.",
                link=f"/events/{event.id}",
            )
        # Leadership is notified of every new event, not only those needing Comms.
        notify_users(
            User.objects.filter(role_q(Role.LEADERSHIP)),
            NotificationType.NEW_EVENT,
            f"New {event.get_category_label()} event '{event.title}' was logged by "
            f"{event.owner.get_full_name() or event.owner.email}.",
            link="/dashboard",
        )
        log_action(
            ActionType.CREATED,
            event,
            user=self.request.user,
            description=f"Event '{event.title}' logged as {event.get_category_label()}.",
        )

    def perform_update(self, serializer):
        event = self.get_object()
        if not event.is_editable:
            raise PermissionDenied(
                "This event can no longer be edited because its Event Status Report has been submitted."
            )
        # Regular edits don't change status; only date/venue changes are detected.
        old_start_date = event.start_date
        old_venue = event.venue

        updated_event = serializer.save()

        if updated_event.needs_comms_support:
            changes = []
            if updated_event.start_date != old_start_date:
                changes.append(f"date changed to {updated_event.start_date}")
            if updated_event.venue != old_venue:
                changes.append("venue changed")
            if changes:
                notify_users(
                    User.objects.filter(role_q(Role.COMMUNICATIONS, Role.COMMS_LEAD)),
                    NotificationType.EVENT_UPDATED,
                    f"Event '{updated_event.title}' was {', '.join(changes)}.",
                    link=f"/events/{updated_event.id}",
                )

        log_action(
            ActionType.UPDATED,
            updated_event,
            user=self.request.user,
            description=f"Event '{updated_event.title}' updated.",
        )


class EventHistoryView(generics.ListAPIView):
    """Item 5 (preserve event history instead of clearing it): every
    Regular Edit, Postpone, Cancel, and Reopen is already recorded in the
    audit log (see perform_update / EventStatusActionView) — this exposes
    that history for a single event. Deliberately a separate view from the
    main Audit Trail page (which is Communications/Leadership-only):
    the Staff member who owns this event should be able to see its history
    too, since it's their own record.
    """

    serializer_class = AuditLogSerializer
    permission_classes = [EventPermission]
    queryset = Event.objects.select_related("owner").all()

    def get(self, request, *args, **kwargs):
        event = self.get_object()
        self.check_object_permissions(request, event)
        logs = AuditLog.objects.filter(object_type=AuditObjectType.EVENT, object_id=str(event.id)).order_by(
            "-created_at"
        )
        return Response(AuditLogSerializer(logs, many=True).data)


ACTION_TO_STATUS = {
    "postpone": EventStatus.POSTPONED,
    "cancel": EventStatus.CANCELLED,
    "reopen": EventStatus.LOGGED,
}


def apply_status_action(event, user, action, reason, new_start_date, new_end_date):
    """Shared by EventStatusActionView (owner-only) and
    AdminEventStatusActionView (item 7.4 — any event) so there's exactly
    one implementation of postpone/cancel/reopen, not two that could
    silently drift apart. Returns a Response either way (an error
    Response for validation failures, the updated event otherwise) so
    both callers can just `return apply_status_action(...)`.
    """
    if action not in ACTION_TO_STATUS:
        return Response({"action": "Must be one of: postpone, cancel, reopen."}, status=400)
    if event.status == EventStatus.COMPLETED:
        return Response({"detail": "This event is already completed and its status can't be changed."}, status=400)
    if action in ("postpone", "cancel") and not reason:
        return Response({"reason": f"A reason is required to {action} an event."}, status=400)
    if action == "reopen" and event.status not in (EventStatus.POSTPONED, EventStatus.CANCELLED):
        return Response({"detail": "Only a postponed or cancelled event can be reopened."}, status=400)
    if action == "postpone":
        if not new_start_date or not new_end_date:
            return Response(
                {"new_start_date": "The new (postponed-to) start and end dates are required."}, status=400
            )
        if new_end_date < new_start_date:
            return Response({"new_end_date": "End date can't be before the start date."}, status=400)

    old_dates = f"{event.start_date} to {event.end_date}"
    new_status = ACTION_TO_STATUS[action]
    event.status = new_status
    event.status_reason = reason
    update_fields = ["status", "status_reason", "updated_at"]
    if action == "postpone":
        event.start_date = new_start_date
        event.end_date = new_end_date
        update_fields += ["start_date", "end_date"]
    event.save(update_fields=update_fields)

    verb = {"postpone": "postponed", "cancel": "cancelled", "reopen": "reopened"}[action]
    date_note = f" Rescheduled from {old_dates} to {event.start_date} to {event.end_date}." if action == "postpone" else ""
    log_action(
        ActionType.STATUS_CHANGED,
        event,
        user=user,
        description=f"Event '{event.title}' {verb}.{date_note}" + (f' Reason: "{reason}"' if reason else ""),
    )

    # Comms is notified of status actions whether or not the event needs support.
    message = f"Event '{event.title}' was {verb}.{date_note}"
    if reason:
        message += f' Reason: "{reason}"'
    notify_users(
        User.objects.filter(role_q(Role.COMMUNICATIONS, Role.COMMS_LEAD)),
        NotificationType.EVENT_UPDATED,
        message,
        link=f"/events/{event.id}",
    )

    return Response(EventDetailSerializer(event).data)


class EventStatusActionView(generics.GenericAPIView):
    """Item 4: Postpone / Cancel / Reopen as dedicated, explicit lifecycle
    actions — deliberately separate from the regular Edit form.

    A Regular Edit is correcting/adjusting details of an event that's
    still happening as planned. Postpone/Cancel change what's actually
    happening to the event itself: they require a reason on record, and
    they have side effects (Comms notification, dashboard exclusion from
    "upcoming") that a quiet field edit shouldn't silently trigger.
    Burying them in the generic Edit form meant Communications watching
    for date changes had no reliable way to notice a postponement — a
    diff-detection buried in perform_update is not the same as a real,
    intentional action with its own confirmation and reason.

    POST /events/<id>/status-action/  body: {"action": "postpone"|"cancel"|"reopen", "reason": "...",
                                              "new_start_date": "...", "new_end_date": "..."}
    `reason` is required for postpone/cancel, optional for reopen.
    `new_start_date`/`new_end_date` are required for postpone only (item:
    entering the postponed-to date here, not a separate edit afterward) —
    they update the event's actual start_date/end_date, which is what the
    Calendar and every other date-driven view already reads from, so a
    postponed event immediately shows on its new date everywhere, with no
    separate "postponed to" field to keep in sync.

    Owner-only (via EventPermission) — see AdminEventStatusActionView for
    the Admin-page equivalent that works on any event.
    """

    permission_classes = [EventPermission]
    serializer_class = EventDetailSerializer
    queryset = Event.objects.select_related("owner").all()

    def post(self, request, *args, **kwargs):
        event = self.get_object()
        self.check_object_permissions(request, event)

        return apply_status_action(
            event,
            request.user,
            request.data.get("action"),
            (request.data.get("reason") or "").strip(),
            parse_date(request.data.get("new_start_date") or ""),
            parse_date(request.data.get("new_end_date") or ""),
        )


class AdminEventListCreateView(generics.ListCreateAPIView):
    """Item 7.4 (Admin Page > Events): list every event (no owner
    scoping — same visibility Communications/Leadership already have) and
    create one on any staff member's behalf. The regular Create Event flow
    (EventViewSet.perform_create) always sets owner=the logged-in user;
    this is the one path that can set it to someone else.
    """

    queryset = Event.objects.select_related("owner").order_by("-start_date")
    permission_classes = [IsAdminOrLeadership]
    filterset_class = EventFilter
    search_fields = ["title", "venue", "city", "country", "organization_lead_agency", "owner__first_name", "owner__last_name"]
    ordering_fields = ["start_date", "end_date", "created_at", "title"]
    ordering = ["-start_date"]

    def get_serializer_class(self):
        return AdminEventCreateSerializer if self.request.method == "POST" else EventListSerializer

    def perform_create(self, serializer):
        event = serializer.save()
        notify_communications_of_new_event(event)
        if event.needs_comms_support:
            notify_users(
                User.objects.filter(role_q(Role.COMMUNICATIONS, Role.COMMS_LEAD)),
                NotificationType.NEW_EVENT,
                f"New {event.get_category_label()} event '{event.title}' was logged and needs Communications support.",
                link=f"/events/{event.id}",
            )
        notify_users(
            User.objects.filter(role_q(Role.LEADERSHIP)),
            NotificationType.NEW_EVENT,
            f"New {event.get_category_label()} event '{event.title}' was logged by "
            f"{event.owner.get_full_name() or event.owner.email}.",
            link="/dashboard",
        )
        log_action(
            ActionType.CREATED,
            event,
            user=self.request.user,
            description=f"Event '{event.title}' added for {event.owner.get_full_name()} via Admin Page.",
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        event = Event.objects.select_related("owner").get(pk=serializer.instance.pk)
        return Response(EventDetailSerializer(event, context={"request": request}).data, status=201)


class AdminEventDetailView(generics.RetrieveUpdateAPIView):
    """Edit any event's details, bypassing the owner-only restriction the
    regular EventViewSet has. Deliberately no DELETE — same reasoning
    EventViewSet's own docstring already states for the whole app
    ("indefinite retention of all event records, and no UI/UX action
    exists for deleting an event"): Events have Support Requests, Event
    Status Reports, photos, and a full audit trail hanging off them, and
    the app already has a real, well-defined state for "this isn't
    happening" — Cancelled (see AdminEventStatusActionView below) — so
    there's no state a delete would represent that Cancel doesn't already
    cover, without the data loss.

    The is_editable lock (no edits once an Event Status Report is
    submitted) still applies here too, for the same reason it applies to
    the owner themselves: protecting the integrity of a submitted report
    against the record it describes silently changing underneath it.
    """

    queryset = Event.objects.select_related("owner").all()
    permission_classes = [IsAdminOrLeadership]

    def get_serializer_class(self):
        return AdminEventUpdateSerializer if self.request.method in ("PUT", "PATCH") else EventDetailSerializer

    def perform_update(self, serializer):
        event = self.get_object()
        if not event.is_editable:
            raise PermissionDenied(
                "This event can no longer be edited because its Event Status Report has been submitted."
            )
        updated_event = serializer.save()
        log_action(
            ActionType.UPDATED,
            updated_event,
            user=self.request.user,
            description=f"Event '{updated_event.title}' updated via Admin Page.",
        )

    def update(self, request, *args, **kwargs):
        super().update(request, *args, **kwargs)
        event = self.get_object()
        return Response(EventDetailSerializer(event, context={"request": request}).data)


class AdminEventStatusActionView(generics.GenericAPIView):
    """Item 7.4: Postpone/Cancel/Reopen any event, not just one's own —
    the Admin-page equivalent of EventStatusActionView, sharing the exact
    same apply_status_action() logic so the two can't drift apart.
    """

    permission_classes = [IsAdminOrLeadership]
    queryset = Event.objects.select_related("owner").all()

    def post(self, request, *args, **kwargs):
        event = self.get_object()
        return apply_status_action(
            event,
            request.user,
            request.data.get("action"),
            (request.data.get("reason") or "").strip(),
            parse_date(request.data.get("new_start_date") or ""),
            parse_date(request.data.get("new_end_date") or ""),
        )
