from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification
from .serializers import NotificationSerializer


class NotificationListView(generics.ListAPIView):
    """Powers the TopNav bell dropdown. Newest first, recipient-scoped —
    every user only ever sees their own notifications.
    """

    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user)


class NotificationUnreadCountView(APIView):
    """Powers the small red count badge on the bell icon itself, without
    the frontend having to fetch and count the full list on every render.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        # Overdue-report notifications are created lazily: the bell polls this
        # endpoint, so the user's own newly overdue events notify them here
        # without needing a scheduler. Each event is only notified once.
        from apps.events.models import Event
        from apps.events.services.notifications import notify_overdue_reports

        notify_overdue_reports(Event.objects.filter(owner=request.user))
        count = Notification.objects.filter(recipient=request.user, is_read=False).count()
        return Response({"count": count})


class NotificationMarkReadView(APIView):
    """Marks one notification read (called when it's clicked) or, with no
    id in the body, all of the user's notifications read (the dropdown's
    "Mark all read" action).
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        notification_id = request.data.get("id")
        qs = Notification.objects.filter(recipient=request.user, is_read=False)
        if notification_id:
            qs = qs.filter(id=notification_id)
        updated = qs.update(is_read=True)
        return Response({"updated": updated})
