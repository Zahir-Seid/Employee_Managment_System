from django.urls import path

from .views import ActiveConfigOptionsView, ConfigOptionDetailView, ConfigOptionListCreateView, SystemSettingsView

app_name = "configuration"

urlpatterns = [
    path("config-options/active/", ActiveConfigOptionsView.as_view(), name="config-options-active"),
    path("config-options/", ConfigOptionListCreateView.as_view(), name="config-options-list"),
    path("config-options/<uuid:pk>/", ConfigOptionDetailView.as_view(), name="config-options-detail"),
    path("system-settings/", SystemSettingsView.as_view(), name="system-settings"),
]
