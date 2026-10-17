import datetime as _dt

from django.db import transaction
from django.db.models import Count, OuterRef, Q, Subquery, Value
from django.db.models.fields import DateTimeField
from django.db.models.functions import Coalesce
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.views import APIView
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.models import Role, User, role_q
from apps.audit.models import ActionType
from apps.audit.utils import log_action
from apps.core.permissions import (
    IsAdminOrLeadership,
    IsCommunicationsLead,
    IsCommunicationsOrLeadership,
    IsCommunicationsRole,
)
from apps.events.models import Event, EventStatus
from apps.notifications.models import Notification, NotificationType
from apps.notifications.utils import notify_user, notify_users

from .attachments import validate_attachments
from .filters import SupportRequestFilter
from .models import (
    TERMINAL_STATUSES,
    CalendarNote,
    SupportRequest,
    SupportRequestAssignmentLog,
    SupportRequestMessage,
    SupportRequestMessageAttachment,
    SupportRequestReadState,
    SupportRequestStatus,
    TodoItem,
)
from .serializers import (
    AdminSupportRequestCreateSerializer,
    AdminSupportRequestUpdateSerializer,
    AssignedUserSerializer,
    AssignmentLogSerializer,
    CalendarEventSerializer,
    CalendarNoteSerializer,
    PostponedCancelledEventSerializer,
    SupportRequestAssignSerializer,
    SupportRequestCreateSerializer,
    SupportRequestMessageSerializer,
    SupportRequestSerializer,
    SupportRequestStatusUpdateSerializer,
    TodoItemToggleSerializer,
    is_conversation_participant,
)
from .services import compute_comms_overview, notify_communications_of_support_request


class SupportRequestCreateView(generics.GenericAPIView):
    """Stage 3 (UI/UX Section 7): submit a Communications Support Request
    for a specific event. Only the event's owner may submit it, and only
    once (FR19).

    Updated requirement #1: Comms Support Yes/No is now asked for every
    event category, so this no longer restricts to Internal events only —
    it now requires only that the event's `needs_comms_support` flag is
    set to true.
    """

    serializer_class = SupportRequestCreateSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_event(self):
        event = get_object_or_404(Event, pk=self.kwargs["event_id"])
        if not self.request.user.is_staff_role or event.owner_id != self.request.user.id:
            raise PermissionDenied("Only the event owner may submit a Communications Support Request.")
        return event

    def post(self, request, *args, **kwargs):
        event = self.get_event()

        if not event.needs_comms_support:
            raise ValidationError({
                "event": "This event was not marked as needing Communications support."
            })
        if event.has_support_request:
            raise ValidationError({"event": "A Communications Support Request already exists for this event."})

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        support_request = serializer.save(event=event)

        notify_communications_of_support_request(support_request)
        notify_users(
            User.objects.filter(role_q(Role.COMMUNICATIONS, Role.COMMS_LEAD)),
            NotificationType.SUPPORT_REQUESTED,
            f"Communications support requested for '{event.title}'.",
            link=f"/support-requests/{support_request.id}",
        )
        log_action(
            ActionType.SUBMITTED,
            support_request,
            user=request.user,
            description=f"Communications Support Request submitted for '{event.title}'.",
        )

        return Response(SupportRequestSerializer(support_request).data, status=status.HTTP_201_CREATED)

    def get(self, request, *args, **kwargs):
        event = get_object_or_404(Event, pk=self.kwargs["event_id"])
        if _sees_only_own_requests(request.user) and event.owner_id != request.user.id:
            raise PermissionDenied("You may only view Support Requests for events you own.")
        if not event.has_support_request:
            return Response({"detail": "No Support Request exists for this event."}, status=status.HTTP_404_NOT_FOUND)
        if (
            request.user.is_plain_communications
            and not event.support_request.assigned_to.filter(pk=request.user.pk).exists()
            and not (request.user.has_role(Role.STAFF) and event.owner_id == request.user.id)
        ):
            raise PermissionDenied("This Support Request is not assigned to you.")
        return Response(SupportRequestSerializer(event.support_request).data)


