"""Partner Engagement Report (EMS Reporting System spec §17). Reuses
services/organizational_report.py's `_organizations_engaged` — the same
"any non-empty organization_lead_agency/co_organizer_name value counts
as an organization/partner" rule the Management Report's own Partner
Summary and executive KPIs already use — so this report's numbers can't
drift from those (spec §27).

EE itself is excluded from that rule (both here and in
_organizations_engaged) even when EE is logged as an event's own lead
agency or co-organizer — EE is the org running the event, not an
external partner, so it never counts as a "partner" in any report that
uses this exclusion.

Per partner row:
  - Events: count of events naming this org as lead agency or
    co-organizer.
  - Participation: actual (submitted-report) participant count summed
    across those events — same actuals-only rule as everywhere else in
    this module. Spec §17 explicitly says not to estimate when data
    isn't available, so an event with no submitted report contributes 0
    here rather than a guessed figure.
  - Programs / Locations: distinct Category / Region values across
    those events.

"Active Partners" (KPI): partners with at least one event that isn't
Cancelled/Postponed in the filtered set — the one honest distinction
the existing Status field actually supports; there's no separate
"active partnership" concept in the schema to query instead.

"Partner Engagement by Period" (spec §17's KPI list) is a trend, not a
single number, so it's built here as a monthly series
(build_monthly_partner_trend) for the frontend to chart, the same way
Event Trend works on the other reports, rather than forced into a KPI
card it doesn't fit.
"""

from collections import defaultdict

from apps.events.models import EventStatus



def _event_partner_names(event):
    names = set()
    if event.organization_lead_agency and event.organization_lead_agency.strip().upper() != "EE":
        names.add(event.organization_lead_agency.strip())
    if event.co_organizer_name and event.co_organizer_name.strip().upper() != "EE":
        names.add(event.co_organizer_name.strip())
    return names


def _event_actual_participants(event):
    report = getattr(event, "post_event_report", None)
    if (
        report
        and report.status == "submitted"
        and report.participants_male is not None
        and report.participants_female is not None
    ):
        return report.participants_male + report.participants_female
    return 0


def build_partner_engagement_rows(events):
    rows_by_partner = {}
    for event in events:
        participants = _event_actual_participants(event)
        for name in _event_partner_names(event):
            row = rows_by_partner.setdefault(
                name,
                {"partner": name, "event_count": 0, "participation": 0, "programs": set(), "locations": set(), "active": False},
            )
            row["event_count"] += 1
            row["participation"] += participants
            row["programs"].add(event.get_category_label())
            row["locations"].add(event.region_group_label)
            if event.status not in (EventStatus.CANCELLED, EventStatus.POSTPONED):
                row["active"] = True

    rows = [
        {
            "partner": row["partner"],
            "event_count": row["event_count"],
            "participation": row["participation"],
            "programs": sorted(row["programs"]),
            "locations": sorted(row["locations"]),
            "active": row["active"],
        }
        for row in rows_by_partner.values()
    ]
    rows.sort(key=lambda r: r["event_count"], reverse=True)
    return rows


def build_monthly_partner_trend(events):
    monthly = defaultdict(set)
    for event in events:
        if not event.start_date:
            continue
        month_key = event.start_date.strftime("%Y-%m")
        monthly[month_key] |= _event_partner_names(event)
    return [
        {"month": month, "partner_count": len(names)}
        for month, names in sorted(monthly.items())
    ]


def build_partner_engagement_summary(rows, events):
    events_with_partner = [e for e in events if _event_partner_names(e)]
    participation_count = sum(_event_actual_participants(e) for e in events_with_partner)
    return {
        "total_partners": len(rows),
        "active_partners": sum(1 for r in rows if r["active"]),
        "events_with_partner_participation": len(events_with_partner),
        "participation_count": participation_count,
    }


def build_partner_engagement_report(events_qs):
    events = list(events_qs.select_related("post_event_report"))
    rows = build_partner_engagement_rows(events)
    return {
        "summary": build_partner_engagement_summary(rows, events),
        "rows": rows,
        "monthly_trend": build_monthly_partner_trend(events),
    }


# Export column set (spec §32) — mirrors PartnerEngagementReport.jsx's
# on-screen table.
EXPORT_HEADERS = [
    ("Partner", "partner", 30),
    ("Events", "event_count", 12),
    ("Participation", "participation", 16),
    ("Programs", "programs_display", 26),
    ("Locations", "locations_display", 26),
]
