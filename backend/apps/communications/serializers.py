from django.utils import timezone
from rest_framework import serializers

from apps.accounts.models import Role, User, role_q
from apps.events.models import Event

from .models import (
    CalendarNote,
    SupportRequest,
    SupportRequestAssignmentLog,
    SupportRequestMessage,
    SupportRequestMessageAttachment,
    SupportType,
    TodoItem,
)


class AssignedUserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "name"]

    def get_name(self, obj):
        return obj.get_full_name() or obj.email


class TodoItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = TodoItem
        fields = ["id", "support_type", "label", "is_done", "completed_at", "completed_by", "notes"]
        read_only_fields = ["id", "support_type", "label", "completed_at", "completed_by"]


class TodoItemToggleSerializer(serializers.ModelSerializer):
    """FR22: allow the Communications team to mark each to-do item as Done.
    Completion date/user are stamped server-side, never client-supplied.
    """

    class Meta:
        model = TodoItem
        fields = ["is_done", "notes", "completed_at", "completed_by"]
        read_only_fields = ["completed_at", "completed_by"]

    def update(self, instance, validated_data):
        was_done = instance.is_done
        instance.notes = validated_data.get("notes", instance.notes)
        instance.is_done = validated_data.get("is_done", instance.is_done)

        if instance.is_done and not was_done:
            instance.completed_at = timezone.now()
            instance.completed_by = self.context["request"].user
        elif not instance.is_done and was_done:
            instance.completed_at = None
            instance.completed_by = None

        instance.save()
        return instance


