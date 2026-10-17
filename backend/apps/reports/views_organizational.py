from django.utils import timezone
from rest_framework import permissions
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role

from .services.annual_event_report import build_annual_event_report
from .services.event_activity_report import EXPORT_HEADERS as EVENT_ACTIVITY_EXPORT_HEADERS
from .services.event_activity_report import build_event_activity_report
from .services.organizational_report import build_organizational_performance_report
from .services.partner_engagement_report import EXPORT_HEADERS as PARTNER_EXPORT_HEADERS
from .services.partner_engagement_report import build_partner_engagement_report
from .services.report_data import get_report_queryset
from .services.report_export import VALID_EXPORT_FORMATS, build_export_response

VALID_PERIODS = {"weekly", "monthly", "quarterly", "yearly", "custom"}


def _export_format_param(request):
    """Spec §32: PDF/Excel/CSV export, respecting current filters and
    permissions. CSV is handled entirely client-side (the frontend
    already has the full filtered row set from this same JSON response —
    see utils/reportExport.js) so only xlsx/pdf need a dedicated
    server-side param here. Named `export_format`, not `format`, for the
    same reason the older Stage 6 generator uses `file_format`: DRF's
    content-negotiation reserves `?format=` for its own json/browsable-
    api suffix feature and silently 404s on an unrecognized value.
    """
    value = request.query_params.get("export_format") or None
    if value and value not in VALID_EXPORT_FORMATS:
        raise ValidationError({"export_format": f"Must be one of {sorted(VALID_EXPORT_FORMATS)}."})
    return value


class CanAccessManagementReport(permissions.BasePermission):
    """EMS Reporting System spec v2 (role-based nav) said Management
    Report was Leadership/Admin only. The follow-up "Complete Development
    + UI/UX Spec" (§1) supersedes that: "Communication should have the
    same report structure as Lead, because Communication needs visibility
    into the events and organizational activities that their
    communication work supports." Staff stays out per that same spec's
    role table (Management Report: Staff = "Permission" — no general
    permission-grant system exists yet to hang that on, so Staff is
    excluded by default here rather than left in on a technicality)."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.has_role("leadership", "admin", "communications")
        )


class OrganizationalPerformanceReportView(APIView):
    """Reports Module Enhancement spec, phase 1 — see
    services/organizational_report.py's module docstring for exactly
    which sections are built and which are deliberately deferred.

    Access: Leadership/Admin/Communication (CanAccessManagementReport) —
    this backs the Management Report. See that permission class for why
    Communication is included and Staff isn't.

    All three roles see the full org-wide report, unscoped. The old
    `is_staff_role`-based "scope to owned events" branch used to apply to
    Admin too (is_staff_role is True for Admin, by design, for its
    day-to-day Staff-level permissions elsewhere in the app) — but the
    spec's Admin is meant to see the same organization-wide Management
    Report as everyone else with access to it, not one silently narrowed
    to events Admin personally owns, so that scoping was removed rather
    than carried forward.
    """

    permission_classes = [permissions.IsAuthenticated, CanAccessManagementReport]

    def get(self, request):
        period = request.query_params.get("period") or None
        if period and period not in VALID_PERIODS:
            raise ValidationError({"period": f"Must be one of {sorted(VALID_PERIODS)}."})

        date_from = request.query_params.get("date_from") or None
        date_to = request.query_params.get("date_to") or None
        if period == "custom" and not (date_from and date_to):
            raise ValidationError({"date_from": "date_from and date_to are both required when period is custom."})

        def _int_param(name):
            value = request.query_params.get(name)
            return int(value) if value not in (None, "") else None

        def _param(name):
            return request.query_params.get(name) or None

        events_qs, start, end = get_report_queryset(
            period=period,
            category=_param("category"),
            region=_param("region"),
            thematic_area=_param("thematic_area"),
            event_type=_param("event_type"),
            mode_of_event=_param("mode_of_event"),
            status=_param("status"),
            organization=_param("organization"),
            support_level=_param("support_level"),
            communication_support=_param("communication_support"),
            date_from=date_from,
            date_to=date_to,
            quarter=_int_param("quarter"),
            year=_int_param("year"),
            month=_int_param("month"),
            week=_int_param("week"),
        )

        period_label = None
        if period and start and end:
            period_label = f"{period.capitalize()} ({start.isoformat()} to {end.isoformat()})"

        payload = build_organizational_performance_report(events_qs, period_label=period_label)
        payload["applied_filters"] = {
            "period": period,
            "date_from": start,
            "date_to": end,
            "category": _param("category"),
            "region": _param("region"),
            "thematic_area": _param("thematic_area"),
            "event_type": _param("event_type"),
            "mode_of_event": _param("mode_of_event"),
            "status": _param("status"),
            "organization": _param("organization"),
            "support_level": _param("support_level"),
            "communication_support": _param("communication_support"),
        }

        export_format = _export_format_param(request)
        if export_format:
            # Only the Event Summary table is row-per-event and exportable.
            return build_export_response(
                export_format,
                "Management_Report_Event_Summary",
                "Management Report - Event Summary",
                EVENT_ACTIVITY_EXPORT_HEADERS,
                payload["event_activity"],
            )
        return Response(payload)


class EventActivityReportView(APIView):
    """Report 2 of the Reports Module spec (§14). Spec §2's role table
    grants this to all four roles, with Staff marked ✓* — "access depends
    on assigned permissions and data scope." No general permission-grant
    system exists yet to hang the "permissions" half on, so this view
    implements only the "data scope" half: Staff sees only events they
    personally own, the exact same restriction Staff already has on
    Events/My Events (see EventViewSet.get_queryset) — not a new, separate
    rule invented for this report.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        period = request.query_params.get("period") or None
        if period and period not in VALID_PERIODS:
            raise ValidationError({"period": f"Must be one of {sorted(VALID_PERIODS)}."})

        date_from = request.query_params.get("date_from") or None
        date_to = request.query_params.get("date_to") or None
        if period == "custom" and not (date_from and date_to):
            raise ValidationError({"date_from": "date_from and date_to are both required when period is custom."})

        def _int_param(name):
            value = request.query_params.get(name)
            return int(value) if value not in (None, "") else None

        def _param(name):
            return request.query_params.get(name) or None

        events_qs, start, end = get_report_queryset(
            period=period,
            category=_param("category"),
            region=_param("region"),
            event_type=_param("event_type"),
            status=_param("status"),
            support_level=_param("support_level"),
            responsible_person=_param("responsible_person"),
            organization=_param("organization"),
            date_from=date_from,
            date_to=date_to,
            quarter=_int_param("quarter"),
            year=_int_param("year"),
            month=_int_param("month"),
            week=_int_param("week"),
        )

        if request.user.is_staff_only:
            events_qs = events_qs.filter(owner=request.user)

        payload = build_event_activity_report(events_qs)
        period_label = None
        if period and start and end:
            period_label = f"{period.capitalize()} ({start.isoformat()} to {end.isoformat()})"
        payload["applied_filters"] = {
            "period": period,
            "period_label": period_label,
            "date_from": start,
            "date_to": end,
            "category": _param("category"),
            "region": _param("region"),
            "event_type": _param("event_type"),
            "status": _param("status"),
            "support_level": _param("support_level"),
            "responsible_person": _param("responsible_person"),
            # Lets a Partner Engagement row drill down to one organization.
            "organization": _param("organization"),
        }

        export_format = _export_format_param(request)
        if export_format:
            return build_export_response(
                export_format,
                "Event_Activity_Report",
                "Event Activity Report",
                EVENT_ACTIVITY_EXPORT_HEADERS,
                payload["rows"],
            )
        return Response(payload)


