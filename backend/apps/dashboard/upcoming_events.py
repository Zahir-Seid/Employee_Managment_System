"""Dashboard Upcoming Events Enhancement.

Backs the Dashboard's "Upcoming Events" card and its "View All" full page:
org-wide visibility for every role (including Staff — see
get_upcoming_events_queryset below), search + filters, a List view, and an
Aggregate view with real (non-hardcoded) breakdowns computed from whatever
filters are currently applied. There is deliberately no separate "Program"
filter/column/chart: this system has no Program field distinct from
Category, so showing one would just repeat Category's data twice.

Deliberately a separate module from dashboard/services.py's existing
get_upcoming_events/get_upcoming_count_30d. get_upcoming_events is left
exactly as it was (still used by the TV Display via `upcoming_scope=org`).
get_upcoming_count_30d, which powers the Dashboard's small "Upcoming (Next
30 days)" KPI card, was changed only to be org-wide for Staff too, so it
agrees with this module's org-wide card.
"""

from django.db.models import Count
from django.utils import timezone

from apps.configuration.models import ConfigOption
from apps.events.models import Event, distinct_display_statuses, filter_events_by_display_status, with_region_group


def get_upcoming_events_queryset():
    """Every event starting today or later, org-wide, for every role.

    Spec §6 (Staff Visibility): Staff users could previously only see
    their own upcoming events here. This is a deliberate, feature-scoped
    exception to FR3's usual "Staff sees only their own events" rule —
    the spec is explicit that this change is scoped to Upcoming Events
    visibility on the Dashboard, not a change to event permissions
    generally (My Events, Event Details editing, etc. are untouched and
    still owner-scoped for Staff). So unlike get_upcoming_events in
    services.py (which still branches on request.user.role), this
    queryset takes no `request`/role at all — every caller of this
    module sees the same org-wide set, same as Communications/Leadership
    already did.
    """
    today = timezone.localdate()
    return Event.objects.select_related("owner").filter(start_date__gte=today)


def apply_upcoming_event_filters(qs, params):
    """Search + filters, spec §4.

    No `program` param: this system has no Program/Project field distinct
    from `category` (see organizational_report.py's own note on this), so
    a Program filter would only duplicate the Category filter. Category
    is the one filter for that column.

    `region` doubles as spec §4's "Region/location" filter — `region` is
    the only location-ish field every other filter in this app (Dashboard,
    Reports, Event list) already filters/groups by; `city` is a separate,
    much less standardized free-text field that isn't used as a filter
    axis anywhere else in the system, so introducing it here would be a
    new, inconsistent axis rather than reuse of an existing one.
    """
    search = params.get("search")
    date_from = params.get("date_from")
    date_to = params.get("date_to")
    category = params.get("category")
    thematic_area = params.get("thematic_area")
    region = params.get("region")
    owner = params.get("owner")
    status = params.get("status")

    if search:
        qs = qs.filter(title__icontains=search)
    if date_from:
        qs = qs.filter(start_date__gte=date_from)
    if date_to:
        qs = qs.filter(start_date__lte=date_to)
    if category:
        # Accepts a comma-separated list, e.g. the Big Events "View All" link.
        qs = qs.filter(category__in=[c for c in category.split(",") if c])
    if thematic_area:
        qs = qs.filter(thematic_area=thematic_area)
    if region:
        qs = with_region_group(qs).filter(region_group=region)
    if owner:
        qs = qs.filter(owner_id=owner)
    if status:
        # `status` is a display status, not the raw stored value.
        qs = filter_events_by_display_status(qs, status)

    # Nearest first; title breaks same-day ties.
    return qs.order_by("start_date", "title")


def serialize_upcoming_event(e):
    return {
        "id": str(e.id),
        "title": e.title,
        "start_date": e.start_date,
        "end_date": e.end_date,
        "category": e.get_category_label(),
        "thematic_area": e.get_thematic_area_label(),
        "region": e.region_group_label,
        "location_label": e.location_label,
        "status": e.get_status_label(),
        "owner_id": str(e.owner_id),
        "owner_name": e.owner.get_full_name() or e.owner.email,
    }


