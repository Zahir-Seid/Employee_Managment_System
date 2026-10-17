from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel
from apps.events.models import Event


class SupportType(models.TextChoices):
    BANNER = "banner", "Banner"
    PHOTOGRAPHER = "photographer", "Photographer"
    VIDEOGRAPHER = "videographer", "Videographer"
    BRANDED_MATERIALS = "branded_materials", "Branded Materials"
    OTHER = "other", "Other"


class SupportRequestStatus(models.TextChoices):
    """Support Request lifecycle (Communications Support Request Assignment
    update):

        Unassigned -> Assigned -> In Progress -> Needs Clarification
                                              -> Clarification Provided
                                              -> On Hold
                                              -> Completed / Declined

    Unassigned vs Assigned is kept in step with `assigned_to` by
    `SupportRequest.sync_assignment_status()` (no assignees -> Unassigned,
    one or more -> Assigned, unless the request is already further along).
    Completed and Declined are preserved by that sync and only leave those
    states when the Lead explicitly reopens the request.
    """

    UNASSIGNED = "unassigned", "Unassigned"
    ASSIGNED = "assigned", "Assigned"
    IN_PROGRESS = "in_progress", "In Progress"
    NEEDS_CLARIFICATION = "needs_clarification", "Needs Clarification"
    CLARIFICATION_PROVIDED = "clarification_provided", "Clarification Provided"
    ON_HOLD = "on_hold", "On Hold"
    COMPLETED = "completed", "Completed"
    DECLINED = "declined", "Declined"


# Resolved states: preserved by assignment changes, left only by an explicit
# Lead reopen.
TERMINAL_STATUSES = (SupportRequestStatus.COMPLETED, SupportRequestStatus.DECLINED)


class SupportRequestPriority(models.TextChoices):
    """Support Requests Enhancement: priority is deliberately never
    stored — it's always derived fresh from how soon the event is (see
    SupportRequest.priority below), so it can never go stale the way a
    manually-set field could if nobody remembers to update it as the
    event date approaches. (Previously distinguished from a separate
    manually-set `urgency` field — that field was removed entirely per
    the Event Registry / Days Until Event update; `priority` here is
    unaffected, it was always independent and date-driven.)
    """

    NORMAL = "normal", "Normal"
    HIGH = "high", "High"
    URGENT = "urgent", "Urgent"


# Thresholds for the date-driven `priority` property, in days until the event
# starts. An event already underway counts as <= 0, so it is always Urgent.
PRIORITY_URGENT_WITHIN_DAYS = 3
PRIORITY_HIGH_WITHIN_DAYS = 7