class SupportRequestSerializer(serializers.ModelSerializer):
    """FR13: auto-fills Event Title, Event Date(s), Event Owner, and Venue
    by reading through the event relation. FR19 is satisfied structurally
    since this is always accessed via its one-to-one event.

    Support Requests Enhancement: adds status/priority (priority is
    read-only and computed — see SupportRequest.priority), the assignee
    list, and the derived attention/overdue/due-soon flags the Overview
    and Requested Supports tabs need. All additive — every existing field
    below is unchanged.
    """

    event_title = serializers.CharField(source="event.title", read_only=True)
    event_start_date = serializers.DateField(source="event.start_date", read_only=True)
    event_end_date = serializers.DateField(source="event.end_date", read_only=True)
    event_owner = serializers.CharField(source="event.owner.get_full_name", read_only=True)
    event_owner_id = serializers.UUIDField(source="event.owner_id", read_only=True)
    days_until_event = serializers.DictField(source="days_until_event_display", read_only=True)
    venue = serializers.CharField(source="event.venue", read_only=True)
    todo_items = TodoItemSerializer(many=True, read_only=True)
    is_fully_completed = serializers.BooleanField(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    priority = serializers.CharField(read_only=True)
    priority_label = serializers.CharField(read_only=True)
    support_needed_count = serializers.SerializerMethodField()
    assigned_to = AssignedUserSerializer(many=True, read_only=True)
    is_unassigned = serializers.BooleanField(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    is_due_soon = serializers.BooleanField(read_only=True)
    needs_attention = serializers.BooleanField(read_only=True)
    # Messages & Clarifications: unread messages for the requesting user
    # (see annotate_unread in views.py). 0 when not annotated or when the
    # user isn't a participant in the conversation.
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = SupportRequest
        fields = [
            "id", "event", "event_title", "event_start_date", "event_end_date",
            "event_owner", "event_owner_id", "venue", "days_until_event", "support_types", "support_details",
            "notes", "todo_items", "is_fully_completed", "created_at",
            "status", "status_display", "priority", "priority_label", "support_needed_count",
            "assigned_to", "is_unassigned", "is_overdue", "is_due_soon", "needs_attention",
            "unread_count",
        ]
        read_only_fields = ["id", "event", "created_at"]

    def get_support_needed_count(self, obj):
        return len(obj.support_types or [])

    def get_unread_count(self, obj):
        count = getattr(obj, "unread_count_annotation", None)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not count or user is None or not user.is_authenticated:
            return 0
        if is_conversation_participant(user, obj):
            return count
        return 0


class SupportRequestAssignSerializer(serializers.Serializer):
    """Lead-only (see IsCommunicationsLead) assignment/reassignment.
    Whole-request-level only — a request's assignees apply to the request
    as a whole, not per selected support type. Sets the complete assignee
    list in one call, so the Lead can add, remove or replace assignees at
    any time; an empty list unassigns the request.

    Records an assignment-history row for every person added or removed
    (who made the change, and when — see SupportRequestAssignmentLog) and
    keeps Unassigned/Assigned in step with the list (see
    SupportRequest.sync_assignment_status). The people added/removed are
    left on `instance.added_users` / `instance.removed_users` for the view
    to notify.
    """

    assigned_to = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(role_q(Role.COMMUNICATIONS, Role.COMMS_LEAD), is_active=True),
        many=True,
        allow_empty=True,
    )

    def update(self, instance, validated_data):
        new_users = {u.pk: u for u in validated_data["assigned_to"]}
        old_users = {u.pk: u for u in instance.assigned_to.all()}
        added = [u for pk, u in new_users.items() if pk not in old_users]
        removed = [u for pk, u in old_users.items() if pk not in new_users]

        instance.assigned_to.set(list(new_users.values()))

        performed_by = getattr(self.context.get("request"), "user", None)
        SupportRequestAssignmentLog.objects.bulk_create(
            [SupportRequestAssignmentLog(support_request=instance, user=u, action="added", performed_by=performed_by) for u in added]
            + [SupportRequestAssignmentLog(support_request=instance, user=u, action="removed", performed_by=performed_by) for u in removed]
        )
        instance.sync_assignment_status()
        instance.added_users = added
        instance.removed_users = removed
        return instance

    def save(self):
        return self.update(self.instance, self.validated_data)


class AssignmentLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    performed_by_name = serializers.SerializerMethodField()
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = SupportRequestAssignmentLog
        fields = ["id", "user", "user_name", "action", "action_display", "performed_by", "performed_by_name", "created_at"]

    def get_user_name(self, obj):
        return (obj.user.get_full_name() or obj.user.email) if obj.user else "Former user"

    def get_performed_by_name(self, obj):
        return (obj.performed_by.get_full_name() or obj.performed_by.email) if obj.performed_by else "Former user"


def is_conversation_participant(user, support_request):
    """Requester, assigned Communications members and the Communications
    Lead can post (and have unread tracking); everyone else who can open the
    request only reads."""
    if not getattr(user, "is_authenticated", False):
        return False
    if support_request.event.owner_id == user.pk or user.is_communications_lead:
        return True
    return any(u.pk == user.pk for u in support_request.assigned_to.all())


class MessageAttachmentSerializer(serializers.ModelSerializer):
    is_image = serializers.BooleanField(read_only=True)
    name = serializers.CharField(source="original_name", read_only=True)
    url = serializers.SerializerMethodField()

    class Meta:
        model = SupportRequestMessageAttachment
        fields = ["id", "name", "content_type", "size", "is_image", "url"]

    def get_url(self, obj):
        # Relative API path, fetched with the user's auth header (files are
        # never exposed through a public /media/ URL).
        return f"/support-requests/{obj.message.support_request_id}/messages/attachments/{obj.id}/"


class SupportRequestMessageSerializer(serializers.ModelSerializer):
    """Messages & Clarifications: sender name/role and timestamp on every
    message, the reply reference, attachments and per-user unread flag.
    Context: `unread_since` (the user's last_read_at, or None) and
    `track_unread` (user is a participant)."""

    sender_name = serializers.SerializerMethodField()
    sender_role = serializers.SerializerMethodField()
    is_requester = serializers.SerializerMethodField()
    reply_to_summary = serializers.SerializerMethodField()
    attachments = MessageAttachmentSerializer(many=True, read_only=True)
    is_unread = serializers.SerializerMethodField()
    body = serializers.CharField(allow_blank=True, required=False)

    class Meta:
        model = SupportRequestMessage
        fields = [
            "id", "sender", "sender_name", "sender_role", "is_requester",
            "body", "is_clarification_request", "reply_to", "reply_to_summary",
            "attachments", "is_unread", "created_at",
        ]
        read_only_fields = ["id", "sender", "created_at", "reply_to"]

    def get_sender_name(self, obj):
        return (obj.sender.get_full_name() or obj.sender.email) if obj.sender else "Former user"

    def get_sender_role(self, obj):
        return obj.sender.get_role_display() if obj.sender else ""

    def get_is_requester(self, obj):
        return bool(obj.sender_id) and obj.sender_id == obj.support_request.event.owner_id

    def get_reply_to_summary(self, obj):
        original = obj.reply_to
        if original is None:
            return None
        text = (original.body or "").strip()
        if not text:
            text = "(attachment)"
        return {
            "id": str(original.id),
            "sender_name": (original.sender.get_full_name() or original.sender.email) if original.sender else "Former user",
            "excerpt": text[:120] + ("…" if len(text) > 120 else ""),
        }

    def get_is_unread(self, obj):
        if not self.context.get("track_unread"):
            return False
        user = self.context["request"].user
        if obj.sender_id == user.pk:
            return False
        since = self.context.get("unread_since")
        return since is None or obj.created_at > since

    def validate_body(self, value):
        return (value or "").strip()


class SupportRequestStatusUpdateSerializer(serializers.ModelSerializer):
    """Support Requests Enhancement: status changes only (not
    notes/support_details — those stay on
    AdminSupportRequestUpdateSerializer for Admin/Leadership editing).
    Role-based transition rules are enforced in the view
    (SupportRequestStatusUpdateView), not here, since they depend on
    whether the requesting user is the Lead or an assignee — the
    serializer just validates the value is a real status.
    """

    class Meta:
        model = SupportRequest
        fields = ["status"]


class SupportRequestCreateSerializer(serializers.ModelSerializer):
    """Stage 3 submission form (UI/UX Section 7). The associated event is
    supplied by the view from the URL, not the request body, so a staff
    member can never attach a support request to someone else's event.

    Support type is multi-select again (support_types), reverted from a
    brief single-dropdown stint — a real event often needs more than one
    kind of support at once. `support_details` optionally carries a
    free-text description per selected type (required for "other").
    """

    class Meta:
        model = SupportRequest
        fields = ["support_types", "support_details", "notes"]

    def validate_support_types(self, value):
        if not value:
            raise serializers.ValidationError("Select at least one support type.")
        # Validated against the active ConfigOption list so admin-added types work.
        from apps.configuration.models import ConfigListType, ConfigOption

        valid = set(
            ConfigOption.objects.filter(list_type=ConfigListType.SUPPORT_TYPE, is_active=True).values_list(
                "value", flat=True
            )
        )
        invalid = set(value) - valid
        if invalid:
            raise serializers.ValidationError(f"Invalid support type(s): {', '.join(invalid)}")
        return value

    def validate(self, attrs):
        support_types = attrs.get("support_types", [])
        details = attrs.get("support_details", {}) or {}
        if SupportType.OTHER in support_types and not (details.get(SupportType.OTHER) or "").strip():
            raise serializers.ValidationError({
                "support_details": "A description is required for 'Other' so Communications knows what it refers to."
            })
        return attrs


class CalendarEventSerializer(serializers.ModelSerializer):
    """Stage 3B: Calendar view. Shows every event, regardless of category —
    previously scoped to only events with a submitted Communications
    Support Request; now Event-based so events without one still show up.
    """

    category = serializers.CharField(source="get_category_label", read_only=True)
    event_id = serializers.UUIDField(source="id", read_only=True)
    status_display = serializers.CharField(source="get_status_label", read_only=True)
    # Status code used to color-code calendar entries; `status` stays raw.
    computed_status = serializers.CharField(source="get_computed_status", read_only=True)
    # Same {code, label, color} object as the event lists, so the Calendar
    # matches the badges shown elsewhere.
    days_until_event = serializers.DictField(source="days_until_event_display", read_only=True)
    owner_name = serializers.CharField(source="owner.get_full_name", read_only=True)
    thematic_area = serializers.CharField(source="get_thematic_area_label", read_only=True)
    location = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "event_id", "title", "category", "start_date", "end_date", "status", "computed_status", "status_display",
            "days_until_event", "owner_name", "thematic_area", "location",
        ]

    def get_location(self, obj):
        # International events add the country (see Event.location_label).
        return ", ".join(part for part in (obj.venue, obj.location_label) if part)


