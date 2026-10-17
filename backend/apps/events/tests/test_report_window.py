from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.core.tests.factories import make_event, make_staff
from apps.dashboard.services import get_overdue_alerts
from apps.events.models import Event
from apps.reports.models import PostEventReport, ReportStatus


def _ended(owner, days_ago, title):
    end = timezone.localdate() - timedelta(days=days_ago)
    return make_event(owner, title=title, start_date=end, end_date=end)


class ReportSubmissionWindowTests(APITestCase):
    """A report is Pending/Draft for 5 days after the event ends, then Overdue."""

    def setUp(self):
        self.staff = make_staff()

    def test_overdue_starts_on_the_sixth_day(self):
        self.assertFalse(_ended(self.staff, 5, "Day 5").is_report_overdue)
        self.assertTrue(_ended(self.staff, 6, "Day 6").is_report_overdue)

    def test_overdue_alerts_use_the_window(self):
        _ended(self.staff, 3, "In window")
        _ended(self.staff, 8, "Late")
        alerts = get_overdue_alerts(Event.objects.all())
        self.assertEqual([a["title"] for a in alerts], ["Late"])
        self.assertEqual(alerts[0]["days_overdue"], 3)

    def test_due_filter_counts_pending_and_draft_inside_the_window(self):
        _ended(self.staff, 0, "Ended today")
        drafted = _ended(self.staff, 5, "Draft on last day")
        PostEventReport.objects.create(event=drafted, status=ReportStatus.DRAFT)
        _ended(self.staff, 6, "Overdue")
        submitted = _ended(self.staff, 2, "Submitted")
        PostEventReport.objects.create(event=submitted, status=ReportStatus.SUBMITTED)
        make_event(self.staff, title="Not ended yet")

        self.client.force_authenticate(user=self.staff)
        response = self.client.get(reverse("event-list"), {"report_status": "due"})
        titles = sorted(e["title"] for e in response.data["results"])
        self.assertEqual(titles, ["Draft on last day", "Ended today"])

    def test_overdue_filter_lists_events_past_the_window(self):
        _ended(self.staff, 5, "Still pending")
        _ended(self.staff, 6, "Overdue draft")
        _ended(self.staff, 9, "Overdue")
        submitted = _ended(self.staff, 10, "Submitted")
        PostEventReport.objects.create(event=submitted, status=ReportStatus.SUBMITTED)

        self.client.force_authenticate(user=self.staff)
        response = self.client.get(reverse("event-list"), {"report_status": "overdue", "ordering": "end_date"})
        self.assertEqual([e["title"] for e in response.data["results"]], ["Overdue", "Overdue draft"])

    def test_event_list_flags_overdue_for_report_status_column(self):
        _ended(self.staff, 5, "Day 5")
        _ended(self.staff, 6, "Day 6 pending")
        drafted = _ended(self.staff, 7, "Day 7 draft")
        PostEventReport.objects.create(event=drafted, status=ReportStatus.DRAFT)
        submitted = _ended(self.staff, 9, "Submitted")
        PostEventReport.objects.create(event=submitted, status=ReportStatus.SUBMITTED)

        self.client.force_authenticate(user=self.staff)
        response = self.client.get(reverse("event-list"))
        flags = {e["title"]: e["is_report_overdue"] for e in response.data["results"]}
        self.assertEqual(
            flags,
            {"Day 5": False, "Day 6 pending": True, "Day 7 draft": True, "Submitted": False},
        )
