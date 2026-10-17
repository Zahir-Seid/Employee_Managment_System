import logging

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from .models import TERMINAL_STATUSES, SupportRequest, SupportRequestPriority, SupportRequestStatus, SupportType

logger = logging.getLogger(__name__)


def notify_communications_of_support_request(support_request):
    """FR18: notify the Communications team by email upon submission of a
    Communications Support Request.
    """
    event = support_request.event
    subject = f"[EMS] Communications Support requested: {event.title}"

    details = support_request.support_details or {}
    type_lines = []
    for support_type in support_request.support_types:
        label = SupportType(support_type).label
        description = (details.get(support_type) or "").strip()
        type_lines.append(f"  - {label}" + (f": {description}" if description else ""))
    support_types_text = "\n".join(type_lines) if type_lines else "  (none)"

    message = (
        f"{event.owner.get_full_name() or event.owner.email} requested Communications support "
        f"for the {event.get_category_label()} event '{event.title}' ({event.start_date} - {event.end_date}).\n\n"
        f"Support requested:\n{support_types_text}\n"
        f"Notes: {support_request.notes or 'None'}\n"
    )
    try:
        send_mail(
            subject=subject,
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[settings.COMMS_TEAM_EMAIL],
            fail_silently=False,
        )
    except Exception:
        logger.exception(
            "Failed to send support-request notification email for support request %s", support_request.id
        )


def _serialize_overview_row(r):
    return {
        "id": str(r.id),
        "event_id": str(r.event_id),
        "event_title": r.event.title,
        "event_start_date": r.event.start_date,
        "event_end_date": r.event.end_date,
        "priority": r.priority,
        "priority_label": r.priority_label,
        "support_needed_count": len(r.support_types or []),
        "status": r.status,
        "status_display": r.get_status_display(),
    }


def compute_comms_overview():
    """Support Requests Enhancement — Overview tab: KPI summary, the next
    few Upcoming Events with an open support request, and the Requests
    Requiring Attention list. `priority`/`needs_attention`/`is_overdue`/
    `is_due_soon` are plain Python properties (derived from the event's
    date, not stored — see models.py), so the underlying rows are pulled
    once and evaluated in Python rather than expressed as a queryset
    filter; org-wide Support Request volume is small enough that this is
    simpler and clearer than reimplementing the same date-window logic
    twice (once here, once as ORM lookups).
    """
    today = timezone.localdate()
    all_requests = list(
        SupportRequest.objects.select_related("event", "event__owner").prefetch_related("assigned_to")
    )

    summary = {
        "total_requests": len(all_requests),
        "unassigned": sum(1 for r in all_requests if r.status == SupportRequestStatus.UNASSIGNED),
        "assigned": sum(1 for r in all_requests if r.status == SupportRequestStatus.ASSIGNED),
        "in_progress": sum(1 for r in all_requests if r.status == SupportRequestStatus.IN_PROGRESS),
        "completed": sum(1 for r in all_requests if r.status == SupportRequestStatus.COMPLETED),
        "declined": sum(1 for r in all_requests if r.status == SupportRequestStatus.DECLINED),
    }
    active = [
        r for r in all_requests
        if r.status not in TERMINAL_STATUSES
    ]
    summary["due_soon"] = sum(1 for r in active if r.is_due_soon)
    summary["overdue"] = sum(1 for r in active if r.is_overdue)
    summary["urgent"] = sum(1 for r in active if r.priority == SupportRequestPriority.URGENT)

    # Upcoming Events: next 5 events (soonest first) with an open request —
    # Declined requests are excluded, same as they're excluded from
    # Requests Requiring Attention below (a declined request isn't an
    # open "support need" anymore).
    upcoming = sorted(
        (r for r in all_requests if r.event.start_date >= today and r.status != SupportRequestStatus.DECLINED),
        key=lambda r: r.event.start_date,
    )
    upcoming_events = [_serialize_overview_row(r) for r in upcoming[:5]]

    # Requests Requiring Attention: Urgent/High priority first, then
    # Normal-priority-but-not-yet-started (Unassigned/Assigned), soonest event first
    # within each tier — see SupportRequest.needs_attention.
    priority_rank = {
        SupportRequestPriority.URGENT: 0,
        SupportRequestPriority.HIGH: 1,
        SupportRequestPriority.NORMAL: 2,
    }
    attention = sorted(
        (r for r in all_requests if r.needs_attention),
        key=lambda r: (priority_rank[r.priority], r.event.start_date),
    )
    requests_requiring_attention = [_serialize_overview_row(r) for r in attention[:5]]

    return {
        "summary": summary,
        "upcoming_events": upcoming_events,
        "requests_requiring_attention": requests_requiring_attention,
    }
