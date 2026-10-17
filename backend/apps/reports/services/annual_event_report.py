"""Annual Event Report (EMS Reporting System spec §18) — a full-year
organizational summary, explicitly distinct from the Management
Report's selected-period view (spec §18: "Management Report =
Selected-period management view. Annual Event Report = Full-year
organizational summary."). Reuses the same building blocks as the
Management Report (organizational_report.py) wherever the two reports
ask for the same underlying thing — Total Events/Participants/Partners,
Key Achievements, Challenges, Follow-up Summary, Communications
Performance — so a number that shows up in both reports can never
disagree (spec §27). The only things genuinely new here are the
year-anchored event queryset and the Month/Program/Region/Event Type/
Status breakdowns spec §18 asks for that the Management Report doesn't
compute.

Per spec §18, the only filter this report exposes is the Reporting Year
— unlike every other report in this module, it doesn't list Program/
Region/Status/etc. as filters of its own, so none are added here either
(a full-year view narrowed by the same filters as everything else would
just be a slower path to the Management Report's own yearly period).

"Organizational Summary" (spec §18: "Major achievements, Challenges,
Follow-up activities") reuses build_key_achievements/build_challenges/
build_follow_up_summary wholesale rather than re-deriving them — same
honesty caveats already documented on those functions apply here too
(e.g. Follow-up's Completed/In Progress counts are None, not guessed).
"""

from collections import Counter

from .organizational_report import (
    _organizations_engaged,
    _total_actual_participants,
    build_challenges,
    build_communications_performance,
    build_event_activity,
    build_follow_up_summary,
    build_key_achievements,
    build_partner_summary,
)


def _month_breakdown(events):
    counts = Counter()
    for e in events:
        if e.start_date:
            counts[e.start_date.strftime("%Y-%m")] += 1
    return [{"month": month, "count": count} for month, count in sorted(counts.items())]


def _label_breakdown(rows, key):
    """Only labels that actually occur in the data (spec §12's "only
    display statuses that actually exist" principle applies equally to
    Program/Region/Event Type here) — never a fixed, padded axis.
    """
    counts = Counter(row[key] for row in rows if row.get(key))
    return [{"label": label, "count": count} for label, count in sorted(counts.items(), key=lambda kv: -kv[1])]


def build_annual_event_report(events_qs, year):
    events = list(
        events_qs.prefetch_related("post_event_report__follow_up_actions", "support_request__todo_items")
    )
    activity_rows = build_event_activity(events)
    comms = build_communications_performance(events)

    summary = {
        "year": year,
        "total_events": len(events),
        # Actuals only, matching the Management Report so shared figures agree.
        "total_participants": _total_actual_participants(events),
        "events_with_actual_participants": sum(1 for r in activity_rows if r["participant_count_is_actual"]),
        "total_partners": len(_organizations_engaged(events)),
        "communication_activities": comms["total_requests"],
    }

    return {
        "summary": summary,
        "events_by_month": _month_breakdown(events),
        "events_by_program": _label_breakdown(activity_rows, "category"),
        "events_by_region": _label_breakdown(activity_rows, "region"),
        "events_by_event_type": _label_breakdown(activity_rows, "event_type"),
        "events_by_status": _label_breakdown(activity_rows, "status"),
        "partner_summary": build_partner_summary(events),
        "communications_performance": comms,
        "key_achievements": build_key_achievements(events),
        "challenges": build_challenges(events),
        "follow_up_summary": build_follow_up_summary(events),
        # Same rows as the Event Activity Report, for drill-down.
        "event_rows": activity_rows,
    }