class AdminSupportRequestCreateSerializer(serializers.ModelSerializer):
    """Item 7.3 (Admin Page > Communications): unlike the staff-facing
    SupportRequestCreateSerializer, `event` is writable here — an admin
    picks which event this is for, rather than it coming from the URL of
    that event's own owner. Reuses the same support_types validation
    (against active ConfigOption entries) and the same auto-generated
    to-do list on save (see the post_save signal in signals.py — this
    fires the same way regardless of which view created the row).
    """

    class Meta:
        model = SupportRequest
        fields = ["event", "support_types", "support_details", "notes"]

    def validate_event(self, value):
        if hasattr(value, "support_request"):
            raise serializers.ValidationError("This event already has a Communications Support Request.")
        return value

    def validate_support_types(self, value):
        if not value:
            raise serializers.ValidationError("Select at least one support type.")
        from apps.configuration.models import ConfigListType, ConfigOption

        valid = set(
            ConfigOption.objects.filter(list_type=ConfigListType.SUPPORT_TYPE, is_active=True).values_list(
                "value", flat=True
            )
        )
        invalid = set(value) - valid
        if invalid:
            raise serializers.ValidationError(f"Not a valid support type: {', '.join(sorted(invalid))}.")
        return value


class AdminSupportRequestUpdateSerializer(serializers.ModelSerializer):
    """Item 7.3 edit: notes/support_details only. support_types is
    deliberately NOT editable here — the to-do checklist is generated once
    at creation (FR20: "support requests aren't edited after submission",
    see the post_save signal), one TodoItem per selected type. Changing
    the type selection after the fact would desync the checklist from
    what's actually selected, silently leaving stale or missing to-do
    items. To change support types, delete and recreate the request
    instead — the checklist then generates fresh and correctly.
    """

    class Meta:
        model = SupportRequest
        fields = ["support_details", "notes"]