class PartnerEngagementReportView(APIView):
    """Report 4 of the Reports Module spec (§17). Access: spec §2's role
    table marks this ✓ for Communication/Lead/Admin and "Permission" for
    Staff — same grant as the Management Report, so this reuses
    CanAccessManagementReport rather than a near-identical copy of it.
    """

    permission_classes = [permissions.IsAuthenticated, CanAccessManagementReport]

    def get(self, request):
        period = request.query_params.get("period") or None
        if period and period not in VALID_PERIODS:
            raise ValidationError({"period": f"Must be one of {sorted(VALID_PERIODS)}."})

        date_from = request.query_params.get("date_from") or None
        date_to = request.query_params.get("date_to") or None
        if period == "custom" and not (date_from and date_to):
            raise ValidationError({"date_from": "date_from and date_to are both required when period is custom."})

        def _int_param(name):
            value = request.query_params.get(name)
            return int(value) if value not in (None, "") else None

        def _param(name):
            return request.query_params.get(name) or None

        events_qs, start, end = get_report_queryset(
            period=period,
            category=_param("category"),
            region=_param("region"),
            organization=_param("organization"),
            date_from=date_from,
            date_to=date_to,
            quarter=_int_param("quarter"),
            year=_int_param("year"),
            month=_int_param("month"),
            week=_int_param("week"),
        )

        payload = build_partner_engagement_report(events_qs)
        period_label = None
        if period and start and end:
            period_label = f"{period.capitalize()} ({start.isoformat()} to {end.isoformat()})"
        payload["applied_filters"] = {
            "period": period,
            "period_label": period_label,
            "date_from": start,
            "date_to": end,
            "category": _param("category"),
            "region": _param("region"),
            "organization": _param("organization"),
        }

        export_format = _export_format_param(request)
        if export_format:
            # Join list fields to strings here; the JSON endpoint keeps them as lists.
            export_rows = [
                {**row, "programs_display": ", ".join(row["programs"]), "locations_display": ", ".join(row["locations"])}
                for row in payload["rows"]
            ]
            return build_export_response(
                export_format, "Partner_Engagement_Report", "Partner Engagement Report", PARTNER_EXPORT_HEADERS, export_rows
            )
        return Response(payload)


class AnnualEventReportView(APIView):
    """Report 5 of the Reports Module spec (§18) — full-year
    organizational summary, distinct from the Management Report's own
    (selectable-period) view. Access: spec §2's role table marks this
    the same as Management/Partner Engagement ("Permission" for Staff),
    so it reuses CanAccessManagementReport.

    The only filter is Reporting Year (spec §18's "Year Selector") —
    unlike every other report here, §18 doesn't list Program/Region/
    Status/etc. as filters of this report's own, so none are accepted.
    """

    permission_classes = [permissions.IsAuthenticated, CanAccessManagementReport]

    def get(self, request):
        year_param = request.query_params.get("year")
        if year_param:
            try:
                year = int(year_param)
            except ValueError:
                raise ValidationError({"year": "Must be a whole number, e.g. 2026."})
        else:
            year = timezone.localdate().year

        events_qs, _start, _end = get_report_queryset(period="yearly", year=year)

        payload = build_annual_event_report(events_qs, year)
        payload["applied_filters"] = {"year": year}

        export_format = _export_format_param(request)
        if export_format:
            # Only the row-per-event table is exportable.
            return build_export_response(
                export_format,
                f"Annual_Event_Report_{year}",
                f"Annual Event Report - {year}",
                EVENT_ACTIVITY_EXPORT_HEADERS,
                payload["event_rows"],
            )
        return Response(payload)
