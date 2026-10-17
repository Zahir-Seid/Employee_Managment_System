import calendar
from datetime import date, timedelta

from django.db.models import Count
from django.db.models.functions import TruncMonth
from django.utils import timezone

from apps.accounts.models import Role
from apps.audit.models import ActionType, AuditLog
from apps.communications.models import SupportRequest
from apps.configuration.models import ConfigListType, ConfigOption
from apps.events.models import (
    with_region_group,
    EVENT_DISPLAY_STATUS_ORDER,
    REPORT_SUBMISSION_WINDOW_DAYS,
    Event,
    EventCategory,
    EventStatus,
    report_overdue_cutoff,
)


def get_summary_cards(events_qs):
    """UI/UX Section 4 Top Summary Cards (FR35-FR37)."""
    counts_by_category = dict(
        events_qs.values_list("category").annotate(c=Count("id")).values_list("category", "c")
    )
    total = events_qs.count()
    completed = events_qs.filter(status=EventStatus.COMPLETED).count()
    # Single query for events with no submitted report (including no report at
    # all), rather than a per-event property that causes N+1 queries.
    pending_reports = events_qs.exclude(post_event_report__status="submitted").count()

    support_requests_qs = SupportRequest.objects.filter(event__in=events_qs)

    return {
        "total_events": total,
        "international_events": counts_by_category.get(EventCategory.INTERNATIONAL, 0),
        "national_events": counts_by_category.get(EventCategory.NATIONAL, 0),
        "sub_regional_events": counts_by_category.get(EventCategory.SUB_REGIONAL, 0),
        "internal_events": counts_by_category.get(EventCategory.INTERNAL, 0),
        "pending_reports": pending_reports,
        "completed_events": completed,
        "communications_requests": support_requests_qs.count(),
    }


def get_category_breakdown(events_qs):
    """FR35: Events by Category chart."""
    rows = events_qs.values("category").annotate(count=Count("id")).order_by("category")
    return [{"category": Event(category=r["category"]).get_category_label(), "count": r["count"]} for r in rows]


def get_status_breakdown(events_qs):
    """Events by Status chart — grouped by the same six-way computed
    display status (Upcoming/Ongoing/Held/Completed/Postponed/Cancelled —
    see Event.get_computed_status) used everywhere else status is shown.
    Unlike get_category_breakdown, this can't be a single `.values().
    annotate()` DB aggregation: Upcoming/Ongoing/Held all share the same
    raw `status` column value and are only distinguished by each event's
    own dates, so the count has to happen in Python after fetching.
    """
    counts = {}
    # Drop the owner join carried by events_qs; .only() can't be combined with
    # select_related on a deferred field.
    for e in events_qs.select_related(None).only("id", "status", "start_date", "end_date"):
        code = e.get_computed_status()
        counts[code] = counts.get(code, 0) + 1

    label_source = Event()
    return [
        {"status": label_source._config_label(ConfigListType.EVENT_STATUS, code), "count": counts[code]}
        for code in EVENT_DISPLAY_STATUS_ORDER
        if code in counts
    ]


def get_region_breakdown(events_qs):
    """FR35: Events by Region chart."""
    # International events count under their country, everything else under its Region.
    rows = with_region_group(events_qs).values("region_group").annotate(count=Count("id")).order_by("-count")
    return [{"region": r["region_group"], "count": r["count"]} for r in rows]


def get_thematic_area_breakdown(events_qs):
    """FR35: Events by Thematic Area chart."""
    rows = events_qs.values("thematic_area").annotate(count=Count("id")).order_by("-count")
    return [{"thematic_area": r["thematic_area"], "count": r["count"]} for r in rows]


def get_report_status_by_thematic_area(events_qs):
    """"Post-Event Report Status" grouped bar chart (staff spec): for each
    thematic area, how many events have a Submitted / Pending / Overdue
    Event Status Report. Reuses the exact same 3-way classification as
    get_post_event_report_status_table above (submitted; overdue if past
    end date with nothing submitted; pending otherwise) — just aggregated
    into per-area counts instead of listed per-event.

    select_related("post_event_report") avoids an N+1 (has_submitted_report
    touches that relation per event); done as a Python loop rather than a
    .annotate() aggregate because the 3-way bucket depends on comparing
    each event's own end_date to today, which isn't expressible as a
    single grouped SQL aggregate without a database-side CASE per-row
    that's harder to keep in sync with has_submitted_report's own logic
    than just reusing that property directly.
    """
    cutoff = report_overdue_cutoff()
    counts = {}
    for event in events_qs.select_related("post_event_report"):
        area = event.thematic_area or "Unspecified"
        bucket = counts.setdefault(area, {"submitted": 0, "pending": 0, "overdue": 0})
        if event.has_submitted_report:
            bucket["submitted"] += 1
        elif event.end_date < cutoff:
            bucket["overdue"] += 1
        else:
            bucket["pending"] += 1

    return [
        {"area": area, **bucket}
        for area, bucket in sorted(counts.items(), key=lambda kv: -sum(kv[1].values()))
    ]


