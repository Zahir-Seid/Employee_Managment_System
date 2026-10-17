from rest_framework import permissions
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role

from .services.communications_report import EXPORT_HEADERS, build_communications_report, get_communications_queryset
from .services.report_export import VALID_EXPORT_FORMATS, build_export_response
from .views_organizational import VALID_PERIODS

VALID_STATUSES = {"completed", "pending", "overdue"}


class CommunicationsReportView(APIView):
    """Report 3 of the Reports Module spec (§15/§16) — see
    services/communications_report.py's module docstring for what's
    computed and what the current schema can't support.

    Access: spec §2's role table marks this ✓ for Communication/Lead/
    Admin and "Relevant" for Staff. As with the Event Activity Report,
    there's no general permission-grant system to hang a narrower
    "relevant" scope on beyond data — so Staff gets the same "own events
    only" scope used everywhere else Staff-visibility is data-scoped
    (Events/My Events, Event Activity Report), which in practice *is*
    "the communication activity relevant to them": the tasks tied to
    events they logged.
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

        def _param(name):
            return request.query_params.get(name) or None

        def _int_param(name):
            value = request.query_params.get(name)
            return int(value) if value not in (None, "") else None

        status_filter = _param("status")
        if status_filter and status_filter not in VALID_STATUSES:
            raise ValidationError({"status": f"Must be one of {sorted(VALID_STATUSES)}."})

        export_format = _param("export_format")
        if export_format and export_format not in VALID_EXPORT_FORMATS:
            raise ValidationError({"export_format": f"Must be one of {sorted(VALID_EXPORT_FORMATS)}."})

        todos_qs, start, end = get_communications_queryset(
            event_title=_param("event"),
            support_type=_param("support_type"),
            responsible_person=_param("responsible_person"),
            period=period,
            category=_param("category"),
            region=_param("region"),
            event_type=_param("event_type"),
            support_level=_param("support_level"),
            organization=_param("organization"),
            date_from=date_from,
            date_to=date_to,
            quarter=_int_param("quarter"),
            year=_int_param("year"),
            month=_int_param("month"),
            week=_int_param("week"),
        )

        if request.user.is_staff_only:
            todos_qs = todos_qs.filter(support_request__event__owner=request.user)

        payload = build_communications_report(todos_qs, status_filter=status_filter)
        period_label = None
        if period and start and end:
            period_label = f"{period.capitalize()} ({start.isoformat()} to {end.isoformat()})"
        payload["applied_filters"] = {
            "period": period,
            "period_label": period_label,
            "date_from": start,
            "date_to": end,
            "event": _param("event"),
            "category": _param("category"),
            "region": _param("region"),
            "event_type": _param("event_type"),
            "support_level": _param("support_level"),
            "organization": _param("organization"),
            "support_type": _param("support_type"),
            "status": status_filter,
            "responsible_person": _param("responsible_person"),
        }

        if export_format:
            # "Responsible" isn't a field on the row dict (see
            # services/communications_report.py's EXPORT_HEADERS comment)
            # — computed here with the same completed_by-or-requested_by
            # fallback CommunicationsReport.jsx's own render function uses,
            # so the exported file and the on-screen table never disagree.
            export_rows = [
                {**row, "responsible": row.get("completed_by") or row.get("requested_by") or ""}
                for row in payload["rows"]
            ]
            return build_export_response(
                export_format, "Communications_Report", "Communications Report", EXPORT_HEADERS, export_rows
            )
        return Response(payload)
