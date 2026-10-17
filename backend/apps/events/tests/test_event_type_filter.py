from django.urls import reverse
from rest_framework.test import APITestCase

from apps.core.tests.factories import make_event, make_staff
from apps.events.models import Event, EventType, ReviewMeetingType, filter_events_by_event_type


class ReviewMeetingEventTypeFilterTests(APITestCase):
    """Review Meeting is two entries (Annual / Mid-term) in Event Type filters."""

    def setUp(self):
        self.staff = make_staff()
        make_event(self.staff, title="Annual RM", event_type=EventType.RM, review_meeting_type=ReviewMeetingType.ANNUAL)
        make_event(self.staff, title="Mid RM", event_type=EventType.RM, review_meeting_type=ReviewMeetingType.MID_TERM)
        make_event(self.staff, title="A workshop", event_type=EventType.WORKSHOP)

    def _titles(self, value):
        return sorted(e.title for e in filter_events_by_event_type(Event.objects.all(), value))

    def test_annual_and_mid_term_are_separate(self):
        self.assertEqual(self._titles("rm_annual"), ["Annual RM"])
        self.assertEqual(self._titles("rm_mid_term"), ["Mid RM"])

    def test_plain_rm_still_matches_both(self):
        self.assertEqual(self._titles("rm"), ["Annual RM", "Mid RM"])

    def test_events_api_accepts_the_new_values(self):
        self.client.force_authenticate(user=self.staff)
        response = self.client.get(reverse("event-list"), {"event_type": "rm_mid_term"})
        self.assertEqual([e["title"] for e in response.data["results"]], ["Mid RM"])