def get_engagement_level_breakdown(events_qs):
    """FR35 (updated requirement #3: replaces 'Events by EE Role' with
    Events by Engagement Level, since EE's Role was split into Engagement
    Level + Support Level).

    Labels come from the admin-managed ConfigOption table (Configuration
    page) rather than Event.get_engagement_level_display(), which stopped
    working once engagement_level's values moved off a static choices list
    — one bulk lookup here avoids an N+1 query per distinct value.
    """
    rows = events_qs.values("engagement_level").annotate(count=Count("id")).order_by("-count")
    labels = dict(
        ConfigOption.objects.filter(list_type=ConfigListType.ENGAGEMENT_LEVEL).values_list("value", "label")
    )
    return [
        {"engagement_level": labels.get(r["engagement_level"], r["engagement_level"]), "count": r["count"]}
        for r in rows
    ]


def get_support_level_breakdown(events_qs):
    """Companion breakdown to Engagement Level, covering the other half of
    the old EE's Role field (updated requirement #3).
    """
    rows = events_qs.values("support_level").annotate(count=Count("id")).order_by("-count")
    return [
        {"support_level": Event(support_level=r["support_level"]).get_support_level_label(), "count": r["count"]}
        for r in rows
    ]


def get_monthly_trend(events_qs):
    """FR35: Monthly Event Trend — always monthly buckets. Also backs the
    "This Month" KPI card's count/trend calculation, which depends on the
    "%Y-%m" key format, so this stays fixed regardless of the chart's
    selected granularity (see get_trend_chart below for that).
    """
    rows = (
        events_qs.annotate(month=TruncMonth("start_date"))
        .values("month")
        .annotate(count=Count("id"))
        .order_by("month")
    )
    return [{"month": r["month"].strftime("%Y-%m"), "count": r["count"]} for r in rows if r["month"]]


