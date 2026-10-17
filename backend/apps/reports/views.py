from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import ActionType
from apps.audit.utils import log_action
from apps.events.models import Event, EventStatus

from .models import EventPhoto, PostEventReport, ReportStatus
from .serializers import EventPhotoSerializer, PostEventReportCreateSerializer, PostEventReportSerializer

# Submit is rejected unless the report has between 4 and 5 photos.
MIN_SUBMIT_PHOTOS = 4
MAX_SUBMIT_PHOTOS = 5


def _get_owned_event(request, event_id):
    event = get_object_or_404(Event, pk=event_id)
    if not request.user.is_staff_role or event.owner_id != request.user.id:
        raise PermissionDenied("Only the event owner may manage its Event Status Report.")
    return event


class PostEventReportCreateView(generics.GenericAPIView):
    """FR29-FR31: create (Save, as a draft) or retrieve the Post-Event
    Report for a specific event. FR29 requires the event date to have
    passed before a report can be logged at all.
    """

    serializer_class = PostEventReportCreateSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event = get_object_or_404(Event, pk=event_id)
        if request.user.is_staff_role and event.owner_id != request.user.id:
            raise PermissionDenied("You may only view Event Status Reports for events you own.")
        if not event.has_post_event_report:
            return Response({"detail": "No Event Status Report exists for this event."}, status=status.HTTP_404_NOT_FOUND)
        return Response(PostEventReportSerializer(event.post_event_report, context={"request": request}).data)

    def post(self, request, event_id):
        event = _get_owned_event(request, event_id)

        if event.has_post_event_report:
            raise ValidationError({"event": "A Event Status Report already exists for this event."})
        if event.end_date > timezone.localdate():
            raise ValidationError({"event": "A Event Status Report can only be submitted after the event date."})

        serializer = self.get_serializer(data=request.data, context={"event": event, "request": request})
        serializer.is_valid(raise_exception=True)
        report = serializer.save()

        log_action(
            ActionType.CREATED,
            report,
            user=request.user,
            description=f"Event Status Report draft started for '{event.title}'.",
        )
        return Response(
            PostEventReportSerializer(report, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class PostEventReportUpdateView(generics.UpdateAPIView):
    """Updates a Event Status Report while it is still a Draft (Save button,
    UI/UX Section 12). Once submitted, FR34 makes the report immutable.
    """

    serializer_class = PostEventReportCreateSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = PostEventReport.objects.select_related("event")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["event"] = self.get_object().event
        return context

    def perform_update(self, serializer):
        report = self.get_object()
        if report.event.owner_id != self.request.user.id:
            raise PermissionDenied("Only the event owner may edit this Event Status Report.")
        if report.status == ReportStatus.SUBMITTED:
            raise PermissionDenied("This Event Status Report has already been submitted and cannot be edited.")
        serializer.save()

    def update(self, request, *args, **kwargs):
        # Answer with the full report (id, status, photos...) like the create
        # endpoint, since the form keeps using it for the photo and submit calls.
        super().update(request, *args, **kwargs)
        return Response(PostEventReportSerializer(self.get_object(), context={"request": request}).data)


class PostEventReportSubmitView(APIView):
    """Submit button (UI/UX Section 12): finalizes the report. FR33 sets
    the event status to Completed; FR34 makes this a one-time action.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        report = get_object_or_404(PostEventReport.objects.select_related("event"), pk=pk)

        if report.event.owner_id != request.user.id:
            raise PermissionDenied("Only the event owner may submit this Event Status Report.")
        if report.status == ReportStatus.SUBMITTED:
            raise ValidationError({"detail": "This Event Status Report has already been submitted."})

        # Completeness is enforced at final Submit; drafts may be incomplete.
        errors = {}
        if not report.major_accomplishment.strip():
            errors["major_accomplishment"] = "Event Overview is required before submitting."
        if not report.best_practices_lessons_actions.strip():
            errors["best_practices_lessons_actions"] = "Key Learnings & Action Points is required before submitting."
        # Partnership opportunities and Challenges Faced are optional. Participation
        # is required only when EE leads the event (see Event.ee_leads).
        if report.event.ee_leads:
            if report.participants_male is None or report.participants_female is None:
                errors["participants_male"] = "Total participants (Male/Female) is required before submitting."
            else:
                # The organization breakdown must add up to the total, which is
                # Male + Female (see the model property).
                org_sum = sum(count for _, count in report.participants_by_organization)
                if org_sum != report.participants_total:
                    errors["participants_by_organization"] = (
                        f"Breakdown by organization must add up to Total Participants "
                        f"({report.participants_total}). It currently adds up to {org_sum}."
                    )
        photo_count = report.photos.count()
        if photo_count < MIN_SUBMIT_PHOTOS or photo_count > MAX_SUBMIT_PHOTOS:
            errors["photos"] = f"Attach between {MIN_SUBMIT_PHOTOS} and {MAX_SUBMIT_PHOTOS} photos before submitting (currently {photo_count})."
        if errors:
            raise ValidationError(errors)

        report.status = ReportStatus.SUBMITTED
        report.submitted_by = request.user
        report.submitted_at = timezone.now()
        report.save(update_fields=["status", "submitted_by", "submitted_at", "updated_at"])

        report.event.status = EventStatus.COMPLETED
        report.event.report_overdue_notified_at = None
        report.event.save(update_fields=["status", "report_overdue_notified_at", "updated_at"])

        log_action(
            ActionType.SUBMITTED,
            report,
            user=request.user,
            description=f"Event Status Report submitted for '{report.event.title}'.",
        )

        return Response(PostEventReportSerializer(report, context={"request": request}).data)


class EventPhotoUploadView(generics.CreateAPIView):
    """FR30/FR45: upload a photo to a Event Status Report, capped at the
    admin-configured limit (Configuration > System Settings).
    """

    serializer_class = EventPhotoSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_report(self):
        report = get_object_or_404(PostEventReport.objects.select_related("event"), pk=self.kwargs["report_id"])
        if report.event.owner_id != self.request.user.id:
            raise PermissionDenied("Only the event owner may upload photos to this report.")
        if report.status == ReportStatus.SUBMITTED:
            raise PermissionDenied("This Event Status Report has already been submitted.")
        return report

    def perform_create(self, serializer):
        report = self.get_report()
        from apps.configuration.models import SystemSettings

        max_photos = SystemSettings.get_settings().max_photos_per_report
        if report.photos.count() >= max_photos:
            raise ValidationError({"image": f"Maximum of {max_photos} photos per event."})
        serializer.save(post_event_report=report)


class EventPhotoDeleteView(generics.DestroyAPIView):
    """Allows the owner to remove a photo before final submission."""

    permission_classes = [permissions.IsAuthenticated]
    queryset = EventPhoto.objects.select_related("post_event_report__event")

    def perform_destroy(self, instance):
        report = instance.post_event_report
        if report.event.owner_id != self.request.user.id:
            raise PermissionDenied("Only the event owner may remove photos from this report.")
        if report.status == ReportStatus.SUBMITTED:
            raise PermissionDenied("This Event Status Report has already been submitted.")
        instance.delete()