def _sees_only_own_requests(user):
    """Only the Staff role is limited to support requests on events it owns.

    NOT `user.is_staff_role`: that property is also True for Admin (Admin
    carries Staff-level day-to-day permissions), which wrongly narrowed an
    Admin's Support Requests list to events they personally own, so Admin
    saw "No Communications Support Requests found" even when requests
    existed. Admin, like Leadership and Communications, sees every request.
    """
    return user.is_staff_only


def _visible_requests(qs, user):
    """Which support requests a user may open. Staff: those on events they own.
    Communications team members (not the Lead): only requests assigned to them,
    including ones shared with other assignees. The Lead, Leadership and Admin
    see every request.
    """
    if _sees_only_own_requests(user):
        return qs.filter(event__owner=user)
    if user.is_plain_communications:
        if user.has_role(Role.STAFF):
            return qs.filter(Q(assigned_to=user) | Q(event__owner=user)).distinct()
        return qs.filter(assigned_to=user)
    return qs


_EPOCH = _dt.datetime(1970, 1, 1, tzinfo=_dt.timezone.utc)


def annotate_unread(qs, user):
    """Adds `unread_count_annotation`: messages from other people newer than
    this user's last_read_at for that request (a correlated subquery, so it
    stays correct next to the assigned_to joins the filters use)."""
    last_read = SupportRequestReadState.objects.filter(support_request=OuterRef("support_request_id"), user=user).values(
        "last_read_at"
    )[:1]
    unread = (
        SupportRequestMessage.objects.filter(support_request=OuterRef("pk"))
        .exclude(sender=user)
        .filter(created_at__gt=Coalesce(Subquery(last_read, output_field=DateTimeField()), Value(_EPOCH, output_field=DateTimeField())))
        .order_by()
        .values("support_request")
        .annotate(c=Count("pk"))
        .values("c")[:1]
    )
    return qs.annotate(unread_count_annotation=Coalesce(Subquery(unread), 0))


class SupportRequestListView(generics.ListAPIView):
    """Stage 8 'Communications Requests' page (Assigned Requests for the
    Communications team). Visibility follows _visible_requests: the Lead,
    Leadership and Admin see every support request, Communications members only
    the ones assigned to them, and Staff the ones tied to events they own
    (read-only; write actions like resolving a request or toggling a to-do item
    stay Communications-only, enforced separately on those views).
    """

    serializer_class = SupportRequestSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_class = SupportRequestFilter
    search_fields = ["event__title", "event__owner__first_name", "event__owner__last_name"]
    ordering_fields = ["created_at", "event__start_date"]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = SupportRequest.objects.select_related("event", "event__owner").prefetch_related("todo_items", "assigned_to")
        qs = annotate_unread(qs, self.request.user)
        return _visible_requests(qs, self.request.user)


class SupportRequestDetailView(generics.RetrieveAPIView):
    """Full details view when a row is clicked (UI/UX Section 8). Same
    visibility as the list view above.
    """

    serializer_class = SupportRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = SupportRequest.objects.select_related("event", "event__owner").prefetch_related("todo_items", "assigned_to")
        qs = annotate_unread(qs, self.request.user)
        return _visible_requests(qs, self.request.user)


class TodoItemToggleView(generics.RetrieveUpdateDestroyAPIView):
    """FR22: Communications team marks a to-do item Done/not Done.

    Also supports DELETE: a to-do item is auto-generated per selected
    support type (see TodoItem docstring), but Communications sometimes
    needs to remove one that no longer applies (e.g. the request changed
    scope) rather than leave it sitting there unchecked forever. Restricted
    to the same Communications-only permission as toggling.
    """

    serializer_class = TodoItemToggleSerializer
    permission_classes = [IsCommunicationsRole]

    def get_queryset(self):
        qs = TodoItem.objects.select_related("support_request")
        if self.request.user.is_plain_communications:
            if self.request.user.has_role(Role.STAFF):
                return qs.filter(
                    Q(support_request__assigned_to=self.request.user)
                    | Q(support_request__event__owner=self.request.user)
                ).distinct()
            return qs.filter(support_request__assigned_to=self.request.user)
        return qs

    def perform_destroy(self, instance):
        label = instance.label
        support_request = instance.support_request
        log_action(
            ActionType.DELETED,
            instance,
            user=self.request.user,
            description=f"To-do item '{label}' deleted from support request for '{support_request.event.title}'.",
        )
        instance.delete()

    def perform_update(self, serializer):
        item = serializer.save()
        log_action(
            ActionType.TODO_COMPLETED if item.is_done else ActionType.UPDATED,
            item,
            user=self.request.user,
            description=f"To-do item '{item.label}' marked {'Done' if item.is_done else 'Pending'}.",
        )
        # Item #9: notify the Staff member who owns the event once every
        # item on their support request's checklist is done — previously
        # there was no way for them to find out except by checking back
        # manually. Only fires on the transition INTO fully-done (not on
        # every toggle while already complete, and not when un-checking).
        support_request = item.support_request
        if item.is_done and support_request.is_fully_completed:
            notify_user(
                support_request.event.owner,
                NotificationType.SUPPORT_COMPLETED,
                f"Communications support for '{support_request.event.title}' is fully completed.",
                link=f"/events/{support_request.event.id}",
            )


