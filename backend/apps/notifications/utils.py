import logging

from django.conf import settings
from django.core.mail import send_mail

from .models import Notification

logger = logging.getLogger(__name__)

# Email subject prefix per notification type.
_SUBJECT_PREFIX = {
    "new_event": "New Event",
    "event_updated": "Event Update",
    "support_requested": "Support Requested",
    "support_completed": "Support Completed",
    "report_overdue": "Report Overdue",
    "support_assigned": "Support Request Assigned",
    "support_unassigned": "Support Request Assignment Removed",
    "support_message": "Support Request Message",
    "support_clarification": "Support Request Clarification",
    "registration_pending": "New Registration",
    "account_approved": "Account Approved",
}


def notify_user(user, notification_type, message, link="", send_email=True):
    """Creates a single in-app notification AND emails the same message to
    the recipient — item 19: notifications previously only showed up in
    the bell, which meant anyone not actively watching the app never saw
    them. Both channels use the same message text so they can never say
    different things. Neither failure blocks the other: a bad email
    address doesn't stop the in-app notification from being created, and
    vice versa — same "never raises" principle already used for the
    original email-sending helpers (apps/events/services/notifications.py,
    apps/communications/services.py).
    """
    try:
        Notification.objects.create(
            recipient=user, notification_type=notification_type, message=message, link=link
        )
    except Exception:
        logger.exception("Failed to create notification for user %s", getattr(user, "id", None))

    # Every notification is emailed unless a caller explicitly passes send_email=False.
    if not send_email or not getattr(user, "email", ""):
        return

    try:
        from apps.configuration.models import SystemSettings

        sys_settings = SystemSettings.get_settings()
        from_email = sys_settings.notification_from_email or settings.DEFAULT_FROM_EMAIL
        copy_to = sys_settings.notification_copy_to_email

        subject_prefix = _SUBJECT_PREFIX.get(notification_type, "Notification")
        body = message
        if link:
            site_url = getattr(settings, "FRONTEND_URL", "").rstrip("/")
            body += f"\n\nView in EMS: {site_url}{link}" if site_url else f"\n\nView in EMS: {link}"
        send_mail(
            subject=f"[EMS] {subject_prefix}",
            message=body,
            from_email=from_email,
            recipient_list=[user.email],
            fail_silently=False,
        )
        # Send the copy as a separate message so a failure there can't affect the
        # recipient's own email.
        if copy_to and copy_to != user.email:
            try:
                send_mail(
                    subject=f"[EMS] {subject_prefix} (copy sent to {user.email})",
                    message=body,
                    from_email=from_email,
                    recipient_list=[copy_to],
                    fail_silently=False,
                )
            except Exception:
                logger.exception("Failed to send notification copy to %s", copy_to)
    except Exception:
        logger.exception("Failed to send notification email to user %s", getattr(user, "id", None))


def notify_users(users_qs, notification_type, message, link=""):
    for user in users_qs:
        notify_user(user, notification_type, message, link)