class PostponedCancelledEventSerializer(serializers.ModelSerializer):
    """Item 3: a durable, browsable record for Communications/Leadership/
    Admin of every Postponed or Cancelled event and its reason — including
    events that never needed comms support at all (no SupportRequest row
    exists for those), which is exactly the gap this closes. The
    notification bell already tells Comms the moment it happens; this is
    the "come back and look it up later" equivalent.
    """

    owner_name = serializers.SerializerMethodField()
    had_support_request = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "id",
            "title",
            "status",
            "status_reason",
            "owner_name",
            "category",
            "start_date",
            "end_date",
            "needs_comms_support",
            "had_support_request",
            "updated_at",
        ]

    def get_owner_name(self, obj):
        return obj.owner.get_full_name() or obj.owner.username

    def get_had_support_request(self, obj):
        return hasattr(obj, "support_request")


class CalendarNoteSerializer(serializers.ModelSerializer):
    """Calendar quick-add note: just a title on a date."""

    created_by_name = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = CalendarNote
        fields = ["id", "title", "date", "created_by_name", "can_delete"]
        read_only_fields = ["id", "created_by_name", "can_delete"]

    def validate_title(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Title is required.")
        return value

    def get_created_by_name(self, obj):
        user = obj.created_by
        return (user.get_full_name() or user.email) if user else ""

    def get_can_delete(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not (user and user.is_authenticated):
            return False
        return user.is_admin_role or obj.created_by_id == user.id
