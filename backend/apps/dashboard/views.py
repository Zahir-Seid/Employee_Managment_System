from datetime import datetime

from rest_framework import permissions
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role
from apps.events.models import Event
from apps.reports.services.report_data import group_events_by_thematic_area

from .big_events import get_big_events_queryset, serialize_big_event
from .filters import get_filtered_events
from .upcoming_events import (
    apply_upcoming_event_filters,
    compute_upcoming_event_filter_options,
    compute_upcoming_events_aggregate,
    get_upcoming_events_queryset,
    serialize_upcoming_event,
)
from .services import (
    get_category_breakdown,
    get_comms_support_overview,
    get_engagement_level_breakdown,
    get_internal_comms_support_breakdown,
    get_monthly_trend,
    get_overdue_alerts,
    get_participant_stats,
    get_post_event_report_status_table,
    get_recent_activity,
    get_region_breakdown,
    get_report_status_by_thematic_area,
    get_status_breakdown,
    get_summary_cards,
    get_support_level_breakdown,
    get_thematic_area_breakdown,
    get_trend_chart,
    get_upcoming_count_30d,
    get_upcoming_events,
)

VALID_SCOPES = {"generic", "thematic_area"}


class DashboardView(APIView):
    """Stage 5 (FR35-FR39): the single Dashboard payload backing UI/UX
    Section 4 — summary cards, charts, participant stats, Upcoming Events,
    and Recent Activity, all filterable by Date Range / Category / Region /
    Thematic Area (FR39).

    Scope (updated requirement #7): 'generic' (default) returns one set of
    aggregate charts across the filtered events. 'thematic_area' returns
    the same charts computed separately per Thematic Area, mirroring the
    Reports app's Thematic Area scope. 'single_event' is intentionally not
    offered here — a single event's data is already fully served by the
    Event Details endpoint (GET /api/events/{id}/), so this app doesn't
    duplicate that as a "dashboard".
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        scope = request.query_params.get("scope", "generic")
        if scope not in VALID_SCOPES:
            raise ValidationError({
                "scope": "Must be one of generic, thematic_area. (single_event isn't offered here; "
                         "use GET /api/events/{id}/ for a single event's full record.)"
            })

        events_qs = get_filtered_events(request)

        # Staff see only their own events here. The org-wide Upcoming Events and
        # Big Events cards use separate endpoints.
        is_staff_member = request.user.is_staff_only
        if is_staff_member:
            events_qs = events_qs.filter(owner=request.user)
        report_status_events_qs = events_qs

        payload = {
            "scope": scope,
            "summary": get_summary_cards(events_qs),
            "participant_stats": get_participant_stats(events_qs),
            "communications_support_breakdown": get_internal_comms_support_breakdown(events_qs),
            "comms_support_overview": get_comms_support_overview(events_qs),
            "post_event_report_status": get_post_event_report_status_table(report_status_events_qs),
            "upcoming_events": get_upcoming_events(
                request,
                limit=int(request.query_params.get("upcoming_limit", 3)),
                org_wide=request.query_params.get("upcoming_scope") == "org",
            ),
            "upcoming_count_30d": get_upcoming_count_30d(
                request, org_wide=request.query_params.get("upcoming_scope") == "org"
            ),
            "recent_activity": get_recent_activity(user=request.user if is_staff_member else None),
        }

        if scope == "thematic_area":
            grouped = group_events_by_thematic_area(events_qs)
            thematic_payload = {}
            for area, events in grouped.items():
                area_qs = events_qs.filter(id__in=[e.id for e in events])
                thematic_payload[area] = {
                    "summary": get_summary_cards(area_qs),
                    "category_breakdown": get_category_breakdown(area_qs),
                    "region_breakdown": get_region_breakdown(area_qs),
                    "engagement_level_breakdown": get_engagement_level_breakdown(area_qs),
                    "support_level_breakdown": get_support_level_breakdown(area_qs),
                    "participant_stats": get_participant_stats(area_qs),
                }
            payload["thematic_areas"] = thematic_payload
        else:
            # Bucket size is one level below the selected period (see get_trend_chart).
            period_param = request.query_params.get("period", "monthly")
            granularity = {
                "weekly": "day",
                "monthly": "week_of_month",
                "quarterly": "month",
                "yearly": "month",
            }.get(period_param, "month")

            def _parse_date(value):
                try:
                    return datetime.strptime(value, "%Y-%m-%d").date() if value else None
                except ValueError:
                    return None

            date_from = _parse_date(request.query_params.get("date_from"))
            date_to = _parse_date(request.query_params.get("date_to"))

            payload["charts"] = {
                "by_category": get_category_breakdown(events_qs),
                "by_status": get_status_breakdown(events_qs),
                "by_region": get_region_breakdown(events_qs),
                "by_thematic_area": get_thematic_area_breakdown(events_qs),
                "report_status_by_thematic_area": get_report_status_by_thematic_area(report_status_events_qs),
                "by_engagement_level": get_engagement_level_breakdown(events_qs),
                "by_support_level": get_support_level_breakdown(events_qs),
                "monthly_trend": get_monthly_trend(events_qs),
                "trend": get_trend_chart(events_qs, granularity=granularity, date_from=date_from, date_to=date_to),
            }

        return Response(payload)


class OverdueAlertsView(APIView):
    """Item 24: a standalone, always-unfiltered Overdue Reports count + list,
    reused by 3 UI spots (Sidebar's "Admin" badge, the Admin > TV Display
    tab's org-wide counter, and Staff's own "Overdue" tab on Event Status
    Reports) via one shared frontend component with a scope prop.

    Deliberately NOT built on top of DashboardView's `events_qs` — that
    queryset is filtered by whatever period/date-range is active on the
    Dashboard (e.g. "Monthly" by default), so an event overdue from three
    months ago would silently disappear from these counters the moment
    someone narrowed the Dashboard's own period filter. This view always
    looks at every event overdue right now, full stop.

    scope=own: the requesting user's own events only (for Staff on the
    Event Status Reports page).
    scope=org: every event org-wide (for the Admin badge and the TV
    Display tab's counter) — matches the existing product decision (see
    apps/dashboard/filters.py) that org-wide aggregates are never
    restricted to "my own events" for any role.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        scope = request.query_params.get("scope", "own")
        if scope not in {"own", "org"}:
            raise ValidationError({"scope": "Must be one of own, org."})
        if request.user.is_staff_only:
            scope = "own"

        qs = Event.objects.select_related("owner").prefetch_related("post_event_report")
        if scope == "own":
            qs = qs.filter(owner=request.user)

        alerts = get_overdue_alerts(qs)
        return Response({"scope": scope, "count": len(alerts), "alerts": alerts})


