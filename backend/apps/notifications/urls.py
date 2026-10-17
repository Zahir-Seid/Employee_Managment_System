from django.urls import path

from .views import NotificationListView, NotificationMarkReadView, NotificationUnreadCountView

urlpatterns = [
    path("notifications/", NotificationListView.as_view(), name="notification-list"),
    path("notifications/unread-count/", NotificationUnreadCountView.as_view(), name="notification-unread-count"),
    path("notifications/mark-read/", NotificationMarkReadView.as_view(), name="notification-mark-read"),
]
