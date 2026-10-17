"""Days Until Event: shared, single-source-of-truth filter logic backing
the Days Until Event dropdown (All / Today / Within 3 Days / Within 7
Days / Within 14 Days / More Than 14 Days / Event Started / Event
Passed) wherever it appears — Events lists, the Admin Events list, and
the Communications Support Requests list. The badge itself (label/color)
is computed per-instance by Event.days_until_event_display; this module
is only the *filter*, since that needs to run at the database level to
stay pagination-friendly (same reasoning as communications/filters.py's
existing filter_priority, which this mirrors).
"""

from datetime import timedelta

from django.utils import timezone

# (code, label) pairs, in display order — code is what the filter param
# value must be; label is what the dropdown shows. "all" is the default/
# no-op choice, not a real bucket, so it's not included here (callers
# building a dropdown should prepend an "All" option themselves).
DAYS_UNTIL_EVENT_CHOICES = [
    ("today", "Today"),
    ("within_3", "Within 3 Days"),
    ("within_7", "Within 7 Days"),
    ("within_14", "Within 14 Days"),
    ("more_than_14", "More Than 14 Days"),
    ("event_started", "Event Started"),
    ("event_passed", "Event Passed"),
]
DAYS_UNTIL_EVENT_VALID_VALUES = {code for code, _label in DAYS_UNTIL_EVENT_CHOICES} | {"all"}


def filter_by_days_until_event(queryset, value, start_field="start_date", end_field="end_date"):
    """Filters `queryset` by the Days Until Event bucket `value`. Falsy
    or "all" returns the queryset unfiltered.

    `start_field`/`end_field` let this run against an Event queryset
    directly (the default "start_date"/"end_date") or against a
    queryset one relation hop away — e.g. SupportRequest, via
    "event__start_date"/"event__end_date" — the same relation-prefix
    pattern communications/filters.py's filter_priority already uses.

    The 3/7/14-day windows are cumulative lookaheads over events that
    haven't started yet (start_date in the future) — "Within 3 Days"
    is a subset of "Within 7 Days", which is a subset of "Within 14
    Days" — not exclusive bands, since "Today", "Event Started", and
    "Event Passed" already exist as their own separate, non-overlapping
    buckets for the other cases.
    """
    if not value or value == "all":
        return queryset

    today = timezone.localdate()

    if value == "today":
        return queryset.filter(**{start_field: today})
    if value == "within_3":
        return queryset.filter(**{f"{start_field}__gt": today, f"{start_field}__lte": today + timedelta(days=3)})
    if value == "within_7":
        return queryset.filter(**{f"{start_field}__gt": today, f"{start_field}__lte": today + timedelta(days=7)})
    if value == "within_14":
        return queryset.filter(**{f"{start_field}__gt": today, f"{start_field}__lte": today + timedelta(days=14)})
    if value == "more_than_14":
        return queryset.filter(**{f"{start_field}__gt": today + timedelta(days=14)})
    if value == "event_started":
        return queryset.filter(**{f"{start_field}__lt": today, f"{end_field}__gte": today})
    if value == "event_passed":
        return queryset.filter(**{f"{end_field}__lt": today})
    return queryset
