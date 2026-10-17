import logging

from django.conf import settings
from django.core.mail import send_mail
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)


def notify_communications_of_new_event(event):
    """FR12: upon event submission, notify the Communications team by email.

    Failures are logged but never raised — a transient SMTP outage must
    not block a staff member from successfully logging an event.
    """
    subject = f"[EMS] New {event.get_category_label()} event logged: {event.title}"
    message = (
        f"A new event has been logged by {event.owner.get_full_name() or event.owner.email}.\n\n"
        f"Title: {event.title}\n"
        f"Category: {event.get_category_label()}\n"
        f"Dates: {event.start_date} to {event.end_date}\n"
        f"Venue: {event.venue}, {event.location_label}\n"
    )
    message += f"Communications support requested: {'Yes' if event.needs_comms_support else 'No'}\n"

    try:
        send_mail(
            subject=subject,
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[settings.COMMS_TEAM_EMAIL],
            fail_silently=False,
        )
    except Exception:
        logger.exception("Failed to send event-logged notification email for event %s", event.id)


def notify_overdue_reports(events=None, force=False):
    """Notify owners (in-app + email) of events past the report submission window
    with no submitted Event Status Report. Each event is notified once, tracked by
    Event.report_overdue_notified_at, unless `force` is set. Returns the number of
    notifications sent.
    """
    from apps.events.models import Event, report_overdue_cutoff
    from apps.notifications.models import NotificationType
    from apps.notifications.utils import notify_user

    today = timezone.localdate()
    overdue_events = (Event.objects.all() if events is None else events).filter(
        end_date__lt=report_overdue_cutoff(today)
    ).filter(Q(post_event_report__isnull=True) | ~Q(post_event_report__status="submitted"))
    if not force:
        overdue_events = overdue_events.filter(report_overdue_notified_at__isnull=True)

    sent_count = 0
    for event in overdue_events.select_related("owner"):
        days_overdue = (today - event.end_date).days
        notify_user(
            event.owner,
            NotificationType.REPORT_OVERDUE,
            (
                f"Your Event Status Report for '{event.title}' is overdue - it ended {days_overdue} "
                f"day{'s' if days_overdue != 1 else ''} ago and no report has been submitted yet."
            ),
            link=f"/events/{event.id}",
        )
        event.report_overdue_notified_at = timezone.now()
        event.save(update_fields=["report_overdue_notified_at"])
        sent_count += 1
    return sent_count
