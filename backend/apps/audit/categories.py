"""Audit Trail summary categories: the six cards at the top of the page.

The page shows "Total Activities" plus five focused counts (Communication
Activity, Report Activity, Logins / Logouts, Events Created, Events
Postponed / Cancelled). Every entry always counts toward the total, but an
entry that isn't one of the five named kinds of activity (user changes, TV
display edits, to-do items, other event updates, ...) simply isn't counted
in any of the five cards, so the five don't have to add up to the total.
"""

import re

from .models import ActionType, ObjectType

CATEGORY_ORDER = [
    "communications",
    "reports",
    "logins",
    "events_created",
    "events_postponed_cancelled",
]

CATEGORY_LABELS = {
    "communications": "Communication Activity",
    "reports": "Report Activity",
    "logins": "Logins / Logouts",
    "events_created": "Events Created",
    "events_postponed_cancelled": "Events Postponed / Cancelled",
}

_REPORT_OBJECT_TYPES = {ObjectType.POST_EVENT_REPORT, ObjectType.REPORT}

# Event postpone/cancel is logged as a STATUS_CHANGED entry whose text reads
# "Event '<title>' postponed." / "Event '<title>' cancelled." (see
# apps/events/views.py). Anchored on that wording so a title or a reason that
# merely contains the word "cancelled" doesn't count.
_EVENT_POSTPONED_OR_CANCELLED = re.compile(r"^Event '.*?' (postponed|cancelled)\.", re.DOTALL)


def categorize(action_type, object_type, description=""):
    """Returns the category code (one of CATEGORY_ORDER) for a single
    entry, or None when the entry isn't one of the five named kinds of
    activity (it still counts toward the total)."""
    if action_type == ActionType.LOGIN:
        return "logins"
    if object_type == ObjectType.SUPPORT_REQUEST:
        return "communications"
    if object_type in _REPORT_OBJECT_TYPES or action_type == ActionType.REPORT_GENERATED:
        return "reports"
    if object_type == ObjectType.EVENT:
        if action_type == ActionType.CREATED:
            return "events_created"
        if action_type == ActionType.STATUS_CHANGED and _EVENT_POSTPONED_OR_CANCELLED.match(description or ""):
            return "events_postponed_cancelled"
    return None


def build_summary(entries):
    """Returns {"total": n, "categories": [{"code","label","count"}, ...]}
    for `entries` (any iterable of objects with .action_type/.object_type/
    .description — a queryset or a plain list both work, so the view can run
    this over the exact same already-filtered, already-deduplicated set of
    rows the list itself renders, keeping the two always in agreement).
    """
    counts = {code: 0 for code in CATEGORY_ORDER}
    total = 0
    for entry in entries:
        total += 1
        code = categorize(entry.action_type, entry.object_type, getattr(entry, "description", ""))
        if code:
            counts[code] += 1

    return {
        "total": total,
        "categories": [
            {"code": code, "label": CATEGORY_LABELS[code], "count": counts[code]} for code in CATEGORY_ORDER
        ],
    }