class CalendarView(generics.ListAPIView):
    """Stage 3B (FR25-FR28): every event, not only ones with a submitted
    Communications Support Request — Comms/Leadership need the full
    picture of what's happening and when, not just what needs their
    action. Originally restricted to Internal events only (FR27), but
    since Comms Support Requests can now come from any category (updated
    requirement #1), the Internal-only restriction has been removed —
    otherwise Communications would have a visibility gap for e.g. an
    International event that needs a banner.

    Calendar Update: (1) only events still on their normal date-driven
    track are shown - Completed, Postponed and Cancelled events are left
    off the Calendar; (2) the response is no longer paginated. It used to
    return just the first 20 events (oldest first), so once more than 20
    events existed the newest/upcoming ones silently never appeared. The
    Calendar has to draw every event in whatever period is on screen, and
    the rows are small, so it's one plain list (the frontend already
    accepts either shape).
    """

    serializer_class = CalendarEventSerializer
    permission_classes = [IsCommunicationsOrLeadership]
    pagination_class = None
    queryset = (
        Event.objects.select_related("support_request", "owner")
        .filter(status=EventStatus.LOGGED)
        .order_by("start_date", "title")
    )


class CalendarNoteListCreateView(generics.ListCreateAPIView):
    """Calendar quick-add notes (title + date). Same audience as the
    Calendar itself: anyone who can open it can see and add notes."""

    serializer_class = CalendarNoteSerializer
    permission_classes = [IsCommunicationsOrLeadership]
    pagination_class = None
    queryset = CalendarNote.objects.select_related("created_by").all()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class CalendarNoteDetailView(generics.DestroyAPIView):
    """Remove a note: its author, or Admin."""

    serializer_class = CalendarNoteSerializer
    permission_classes = [IsCommunicationsOrLeadership]
    queryset = CalendarNote.objects.all()

    def perform_destroy(self, instance):
        user = self.request.user
        if not (user.is_admin_role or instance.created_by_id == user.id):
            raise PermissionDenied("Only the person who added this note, or an Admin, can delete it.")
        instance.delete()


class PostponedCancelledEventsView(generics.ListAPIView):
    """Item 3: durable list of every Postponed/Cancelled event for
    Communications/Leadership/Admin — regardless of whether that event
    ever needed comms support, so this is *not* limited to
    SupportRequest rows the way SupportRequestListView above is. Closes
    the gap where an event postponed with needs_comms_support=False only
    ever showed up as a one-time notification, with nowhere to look it up
    again afterward.
    """

    serializer_class = PostponedCancelledEventSerializer
    permission_classes = [IsCommunicationsOrLeadership]
    ordering = ["-updated_at"]

    def get_queryset(self):
        return (
            Event.objects.select_related("owner")
            .filter(status__in=["postponed", "cancelled"])
            .order_by("-updated_at")
        )


