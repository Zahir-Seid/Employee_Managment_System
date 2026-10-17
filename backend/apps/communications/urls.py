from django.urls import path

from .views import (
    AdminSupportRequestDetailView,
    AdminSupportRequestListCreateView,
    CalendarNoteDetailView,
    CalendarNoteListCreateView,
    CalendarView,
    CommsOverviewView,
    CommunicationsTeamListView,
    PostponedCancelledEventsView,
    SupportRequestAssignmentHistoryView,
    SupportRequestAttachmentDownloadView,
    SupportRequestAssignView,
    SupportRequestCreateView,
    SupportRequestDetailView,
    SupportRequestListView,
    SupportRequestMessageListCreateView,
    SupportRequestMessagesReadView,
    SupportRequestStatusUpdateView,
    TodoItemToggleView,
)

app_name = "communications"

urlpatterns = [
    path("events/<uuid:event_id>/support-request/", SupportRequestCreateView.as_view(), name="support-request-create"),
    path("support-requests/", SupportRequestListView.as_view(), name="support-request-list"),
    path("support-requests/<uuid:pk>/", SupportRequestDetailView.as_view(), name="support-request-detail"),
    # Support Requests Enhancement
    path("support-requests/<uuid:pk>/assign/", SupportRequestAssignView.as_view(), name="support-request-assign"),
    path(
        "support-requests/<uuid:pk>/status/",
        SupportRequestStatusUpdateView.as_view(),
        name="support-request-status",
    ),
    path(
        "support-requests/<uuid:pk>/assignment-history/",
        SupportRequestAssignmentHistoryView.as_view(),
        name="support-request-assignment-history",
    ),
    path(
        "support-requests/<uuid:pk>/messages/",
        SupportRequestMessageListCreateView.as_view(),
        name="support-request-messages",
    ),
    path(
        "support-requests/<uuid:pk>/messages/read/",
        SupportRequestMessagesReadView.as_view(),
        name="support-request-messages-read",
    ),
    path(
        "support-requests/<uuid:pk>/messages/attachments/<uuid:attachment_id>/",
        SupportRequestAttachmentDownloadView.as_view(),
        name="support-request-attachment",
    ),
    path("comms-overview/", CommsOverviewView.as_view(), name="overview"),
    path("communications-team/", CommunicationsTeamListView.as_view(), name="communications-team"),
    path("support-requests/todo-items/<uuid:pk>/", TodoItemToggleView.as_view(), name="todo-item-toggle"),
    path("postponed-cancelled-events/", PostponedCancelledEventsView.as_view(), name="postponed-cancelled-events"),
    path("calendar/", CalendarView.as_view(), name="calendar"),
    path("calendar/notes/", CalendarNoteListCreateView.as_view(), name="calendar-notes"),
    path("calendar/notes/<uuid:pk>/", CalendarNoteDetailView.as_view(), name="calendar-note-detail"),
    # Item 7.3 (Admin Page > Communications)
    path("admin/support-requests/", AdminSupportRequestListCreateView.as_view(), name="admin-support-request-list"),
    path(
        "admin/support-requests/<uuid:pk>/",
        AdminSupportRequestDetailView.as_view(),
        name="admin-support-request-detail",
    ),
]
