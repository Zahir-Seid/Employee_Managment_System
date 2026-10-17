"""Event Activity Report (EMS Reporting System spec §14 — "What events
were conducted, where, when, by whom, and with what results?").

Per the spec's own instruction not to duplicate calculation logic across
reports (§27/§28), the table rows here are the exact same rows the
Management Report's Event Summary table already computes
(services/organizational_report.build_event_activity) — same columns,
same participant-actual-vs-expected fallback rule, same status/category
codes. This module adds only what's new for this report: the KPI
summary, built from those same rows so the two reports can never
disagree on a shared filter set.
"""

from apps.events.models import EventStatus

from .organizational_report import _total_actual_participants, build_event_activity


def build_event_activity_summary(rows, events):
    """KPIs per spec §14: Total Events, Completed Events, Upcoming Events,
    Cancelled/Postponed, Participants, Average Participants per Event.

    "Upcoming" uses `status_code`, which is now Event.get_computed_status()
    (Event Status Update) rather than the raw stored status — "upcoming"
    here is exactly the same "not yet started" definition the Management
    Report's executive summary uses, just computed once on the Event
    instead of re-checked with a separate date comparison here, so §27's
    "same metric, same number everywhere" still holds.

    "Participants"/"Average Participants per Event" are Actuals only —
    computed with the same `_total_actual_participants` rule the
    Management Report and Annual Event Report use (spec §27: a number
    shared across reports can't disagree), i.e. summed only from events
    with a *submitted* Event Status Report. Previously this summed each
    row's already-computed participant_count, which falls back to the
    event's *expected* headcount for events with no submitted report yet
    — a looser, blended number that doesn't belong in a KPI labeled
    "Total Participants" and disagreed with the same KPI elsewhere.
    `events_with_actual_participants` is still surfaced alongside it so
    the frontend can show how many of the report's events have actually
    reported a real headcount (the per-row table still shows the
    expected-fallback figure, labeled "(expected)", for events without
    one yet).
    """
    total = len(rows)
    completed = sum(1 for r in rows if r["status_code"] == EventStatus.COMPLETED)
    upcoming = sum(1 for r in rows if r["status_code"] == "upcoming")
    cancelled_postponed = sum(1 for r in rows if r["status_code"] in (EventStatus.CANCELLED, EventStatus.POSTPONED))

    total_participants = _total_actual_participants(events)
    events_with_actual = sum(1 for r in rows if r["participant_count_is_actual"])
    average_participants_per_event = round(total_participants / events_with_actual, 1) if events_with_actual else None

    return {
        "total_events": total,
        "completed_events": completed,
        "upcoming_events": upcoming,
        "cancelled_postponed_events": cancelled_postponed,
        "total_participants": total_participants,
        "events_with_actual_participants": events_with_actual,
        "average_participants_per_event": average_participants_per_event,
    }


def build_event_activity_report(events_qs):
    events = list(events_qs.select_related("owner").prefetch_related("post_event_report"))
    rows = build_event_activity(events)
    return {
        "summary": build_event_activity_summary(rows, events),
        "rows": rows,
    }


# Export column set (spec §32) — same fields/order as the frontend's
# on-screen table (see EventActivityReport.jsx's TABLE_COLUMNS), so the
# exported file matches what's visible rather than an independently
# maintained column list that could drift out of sync with it.
EXPORT_HEADERS = [
    ("Event", "title", 32),
    ("Event Type", "event_type_label", 24),
    ("Start Date", "start_date", 14),
    ("End Date", "end_date", 14),
    ("Region", "region", 16),
    ("Program", "category", 16),
    ("Lead Organization", "lead_organization", 22),
    ("Partner", "partner", 22),
    ("Status", "status", 14),
    ("Participants", "participant_count", 14),
    ("Report Status", "post_event_report_status", 16),
]
