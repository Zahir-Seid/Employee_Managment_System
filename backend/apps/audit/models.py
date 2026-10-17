from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class ActionType(models.TextChoices):
    CREATED = "created", "Created"
    UPDATED = "updated", "Updated"
    STATUS_CHANGED = "status_changed", "Status Changed"
    SUBMITTED = "submitted", "Submitted"
    DELETED = "deleted", "Deleted"
    LOGIN = "login", "Login"
    TODO_COMPLETED = "todo_completed", "To-Do Item Completed"
    REPORT_GENERATED = "report_generated", "Report Generated"


class ObjectType(models.TextChoices):
    EVENT = "event", "Event"
    SUPPORT_REQUEST = "support_request", "Communications Support Request"
    TODO_ITEM = "todo_item", "To-Do Item"
    POST_EVENT_REPORT = "post_event_report", "Event Status Report"
    USER = "user", "User"
    REPORT = "report", "Generated Report"
    CONFIG_OPTION = "config_option", "Configuration Option"
    TV_DISPLAY_SETTINGS = "tv_display_settings", "TV Display Settings"
    TV_DISPLAY_SLIDE = "tv_display_slide", "TV Display Slide"
    HOME_CONTENT = "home_content", "Home Page Content"
    SITE_SETTINGS = "site_settings", "Home Page Site Settings"


class AuditLog(TimeStampedModel):
    """Central audit trail (FR49) covering event submissions, Communications
    Support Requests, and Event Status Report submissions, plus a handful of
    other sensitive actions (logins, report generation) useful for security
    review (Stage 8). Entries are immutable and never exposed for editing —
    only for read-only viewing by Communications/Leadership (Section 17
    implies Leadership has broad read access; Staff do not see the audit log).
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    action_type = models.CharField(max_length=30, choices=ActionType.choices)
    object_type = models.CharField(max_length=30, choices=ObjectType.choices)
    object_id = models.CharField(max_length=64)
    description = models.CharField(max_length=500, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta(TimeStampedModel.Meta):
        indexes = [
            models.Index(fields=["object_type", "object_id"]),
            models.Index(fields=["action_type"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self):
        who = self.user.get_full_name() if self.user else "System"
        return f"[{self.created_at:%Y-%m-%d %H:%M}] {who} {self.action_type} {self.object_type} {self.object_id}"
