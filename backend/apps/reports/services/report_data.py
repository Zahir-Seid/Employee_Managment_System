import calendar
from datetime import date, timedelta

from django.db.models import Q
from django.utils import timezone

from apps.events.models import Event, filter_events_by_event_type, with_region_group


def resolve_period_range(period, reference_date=None, quarter=None, year=None, month=None, week=None):
    """FR41: resolves a Weekly/Monthly/Quarterly/Yearly period into a
    concrete (start, end) date range, anchored to `reference_date`
    (defaults to today). Based on the event's start_date per the product
    decision that reports describe "what events happened," not "what was
    logged."

    `quarter` (1-4) / `year` let the caller pick a specific quarter or year
    instead of always resolving to whichever one `reference_date` falls in
    — the Dashboard and Reports pages both expose this as an explicit
    picker rather than only ever showing "this quarter"/"this year".

    `month` (1-12) / `year`: a specific month instead of the current one.
    `week` (1-4) / `month` / `year`: a specific week-of-month (days 1-7,
    8-14, 15-21, 22-end) — same definition used by the Dashboard's trend
    chart drill-down, so "Week 2 of July" means the same thing everywhere.
    """
    today = reference_date or timezone.localdate()

    if period == "weekly":
        if week and month:
            target_year = year or today.year
            last_day = calendar.monthrange(target_year, month)[1]
            start_day = (week - 1) * 7 + 1
            end_day = last_day if week == 4 else min(week * 7, last_day)
            start = date(target_year, month, start_day)
            end = date(target_year, month, end_day)
        else:
            start = today - timedelta(days=today.weekday())
            end = start + timedelta(days=6)
    elif period == "monthly":
        if month:
            target_year = year or today.year
            start = date(target_year, month, 1)
            last_day = calendar.monthrange(target_year, month)[1]
            end = date(target_year, month, last_day)
        else:
            start = today.replace(day=1)
            last_day = calendar.monthrange(today.year, today.month)[1]
            end = today.replace(day=last_day)
    elif period == "quarterly":
        # Item 12: fiscal quarters start in July (Q1 Jul-Sep ... Q4 Apr-Jun).
        FISCAL_QUARTER_START_MONTH = {1: 7, 2: 10, 3: 1, 4: 4}
        target_year = year or today.year
        target_quarter = quarter or (((today.month - 7) % 12) // 3 + 1)
        start_month = FISCAL_QUARTER_START_MONTH[target_quarter]
        start = date(target_year, start_month, 1)
        end_month = start_month + 2
        last_day = calendar.monthrange(target_year, end_month)[1]
        end = date(target_year, end_month, last_day)
    elif period == "yearly":
        target_year = year or today.year
        start = date(target_year, 1, 1)
        end = date(target_year, 12, 31)
    else:
        raise ValueError(f"Unknown period: {period}")

    return start, end


def get_report_queryset(
    period=None,
    category=None,
    region=None,
    thematic_area=None,
    communication_support=None,
    event_type=None,
    mode_of_event=None,
    status=None,
    organization=None,
    support_level=None,
    responsible_person=None,
    date_from=None,
    date_to=None,
    reference_date=None,
    quarter=None,
    year=None,
    month=None,
    week=None,
):
    """FR41/FR43: builds the filtered event queryset used by the PDF/Excel
    report generators and the on-screen preview.

    `period` is optional: the "Single Event" report scope pulls one
    specific event's full record rather than a date range, so Period does
    not apply there (per product decision) and this function is called
    with period=None in that case, skipping date filtering entirely.
    `period="custom"` uses `date_from`/`date_to` directly instead of
    resolving a named period (Organizational Performance Report's
    "Custom Date Range" filter option).

    `quarter` (1-4) / `year`: only meaningful when period is "quarterly" or
    "yearly" — lets the caller pick a specific one instead of always the
    current quarter/year.

    `month` (1-12): a specific month when period is "monthly", or (with
    `week`, 1-4) a specific week-of-month when period is "weekly".

    `communication_support` (corrected report spec): "requested" / "not_requested" /
    None (All). Filters on whether the event asked for Communications
    support at all (needs_comms_support), not on request completion status.

    `event_type` / `mode_of_event` / `status`: same filters already
    available on the Events list and Admin Events pages (Event Type and
    Mode of Event were added to the Event model after this report scope
    was first built, and never got wired in here — this closes that gap).

    `organization` (Organizational Performance Report's "Organization /
    Partner" filter): matches against either Lead Organization or
    Co-organizer — the two places an org name is captured on Event today
    (there's no structured Partner model — see org_performance.py's
    module docstring).

    `support_level`: EMS Reporting System spec v2's "Support Level"
    report filter — matches Event.support_level (Financial/Technical/
    Both) directly, same field the Event form itself uses.

    `responsible_person` (Event Activity Report's "Responsible Person"
    filter, spec §14): there's no separate "responsible person" field on
    Event — the closest existing concept is Event Owner (the staff member
    who logged it, same person EventViewSet's Staff-scoping already keys
    off of) — so this matches against the owner's first name, last name,
    or username, the same three fields their account actually has.
    """
    qs = (
        Event.objects.select_related("owner")
        .prefetch_related("support_request", "post_event_report")
    )

    start = end = None
    if period == "custom":
        if not date_from or not date_to:
            raise ValueError("date_from and date_to are required when period is 'custom'.")
        start, end = date_from, date_to
        qs = qs.filter(start_date__gte=start, start_date__lte=end)
    elif period:
        start, end = resolve_period_range(period, reference_date, quarter=quarter, year=year, month=month, week=week)
        qs = qs.filter(start_date__gte=start, start_date__lte=end)

    if category:
        qs = qs.filter(category=category)
    if region:
        # Region, or the country of an International event (same grouping as the reports).
        qs = with_region_group(qs).filter(region_group__iexact=region)
    if thematic_area:
        qs = qs.filter(thematic_area__iexact=thematic_area)
    if event_type:
        qs = filter_events_by_event_type(qs, event_type)
    if mode_of_event:
        qs = qs.filter(mode_of_event=mode_of_event)
    if status:
        qs = qs.filter(status=status)
    if organization:
        qs = qs.filter(
            Q(organization_lead_agency__icontains=organization) | Q(co_organizer_name__icontains=organization)
        )
    if communication_support == "requested":
        qs = qs.filter(needs_comms_support=True)
    elif communication_support == "not_requested":
        qs = qs.filter(needs_comms_support=False)
    if support_level:
        qs = qs.filter(support_level=support_level)
    if responsible_person:
        qs = qs.filter(
            Q(owner__first_name__icontains=responsible_person)
            | Q(owner__last_name__icontains=responsible_person)
            | Q(owner__username__icontains=responsible_person)
        )

    return qs.order_by("thematic_area", "start_date"), start, end


def get_report_summary_stats(events):
    """Report Preview summary (corrected report spec): Number of Events,
    Completed Events, Pending Reports, Communication Requests —
    computed over whatever event set (list or queryset) the caller
    already resolved, so Generic/Thematic Area/Single Event all share
    one implementation.

    `urgent_requests` was dropped from this summary along with the
    SupportRequest.urgency field it was computed from (Event Registry /
    Days Until Event update) — nothing replaces it, per that update's
    explicit "don't invent a new Priority field" instruction.
    """
    events = list(events)
    completed = sum(1 for e in events if e.status == "completed")
    pending_reports = sum(1 for e in events if not e.has_submitted_report)
    comms_requests = sum(1 for e in events if e.has_support_request)
    return {
        "number_of_events": len(events),
        "completed_events": completed,
        "pending_reports": pending_reports,
        "communication_requests": comms_requests,
    }


def group_events_by_thematic_area(events):
    """Report Scope = "Thematic Area": groups the (already filtered/period-
    scoped) event queryset into ordered sections keyed by thematic area,
    for both the PDF and Excel generators to render as separate sections.
    """
    groups = {}
    for event in events:
        key = event.thematic_area or "Unspecified"
        groups.setdefault(key, []).append(event)
    return dict(sorted(groups.items(), key=lambda item: item[0].lower()))