def get_trend_chart(events_qs, granularity="month", date_from=None, date_to=None):
    """Events Logged Over Time chart data. The bucket size is one level of
    granularity below whichever Period the Dashboard filter is set to, so
    the chart always shows a meaningful breakdown instead of one flat
    point spanning the whole range:

      - Weekly period    -> granularity="day"           7 days, one per day
      - Monthly period   -> granularity="week_of_month"  Week 1..4/5 within that month
      - Quarterly period -> granularity="month"          the 3 months in that quarter
      - Yearly period    -> granularity="month"          all 12 months of that year
      - All/Custom       -> granularity="month"          unchanged (whatever months have data)

    date_from/date_to (as date objects) anchor the day/week_of_month/month
    ranges so every expected bucket appears at 0 rather than only ones
    that happen to have data — e.g. Week 3 with no events still shows up
    as a 0 rather than a gap in an otherwise Week1/2/4 axis.

    "week_of_month" buckets by day-of-month in chunks of 7 (days 1-7 =
    Week 1, 8-14 = Week 2, ...) — a literal "which week of this month",
    not the ISO calendar week (which can straddle two different months).
    """
    if granularity == "day":
        counts = {r["start_date"]: r["count"] for r in events_qs.values("start_date").annotate(count=Count("id"))}
        if date_from and date_to:
            days = []
            d = date_from
            while d <= date_to:
                days.append(d)
                d += timedelta(days=1)
        else:
            days = sorted(counts.keys())
        return [{"month": d.strftime("%Y-%m-%d"), "count": counts.get(d, 0)} for d in days]

    if granularity == "week_of_month":
        buckets = {}
        for d in events_qs.values_list("start_date", flat=True):
            week_num = ((d.day - 1) // 7) + 1
            buckets[week_num] = buckets.get(week_num, 0) + 1
        if date_from:
            total_days = calendar.monthrange(date_from.year, date_from.month)[1]
        else:
            total_days = max(buckets.keys(), default=1) * 7
        num_weeks = ((total_days - 1) // 7) + 1
        return [{"month": f"Week {w}", "count": buckets.get(w, 0)} for w in range(1, num_weeks + 1)]

    counts = {
        r["bucket"]: r["count"]
        for r in events_qs.annotate(bucket=TruncMonth("start_date")).values("bucket").annotate(count=Count("id"))
        if r["bucket"]
    }
    if date_from and date_to:
        months = []
        cursor = date_from.replace(day=1)
        end_cursor = date_to.replace(day=1)
        while cursor <= end_cursor:
            months.append(cursor)
            cursor = date(cursor.year + 1, 1, 1) if cursor.month == 12 else date(cursor.year, cursor.month + 1, 1)
    else:
        months = sorted(counts.keys())
    return [{"month": m.strftime("%Y-%m"), "count": counts.get(m, 0)} for m in months]


def get_participant_stats(events_qs):
    """Updated requirement #7: participant count breakdown for the
    Dashboard, alongside the Engagement Level breakdown above.

    Actuals only, from each event's submitted Event Status Report — same
    rule (and same reasoning) as apps.reports.services.organizational_report
    uses for its own participant KPIs: an event's `expected_participants`
    is a plan made before the event happened, not a real headcount, so it
    doesn't belong in a number meant to reflect who actually attended.
    Events with no submitted report (or a submitted one with participant
    counts left blank) simply don't contribute here, rather than falling
    back to the expected estimate.
    """
    total = 0
    count = 0
    for event in events_qs.select_related("post_event_report"):
        report = getattr(event, "post_event_report", None)
        if report and report.status == "submitted" and report.participants_male is not None and report.participants_female is not None:
            total += report.participants_male + report.participants_female
            count += 1
    return {
        "total_participants": total,
        "average_participants": round(total / count, 1) if count else 0,
    }


def get_internal_comms_support_breakdown(events_qs):
    """FR36: count of events with and without a Communications Support
    Request. Originally scoped to Internal events only; since Comms
    Support Requests now apply to every category (updated requirement #1),
    this is reported both overall and broken out per category so the
    original Internal-specific figure remains visible.
    """
    with_request = events_qs.filter(support_request__isnull=False).count()
    without_request = events_qs.count() - with_request

    internal_qs = events_qs.filter(category=EventCategory.INTERNAL)
    internal_with_request = internal_qs.filter(support_request__isnull=False).count()

    return {
        "with_support_request": with_request,
        "without_support_request": without_request,
        "internal_with_support_request": internal_with_request,
        "internal_without_support_request": internal_qs.count() - internal_with_request,
    }


def get_comms_support_overview(events_qs):
    """Dashboard spec: 'Communications Support Overview' — total requests,
    a count per support type actually selected (an event can have more
    than one, since support_types is multi-select), and Urgent vs
    Standard counts.
    """
    from apps.configuration.models import ConfigListType
    from apps.configuration.utils import get_config_labels

    support_requests_qs = SupportRequest.objects.filter(event__in=events_qs)
    total = support_requests_qs.count()

    # Seeded from the active ConfigOption list so admin-added types are counted.
    labels = get_config_labels(ConfigListType.SUPPORT_TYPE)
    type_counts = {value: 0 for value in labels}
    for support_types in support_requests_qs.values_list("support_types", flat=True):
        for t in support_types or []:
            type_counts[t] = type_counts.get(t, 0) + 1

    return {
        "total_requests": total,
        "by_support_type": [
            {"support_type": labels.get(value, value), "count": count}
            for value, count in type_counts.items()
        ],
    }


def get_post_event_report_status_table(events_qs, limit=15):
    """Dashboard spec: 'Event Status Report Status' table — Event, Owner,
    Event Date, Status, Days Overdue, and enough info for the frontend to
    render an Action link. Prioritizes overdue-first, then soonest-ending,
    so the most actionable rows surface without needing pagination for a
    dashboard widget (the full list is always available via My Events /
    Reports for anyone who needs it).
    """
    today = timezone.localdate()
    cutoff = report_overdue_cutoff(today)
    rows = []
    for e in events_qs.select_related("owner").order_by("end_date")[: limit * 3]:
        has_submitted = e.has_submitted_report
        if has_submitted:
            status, days_overdue = "Completed", 0
        elif e.end_date < cutoff:
            status, days_overdue = "Overdue", (today - e.end_date).days - REPORT_SUBMISSION_WINDOW_DAYS
        else:
            status, days_overdue = "Pending", 0
        rows.append({
            "event_id": str(e.id),
            "title": e.title,
            "owner_name": e.owner.get_full_name() or e.owner.email,
            "end_date": e.end_date,
            "status": status,
            "days_overdue": days_overdue,
        })

    # Overdue first (most overdue at the top), then Pending, then Completed.
    order = {"Overdue": 0, "Pending": 1, "Completed": 2}
    rows.sort(key=lambda r: (order[r["status"]], -r["days_overdue"]))
    return rows[:limit]


def get_overdue_alerts(events_qs):
    """FR37 / dashboard spec 'Overdue Alerts': events past their report
    submission window with no submitted Event Status Report — surfaced as a distinct list so
    the frontend can render them as red warning cards, separate from the
    general status table above.
    """
    today = timezone.localdate()
    overdue = list(
        events_qs.select_related("owner")
        .filter(end_date__lt=report_overdue_cutoff(today))
        .exclude(post_event_report__status="submitted")
    )
    overdue.sort(key=lambda e: e.end_date)
    return [
        {
            "event_id": str(e.id),
            "title": e.title,
            "owner_name": e.owner.get_full_name() or e.owner.email,
            "end_date": e.end_date,
            "days_overdue": (today - e.end_date).days - REPORT_SUBMISSION_WINDOW_DAYS,
        }
        for e in overdue
    ]


def get_upcoming_count_30d(request, org_wide=False):
    """Item #6 fix: the 'Upcoming' KPI card was previously just
    len(get_upcoming_events(...)), which is capped at `limit` (3) for
    display purposes — so the card could never show more than 3 even when
    far more events were genuinely upcoming, silently understating the
    real number. This is a real, uncapped count of events starting within
    the next 30 days, same role scoping as get_upcoming_events.

    Dashboard Upcoming Events Enhancement §6: this count is now org-wide
    for every role, Staff included — it used to be owner-scoped for Staff,
    which made this KPI card disagree with the new org-wide Upcoming
    Events card next to it. `org_wide` is still accepted (DashboardView
    passes it) but no longer changes anything here.
    """
    today = timezone.localdate()
    return Event.objects.filter(start_date__gte=today, start_date__lte=today + timedelta(days=30)).count()


def get_upcoming_events(request, limit=3, org_wide=False):
    """Updated requirement #7 / dashboard spec: 'Upcoming Events' showing
    the nearest N events, including the Communications Support flag and
    Urgent badge the corrected spec asks for. Respects the same role
    scoping as everywhere else: Staff see only their own (FR3);
    Communications/Leadership see all.

    org_wide=True bypasses that Staff-owns-it filter regardless of the
    requesting user's role — for the TV Display (see DashboardView's
    `upcoming_scope` query param), which is a shared office screen, not
    anyone's personal Dashboard: whichever account happens to be logged
    into that browser is incidental, and every viewer expects to see the
    whole organization's upcoming events, same as Communications/
    Leadership already do here. Every other caller leaves this False and
    keeps the existing FR3 behavior exactly as before.
    """
    today = timezone.localdate()
    qs = (
        Event.objects.select_related("owner")
        .select_related("support_request")
        .filter(start_date__gte=today)
        .order_by("start_date")
    )

    if request.user.is_staff_only and not org_wide:
        qs = qs.filter(owner=request.user)

    results = []
    for e in qs[:limit]:
        results.append({
            "id": str(e.id),
            "title": e.title,
            "category": e.get_category_label(),
            "start_date": e.start_date,
            "end_date": e.end_date,
            "region": e.region_group_label,
            "location_label": e.location_label,
            # Used by the TV Display rows; the main Dashboard still reads `region`.
            "thematic_area": e.get_thematic_area_label(),
            "owner_name": e.owner.get_full_name() or e.owner.email,
            "needs_comms_support": e.needs_comms_support,
        })
    return results


def get_recent_activity(limit=10, user=None):
    """UI/UX Section 4 'Recent Activity': latest Events Logged, Support
    Requests, and Event Status Reports submitted. Backed by the audit trail
    (FR49) rather than a separate query across three tables/apps. Pass `user`
    to limit it to that user's own actions.
    """
    relevant_actions = [ActionType.CREATED, ActionType.SUBMITTED]
    logs_qs = AuditLog.objects.filter(
        action_type__in=relevant_actions,
        object_type__in=["event", "support_request", "post_event_report"],
    )
    if user is not None:
        logs_qs = logs_qs.filter(user=user)
    # Fetch extra rows so enough remain after de-duplicating near-simultaneous
    # repeats (same 2-second window as the Audit Trail page).
    logs = list(logs_qs.select_related("user").order_by("-created_at")[: limit * 3])
    deduped = []
    seen_key = None
    seen_time = None
    for log in logs:
        key = (log.user_id, log.action_type, log.object_type, log.object_id, log.description)
        if key == seen_key and seen_time is not None and abs((seen_time - log.created_at).total_seconds()) <= 2:
            continue
        deduped.append(log)
        seen_key = key
        seen_time = log.created_at
        if len(deduped) >= limit:
            break
    return [
        {
            "id": str(log.id),
            "action_type": log.get_action_type_display(),
            "object_type": log.get_object_type_display(),
            "description": log.description,
            "user": (log.user.get_full_name() or log.user.get_username() or log.user.email) if log.user else "System",
            "created_at": log.created_at,
        }
        for log in deduped
    ]