class SupportRequest(TimeStampedModel):
    """Stage 3: Communications Support Request. One-to-one with Event
    because an event can have at most one active support request.

    Updated requirement #1: Comms Support Yes/No is now asked for every
    event category, not just Internal — so a SupportRequest can now be
    attached to any category of event (the earlier Internal-only
    restriction has been removed from `clean()`).

    Second reversal: support type went from checkboxes (multi-select) to a
    single dropdown (an earlier update), and is now going back to
    multi-select — a real event often needs more than one kind of support
    at once (e.g. Banner AND Photographer). Each selected type can also
    carry its own optional free-text description (not just "Other"), e.g.
    "Banner — needs to be 3x2m, ready by Friday".

    FR13 (auto-fill Event Title/Date/Owner/Venue) is satisfied by reading
    through the `event` relation at serialization time rather than
    duplicating that data here — a single source of truth avoids drift if
    the event is later edited.
    """

    event = models.OneToOneField(Event, on_delete=models.CASCADE, related_name="support_request")
    # JSONField rather than ArrayField so migrations also run on SQLite. No
    # default, so DRF requires it and "select at least one" can't be bypassed.
    support_types = models.JSONField(
        help_text="One or more support types selected via checkboxes.",
    )
    # Optional description per selected support type; required for "other".
    support_details = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True)  # FR16

    status = models.CharField(
        max_length=30, choices=SupportRequestStatus.choices, default=SupportRequestStatus.UNASSIGNED
    )
    # Assignees are Communications or Communications Lead users (enforced in the
    # serializer/view). May be empty until the Lead assigns the request.
    assigned_to = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="assigned_support_requests"
    )

    class Meta(TimeStampedModel.Meta):
        indexes = [models.Index(fields=["status"])]

    def __str__(self):
        return f"Support Request for {self.event.title}"

    def clean(self):
        if not self.support_types:
            raise ValidationError({"support_types": "Select at least one support type."})
        if SupportType.OTHER in self.support_types and not (self.support_details or {}).get(SupportType.OTHER):
            raise ValidationError({
                "support_details": "A description is required for 'Other' so Communications knows what it refers to."
            })

    @property
    def is_fully_completed(self):
        return not self.todo_items.filter(is_done=False).exists()

    @property
    def is_unassigned(self):
        return not self.assigned_to.exists()

    def sync_assignment_status(self):
        """Keeps Unassigned/Assigned in step with the assignee list. No
        assignees -> Unassigned; one or more -> Assigned if the request is
        still Unassigned. In Progress / Needs Clarification / Clarification
        Provided / On Hold stay as they are while someone is assigned
        (and fall back to Unassigned if everyone is removed). Completed and
        Declined are never touched here.
        """
        if self.status in TERMINAL_STATUSES:
            return
        has_assignees = self.assigned_to.exists()
        if not has_assignees:
            new_status = SupportRequestStatus.UNASSIGNED
        elif self.status == SupportRequestStatus.UNASSIGNED:
            new_status = SupportRequestStatus.ASSIGNED
        else:
            return
        if new_status != self.status:
            self.status = new_status
            self.save(update_fields=["status", "updated_at"])

    @property
    def days_until_event(self):
        return (self.event.start_date - timezone.localdate()).days

    @property
    def days_until_event_display(self):
        """{"code", "label", "color"} for the Days Until Event badge shown
        on the Requested Supports list — delegates to the event's own
        display so the coloring/thresholds never drift from the Calendar's
        and Events list's version of the same badge.
        """
        return self.event.days_until_event_display

    @property
    def priority(self):
        """Date-driven, always-fresh priority — see SupportRequestPriority
        docstring above for why this is a property rather than a stored
        field.
        """
        days = self.days_until_event
        if days <= PRIORITY_URGENT_WITHIN_DAYS:
            return SupportRequestPriority.URGENT
        if days <= PRIORITY_HIGH_WITHIN_DAYS:
            return SupportRequestPriority.HIGH
        return SupportRequestPriority.NORMAL

    @property
    def priority_label(self):
        return SupportRequestPriority(self.priority).label

    @property
    def is_overdue(self):
        """The event has already ended and the request never got resolved
        (Completed or Declined) — the support, if it was ever delivered,
        can no longer help this event.
        """
        active = self.status not in TERMINAL_STATUSES
        return active and self.event.end_date < timezone.localdate()

    @property
    def is_due_soon(self):
        """Not yet overdue, event is within the Urgent window, and the
        request is still unresolved — the Overview's early-warning signal
        distinct from already-Urgent-priority (which also fires further
        out, at the High threshold) or already-overdue.
        """
        if self.is_overdue:
            return False
        active = self.status not in (SupportRequestStatus.COMPLETED, SupportRequestStatus.DECLINED)
        return active and 0 <= self.days_until_event <= PRIORITY_URGENT_WITHIN_DAYS

    @property
    def needs_attention(self):
        """Support Requests Enhancement, Overview §3: Urgent/High priority
        (regardless of status), OR still Unassigned/Assigned (work hasn't
        started yet) — but never once Completed or Declined, regardless
        of priority or status. A Normal-priority request keeps needing
        attention until it's In Progress, not after.
        """
        if self.status in (SupportRequestStatus.COMPLETED, SupportRequestStatus.DECLINED):
            return False
        return self.priority in (SupportRequestPriority.HIGH, SupportRequestPriority.URGENT) or (
            self.status in (SupportRequestStatus.UNASSIGNED, SupportRequestStatus.ASSIGNED)
        )



class SupportRequestAssignmentLog(TimeStampedModel):
    """Assignment history: one row per person added to / removed from a
    Support Request, with who made the change and when (created_at).
    """

    class Action(models.TextChoices):
        ADDED = "added", "Assigned"
        REMOVED = "removed", "Removed"

    support_request = models.ForeignKey(
        SupportRequest, on_delete=models.CASCADE, related_name="assignment_logs"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    action = models.CharField(max_length=10, choices=Action.choices)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )

    class Meta(TimeStampedModel.Meta):
        ordering = ["-created_at"]


