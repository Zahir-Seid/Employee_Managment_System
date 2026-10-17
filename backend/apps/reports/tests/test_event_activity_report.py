from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.core.tests.factories import make_communications, make_event, make_leadership, make_staff, make_user
from apps.events.models import EventStatus


class EventActivityReportAccessTests(APITestCase):
    """Reports Module spec §14/§2 — Event Activity Report is open to all
    four roles (unlike the Management Report), with Staff scoped to only
    the events they personally own (same data-scope rule as Events/My
    Events — see EventViewSet.get_queryset)."""

    def setUp(self):
        self.staff = make_staff(email="staffacc@x.com")
        # Distinct names: make_user() defaults everyone to "Test User", which
        # would make a name search match both owners.
        self.other_staff = make_staff(email="staffacc2@x.com", first_name="Selamawit", last_name="Tadesse")
        self.comms = make_communications()
        self.leader = make_leadership()
        self.admin = make_user(email="adminacc@x.com", role=Role.ADMIN)

        make_event(self.staff, title="Staff-owned Event", status=EventStatus.COMPLETED)
        make_event(self.other_staff, title="Other Staff Event", status=EventStatus.COMPLETED)

    def test_all_four_roles_can_access(self):
        for user in (self.staff, self.comms, self.leader, self.admin):
            self.client.force_authenticate(user)
            resp = self.client.get("/api/reports/event-activity/")
            self.assertEqual(resp.status_code, status.HTTP_200_OK, msg=f"role={user.role}")

    def test_staff_scoped_to_own_events_only(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/reports/event-activity/")
        self.assertEqual(resp.data["summary"]["total_events"], 1)
        self.assertEqual(resp.data["rows"][0]["title"], "Staff-owned Event")

    def test_admin_sees_all_events(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/event-activity/")
        self.assertEqual(resp.data["summary"]["total_events"], 2)

    def test_responsible_person_filter(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(f"/api/reports/event-activity/?responsible_person={self.other_staff.first_name}")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["summary"]["total_events"], 1)

    def test_summary_kpi_keys_present(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/event-activity/")
        summary = resp.data["summary"]
        for key in (
            "total_events", "completed_events", "upcoming_events",
            "cancelled_postponed_events", "total_participants",
            "events_with_actual_participants", "average_participants_per_event",
        ):
            self.assertIn(key, summary)


class EventActivityReportExportTests(APITestCase):
    """Reports Module spec §32 — Excel/PDF export, respecting current
    filters and permissions."""

    def setUp(self):
        self.admin = make_user(email="adminacc3@x.com", role=Role.ADMIN)
        make_event(self.admin, title="Export Test Event", status=EventStatus.COMPLETED)

    def test_xlsx_export_returns_file(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/event-activity/?export_format=xlsx")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(
            resp["Content-Type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        self.assertIn("attachment", resp["Content-Disposition"])

    def test_pdf_export_returns_file(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/event-activity/?export_format=pdf")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp["Content-Type"], "application/pdf")

    def test_invalid_export_format_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/event-activity/?export_format=docx")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
