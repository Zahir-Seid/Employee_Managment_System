from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.core.tests.factories import make_communications, make_event, make_leadership, make_staff, make_user
from apps.events.models import EventStatus


class AnnualEventReportAccessTests(APITestCase):
    """Reports Module spec §18/§2 — Annual Event Report is Staff-
    excluded, same grant as the Management Report."""

    def setUp(self):
        self.staff = make_staff(email="annacc1@x.com")
        self.comms = make_communications()
        self.leader = make_leadership()
        self.admin = make_user(email="annacc2@x.com", role=Role.ADMIN)

    def test_staff_excluded(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/reports/annual/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_other_three_roles_can_access(self):
        for user in (self.comms, self.leader, self.admin):
            self.client.force_authenticate(user)
            resp = self.client.get("/api/reports/annual/")
            self.assertEqual(resp.status_code, status.HTTP_200_OK, msg=f"role={user.role}")


class AnnualEventReportDataTests(APITestCase):
    def setUp(self):
        self.admin = make_user(email="annacc3@x.com", role=Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def test_defaults_to_current_year_when_no_year_given(self):
        resp = self.client.get("/api/reports/annual/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("year", resp.data["summary"])

    def test_only_events_in_requested_year_counted(self):
        make_event(
            self.admin, title="In 2025", start_date=date(2025, 5, 1), end_date=date(2025, 5, 1),
            status=EventStatus.COMPLETED,
        )
        make_event(
            self.admin, title="In 2026", start_date=date(2026, 5, 1), end_date=date(2026, 5, 1),
            status=EventStatus.COMPLETED,
        )

        resp = self.client.get("/api/reports/annual/?year=2025")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["summary"]["total_events"], 1)
        self.assertEqual(resp.data["summary"]["year"], 2025)
        titles = [r["title"] for r in resp.data["event_rows"]]
        self.assertEqual(titles, ["In 2025"])

    def test_invalid_year_rejected(self):
        resp = self.client.get("/api/reports/annual/?year=not-a-year")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_breakdowns_only_include_values_present_in_data(self):
        make_event(
            self.admin, title="Region A", region="Addis Ababa",
            start_date=date(2025, 1, 10), end_date=date(2025, 1, 10), status=EventStatus.COMPLETED,
        )
        resp = self.client.get("/api/reports/annual/?year=2025")
        regions = [r["label"] for r in resp.data["events_by_region"]]
        self.assertEqual(regions, ["Addis Ababa"])

    def test_summary_kpi_keys_present(self):
        make_event(
            self.admin, start_date=date(2025, 1, 10), end_date=date(2025, 1, 10), status=EventStatus.COMPLETED,
        )
        resp = self.client.get("/api/reports/annual/?year=2025")
        summary = resp.data["summary"]
        for key in ("year", "total_events", "total_participants", "total_partners", "communication_activities"):
            self.assertIn(key, summary)

    def test_xlsx_export_returns_file(self):
        make_event(
            self.admin, start_date=date(2025, 1, 10), end_date=date(2025, 1, 10), status=EventStatus.COMPLETED,
        )
        resp = self.client.get("/api/reports/annual/?year=2025&export_format=xlsx")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(
            resp["Content-Type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
