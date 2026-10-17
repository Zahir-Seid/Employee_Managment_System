from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.core.tests.factories import make_communications, make_event, make_leadership, make_staff
from apps.communications.models import SupportRequest
from apps.events.models import EventCategory


class SupportRequestCreationTests(APITestCase):
    """Stage 3 + updated requirement #1 (any category) and the reversal
    back to multi-select support types (support_types, a list), each
    optionally carrying its own description via support_details.
    """

    def setUp(self):
        self.staff = make_staff()
        self.client.force_authenticate(user=self.staff)

    def test_cannot_request_support_if_event_not_marked_as_needing_it(self):
        event = make_event(self.staff, category=EventCategory.INTERNATIONAL, needs_comms_support=False)
        response = self.client.post(
            reverse("communications:support-request-create", args=[event.id]),
            {"support_types": ["banner"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_international_event_can_submit_support_request(self):
        """Reversal of the original Internal-only restriction."""
        event = make_event(self.staff, category=EventCategory.INTERNATIONAL, needs_comms_support=True)
        response = self.client.post(
            reverse("communications:support-request-create", args=[event.id]),
            {"support_types": ["banner"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_empty_support_types_is_rejected(self):
        event = make_event(self.staff, needs_comms_support=True)
        response = self.client.post(
            reverse("communications:support-request-create", args=[event.id]),
            {"support_types": []},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_omitting_support_types_entirely_is_rejected(self):
        """Bug fix: giving the model field a default previously made this
        field appear optional to DRF, silently bypassing FR14 entirely
        when the client omitted it. Removing the default fixed this.
        """
        event = make_event(self.staff, needs_comms_support=True)
        response = self.client.post(
            reverse("communications:support-request-create", args=[event.id]),
            {},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_other_support_type_requires_description(self):
        event = make_event(self.staff, needs_comms_support=True)
        response = self.client.post(
            reverse("communications:support-request-create", args=[event.id]),
            {"support_types": ["other"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_other_support_type_with_description_succeeds(self):
        event = make_event(self.staff, needs_comms_support=True)
        response = self.client.post(
            reverse("communications:support-request-create", args=[event.id]),
            {
                "support_types": ["other"],
                "support_details": {"other": "Stage backdrop rental"},
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_multiple_support_types_generate_one_todo_item_each(self):
        event = make_event(self.staff, needs_comms_support=True)
        response = self.client.post(
            reverse("communications:support-request-create", args=[event.id]),
            {"support_types": ["photographer", "banner"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(response.data["todo_items"]), 2)
        todo_types = {item["support_type"] for item in response.data["todo_items"]}
        self.assertEqual(todo_types, {"photographer", "banner"})

    def test_non_owner_staff_cannot_view_another_staff_members_support_request(self):
        other_staff = make_staff(email="other@ee.org")
        event = make_event(self.staff, needs_comms_support=True)
        self.client.post(
            reverse("communications:support-request-create", args=[event.id]),
            {"support_types": ["banner"]},
            format="json",
        )
        self.client.force_authenticate(user=other_staff)
        response = self.client.get(reverse("communications:support-request-create", args=[event.id]))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_cannot_submit_a_second_support_request_for_same_event(self):
        event = make_event(self.staff, needs_comms_support=True)
        self.client.post(
            reverse("communications:support-request-create", args=[event.id]),
            {"support_types": ["banner"]},
            format="json",
        )
        response = self.client.post(
            reverse("communications:support-request-create", args=[event.id]),
            {"support_types": ["videographer"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TodoItemToggleTests(APITestCase):
    """FR22: Communications team marks to-do items Done; stamps completed_by/at."""

    def setUp(self):
        self.staff = make_staff()
        self.comms = make_communications()
        self.event = make_event(self.staff, needs_comms_support=True)
        self.client.force_authenticate(user=self.staff)
        response = self.client.post(
            reverse("communications:support-request-create", args=[self.event.id]),
            {"support_types": ["banner"]},
            format="json",
        )
        self.todo_item_id = response.data["todo_items"][0]["id"]

    def test_only_communications_can_toggle_todo_item(self):
        self.client.force_authenticate(user=self.staff)
        response = self.client.patch(
            reverse("communications:todo-item-toggle", args=[self.todo_item_id]), {"is_done": True}
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_unassigned_communications_member_cannot_touch_the_todo_item(self):
        self.client.force_authenticate(user=self.comms)
        url = reverse("communications:todo-item-toggle", args=[self.todo_item_id])
        self.assertEqual(self.client.patch(url, {"is_done": True}).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_404_NOT_FOUND)

    def test_communications_can_mark_todo_item_done(self):
        SupportRequest.objects.get(event=self.event).assigned_to.add(self.comms)
        self.client.force_authenticate(user=self.comms)
        response = self.client.patch(
            reverse("communications:todo-item-toggle", args=[self.todo_item_id]), {"is_done": True}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_done"])
        # Bug fix: these were stamped on the model correctly but never
        # actually included in the toggle response's serialized fields.
        self.assertIsNotNone(response.data["completed_at"])
        self.assertEqual(response.data["completed_by"], self.comms.id)


class CalendarScopeTests(APITestCase):
    """Updated requirement: Calendar now shows any category with a
    submitted Support Request, not Internal-only (reversal of FR27).
    """

    def setUp(self):
        self.staff = make_staff()
        self.comms = make_communications()
        self.leadership = make_leadership()

        self.internal_event = make_event(self.staff, category=EventCategory.INTERNAL, needs_comms_support=True, title="Internal Event")
        self.international_event = make_event(
            self.staff, category=EventCategory.INTERNATIONAL, needs_comms_support=True, title="International Event"
        )
        for event in (self.internal_event, self.international_event):
            self.client.force_authenticate(user=self.staff)
            self.client.post(
                reverse("communications:support-request-create", args=[event.id]),
                {"support_types": ["banner"]},
                format="json",
            )

    def test_calendar_includes_non_internal_events_with_support_requests(self):
        self.client.force_authenticate(user=self.comms)
        response = self.client.get(reverse("communications:calendar"))
        titles = [row["title"] for row in response.data["results"]] if "results" in response.data else [
            row["title"] for row in response.data
        ]
        self.assertIn("Internal Event", titles)
        self.assertIn("International Event", titles)

    def test_staff_cannot_access_calendar(self):
        self.client.force_authenticate(user=self.staff)
        response = self.client.get(reverse("communications:calendar"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class CalendarUpdateTests(APITestCase):
    """Calendar Update: the Calendar's data endpoint — only date-driven
    (Logged) events, everything in one unpaginated list, and the extra
    fields the colors / status filter / details popup are built from."""

    def setUp(self):
        from datetime import timedelta

        from django.utils import timezone

        from apps.events.models import EventStatus

        self.today = timezone.localdate()
        self.staff = make_staff()
        self.comms = make_communications()
        self.url = reverse("communications:calendar")

        from apps.events.models import Event

        def ev(title, start_offset, length):
            event = make_event(self.staff, title=title)
            Event.objects.filter(pk=event.pk).update(
                start_date=self.today + timedelta(days=start_offset),
                end_date=self.today + timedelta(days=start_offset + length - 1),
            )

        for title, offset, length in [
            ("Green", 20, 1), ("Yellow", 10, 1), ("Orange", 3, 1),
            ("Ongoing", -1, 3), ("Today", 0, 1), ("Held", -10, 2),
        ]:
            ev(title, offset, length)
        self.postponed = make_event(self.staff, title="Postponed One", status=EventStatus.POSTPONED)
        self.cancelled = make_event(self.staff, title="Cancelled One", status=EventStatus.CANCELLED)
        self.completed = make_event(self.staff, title="Completed One", status=EventStatus.COMPLETED)
        self.client.force_authenticate(user=self.comms)

    def _rows(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data["results"] if isinstance(response.data, dict) else response.data

    def test_completed_postponed_and_cancelled_events_are_not_on_the_calendar(self):
        titles = {r["title"] for r in self._rows()}
        self.assertEqual(titles, {"Green", "Yellow", "Orange", "Ongoing", "Today", "Held"})

    def test_days_until_event_colors_follow_the_spec_and_never_red(self):
        colors = {r["title"]: r["days_until_event"]["color"] for r in self._rows()}
        self.assertEqual(
            colors,
            {"Green": "green", "Yellow": "yellow", "Orange": "orange", "Ongoing": "blue", "Today": "blue", "Held": "gray"},
        )
        self.assertNotIn("red", colors.values())

    def test_rows_carry_the_fields_the_details_popup_needs(self):
        row = next(r for r in self._rows() if r["title"] == "Green")
        for key in ("event_id", "title", "category", "start_date", "end_date", "days_until_event", "owner_name", "thematic_area", "location"):
            self.assertIn(key, row)
        self.assertIn("Addis Ababa", row["location"])

    def test_every_event_is_returned_not_just_the_first_20(self):
        for i in range(25):
            make_event(self.staff, title=f"Bulk {i}", days_from_today=30 + i)
        rows = self._rows()
        self.assertEqual(len(rows), 6 + 25)
        self.assertIsInstance(rows, list)
