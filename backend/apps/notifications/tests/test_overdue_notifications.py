from datetime import timedelta

from django.core import mail
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.core.tests.factories import make_event, make_staff
from apps.notifications.models import Notification, NotificationType


def _ended(owner, days_ago, title):
    end = timezone.localdate() - timedelta(days=days_ago)
    return make_event(owner, title=title, start_date=end, end_date=end)


class OverdueReportNotificationTests(APITestCase):
    def setUp(self):
        self.staff = make_staff()
        self.other = make_staff(email="other@ee.org")

    def _unread(self, user):
        self.client.force_authenticate(user=user)
        return self.client.get(reverse("notification-unread-count")).data["count"]

    def test_bell_notifies_owner_once_for_an_overdue_event(self):
        _ended(self.staff, 8, "Late report")
        self.assertEqual(self._unread(self.staff), 1)
        self.assertEqual(self._unread(self.staff), 1)
        notification = Notification.objects.get(recipient=self.staff)
        self.assertEqual(notification.notification_type, NotificationType.REPORT_OVERDUE)
        self.assertEqual(len(mail.outbox), 1)

    def test_event_inside_the_window_does_not_notify(self):
        _ended(self.staff, 5, "Still pending")
        self.assertEqual(self._unread(self.staff), 0)

    def test_other_users_events_are_not_notified_through_my_bell(self):
        _ended(self.other, 9, "Someone else's")
        self.assertEqual(self._unread(self.staff), 0)
        self.assertFalse(Notification.objects.filter(recipient=self.other).exists())
