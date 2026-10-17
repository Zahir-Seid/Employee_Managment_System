from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.communications.models import SupportRequest, TodoItem
from apps.core.tests.factories import make_communications, make_event, make_leadership, make_staff, make_user
from apps.events.models import EventStatus


def make_todo(event, support_type="photographer", is_done=False, **kwargs):
    support_request, _ = SupportRequest.objects.get_or_create(
        event=event, defaults={"support_types": [support_type]}
    )
    # Creating a SupportRequest already auto-generates one TodoItem per selected
    # support type (apps/communications/signals.py, FR21). Reuse that item instead
    # of adding a duplicate, so the report sees exactly one activity per type.
    todo = TodoItem.objects.filter(support_request=support_request, support_type=support_type).first()
    if todo is None:
        return TodoItem.objects.create(
            support_request=support_request,
            support_type=support_type,
            label=kwargs.pop("label", support_type.title()),
            is_done=is_done,
            **kwargs,
        )
    todo.is_done = is_done
    for field, value in kwargs.items():
        setattr(todo, field, value)
    todo.save()
    return todo


class CommunicationsReportAccessTests(APITestCase):
    """Reports Module spec §15/§16/§2 — Communications Report is open to
    all four roles, with Staff scoped to only the communication tasks
    tied to events they personally own."""

    def setUp(self):
        self.staff = make_staff(email="staffacc@x.com")
        self.other_staff = make_staff(email="staffacc2@x.com")
        self.comms = make_communications()
        self.leader = make_leadership()
        self.admin = make_user(email="adminacc@x.com", role=Role.ADMIN)

        self.staff_event = make_event(self.staff, title="Staff Event", status=EventStatus.COMPLETED)
        self.other_event = make_event(self.other_staff, title="Other Event", status=EventStatus.COMPLETED)
        make_todo(self.staff_event, support_type="photographer", is_done=True)
        make_todo(self.other_event, support_type="banner", is_done=False)

    def test_all_four_roles_can_access(self):
        for user in (self.staff, self.comms, self.leader, self.admin):
            self.client.force_authenticate(user)
            resp = self.client.get("/api/reports/communications/")
            self.assertEqual(resp.status_code, status.HTTP_200_OK, msg=f"role={user.role}")

    def test_staff_scoped_to_own_events_only(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/reports/communications/")
        self.assertEqual(resp.data["summary"]["total_activities"], 1)
        self.assertEqual(resp.data["rows"][0]["event_title"], "Staff Event")

    def test_admin_sees_all_activities(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/communications/")
        self.assertEqual(resp.data["summary"]["total_activities"], 2)

    def test_status_filter(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/communications/?status=completed")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["summary"]["total_activities"], 1)
        self.assertEqual(resp.data["rows"][0]["status"], "completed")

    def test_invalid_status_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/communications/?status=bogus")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_support_type_filter(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/communications/?support_type=banner")
        self.assertEqual(resp.data["summary"]["total_activities"], 1)
        self.assertEqual(resp.data["rows"][0]["support_type"], "banner")

    def test_summary_shape_and_missing_data_is_none_not_zero(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/communications/")
        summary = resp.data["summary"]
        self.assertIsNone(summary["in_progress"])
        self.assertIsNone(summary["to_do"])
        self.assertIsNone(summary["outputs_produced"])
        self.assertIn("note", summary)


class CommunicationsReportExportTests(APITestCase):
    """Reports Module spec §32 — Excel/PDF export, respecting current
    filters and permissions."""

    def setUp(self):
        self.admin = make_user(email="adminacc2@x.com", role=Role.ADMIN)
        self.staff = make_staff(email="staffacc3@x.com")
        event = make_event(self.admin, title="Export Test Event", status=EventStatus.COMPLETED)
        make_todo(event, support_type="banner", is_done=True)

    def test_xlsx_export_returns_file(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/communications/?export_format=xlsx")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(
            resp["Content-Type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        self.assertIn("attachment", resp["Content-Disposition"])

    def test_pdf_export_returns_file(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/communications/?export_format=pdf")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp["Content-Type"], "application/pdf")

    def test_invalid_export_format_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/reports/communications/?export_format=docx")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
