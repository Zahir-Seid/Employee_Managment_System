from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.communications.models import CalendarNote
from apps.core.tests.factories import make_communications, make_leadership, make_staff, make_user


class CalendarNoteTests(APITestCase):
    """The Calendar's quick-add: click an empty day, type a title, save."""

    def setUp(self):
        self.url = reverse("communications:calendar-notes")
        self.comms = make_communications()
        self.leadership = make_leadership()

    def test_communications_can_add_a_note_on_a_date(self):
        self.client.force_authenticate(self.comms)
        response = self.client.post(self.url, {"title": "  Call the printer  ", "date": "2026-10-14"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["title"], "Call the printer")
        self.assertEqual(response.data["date"], "2026-10-14")
        self.assertTrue(response.data["can_delete"])
        self.assertEqual(CalendarNote.objects.get().created_by, self.comms)

    def test_leadership_can_add_and_everyone_with_calendar_access_sees_it(self):
        self.client.force_authenticate(self.leadership)
        self.client.post(self.url, {"title": "Board dinner", "date": "2026-10-20"}, format="json")
        self.client.force_authenticate(self.comms)
        rows = self.client.get(self.url).data
        self.assertEqual([r["title"] for r in rows], ["Board dinner"])
        # Not the author, not Admin: visible but not deletable.
        self.assertFalse(rows[0]["can_delete"])

    def test_title_is_required(self):
        self.client.force_authenticate(self.comms)
        for bad in ["", "   "]:
            response = self.client.post(self.url, {"title": bad, "date": "2026-10-14"}, format="json")
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_date_is_required(self):
        self.client.force_authenticate(self.comms)
        response = self.client.post(self.url, {"title": "x"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_staff_cannot_use_calendar_notes(self):
        self.client.force_authenticate(make_staff())
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.post(self.url, {"title": "x", "date": "2026-10-14"}, format="json").status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_only_author_or_admin_can_delete(self):
        self.client.force_authenticate(self.comms)
        note_id = self.client.post(self.url, {"title": "x", "date": "2026-10-14"}, format="json").data["id"]
        detail = reverse("communications:calendar-note-detail", args=[note_id])

        self.client.force_authenticate(self.leadership)
        self.assertEqual(self.client.delete(detail).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(CalendarNote.objects.count(), 1)

        self.client.force_authenticate(make_user(email="admin@ee.org", role=Role.ADMIN))
        self.assertEqual(self.client.delete(detail).status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(CalendarNote.objects.count(), 0)
