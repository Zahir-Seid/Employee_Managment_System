from apps.events.models import Event, filter_events_by_display_status, with_region_group


def get_filtered_events(request):
    """UI/UX Section 4 Dashboard Filters: Date Range, Category, Region,
    Thematic Area, and Event Status (added per the corrected dashboard
    spec). Unlike Stage 6 Reports (which use fixed Weekly/Monthly/
    Quarterly periods), the Dashboard uses a free-form date range.

    This builds the org-wide set; DashboardView narrows it to the user's own
    events for Staff.
    """
    qs = Event.objects.select_related("owner").prefetch_related("support_request", "post_event_report")

    date_from = request.query_params.get("date_from")
    date_to = request.query_params.get("date_to")
    category = request.query_params.get("category")
    region = request.query_params.get("region")
    thematic_area = request.query_params.get("thematic_area")
    status = request.query_params.get("status")

    if date_from:
        qs = qs.filter(start_date__gte=date_from)
    if date_to:
        qs = qs.filter(start_date__lte=date_to)
    if category:
        qs = qs.filter(category=category)
    if region:
        # Region, or the country of an International event (same grouping as the charts).
        qs = with_region_group(qs).filter(region_group__iexact=region)
    if thematic_area:
        qs = qs.filter(thematic_area__iexact=thematic_area)
    if status:
        # Event Status Update: `status` here is one of the six display
        # values (Upcoming/Ongoing/Held/Completed/Postponed/Cancelled),
        # not the four raw stored ones — see filter_events_by_display_status.
        qs = filter_events_by_display_status(qs, status)

    return qs
