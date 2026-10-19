from django.http import FileResponse
from django.utils import timezone
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import ActionType, ObjectType
from apps.audit.utils import log_action
from apps.communications.attachments import clean_filename
from apps.events.models import Event

from .services.docx_generator import (
    generate_generic_report_docx,
    generate_single_event_docx,
    generate_thematic_area_report_docx,
)
from .services.excel_generator import (
    generate_generic_report_excel,
    generate_single_event_excel,
    generate_thematic_area_report_excel,
)
from .services.pdf_generator import (
    generate_generic_report_pdf,
    generate_single_event_pdf,
    generate_thematic_area_report_pdf,
)
from .services.report_data import get_report_queryset, get_report_summary_stats, group_events_by_thematic_area

VALID_PERIODS = {"weekly", "monthly", "quarterly", "yearly"}
VALID_FORMATS = {"pdf", "excel", "docx"}  # Item #5: added Word export


def _safe_report_filename(title, ext):
    """Download name for a generated single-event export.

    Event titles are free text a user controls. A title carrying \\r\\n
    (or other control characters) used to end up verbatim inside the
    Content-Disposition header — Django responds with a BadHeaderError
    500, and a crafted title can smuggle extra header lines into the
    download. Strip them the same way the support-message attachments
    pipeline does (finding: header injection via export filename).
    """
    return clean_filename(f"{title.replace(' ', '_')}.{ext}")
VALID_SCOPES = {"generic", "thematic_area", "single_event"}


def _get_visible_event(request, event_id, own_only=True):
    """Report Scope = Single Event: Staff may only pull their own event;
    Communications/Leadership may pull any (consistent with their
    read-only access to all events elsewhere in the system). The Event Details
    PDF passes own_only=False since any event can be opened read-only.
    """
    from django.core.exceptions import ValidationError as DjangoValidationError
    from django.http import Http404

    try:
        event = Event.objects.select_related("owner").get(pk=event_id)
    except (Event.DoesNotExist, ValueError, TypeError, DjangoValidationError) as exc:
        # A specific message distinguishes a missing event ID from a routing 404.
        raise Http404(f"No event found with id={event_id!r}.") from exc
    if own_only and request.user.is_staff_role and event.owner_id != request.user.id:
        raise PermissionDenied("You may only generate reports for events you own.")
    return event


def _resolve_scope_and_period(request):
    """Validates and resolves the Scope/Period combination:
    - Generic or Thematic Area scope: a Period is required (FR41).
    - Single Event scope: Period does not apply and is ignored even if
      supplied, since the report pulls one event's full record rather
      than a date range.
    """
    scope = request.query_params.get("scope", "generic")
    if scope not in VALID_SCOPES:
        raise ValidationError({"scope": "Must be one of generic, thematic_area, single_event."})

    if scope == "single_event":
        event_id = request.query_params.get("event_id")
        if not event_id:
            raise ValidationError({"event_id": "Required when scope is single_event."})
        return scope, None, event_id

    period = request.query_params.get("period", "monthly")
    if period not in VALID_PERIODS:
        raise ValidationError({"period": "Must be one of weekly, monthly, quarterly."})
    return scope, period, None