def get_private_storage():
    """Private storage for message attachments (see settings.PRIVATE_MEDIA_ROOT).
    A callable so the migration doesn't bake in a machine-specific path."""
    from django.core.files.storage import FileSystemStorage

    return FileSystemStorage(location=settings.PRIVATE_MEDIA_ROOT)


def attachment_upload_path(instance, filename):
    # Random, non-guessable stored name; the original name is kept in the DB.
    import os
    import uuid

    ext = os.path.splitext(filename)[1].lower()
    return f"support_messages/{instance.message.support_request_id}/{uuid.uuid4().hex}{ext}"


class ImmutableRecordError(Exception):
    """Raised on any attempt to edit or delete a sent message/attachment."""


class ImmutableQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ImmutableRecordError("Sent messages and attachments can't be edited.")

    def delete(self):
        raise ImmutableRecordError("Sent messages and attachments can't be deleted.")


class ImmutableModelMixin(models.Model):
    """Messages & Clarifications history is permanent: once saved, a record
    can't be changed or deleted through the application (it only goes away
    if its whole Support Request is deleted)."""

    objects = ImmutableQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ImmutableRecordError("Sent messages and attachments can't be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableRecordError("Sent messages and attachments can't be deleted.")


class SupportRequestMessage(ImmutableModelMixin, TimeStampedModel):
    """Messages & Clarifications: the conversation attached to a Support
    Request between the requester (event owner), the assigned Communications
    members and the Communications Lead. Immutable once sent.
    """

    support_request = models.ForeignKey(
        SupportRequest, on_delete=models.CASCADE, related_name="messages"
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    # Blank is allowed for attachment-only messages (enforced in the view).
    body = models.TextField(blank=True)
    # The message this one replies to (the thread itself stays chronological).
    reply_to = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="replies"
    )
    # True when a Communications participant posted this as a request for
    # clarification (moves the request to Needs Clarification).
    is_clarification_request = models.BooleanField(default=False)

    class Meta(TimeStampedModel.Meta):
        ordering = ["created_at"]

    def __str__(self):
        return f"Message on {self.support_request_id} by {self.sender_id}"


class SupportRequestMessageAttachment(ImmutableModelMixin, TimeStampedModel):
    message = models.ForeignKey(SupportRequestMessage, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(storage=get_private_storage, upload_to=attachment_upload_path, max_length=255)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()

    class Meta(TimeStampedModel.Meta):
        ordering = ["created_at"]

    @property
    def is_image(self):
        return self.content_type.startswith("image/")


class SupportRequestReadState(TimeStampedModel):
    """Per-user, per-request unread tracking: messages from others newer than
    `last_read_at` are unread for this user."""

    support_request = models.ForeignKey(SupportRequest, on_delete=models.CASCADE, related_name="read_states")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    last_read_at = models.DateTimeField()

    class Meta(TimeStampedModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["support_request", "user"], name="unique_read_state_per_user_request")
        ]


class TodoItem(TimeStampedModel):
    """Stage 3A: auto-generated per Support Request — one TodoItem per
    selected support type (support_types is multi-select again). Each
    item's label folds in that type's optional description, if provided.
    Completion is optional/unenforced (FR24).
    """

    support_request = models.ForeignKey(SupportRequest, on_delete=models.CASCADE, related_name="todo_items")
    # Validated against the admin-managed ConfigOption list; SupportType is kept
    # for seed defaults and the "other" check.
    support_type = models.CharField(max_length=30)
    label = models.CharField(max_length=255)
    is_done = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    notes = models.TextField(blank=True)  # UI/UX Section 9: optional notes per task

    class Meta(TimeStampedModel.Meta):
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.label} - {'Done' if self.is_done else 'Pending'}"


class CalendarNote(TimeStampedModel):
    """A quick "anything to remember" entry on the Calendar: clicking an
    empty day and typing just a title. It is NOT an Event (no owner, status,
    support request or report), just a titled note on one date that shows up
    on the Calendar for everyone who can open it (Communications, Comms Lead,
    Leadership, Admin)."""

    title = models.CharField(max_length=255)
    date = models.DateField(db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TimeStampedModel.Meta):
        ordering = ["date", "created_at"]

    def __str__(self):
        return f"{self.date}: {self.title}"
