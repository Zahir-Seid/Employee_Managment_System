from django.urls import path

from .views import (
    HomeContentDetailView,
    HomeContentListCreateView,
    HomeFeedView,
    LinkableEventsView,
    SiteSettingsView,
)

urlpatterns = [
    path("home/feed/", HomeFeedView.as_view(), name="home-feed"),
    path("home/content/", HomeContentListCreateView.as_view(), name="home-content-list"),
    path("home/content/<uuid:pk>/", HomeContentDetailView.as_view(), name="home-content-detail"),
    path("home/site-settings/", SiteSettingsView.as_view(), name="home-site-settings"),
    path("home/linkable-events/", LinkableEventsView.as_view(), name="home-linkable-events"),
]
