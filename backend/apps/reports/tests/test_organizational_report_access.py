from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User


class ManagementReportAccessTests(APITestCase):
    """EMS Reporting System: Complete Development + UI/UX Spec §1 —
    Communication gets the same Management Report access as Lead/Admin;
    Staff does not (no general permission-grant system exists yet)."""

    def setUp(self):
        self.comms = User.objects.create_user(username="commsacc", email="commsacc@x.com", password="x", role=Role.COMMUNICATIONS)
        self.staff = User.objects.create_user(username="staffacc", email="staffacc@x.com", password="x", role=Role.STAFF)
        self.leader = User.objects.create_user(username="leadacc", email="leadacc@x.com", password="x", role=Role.LEADERSHIP)
        self.admin = User.objects.create_user(username="adminacc", email="adminacc@x.com", password="x", role=Role.ADMIN)

    def test_communications_can_access(self):
        self.client.force_authenticate(self.comms)
        resp = self.client.get("/api/reports/organizational-performance/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_leadership_can_access(self):
        self.client.force_authenticate(self.leader)
        resp = self.client.get("/api/reports/organizational-performance/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_admin_can_access(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/organizational-performance/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_staff_cannot_access(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/reports/organizational-performance/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_support_level_filter_applied_and_echoed(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/organizational-performance/?support_level=financial")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["applied_filters"]["support_level"], "financial")

    def test_new_filter_params_echoed(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(
            "/api/reports/organizational-performance/"
            "?thematic_area=Health&mode_of_event=virtual&communication_support=requested"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        filters = resp.data["applied_filters"]
        self.assertEqual(filters["thematic_area"], "Health")
        self.assertEqual(filters["mode_of_event"], "virtual")
        self.assertEqual(filters["communication_support"], "requested")

    def test_xlsx_export_returns_file(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/organizational-performance/?export_format=xlsx")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(
            resp["Content-Type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    def test_pdf_export_returns_file(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/organizational-performance/?export_format=pdf")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp["Content-Type"], "application/pdf")