def _label_map(list_type, values):
    """Bulk value->label lookup for one ConfigOption list_type, so an
    aggregate breakdown doesn't call the per-instance get_X_label() (one
    query per distinct value) — falls back to the raw value for anything
    without a matching ConfigOption, same as get_X_label() does.
    """
    values = [v for v in values if v]
    options = ConfigOption.objects.filter(list_type=list_type, value__in=values)
    labels = {opt.value: opt.label for opt in options}
    return {v: labels.get(v, v) for v in values}


def compute_upcoming_events_aggregate(qs):
    """Aggregate view (spec §5): overall count plus breakdowns by
    Category, Thematic Area, and Event Owner/Staff — all computed from
    `qs` (i.e. whatever filters are currently applied), never hardcoded.
    No Program breakdown — see apply_upcoming_event_filters's docstring.
    """
    from apps.configuration.models import ConfigListType

    total = qs.count()

    category_counts = list(qs.values("category").annotate(count=Count("id")).order_by("-count"))
    category_labels = _label_map(ConfigListType.CATEGORY, [c["category"] for c in category_counts])
    by_category = [
        {"label": category_labels.get(c["category"], c["category"]), "count": c["count"]}
        for c in category_counts
    ]

    thematic_counts = list(qs.values("thematic_area").annotate(count=Count("id")).order_by("-count"))
    thematic_labels = _label_map(ConfigListType.THEMATIC_AREA, [t["thematic_area"] for t in thematic_counts])
    by_thematic_area = [
        {"label": thematic_labels.get(t["thematic_area"], t["thematic_area"]), "count": t["count"]}
        for t in thematic_counts
    ]

    owner_counts = list(
        qs.values("owner_id", "owner__first_name", "owner__last_name", "owner__email")
        .annotate(count=Count("id"))
        .order_by("-count")
    )
    by_owner = [
        {
            "label": (f"{o['owner__first_name']} {o['owner__last_name']}".strip() or o["owner__email"]),
            "count": o["count"],
        }
        for o in owner_counts
    ]

    return {
        "total": total,
        "by_category": by_category,
        "by_thematic_area": by_thematic_area,
        "by_owner": by_owner,
    }


def compute_upcoming_event_filter_options(qs):
    """Values to populate the filter dropdowns (Category, Thematic Area,
    Region, Event Owner/Staff, Status) — always drawn from `qs`
    (the full, unfiltered upcoming-events set, as every caller here
    passes it) rather than a hardcoded list, so an option only ever
    appears if some real upcoming event actually has it, and options
    never quietly drift out of sync with what Category/Thematic
    Area/Status actually allow (both are admin-configurable — see
    apps.configuration.ConfigOption).
    """
    from apps.configuration.models import ConfigListType

    categories = sorted({e for e in qs.values_list("category", flat=True).distinct() if e})
    category_labels = _label_map(ConfigListType.CATEGORY, categories)
    thematic_areas = sorted({e for e in qs.values_list("thematic_area", flat=True).distinct() if e})
    thematic_labels = _label_map(ConfigListType.THEMATIC_AREA, thematic_areas)
    regions = sorted({e for e in with_region_group(qs).values_list("region_group", flat=True).distinct() if e})
    # Computed display statuses, since Upcoming/Ongoing/Held share one raw value.
    # select_related(None) because the helper uses .only(), which Django rejects
    # on a queryset that still joins the owner.
    statuses = distinct_display_statuses(qs.select_related(None))
    status_labels = _label_map(ConfigListType.EVENT_STATUS, statuses)

    owners = list(
        qs.values("owner_id", "owner__first_name", "owner__last_name", "owner__email")
        .distinct()
        .order_by("owner__first_name", "owner__last_name")
    )

    return {
        "categories": [{"value": v, "label": category_labels.get(v, v)} for v in categories],
        "thematic_areas": [{"value": v, "label": thematic_labels.get(v, v)} for v in thematic_areas],
        "regions": [{"value": v, "label": v} for v in regions],
        "statuses": [{"value": v, "label": status_labels.get(v, v)} for v in statuses],
        "owners": [
            {
                "value": str(o["owner_id"]),
                "label": f"{o['owner__first_name']} {o['owner__last_name']}".strip() or o["owner__email"],
            }
            for o in owners
        ],
    }