class UpcomingEventsPagination(PageNumberPagination):
    """Same page-size-override pattern as everywhere else paginated in
    this app: the Dashboard's compact card asks for page_size=5 (spec's
    default "next 5 upcoming events"), the "View All" page uses the
    normal default/larger page sizes.
    """

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class BigEventsView(APIView):
    """Dashboard Big Events section: every International/National event
    that's still Upcoming or Ongoing, org-wide, nearest-first — see
    apps/dashboard/big_events.py. Deliberately unpaginated: this is a
    small featured set (a carousel of a handful of cards), not a list
    meant to be paginated/filtered the way Upcoming Events is.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        events = [serialize_big_event(e, request) for e in get_big_events_queryset()]
        return Response({"count": len(events), "results": events})


class UpcomingEventsListView(APIView):
    """Dashboard Upcoming Events Enhancement, §2/§3/§6: the List view
    backing both the Dashboard card (page_size=5) and its "View All" full
    page (normal pagination) — org-wide for every role, search + filters,
    ordered nearest-first.
    """

    permission_classes = [permissions.IsAuthenticated]
    pagination_class = UpcomingEventsPagination

    def get(self, request):
        qs = apply_upcoming_event_filters(get_upcoming_events_queryset(), request.query_params)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(qs, request, view=self)
        results = [serialize_upcoming_event(e) for e in page]
        return paginator.get_paginated_response(results)


class UpcomingEventsAggregateView(APIView):
    """Dashboard Upcoming Events Enhancement §5: the Aggregate view — same
    filters as the List view above, real counts/breakdowns computed from
    the filtered queryset, nothing hardcoded.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = apply_upcoming_event_filters(get_upcoming_events_queryset(), request.query_params)
        return Response(compute_upcoming_events_aggregate(qs))


class UpcomingEventsFilterOptionsView(APIView):
    """Dashboard Upcoming Events Enhancement §4: the values that populate
    the filter dropdowns (Category, Thematic Area, Region, Event
    Owner/Staff, Status) — always the full org-wide upcoming-events set,
    unaffected by whatever is currently selected, so choosing one filter
    never makes another filter's own options disappear.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(compute_upcoming_event_filter_options(get_upcoming_events_queryset()))