class ReportPreviewView(APIView):
    """Optional preview before download (UI/UX Section 13): returns the
    filtered/grouped event list as JSON so the frontend can render a
    summary before the person commits to generating a PDF/Excel file.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        scope, period, event_id = _resolve_scope_and_period(request)

        if scope == "single_event":
            event = _get_visible_event(request, event_id)
            # Full EventDetailSerializer so the preview has every field the
            # PDF/Word generators use.
            from apps.events.serializers import EventDetailSerializer

            return Response({
                "scope": scope,
                "event": EventDetailSerializer(event, context={"request": request}).data,
                "generated_at": timezone.now().date().isoformat(),
            })

        category = request.query_params.get("category")
        region = request.query_params.get("region")
        thematic_area = request.query_params.get("thematic_area")
        communication_support = request.query_params.get("communication_support")
        event_type = request.query_params.get("event_type")
        mode_of_event = request.query_params.get("mode_of_event")
        status_filter = request.query_params.get("status")
        quarter = request.query_params.get("quarter")
        year = request.query_params.get("year")
        month = request.query_params.get("month")
        week = request.query_params.get("week")

        events, start, end = get_report_queryset(
            period=period, category=category, region=region, thematic_area=thematic_area,
            communication_support=communication_support,
            event_type=event_type, mode_of_event=mode_of_event, status=status_filter,
            quarter=int(quarter) if quarter else None,
            year=int(year) if year else None,
            month=int(month) if month else None,
            week=int(week) if week else None,
        )
        summary_stats = get_report_summary_stats(events)

        # Same per-event serializer as the Single Event preview; the generators
        # render the full event template for each matching event.
        from apps.events.serializers import EventDetailSerializer

        def _serialize(e):
            return EventDetailSerializer(e, context={"request": request}).data

        if scope == "thematic_area":
            grouped = group_events_by_thematic_area(events)
            payload = {area: [_serialize(e) for e in evts] for area, evts in grouped.items()}
            return Response({
                "scope": scope, "period": period, "start_date": start, "end_date": end,
                "count": len(events), "summary_stats": summary_stats, "thematic_areas": payload,
            })

        data = [_serialize(e) for e in events]
        return Response({
            "scope": scope, "period": period, "start_date": start, "end_date": end,
            "count": len(data), "summary_stats": summary_stats, "events": data,
        })


class ReportGenerateView(APIView):
    """Stage 6 (FR40-FR43): generates the downloadable PDF or Excel report.

    Scope (Generic / Thematic Area / Single Event) and Period (Weekly /
    Monthly / Quarterly) are independent, combinable filters, except that
    Period does not apply to the Single Event scope (per product decision).
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        scope, period, event_id = _resolve_scope_and_period(request)
        # Not `format`: DRF reserves ?format= for renderer suffixes and 404s on
        # values like "pdf".
        file_format = request.query_params.get("file_format", "pdf")
        if file_format not in VALID_FORMATS:
            raise ValidationError({"file_format": "Must be one of pdf, excel, docx."})

        if scope == "single_event":
            return self._generate_single_event(request, event_id, file_format)

        category = request.query_params.get("category")
        region = request.query_params.get("region")
        thematic_area = request.query_params.get("thematic_area")
        communication_support = request.query_params.get("communication_support")
        event_type = request.query_params.get("event_type")
        mode_of_event = request.query_params.get("mode_of_event")
        status_filter = request.query_params.get("status")
        quarter = request.query_params.get("quarter")
        year = request.query_params.get("year")
        month = request.query_params.get("month")
        week = request.query_params.get("week")

        events, start, end = get_report_queryset(
            period=period, category=category, region=region, thematic_area=thematic_area,
            communication_support=communication_support,
            event_type=event_type, mode_of_event=mode_of_event, status=status_filter,
            quarter=int(quarter) if quarter else None,
            year=int(year) if year else None,
            month=int(month) if month else None,
            week=int(week) if week else None,
        )
        events = list(events)
        if not events:
            # Fail clearly instead of generating an empty file.
            raise ValidationError({"detail": "No records found for the selected filters."})
        period_label = period.capitalize()

        log_action(
            ActionType.REPORT_GENERATED,
            f"{scope}-{period}-{file_format}-{start}-{end}",
            user=request.user,
            description=f"Generated {period_label} {file_format.upper()} report, scope={scope} ({start} to {end}).",
            metadata={
                "scope": scope, "category": category, "region": region, "thematic_area": thematic_area,
                "event_type": event_type, "mode_of_event": mode_of_event, "status": status_filter,
            },
            object_type=ObjectType.REPORT,
        )

        if scope == "thematic_area":
            grouped = group_events_by_thematic_area(events)
            if file_format == "pdf":
                buffer = generate_thematic_area_report_pdf(grouped, start, end, period_label, request.user)
                filename = f"EMS_{period}_by_thematic_area_{start}_{end}.pdf"
                content_type = "application/pdf"
            elif file_format == "docx":
                buffer = generate_thematic_area_report_docx(grouped, start, end, period_label, request.user)
                filename = f"EMS_{period}_by_thematic_area_{start}_{end}.docx"
                content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            else:
                buffer = generate_thematic_area_report_excel(grouped, start, end, period_label, request.user)
                filename = f"EMS_{period}_by_thematic_area_{start}_{end}.xlsx"
                content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        else:  # generic
            if file_format == "pdf":
                buffer = generate_generic_report_pdf(events, start, end, period_label, request.user)
                filename = f"EMS_{period}_report_{start}_{end}.pdf"
                content_type = "application/pdf"
            elif file_format == "docx":
                buffer = generate_generic_report_docx(events, start, end, period_label, request.user)
                filename = f"EMS_{period}_report_{start}_{end}.docx"
                content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            else:
                buffer = generate_generic_report_excel(events, start, end, period_label, request.user)
                filename = f"EMS_{period}_report_{start}_{end}.xlsx"
                content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

        return FileResponse(buffer, as_attachment=True, filename=filename, content_type=content_type)

    def _generate_single_event(self, request, event_id, file_format):
        event = _get_visible_event(request, event_id)

        log_action(
            ActionType.REPORT_GENERATED,
            str(event.id),
            user=request.user,
            description=f"Generated Single Event {file_format.upper()} report for '{event.title}'.",
            metadata={"scope": "single_event"},
            object_type=ObjectType.REPORT,
        )

        if file_format == "pdf":
            buffer = generate_single_event_pdf(event, request.user)
            filename = _safe_report_filename(event.title, "pdf")
            content_type = "application/pdf"
        elif file_format == "docx":
            buffer = generate_single_event_docx(event, request.user)
            filename = _safe_report_filename(event.title, "docx")
            content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        else:
            buffer = generate_single_event_excel(event, request.user)
            filename = _safe_report_filename(event.title, "xlsx")
            content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

        return FileResponse(buffer, as_attachment=True, filename=filename, content_type=content_type)


class EventPdfView(APIView):
    """Generate PDF button on Event Details (UI/UX Section 11) — a fixed
    one-click PDF export, distinct from the Reports page's Single Event
    scope (which also offers Excel and lives in the Reports UI instead).
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event = _get_visible_event(request, event_id, own_only=False)
        buffer = generate_single_event_pdf(event, request.user)
        filename = _safe_report_filename(event.title, "pdf")
        return FileResponse(buffer, as_attachment=True, filename=filename, content_type="application/pdf")
