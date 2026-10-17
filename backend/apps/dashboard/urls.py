from django.urls import path

from .views import (
    BigEventsView,
    DashboardView,
    OverdueAlertsView,
    UpcomingEventsAggregateView,
    UpcomingEventsFilterOptionsView,
    UpcomingEventsListView,
)

app_name = "dashboard"

urlpatterns = [
    path("", DashboardView.as_view(), name="dashboard"),
    path("overdue-alerts/", OverdueAlertsView.as_view(), name="overdue-alerts"),
    # Big Events section — International/National events, Upcoming or
    # Ongoing only (see apps/dashboard/big_events.py).
    path("big-events/", BigEventsView.as_view(), name="big-events"),
    # Dashboard Upcoming Events Enhancement — backs the Dashboard card and
    # its "View All" full page (see apps/dashboard/upcoming_events.py).
    path("upcoming-events/", UpcomingEventsListView.as_view(), name="upcoming-events-list"),
    path("upcoming-events/aggregate/", UpcomingEventsAggregateView.as_view(), name="upcoming-events-aggregate"),
    path(
        "upcoming-events/filter-options/",
        UpcomingEventsFilterOptionsView.as_view(),
        name="upcoming-events-filter-options",
    ),
]
