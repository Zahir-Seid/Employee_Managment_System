from django.urls import path

from .views import (
    TVDisplayCustomSectionCreateView,
    TVDisplayCustomSectionDetailView,
    TVDisplaySettingsView,
    TVDisplaySlideDetailView,
    TVDisplaySlideListCreateView,
)

app_name = "tv_display"

urlpatterns = [
    path("settings/", TVDisplaySettingsView.as_view(), name="tv-display-settings"),
    path("slides/", TVDisplaySlideListCreateView.as_view(), name="tv-display-slide-list"),
    path("slides/<int:pk>/", TVDisplaySlideDetailView.as_view(), name="tv-display-slide-detail"),
    path("custom-sections/", TVDisplayCustomSectionCreateView.as_view(), name="tv-display-custom-section-create"),
    path(
        "custom-sections/<str:key>/",
        TVDisplayCustomSectionDetailView.as_view(),
        name="tv-display-custom-section-detail",
    ),
]
