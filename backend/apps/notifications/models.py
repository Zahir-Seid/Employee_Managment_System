from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class NotificationType(models.TextChoices):
    NEW_EVENT = "new_event", "New Event Logged"
    EVENT_UPDATED = "event_updated", "Event Postponed/Cancelled/Changed"
    SUPPORT_REQUESTED = "support_requested", "Communications Support Requested"
    SUPPORT_COMPLETED = "support_completed", "Communications Support Completed"
    REPORT_OVERDUE = "report_overdue", "Event Status Report Overdue"
    # Support Requests Enhancement: fires when the Communications Lead
    # assigns (or reassigns) a Support Request to a team member.
    SUPPORT_ASSIGNED = "support_assigned", "Support Request Assigned"
    # Communications Support Request Assignment update.
    SUPPORT_UNASSIGNED = "support_unassigned", "Support Request Assignment Removed"
    SUPPORT_MESSAGE = "support_message", "Support Request Message"
    SUPPORT_CLARIFICATION = "support_clarification", "Support Request Clarification"
    # User Registration Update.
    REGISTRATION_PENDING = "registration_pending", "New Registration Pending Approval"
    ACCOUNT_APPROVED = "account_approved", "Account Approved"


class Notification(TimeStampedModel):
    """In-app notification bell (item #9 fix): previously the TopNav bell
    icon was a static UI stub with zero backing data. This is a real,
    per-user notification, created at the same trigger points that already
    send email (new event needing Comms support, support request
    submitted) plus one Staff-facing trigger (their support request being
    fully completed) — so the bell reflects real events, not a mock.
    """

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    notification_type = models.CharField(max_length=30, choices=NotificationType.choices)
    message = models.CharField(max_length=255)
    # Frontend route to navigate to when the notification is clicked, e.g.
    # "/support-requests/<id>" or "/events/<id>". Optional since not every
    # notification necessarily links somewhere.
    link = models.CharField(max_length=255, blank=True)
    is_read = models.BooleanField(default=False)

    class Meta(TimeStampedModel.Meta):
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["recipient", "is_read"]),
        ]

    def __str__(self):
        return f"{self.notification_type} -> {self.recipient_id}: {self.message[:40]}"
