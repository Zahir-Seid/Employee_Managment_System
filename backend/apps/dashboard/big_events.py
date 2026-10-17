"""Dashboard Big Events section.

Backs the Dashboard's "Big Events" featured-card section: International
and National events only (Sub-national/Internal never qualify — Internal is
explicit in the spec, Sub-national is simply not one of the two named
categories), shown while they're still Upcoming or Ongoing. Once an event
is Held/Completed/Postponed/Cancelled it drops out of this section (it's
no longer an "important upcoming event"), same as it would age out of the
Upcoming Events card.

Deliberately a separate module from upcoming_events.py: that module's
queryset is `start_date__gte=today` only (Upcoming, never Ongoing) and is
already relied on elsewhere (the Upcoming Events card/page) with that
exact meaning, so widening it here would change those surfaces too.
"""

from django.utils import timezone

from apps.events.models import Event, EventStatus

# The two categories that qualify as a "Big Event" — see FR/spec: only
# International and National, never Sub-national or Internal.
BIG_EVENT_CATEGORIES = ["international", "national"]


def get_big_events_queryset():
    """International/National events that are still Upcoming or Ongoing.

    `status=EventStatus.LOGGED, end_date__gte=today` is exactly
    "Upcoming or Ongoing" per Event.get_computed_status: Postponed/
    Cancelled/Completed all have a different stored `status`, and Held
    is LOGGED with end_date in the past — so this one compound filter
    covers both display statuses without needing a Python-level pass
    over the queryset (see filter_events_by_display_status for the same
    pattern used elsewhere).
    """
    today = timezone.localdate()
    return (
        Event.objects.select_related("owner")
        .filter(category__in=BIG_EVENT_CATEGORIES, status=EventStatus.LOGGED, end_date__gte=today)
        .order_by("start_date", "title")
    )


def _photo_url(event, request):
    if not event.big_event_photo:
        return None
    url = event.big_event_photo.url
    return request.build_absolute_uri(url) if request is not None else url


def serialize_big_event(event, request=None):
    location = event.location_label
    return {
        "id": str(event.id),
        "title": event.title,
        "category": event.category,
        "category_label": event.get_category_label(),
        "start_date": event.start_date,
        "end_date": event.end_date,
        "venue": event.venue,
        "location": location,
        "computed_status": event.get_computed_status(),
        "status_display": event.get_status_label(),
        "days_until_event": event.days_until_event_display,
        "photo": _photo_url(event, request),
    }
