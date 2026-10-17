from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.communications.models import SupportRequest, SupportRequestAssignmentLog, SupportRequestStatus
from apps.core.tests.factories import make_comms_lead, make_communications, make_event, make_staff
from apps.notifications.models import Notification, NotificationType


class AssignmentWorkflowTests(APITestCase):
    def setUp(self):
        self.lead = make_comms_lead()
        self.comms_a = make_communications(email="a@ee.org")
        self.comms_b = make_communications(email="b@ee.org")
        self.comms_c = make_communications(email="c@ee.org")
        self.staff = make_staff()
        self.event = make_event(self.staff, needs_comms_support=True)
        self.client.force_authenticate(user=self.staff)
        response = self.client.post(
            reverse("communications:support-request-create", args=[self.event.id]),
            {"support_types": ["banner"]},
            format="json",
        )
        self.sr = SupportRequest.objects.get(pk=response.data["id"])
        self.client.force_authenticate(user=self.lead)

    def _assign(self, users):
        return self.client.patch(
            reverse("communications:support-request-assign", args=[self.sr.id]),
            {"assigned_to": [str(u.id) for u in users]},
            format="json",
        )

    def _status(self, value):
        return self.client.patch(
            reverse("communications:support-request-status", args=[self.sr.id]), {"status": value}, format="json"
        )

    def _post(self, body, clarification=False):
        return self.client.post(
            reverse("communications:support-request-messages", args=[self.sr.id]),
            {"body": body, "is_clarification_request": clarification},
            format="json",
        )

    def test_assigning_moves_unassigned_to_assigned_and_back(self):
        self._assign([self.comms_a, self.comms_b])
        self.sr.refresh_from_db()
        self.assertEqual(self.sr.status, SupportRequestStatus.ASSIGNED)
        self._assign([])
        self.sr.refresh_from_db()
        self.assertEqual(self.sr.status, SupportRequestStatus.UNASSIGNED)

    def test_in_progress_survives_reassignment(self):
        self._assign([self.comms_a])
        self._status("in_progress")
        self._assign([self.comms_a, self.comms_b])
        self.sr.refresh_from_db()
        self.assertEqual(self.sr.status, SupportRequestStatus.IN_PROGRESS)

    def test_completed_is_preserved_until_lead_reopens(self):
        self._assign([self.comms_a])
        self._status("completed")
        self._assign([self.comms_b])
        self.sr.refresh_from_db()
        self.assertEqual(self.sr.status, SupportRequestStatus.COMPLETED)
        self._status("assigned")
        self.sr.refresh_from_db()
        self.assertEqual(self.sr.status, SupportRequestStatus.ASSIGNED)

    def test_assignee_cannot_reopen_or_set_assigned(self):
        self._assign([self.comms_a])
        self._status("completed")
        self.client.force_authenticate(user=self.comms_a)
        self.assertEqual(self._status("in_progress").status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(user=self.lead)
        self._status("assigned")
        self.client.force_authenticate(user=self.comms_a)
        self.assertEqual(self._status("assigned").status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self._status("on_hold").status_code, status.HTTP_200_OK)

    def test_history_and_notifications_for_added_and_removed(self):
        self._assign([self.comms_a, self.comms_b])
        self._assign([self.comms_b, self.comms_c])
        logs = SupportRequestAssignmentLog.objects.filter(support_request=self.sr)
        self.assertEqual(logs.filter(action="added").count(), 3)
        removed = logs.get(action="removed")
        self.assertEqual(removed.user, self.comms_a)
        self.assertEqual(removed.performed_by, self.lead)
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.comms_a, notification_type=NotificationType.SUPPORT_UNASSIGNED
            ).exists()
        )
        response = self.client.get(reverse("communications:support-request-assignment-history", args=[self.sr.id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 4)

    def test_my_assignments_includes_shared_requests(self):
        self._assign([self.comms_a, self.comms_b])
        self.client.force_authenticate(user=self.comms_b)
        response = self.client.get(reverse("communications:support-request-list"), {"assigned_to_me": "true"})
        self.assertEqual(response.data["count"], 1)
        self.client.force_authenticate(user=self.comms_c)
        response = self.client.get(reverse("communications:support-request-list"), {"assigned_to_me": "true"})
        self.assertEqual(response.data["count"], 0)

    def test_clarification_flow(self):
        self._assign([self.comms_a])
        self.client.force_authenticate(user=self.comms_a)
        self.assertEqual(self._post("What size?", clarification=True).status_code, status.HTTP_201_CREATED)
        self.sr.refresh_from_db()
        self.assertEqual(self.sr.status, SupportRequestStatus.NEEDS_CLARIFICATION)
        self.client.force_authenticate(user=self.staff)
        self.assertEqual(self._post("3x2m").status_code, status.HTTP_201_CREATED)
        self.sr.refresh_from_db()
        self.assertEqual(self.sr.status, SupportRequestStatus.CLARIFICATION_PROVIDED)
        response = self.client.get(reverse("communications:support-request-messages", args=[self.sr.id]))
        self.assertEqual([m["body"] for m in response.data], ["What size?", "3x2m"])
        self.assertTrue(response.data[1]["is_requester"])
        self.assertTrue(
            Notification.objects.filter(recipient=self.comms_a, notification_type=NotificationType.SUPPORT_CLARIFICATION).exists()
        )

    def test_requester_cannot_flag_clarification_and_outsiders_cannot_post(self):
        self._assign([self.comms_a])
        self.client.force_authenticate(user=self.staff)
        self._post("hello", clarification=True)
        self.sr.refresh_from_db()
        self.assertEqual(self.sr.status, SupportRequestStatus.ASSIGNED)
        self.client.force_authenticate(user=self.comms_b)
        self.assertEqual(self._post("hi").status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            self.client.get(reverse("communications:support-request-messages", args=[self.sr.id])).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        other_staff = make_staff(email="other@ee.org")
        self.client.force_authenticate(user=other_staff)
        self.assertEqual(
            self.client.get(reverse("communications:support-request-messages", args=[self.sr.id])).status_code,
            status.HTTP_404_NOT_FOUND,
        )
