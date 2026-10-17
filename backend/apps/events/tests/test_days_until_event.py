"""Days Until Event: the computed badge on Event, and the shared filter
bucket (All/Today/Within 3/7/14 Days/More Than 14 Days/Event
Started/Event Passed), exercised here via the Events list endpoint —
the same EventListSerializer/EventFilter that Staff, Communications,
and Admin all share.
"""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.core.tests.factories import make_event, make_staff


class DaysUntilEventDisplayTests(APITestCase):
    """Exercises Event.days_until_event_display directly against the
    exact thresholds/labels/colors from the spec.
    """

    def setUp(self):
        self.staff = make_staff()

    def _display(self, **kwargs):
        return make_event(self.staff, **kwargs).days_until_event_display

    def test_more_than_14_days_is_green(self):
        self.assertEqual(self._display(days_from_today=24), {"code": "more_than_14", "label": "24 days", "color": "green"})

    def test_exactly_14_days_is_yellow_boundary(self):
        self.assertEqual(self._display(days_from_today=14), {"code": "within_14", "label": "14 days", "color": "yellow"})

    def test_8_days_is_yellow(self):
        self.assertEqual(self._display(days_from_today=8), {"code": "within_14", "label": "8 days", "color": "yellow"})

    def test_7_days_is_orange_boundary(self):
        self.assertEqual(self._display(days_from_today=7), {"code": "within_7", "label": "7 days", "color": "orange"})

    def test_1_day_is_orange(self):
        self.assertEqual(self._display(days_from_today=1), {"code": "within_7", "label": "1 day", "color": "orange"})

    def test_today_is_blue(self):
        self.assertEqual(self._display(days_from_today=0), {"code": "today", "label": "Today", "color": "blue"})

    def test_multi_day_event_in_progress_is_event_started(self):
        # Started yesterday, ends in 2 days — today falls within the run.
        event = make_event(self.staff, days_from_today=-1, end_date=timezone.localdate() + timedelta(days=2))
        self.assertEqual(
            event.days_until_event_display, {"code": "event_started", "label": "Event Started", "color": "blue"}
        )

    def test_event_fully_over_is_event_passed(self):
        event = make_event(
            self.staff,
            start_date=timezone.localdate() - timedelta(days=10),
            end_date=timezone.localdate() - timedelta(days=8),
        )
        self.assertEqual(
            event.days_until_event_display, {"code": "event_passed", "label": "Event Passed", "color": "gray"}
        )


class DaysUntilEventFilterTests(APITestCase):
    """The ?days_until_event= query param on the Events list endpoint
    (shared by Staff/Communications/Admin — see EventFilter)."""

    def setUp(self):
        self.staff = make_staff()
        self.client.force_authenticate(user=self.staff)
        self.today_event = make_event(self.staff, days_from_today=0, title="Today Event")
        self.soon_event = make_event(self.staff, days_from_today=2, title="Soon Event")
        self.far_event = make_event(self.staff, days_from_today=30, title="Far Event")
        self.passed_event = make_event(
            self.staff,
            start_date=timezone.localdate() - timedelta(days=10),
            end_date=timezone.localdate() - timedelta(days=8),
            title="Passed Event",
        )

    def _titles(self, days_until_event):
        resp = self.client.get(reverse("event-list"), {"days_until_event": days_until_event})
        return {e["title"] for e in resp.data["results"]}

    def test_today_filter(self):
        self.assertEqual(self._titles("today"), {"Today Event"})

    def test_within_3_days_filter_excludes_today_and_far(self):
        self.assertEqual(self._titles("within_3"), {"Soon Event"})

    def test_more_than_14_filter(self):
        self.assertEqual(self._titles("more_than_14"), {"Far Event"})

    def test_event_passed_filter(self):
        self.assertEqual(self._titles("event_passed"), {"Passed Event"})

    def test_serializer_includes_days_until_event_badge(self):
        resp = self.client.get(reverse("event-list"), {"days_until_event": "today"})
        row = resp.data["results"][0]
        self.assertEqual(row["days_until_event"], {"code": "today", "label": "Today", "color": "blue"})
