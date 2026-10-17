from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.audit.models import ActionType, ObjectType
from apps.audit.utils import log_action
from apps.core.tests.factories import make_communications, make_event, make_staff


class LogActionUtilTests(TestCase):
    """Regression test for a real bug found during development: object_type
    must match AuditLog's snake_case ObjectType choices exactly (previously
    derived as 'supportrequest'/'posteventreport' with no underscores).
    """

    def setUp(self):
        self.staff = make_staff()

    def test_object_type_derived_as_snake_case_matching_choices(self):
        event = make_event(self.staff)
        entry = log_action(ActionType.CREATED, event, user=self.staff, description="test")
        self.assertEqual(entry.object_type, "event")
        self.assertIn(entry.object_type, ObjectType.values)

    def test_camel_case_class_name_converted_correctly(self):
        from apps.communications.models import SupportRequest

        event = make_event(self.staff, needs_comms_support=True)
        support_request = SupportRequest.objects.create(event=event, support_types=["banner"])
        entry = log_action(ActionType.SUBMITTED, support_request, user=self.staff)
        self.assertEqual(entry.object_type, "support_request")
        self.assertIn(entry.object_type, ObjectType.values)

    def test_string_obj_requires_explicit_object_type(self):
        with self.assertRaises(ValueError):
            log_action(ActionType.REPORT_GENERATED, "some-id", user=self.staff)

    def test_string_obj_with_explicit_object_type_succeeds(self):
        entry = log_action(
            ActionType.REPORT_GENERATED, "generic-monthly-pdf", user=self.staff, object_type=ObjectType.REPORT
        )
        self.assertEqual(entry.object_type, ObjectType.REPORT)
        self.assertEqual(entry.object_id, "generic-monthly-pdf")

    def test_unauthenticated_user_stored_as_none(self):
        from django.contrib.auth.models import AnonymousUser

        event = make_event(self.staff)
        entry = log_action(ActionType.CREATED, event, user=AnonymousUser())
        self.assertIsNone(entry.user)


class AuditLogAccessTests(APITestCase):
    """FR49: read-only, restricted to Communications/Leadership."""

    def setUp(self):
        self.staff = make_staff()
        self.comms = make_communications()
        event = make_event(self.staff)
        log_action(ActionType.CREATED, event, user=self.staff, description="Event logged.")

    def test_staff_cannot_view_audit_log(self):
        self.client.force_authenticate(user=self.staff)
        response = self.client.get(reverse("audit:audit-log-list"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_communications_can_view_audit_log(self):
        self.client.force_authenticate(user=self.comms)
        response = self.client.get(reverse("audit:audit-log-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(response.data["count"], 1)

    def test_audit_log_is_read_only_via_admin(self):
        from django.contrib import admin

        from apps.audit.models import AuditLog as AuditLogModel

        model_admin = admin.site._registry[AuditLogModel]
        self.assertFalse(model_admin.has_add_permission(request=None))
        self.assertFalse(model_admin.has_change_permission(request=None))
        self.assertFalse(model_admin.has_delete_permission(request=None))
