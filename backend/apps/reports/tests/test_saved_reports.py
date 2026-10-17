from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.core.tests.factories import make_communications, make_leadership, make_staff, make_user
from apps.reports.models import SavedReport


class SavedReportTests(APITestCase):
    """Reports Module spec §19 — save/reopen a report configuration,
    scoped privately to the user who created it (see models.SavedReport's
    docstring for why saves aren't shared org-wide)."""

    def setUp(self):
        self.staff = make_staff(email="staffacc4@x.com")
        self.other_staff = make_staff(email="staffacc5@x.com")
        self.admin = make_user(email="adminacc4@x.com", role=Role.ADMIN)

    def test_create_saved_report(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.post(
            "/api/reports/saved-reports/",
            {"name": "Q3 Oromia Events", "report_type": "event_activity", "filters": {"region": "Oromia", "period": "quarterly"}},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["report_type"], "event_activity")
        self.assertEqual(resp.data["filters"]["region"], "Oromia")
        self.assertEqual(resp.data["created_by_name"], self.staff.get_full_name())

    def test_list_only_shows_own_saved_reports(self):
        SavedReport.objects.create(name="Mine", report_type="management", filters={}, created_by=self.staff)
        SavedReport.objects.create(name="Not Mine", report_type="management", filters={}, created_by=self.other_staff)

        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/reports/saved-reports/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [r["name"] for r in resp.data["results"]]
        self.assertIn("Mine", names)
        self.assertNotIn("Not Mine", names)

    def test_cannot_access_another_users_saved_report(self):
        saved = SavedReport.objects.create(name="Theirs", report_type="management", filters={}, created_by=self.other_staff)
        self.client.force_authenticate(self.staff)
        resp = self.client.get(f"/api/reports/saved-reports/{saved.id}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_saved_report(self):
        saved = SavedReport.objects.create(name="Old Name", report_type="management", filters={}, created_by=self.staff)
        self.client.force_authenticate(self.staff)
        resp = self.client.patch(f"/api/reports/saved-reports/{saved.id}/", {"name": "New Name"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        saved.refresh_from_db()
        self.assertEqual(saved.name, "New Name")

    def test_duplicate_saved_report(self):
        saved = SavedReport.objects.create(
            name="Original", report_type="communications", filters={"status": "overdue"}, created_by=self.staff
        )
        self.client.force_authenticate(self.staff)
        resp = self.client.post(f"/api/reports/saved-reports/{saved.id}/duplicate/")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["name"], "Original (Copy)")
        self.assertEqual(resp.data["filters"]["status"], "overdue")
        self.assertEqual(SavedReport.objects.filter(created_by=self.staff).count(), 2)

    def test_delete_saved_report(self):
        saved = SavedReport.objects.create(name="Delete Me", report_type="management", filters={}, created_by=self.staff)
        self.client.force_authenticate(self.staff)
        resp = self.client.delete(f"/api/reports/saved-reports/{saved.id}/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(SavedReport.objects.filter(id=saved.id).exists())

    def test_filters_must_be_an_object(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            "/api/reports/saved-reports/",
            {"name": "Bad Filters", "report_type": "management", "filters": "not-an-object"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_all_roles_can_save(self):
        for user in (self.staff, make_communications(), make_leadership(), self.admin):
            self.client.force_authenticate(user)
            resp = self.client.post(
                "/api/reports/saved-reports/",
                {"name": "x", "report_type": "management", "filters": {}},
                format="json",
            )
            self.assertEqual(resp.status_code, status.HTTP_201_CREATED, msg=f"role={user.role}")
