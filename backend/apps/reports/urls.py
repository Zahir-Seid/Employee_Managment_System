from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    EventPhotoDeleteView,
    EventPhotoUploadView,
    PostEventReportCreateView,
    PostEventReportSubmitView,
    PostEventReportUpdateView,
)
from .views_communications_report import CommunicationsReportView
from .views_generation import EventPdfView, ReportGenerateView, ReportPreviewView
from .views_organizational import (
    AnnualEventReportView,
    EventActivityReportView,
    OrganizationalPerformanceReportView,
    PartnerEngagementReportView,
)
from .views_saved_reports import SavedReportViewSet

app_name = "reports"

router = DefaultRouter()
router.register(r"reports/saved-reports", SavedReportViewSet, basename="saved-report")

urlpatterns = [
    # Event Status Report lifecycle
    path("events/<uuid:event_id>/post-event-report/", PostEventReportCreateView.as_view(), name="report-create"),
    path("post-event-reports/<uuid:pk>/", PostEventReportUpdateView.as_view(), name="report-update"),
    path("post-event-reports/<uuid:pk>/submit/", PostEventReportSubmitView.as_view(), name="report-submit"),
    path("post-event-reports/<uuid:report_id>/photos/", EventPhotoUploadView.as_view(), name="report-photo-upload"),
    path("post-event-reports/photos/<uuid:pk>/", EventPhotoDeleteView.as_view(), name="report-photo-delete"),

    # Report generation
    path("reports/preview/", ReportPreviewView.as_view(), name="report-preview"),
    path("reports/generate/", ReportGenerateView.as_view(), name="report-generate"),
    path("events/<uuid:event_id>/pdf/", EventPdfView.as_view(), name="event-pdf"),

    # Organizational Performance Report
    path(
        "reports/organizational-performance/",
        OrganizationalPerformanceReportView.as_view(),
        name="organizational-performance-report",
    ),

    # Event Activity Report
    path(
        "reports/event-activity/",
        EventActivityReportView.as_view(),
        name="event-activity-report",
    ),

    # Communications Report
    path(
        "reports/communications/",
        CommunicationsReportView.as_view(),
        name="communications-report",
    ),

    # Partner Engagement Report
    path(
        "reports/partner-engagement/",
        PartnerEngagementReportView.as_view(),
        name="partner-engagement-report",
    ),

    # Annual Event Report
    path(
        "reports/annual/",
        AnnualEventReportView.as_view(),
        name="annual-event-report",
    ),
] + router.urls
