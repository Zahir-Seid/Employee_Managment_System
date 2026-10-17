from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AdminEventDetailView,
    AdminEventListCreateView,
    AdminEventStatusActionView,
    EventHistoryView,
    EventStatusActionView,
    EventViewSet,
)

router = DefaultRouter()
router.register(r"", EventViewSet, basename="event")

urlpatterns = [
    path("<uuid:pk>/status-action/", EventStatusActionView.as_view(), name="event-status-action"),
    path("<uuid:pk>/history/", EventHistoryView.as_view(), name="event-history"),
    # Item 7.4 (Admin Page > Events) — placed before the router below so
    # these exact-literal "admin/..." paths are matched first, rather
    # than falling into the router's `<pk>` pattern.
    path("admin/", AdminEventListCreateView.as_view(), name="admin-event-list"),
    path("admin/<uuid:pk>/", AdminEventDetailView.as_view(), name="admin-event-detail"),
    path("admin/<uuid:pk>/status-action/", AdminEventStatusActionView.as_view(), name="admin-event-status-action"),
] + router.urls