class AdminSupportRequestListCreateView(generics.ListCreateAPIView):
    """Item 7.3 (Admin Page > Communications): every Support Request
    across every event, not scoped to "requests I need to action" the way
    the Comms-facing SupportRequestListView is — an admin can also create
    one on an event's behalf here (e.g. Comms support was needed but the
    owner never got around to submitting it).
    """

    queryset = SupportRequest.objects.select_related("event", "event__owner").order_by("-created_at")
    permission_classes = [IsAdminOrLeadership]
    filterset_fields = []
    search_fields = ["event__title", "event__owner__first_name", "event__owner__last_name"]

    def get_serializer_class(self):
        return AdminSupportRequestCreateSerializer if self.request.method == "POST" else SupportRequestSerializer

    def perform_create(self, serializer):
        support_request = serializer.save()
        notify_communications_of_support_request(support_request)
        log_action(
            ActionType.SUBMITTED,
            support_request,
            user=self.request.user,
            description=f"Communications Support Request added for '{support_request.event.title}' (Admin Page).",
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        # Re-serialize with the read-facing shape (event title/owner/todo_items
        # etc.) rather than echoing back the create-only field set.
        support_request = SupportRequest.objects.get(pk=serializer.instance.pk)
        return Response(SupportRequestSerializer(support_request).data, status=status.HTTP_201_CREATED)


class AdminSupportRequestDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Edit (notes/support_details, see AdminSupportRequestUpdateSerializer
    docstring for why support_types itself isn't editable here) or delete.

    Unlike ConfigOption/Staff, a real DELETE is appropriate here rather
    than deactivate-only: nothing else references a SupportRequest as a
    stable identifier the way Events reference a Category value or an
    AuditLog references a User. Deleting one just clears event.support_request
    back to null (TodoItems cascade with it) — the event's own detail page
    already has a well-defined display for exactly that state ("support
    was requested, but the request was never submitted"), so this can't
    leave anything in a broken or undefined state the way the other
    deletes could.
    """

    queryset = SupportRequest.objects.select_related("event", "event__owner")
    permission_classes = [IsAdminOrLeadership]

    def get_serializer_class(self):
        return AdminSupportRequestUpdateSerializer if self.request.method in ("PUT", "PATCH") else SupportRequestSerializer

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action(
            ActionType.UPDATED,
            instance,
            user=self.request.user,
            description=f"Updated Communications Support Request for '{instance.event.title}'.",
        )

    def perform_destroy(self, instance):
        event_title = instance.event.title
        log_action(
            ActionType.DELETED,
            instance,
            user=self.request.user,
            description=f"Deleted Communications Support Request for '{event_title}'.",
        )
        instance.delete()

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        instance = self.get_object()
        response.data = SupportRequestSerializer(instance).data
        return response


class CommunicationsTeamListView(generics.ListAPIView):
    """Support Requests Enhancement: the assignee options for the
    Requested Supports tab's assignment control (Communications + Comms
    Lead). Any Communications team member can view the roster — only
    IsCommunicationsLead can actually call SupportRequestAssignView above
    with it.
    """

    serializer_class = AssignedUserSerializer
    permission_classes = [IsCommunicationsRole]
    queryset = User.objects.filter(role_q(Role.COMMUNICATIONS, Role.COMMS_LEAD)).order_by(
        "first_name", "last_name"
    )
    pagination_class = None


class SupportRequestAssignView(generics.UpdateAPIView):
    """Lead-only. Sets the request's entire assignee list in one call
    (whole-request-level — see SupportRequestAssignSerializer): the Lead
    can add, remove or replace assignees at any time, including assigning
    themselves (include their own id in the list). An empty list unassigns
    the request entirely (back to "Unassigned"). Everyone added or removed
    is notified, and the change is written to the assignment history.
    """

    serializer_class = SupportRequestAssignSerializer
    permission_classes = [IsCommunicationsLead]
    queryset = SupportRequest.objects.select_related("event")
    http_method_names = ["patch"]

    def perform_update(self, serializer):
        instance = serializer.save()
        link = f"/support-requests/{instance.id}"
        for user in instance.added_users:
            notify_user(
                user,
                NotificationType.SUPPORT_ASSIGNED,
                f"You've been assigned to the Communications Support Request for '{instance.event.title}'.",
                link=link,
            )
        for user in instance.removed_users:
            notify_user(
                user,
                NotificationType.SUPPORT_UNASSIGNED,
                f"You've been removed from the Communications Support Request for '{instance.event.title}'.",
                link=link,
            )
        assignee_names = ", ".join(
            u.get_full_name() or u.email for u in instance.assigned_to.all()
        ) or "nobody (unassigned)"
        log_action(
            ActionType.UPDATED,
            instance,
            user=self.request.user,
            description=f"Support Request for '{instance.event.title}' assigned to: {assignee_names}.",
        )

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        instance = self.get_object()
        response.data = SupportRequestSerializer(instance).data
        return response


# Statuses an assigned (non-Lead) Communications member may set. Unassigned /
# Assigned follow the assignee list automatically, and Declined, and reopening
# a resolved request, are Lead-only.
ASSIGNEE_SETTABLE_STATUSES = (
    SupportRequestStatus.IN_PROGRESS,
    SupportRequestStatus.NEEDS_CLARIFICATION,
    SupportRequestStatus.CLARIFICATION_PROVIDED,
    SupportRequestStatus.ON_HOLD,
    SupportRequestStatus.COMPLETED,
)


class SupportRequestStatusUpdateView(generics.UpdateAPIView):
    """Status changes.

    - Communications Lead: any status, on any request. Choosing Assigned or
      Unassigned (e.g. to reopen a Completed/Declined request) resolves to
      whichever of the two matches the request's current assignees.
    - Communications (non-Lead): only on requests they're personally
      assigned to, only the working statuses (see
      ASSIGNEE_SETTABLE_STATUSES), and not on a Completed/Declined request —
      only the Lead can reopen those.
    """

    serializer_class = SupportRequestStatusUpdateSerializer
    permission_classes = [IsCommunicationsRole]
    queryset = SupportRequest.objects.select_related("event")
    http_method_names = ["patch"]

    def perform_update(self, serializer):
        instance = serializer.instance
        user = self.request.user
        new_status = serializer.validated_data.get("status")

        if not user.is_communications_lead:
            if not instance.assigned_to.filter(pk=user.pk).exists():
                raise PermissionDenied("You can only update the status of Support Requests assigned to you.")
            if instance.status in TERMINAL_STATUSES:
                raise PermissionDenied("Only the Communications Lead can reopen a completed or declined Support Request.")
            if new_status == SupportRequestStatus.DECLINED:
                raise PermissionDenied("Only the Communications Lead can decline a Support Request.")
            if new_status not in ASSIGNEE_SETTABLE_STATUSES:
                raise PermissionDenied("You can't set that status.")
        elif new_status in (SupportRequestStatus.UNASSIGNED, SupportRequestStatus.ASSIGNED):
            new_status = (
                SupportRequestStatus.ASSIGNED if instance.assigned_to.exists() else SupportRequestStatus.UNASSIGNED
            )
            serializer.validated_data["status"] = new_status

        old_status_label = instance.get_status_display()
        updated = serializer.save()
        log_action(
            ActionType.STATUS_CHANGED,
            updated,
            user=user,
            description=(
                f"Support Request for '{updated.event.title}' status changed from "
                f"{old_status_label} to {updated.get_status_display()}."
            ),
        )

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        instance = self.get_object()
        response.data = SupportRequestSerializer(instance).data
        return response


class SupportRequestAssignmentHistoryView(generics.ListAPIView):
    """Who assigned / removed whom, and when. Communications Lead only; the
    screen no longer displays it, but changes are still recorded."""

    serializer_class = AssignmentLogSerializer
    permission_classes = [IsCommunicationsLead]
    pagination_class = None

    def get_queryset(self):
        return SupportRequestAssignmentLog.objects.filter(support_request_id=self.kwargs["pk"]).select_related(
            "user", "performed_by"
        )


def _message_recipients(support_request, exclude_user):
    """Everyone in the conversation: the requester, the assignees and the
    Communications Lead(s), minus the sender. Keyed by user id, so someone
    who is both an assignee and a Lead is only notified once."""
    people = {support_request.event.owner_id: support_request.event.owner}
    for u in support_request.assigned_to.all():
        people[u.pk] = u
    for u in User.objects.filter(role_q(Role.COMMS_LEAD), is_active=True):
        people[u.pk] = u
    people.pop(exclude_user.pk, None)
    return people


def _as_bool(value):
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


def _visible_support_request_or_404(user, pk):
    """Same visibility as the request detail page (see _visible_requests)."""
    qs = SupportRequest.objects.select_related("event", "event__owner").prefetch_related("assigned_to")
    return get_object_or_404(_visible_requests(qs, user), pk=pk)


class SupportRequestMessageListCreateView(generics.ListCreateAPIView):
    """Messages & Clarifications — the conversation attached to a Support
    Request.

    Read: anyone who can open the request (requester on their own events,
    Communications, Leadership/Admin). Post: only the requester, the
    assigned Communications members and the Communications Lead — and not
    once the request is Completed or Declined (read-only until the Lead
    reopens it).

    Messages are immutable (no edit/delete endpoint exists). A message can
    carry up to 5 attachments (multipart) and reply to an earlier message.
    A clarification request (Communications side) moves the request to
    Needs Clarification; the requester's next message moves it to
    Clarification Provided.
    """

    serializer_class = SupportRequestMessageSerializer
    pagination_class = None
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_permissions(self):
        return [permissions.IsAuthenticated()]

    def get_support_request(self):
        if not hasattr(self, "_support_request"):
            self._support_request = _visible_support_request_or_404(self.request.user, self.kwargs["pk"])
        return self._support_request

    def get_queryset(self):
        sr = self.get_support_request()
        return SupportRequestMessage.objects.filter(support_request=sr).select_related(
            "sender", "support_request__event", "reply_to", "reply_to__sender"
        ).prefetch_related("attachments")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.request is not None and self.request.user.is_authenticated and "pk" in self.kwargs:
            sr = self.get_support_request()
            track = is_conversation_participant(self.request.user, sr)
            context["track_unread"] = track
            if track:
                state = SupportRequestReadState.objects.filter(support_request=sr, user=self.request.user).first()
                context["unread_since"] = state.last_read_at if state else None
        return context

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = self.perform_create(serializer)
        # Re-serialize from the DB so reply summary/attachments are populated.
        message = self.get_queryset().get(pk=message.pk)
        return Response(self.get_serializer(message).data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        sr = self.get_support_request()
        user = self.request.user
        is_requester = sr.event.owner_id == user.pk
        is_assignee = sr.assigned_to.filter(pk=user.pk).exists()
        if not (is_requester or is_assignee or user.is_communications_lead):
            raise PermissionDenied("Only the requester, the assigned team members and the Communications Lead can post messages.")
        if sr.status in TERMINAL_STATUSES:
            raise PermissionDenied(
                f"This request is {sr.get_status_display()} and its conversation is read-only. "
                "The Communications Lead can reopen it to allow further messages."
            )

        body = serializer.validated_data.get("body", "")
        files = validate_attachments(self.request.FILES.getlist("attachments"))
        if not body and not files:
            raise ValidationError({"body": "Write a message or attach a file."})

        reply_to = None
        reply_to_id = self.request.data.get("reply_to")
        if reply_to_id:
            try:
                reply_to = SupportRequestMessage.objects.select_related("sender").get(pk=reply_to_id, support_request=sr)
            except Exception:
                raise ValidationError({"reply_to": "That message isn't part of this conversation."})

        wants_clarification = _as_bool(self.request.data.get("is_clarification_request")) and not is_requester

        with transaction.atomic():
            message = serializer.save(
                support_request=sr,
                sender=user,
                body=body,
                reply_to=reply_to,
                is_clarification_request=wants_clarification,
            )
            for f, name, content_type in files:
                SupportRequestMessageAttachment.objects.create(
                    message=message, file=f, original_name=name, content_type=content_type, size=f.size
                )

            old_label = sr.get_status_display()
            note = None
            if wants_clarification:
                sr.status = SupportRequestStatus.NEEDS_CLARIFICATION
                note = "clarification requested"
            elif is_requester and sr.status == SupportRequestStatus.NEEDS_CLARIFICATION:
                sr.status = SupportRequestStatus.CLARIFICATION_PROVIDED
                note = "clarification provided"
            if note:
                sr.save(update_fields=["status", "updated_at"])
                log_action(
                    ActionType.STATUS_CHANGED,
                    sr,
                    user=user,
                    description=(
                        f"Support Request for '{sr.event.title}' status changed from {old_label} to "
                        f"{sr.get_status_display()} ({note})."
                    ),
                )

        self._notify(sr, message, reply_to, wants_clarification, note == "clarification provided")
        return message

    def _notify(self, sr, message, reply_to, is_clarification_request, is_clarification_provided):
        """In-app notification for every new message, and every one is also
        emailed to the recipient (same text on both channels).
        One notification per person even if they're both assignee and Lead."""
        user = self.request.user
        title = sr.event.title
        link = f"/support-requests/{sr.id}"
        sender_name = user.get_full_name() or user.email
        recipients = _message_recipients(sr, user)
        requester_id = sr.event.owner_id

        plan = {
            pk: (NotificationType.SUPPORT_MESSAGE, f"{sender_name} sent a message on the Support Request for '{title}'.", True)
            for pk in recipients
        }
        if is_clarification_request:
            for pk in recipients:
                if pk == requester_id:
                    plan[pk] = (
                        NotificationType.SUPPORT_CLARIFICATION,
                        f"{sender_name} needs clarification on your Communications Support Request for '{title}'.",
                        True,
                    )
                else:
                    plan[pk] = (
                        NotificationType.SUPPORT_CLARIFICATION,
                        f"{sender_name} requested clarification on the Support Request for '{title}'.",
                        True,
                    )
        elif is_clarification_provided:
            for pk in recipients:
                plan[pk] = (
                    NotificationType.SUPPORT_CLARIFICATION,
                    f"{sender_name} provided clarification on the Support Request for '{title}'.",
                    True,
                )
        if reply_to is not None and reply_to.sender_id in plan and not (is_clarification_request and reply_to.sender_id == requester_id):
            plan[reply_to.sender_id] = (
                plan[reply_to.sender_id][0],
                f"{sender_name} replied to your message on the Support Request for '{title}'.",
                True,
            )

        for pk, (ntype, text, email) in plan.items():
            notify_user(recipients[pk], ntype, text, link=link, send_email=email)


class SupportRequestMessagesReadView(APIView):
    """Marks the conversation as read for the current user (clears the unread
    badge/divider and the matching bell notifications). Optional `up_to`
    (ISO timestamp of the newest message the user has actually seen) stops a
    message that arrived in the meantime from being marked read unseen."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        sr = _visible_support_request_or_404(request.user, pk)
        now = timezone.now()
        up_to = parse_datetime(str(request.data.get("up_to") or "")) if request.data.get("up_to") else None
        moment = min(up_to, now) if up_to else now
        state, created = SupportRequestReadState.objects.get_or_create(
            support_request=sr, user=request.user, defaults={"last_read_at": moment}
        )
        if not created and moment > state.last_read_at:
            state.last_read_at = moment
            state.save(update_fields=["last_read_at", "updated_at"])
        if not up_to or not sr.messages.filter(created_at__gt=moment).exclude(sender=request.user).exists():
            Notification.objects.filter(
                recipient=request.user,
                link=f"/support-requests/{sr.id}",
                notification_type__in=[NotificationType.SUPPORT_MESSAGE, NotificationType.SUPPORT_CLARIFICATION],
                is_read=False,
            ).update(is_read=True)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SupportRequestAttachmentDownloadView(APIView):
    """Authenticated download of one attachment. Same visibility as the
    request itself; images are served inline (for thumbnails), everything
    else as a download. Files live in private storage, never under /media/."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk, attachment_id):
        sr = _visible_support_request_or_404(request.user, pk)
        attachment = get_object_or_404(
            SupportRequestMessageAttachment.objects.select_related("message"),
            pk=attachment_id,
            message__support_request=sr,
        )
        try:
            handle = attachment.file.open("rb")
        except (FileNotFoundError, ValueError):
            raise Http404("File not found.")
        response = FileResponse(
            handle,
            as_attachment=not attachment.is_image,
            filename=attachment.original_name,
            content_type=attachment.content_type,
        )
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        response["Cache-Control"] = "private, max-age=0, no-store"
        return response


class CommsOverviewView(generics.GenericAPIView):
    """Support Requests Enhancement — Overview tab: KPI summary, Upcoming
    Events, and Requests Requiring Attention (see
    services.compute_comms_overview). Same audience as the Calendar
    (Communications, including Comms Lead, and Leadership/Admin) —
    deliberately not Staff-visible, matching every other Support
    Requests tab except the request's own event owner's read access
    handled elsewhere.
    """

    permission_classes = [IsCommunicationsOrLeadership]

    def get(self, request, *args, **kwargs):
        return Response(compute_comms_overview())
