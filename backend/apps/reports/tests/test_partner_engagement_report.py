from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.core.tests.factories import make_communications, make_event, make_leadership, make_staff, make_user
from apps.events.models import EventStatus
from apps.reports.models import PostEventReport, ReportStatus


class PartnerEngagementReportAccessTests(APITestCase):
    """Reports Module spec §17/§2 — Partner Engagement Report is Staff-
    excluded, same grant as the Management Report (CanAccessManagementReport)."""

    def setUp(self):
        self.staff = make_staff(email="peracc1@x.com")
        self.comms = make_communications()
        self.leader = make_leadership()
        self.admin = make_user(email="peracc2@x.com", role=Role.ADMIN)

    def test_staff_excluded(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/reports/partner-engagement/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_other_three_roles_can_access(self):
        for user in (self.comms, self.leader, self.admin):
            self.client.force_authenticate(user)
            resp = self.client.get("/api/reports/partner-engagement/")
            self.assertEqual(resp.status_code, status.HTTP_200_OK, msg=f"role={user.role}")


class PartnerEngagementReportDataTests(APITestCase):
    def setUp(self):
        self.admin = make_user(email="peracc3@x.com", role=Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def _submit_report(self, event, male, female):
        PostEventReport.objects.create(
            event=event, status=ReportStatus.SUBMITTED, participants_male=male, participants_female=female
        )

    def test_partner_rollup_and_participation(self):
        e1 = make_event(
            self.admin, title="Health Forum", organization_lead_agency="MoH", co_organizer_name="",
            status=EventStatus.COMPLETED, region="Addis Ababa",
        )
        self._submit_report(e1, male=10, female=15)
        e2 = make_event(
            self.admin, title="Health Forum 2", organization_lead_agency="MoH", co_organizer_name="UNICEF",
            status=EventStatus.COMPLETED, region="Oromia",
        )
        self._submit_report(e2, male=5, female=5)

        resp = self.client.get("/api/reports/partner-engagement/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        rows_by_partner = {r["partner"]: r for r in resp.data["rows"]}

        self.assertEqual(rows_by_partner["MoH"]["event_count"], 2)
        self.assertEqual(rows_by_partner["MoH"]["participation"], 35)
        self.assertEqual(sorted(rows_by_partner["MoH"]["locations"]), ["Addis Ababa", "Oromia"])

        self.assertEqual(rows_by_partner["UNICEF"]["event_count"], 1)
        self.assertEqual(rows_by_partner["UNICEF"]["participation"], 10)

        summary = resp.data["summary"]
        self.assertEqual(summary["total_partners"], 2)
        self.assertEqual(summary["events_with_partner_participation"], 2)
        self.assertEqual(summary["participation_count"], 45)

    def test_no_estimate_when_no_submitted_report(self):
        # Spec §17: "Do not invent or estimate partner statistics when
        # the required data is unavailable." An event with an org name
        # but no submitted Event Status Report should contribute 0
        # participation, not a guessed figure from expected_participants.
        make_event(
            self.admin, title="No Report Yet", organization_lead_agency="WHO",
            status=EventStatus.LOGGED, expected_participants=200,
        )
        resp = self.client.get("/api/reports/partner-engagement/")
        row = next(r for r in resp.data["rows"] if r["partner"] == "WHO")
        self.assertEqual(row["participation"], 0)

    def test_active_partner_excludes_cancelled_only_partner(self):
        make_event(self.admin, title="Cancelled Event", organization_lead_agency="Cancelled Org", status=EventStatus.CANCELLED)
        resp = self.client.get("/api/reports/partner-engagement/")
        row = next(r for r in resp.data["rows"] if r["partner"] == "Cancelled Org")
        self.assertFalse(row["active"])
        self.assertEqual(resp.data["summary"]["active_partners"], 0)

    def test_xlsx_export_returns_file(self):
        make_event(self.admin, title="Export Event", organization_lead_agency="Export Org")
        resp = self.client.get("/api/reports/partner-engagement/?export_format=xlsx")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(
            resp["Content-Type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
