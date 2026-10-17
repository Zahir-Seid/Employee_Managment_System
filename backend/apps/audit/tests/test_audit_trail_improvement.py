"""Audit Trail improvement: login logging, status_changed categorization,
role/activation-change logging, and the summary counts endpoint.
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.audit.categories import build_summary, categorize
from apps.audit.models import ActionType, AuditLog, ObjectType
from apps.core.tests.factories import make_event, make_leadership, make_staff, make_user


class LoginLoggingTests(APITestCase):
    def test_successful_login_creates_a_login_audit_entry(self):
        staff = make_staff()
        response = self.client.post(reverse("accounts:login"), {"email": staff.email, "password": "TestPass123!"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entry = AuditLog.objects.get(action_type=ActionType.LOGIN, object_id=str(staff.id))
        self.assertEqual(entry.user, staff)

    def test_failed_login_does_not_create_a_login_audit_entry(self):
        staff = make_staff()
        response = self.client.post(reverse("accounts:login"), {"email": staff.email, "password": "wrong"})
        self.assertNotEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(AuditLog.objects.filter(action_type=ActionType.LOGIN).exists())


class RoleAndActivationLoggingTests(APITestCase):
    def setUp(self):
        self.admin = make_user(email="admin@ee.org", role=Role.ADMIN)
        self.client.force_authenticate(user=self.admin)

    def test_role_change_is_logged(self):
        target = make_staff(email="target@ee.org")
        url = reverse("accounts:staff-detail", args=[target.id])
        response = self.client.patch(url, {"role": Role.COMMUNICATIONS})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entry = AuditLog.objects.filter(object_type=ObjectType.USER, object_id=str(target.id)).latest("created_at")
        self.assertIn("role changed", entry.description)

    def test_activation_change_is_logged(self):
        target = make_staff(email="target2@ee.org", is_active=False)
        url = reverse("accounts:staff-detail", args=[target.id])
        response = self.client.patch(url, {"is_active": True})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entry = AuditLog.objects.filter(object_type=ObjectType.USER, object_id=str(target.id)).latest("created_at")
        self.assertIn("activated", entry.description)

    def test_noop_update_does_not_create_a_spurious_entry(self):
        target = make_staff(email="target3@ee.org")
        AuditLog.objects.all().delete()
        url = reverse("accounts:staff-detail", args=[target.id])
        response = self.client.patch(url, {"position": "Same role, same status, just editing position"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(AuditLog.objects.filter(object_type=ObjectType.USER, object_id=str(target.id)).exists())


class StatusChangedCategorizationTests(APITestCase):
    def setUp(self):
        self.staff = make_staff()

    def test_event_postpone_logs_as_status_changed_not_updated(self):
        event = make_event(self.staff)
        self.client.force_authenticate(user=self.staff)
        url = reverse("event-status-action", args=[event.id])
        response = self.client.post(
            url,
            {"action": "postpone", "reason": "venue unavailable", "new_start_date": "2030-01-01", "new_end_date": "2030-01-02"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entry = AuditLog.objects.filter(object_type=ObjectType.EVENT, object_id=str(event.id)).latest("created_at")
        self.assertEqual(entry.action_type, ActionType.STATUS_CHANGED)


class CategorizeTests(APITestCase):
    def test_login_categorized_as_logins(self):
        self.assertEqual(categorize(ActionType.LOGIN, ObjectType.USER), "logins")

    def test_event_created_categorized_as_events_created(self):
        self.assertEqual(categorize(ActionType.CREATED, ObjectType.EVENT), "events_created")

    def test_event_update_and_delete_are_not_counted_in_any_card(self):
        self.assertIsNone(categorize(ActionType.UPDATED, ObjectType.EVENT))
        self.assertIsNone(categorize(ActionType.DELETED, ObjectType.EVENT))

    def test_event_postponed_or_cancelled_read_from_log_text(self):
        self.assertEqual(
            categorize(ActionType.STATUS_CHANGED, ObjectType.EVENT, "Event 'Summit' postponed. Rescheduled from a to b."),
            "events_postponed_cancelled",
        )
        self.assertEqual(
            categorize(ActionType.STATUS_CHANGED, ObjectType.EVENT, "Event 'Summit' cancelled. Reason: \"rain\""),
            "events_postponed_cancelled",
        )

    def test_event_reopened_or_unrelated_text_is_not_postponed_or_cancelled(self):
        self.assertIsNone(categorize(ActionType.STATUS_CHANGED, ObjectType.EVENT, "Event 'Summit' reopened."))
        self.assertIsNone(categorize(ActionType.STATUS_CHANGED, ObjectType.EVENT, "Event 'Was cancelled last year' reopened."))

    def test_any_support_request_activity_is_communications(self):
        self.assertEqual(categorize(ActionType.SUBMITTED, ObjectType.SUPPORT_REQUEST), "communications")
        self.assertEqual(categorize(ActionType.STATUS_CHANGED, ObjectType.SUPPORT_REQUEST), "communications")

    def test_report_generated_categorized_as_reports(self):
        self.assertEqual(categorize(ActionType.REPORT_GENERATED, ObjectType.REPORT), "reports")

    def test_other_activity_is_not_counted_in_any_card(self):
        self.assertIsNone(categorize(ActionType.UPDATED, ObjectType.USER))
        self.assertIsNone(categorize(ActionType.TODO_COMPLETED, ObjectType.TODO_ITEM))
        self.assertIsNone(categorize("some_future_action", "some_future_object"))


class SummaryEndpointTests(APITestCase):
    def setUp(self):
        self.leadership = make_leadership()
        self.staff = make_staff()
        self.client.force_authenticate(user=self.leadership)

    def test_summary_totals_match_filtered_list(self):
        event = make_event(self.staff)
        from apps.audit.utils import log_action

        log_action(ActionType.CREATED, event, user=self.staff, description="a")
        log_action(ActionType.UPDATED, event, user=self.staff, description="b")

        response = self.client.get(reverse("audit:audit-log-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("summary", response.data)
        self.assertEqual(response.data["summary"]["total"], response.data["count"])
        created_bucket = next(c for c in response.data["summary"]["categories"] if c["code"] == "events_created")
        # Only the CREATED entry counts; the UPDATED one is in the total only.
        self.assertEqual(created_bucket["count"], 1)

    def test_summary_reflects_action_type_filter(self):
        event = make_event(self.staff)
        from apps.audit.utils import log_action

        log_action(ActionType.CREATED, event, user=self.staff, description="a")
        log_action(ActionType.DELETED, event, user=self.staff, description="b")

        response = self.client.get(reverse("audit:audit-log-list"), {"action_type": "created"})
        self.assertEqual(response.data["summary"]["total"], 1)


class BuildSummaryTests(APITestCase):
    def test_all_categories_present_even_when_zero(self):
        summary = build_summary([])
        self.assertEqual(summary["total"], 0)
        codes = {c["code"] for c in summary["categories"]}
        self.assertEqual(
            codes,
            {"communications", "reports", "logins", "events_created", "events_postponed_cancelled"},
        )
