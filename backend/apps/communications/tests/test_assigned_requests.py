from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.communications.models import SupportRequest
from apps.accounts.models import Role
from apps.core.tests.factories import (
    make_comms_lead,
    make_communications,
    make_event,
    make_leadership,
    make_staff,
    make_user,
)


def _request_for(owner, title, assignees=()):
    event = make_event(owner, title=title, needs_comms_support=True)
    support_request = SupportRequest.objects.create(event=event, support_types=["banner"])
    support_request.assigned_to.set(assignees)
    return support_request


class AssignedRequestsVisibilityTests(APITestCase):
    """Communications members see only the requests assigned to them; the Lead,
    Leadership and Admin see all of them."""

    def setUp(self):
        self.owner = make_staff()
        self.lead = make_comms_lead()
        self.ann = make_communications(email="ann@ee.org")
        self.ben = make_communications(email="ben@ee.org")
        self.admin = make_user(email="admin@ee.org", role=Role.ADMIN)
        self.mine = _request_for(self.owner, "Ann only", [self.ann])
        self.shared = _request_for(self.owner, "Ann and Ben", [self.ann, self.ben])
        self.others = _request_for(self.owner, "Ben only", [self.ben])
        self.unassigned = _request_for(self.owner, "Nobody yet")

    def _titles(self, user, **params):
        self.client.force_authenticate(user=user)
        response = self.client.get(reverse("communications:support-request-list"), params)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return sorted(r["event_title"] if "event_title" in r else r["event"]["title"] for r in response.data["results"])

    def test_member_sees_only_requests_assigned_to_them(self):
        self.assertEqual(self._titles(self.ann), ["Ann and Ben", "Ann only"])

    def test_shared_request_appears_for_each_assignee(self):
        self.assertIn("Ann and Ben", self._titles(self.ann))
        self.assertIn("Ann and Ben", self._titles(self.ben))

    def test_member_never_sees_unassigned_or_others_requests(self):
        titles = self._titles(self.ann)
        self.assertNotIn("Nobody yet", titles)
        self.assertNotIn("Ben only", titles)

    def test_lead_leadership_and_admin_see_every_request(self):
        for user in (self.lead, self.admin, make_leadership()):
            self.assertEqual(len(self._titles(user)), 4, user.role)

    def test_member_cannot_open_other_requests_by_url(self):
        self.client.force_authenticate(user=self.ann)
        for hidden in (self.others, self.unassigned):
            for name in ("support-request-detail", "support-request-messages"):
                response = self.client.get(reverse(f"communications:{name}", args=[hidden.id]))
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND, name)
        detail = self.client.get(reverse("communications:support-request-detail", args=[self.shared.id]))
        self.assertEqual(detail.status_code, status.HTTP_200_OK)

    def test_member_cannot_reach_a_request_through_its_event(self):
        self.client.force_authenticate(user=self.ann)
        hidden = self.client.get(reverse("communications:support-request-create", args=[self.others.event_id]))
        self.assertEqual(hidden.status_code, status.HTTP_403_FORBIDDEN)
        own = self.client.get(reverse("communications:support-request-create", args=[self.mine.event_id]))
        self.assertEqual(own.status_code, status.HTTP_200_OK)

    def test_member_cannot_touch_another_members_todo_items(self):
        item = self.others.todo_items.first()
        url = reverse("communications:todo-item-toggle", args=[item.id])
        self.client.force_authenticate(user=self.ann)
        self.assertEqual(self.client.patch(url, {"is_done": True}).status_code, status.HTTP_404_NOT_FOUND)
        own = self.mine.todo_items.first()
        own_url = reverse("communications:todo-item-toggle", args=[own.id])
        self.assertEqual(self.client.patch(own_url, {"is_done": True}).status_code, status.HTTP_200_OK)

    def test_member_cannot_change_status_of_a_request_not_assigned_to_them(self):
        self.client.force_authenticate(user=self.ann)
        url = reverse("communications:support-request-status", args=[self.others.id])
        response = self.client.patch(url, {"status": "in_progress"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_lead_can_still_assign_and_reassign(self):
        self.client.force_authenticate(user=self.lead)
        url = reverse("communications:support-request-assign", args=[self.unassigned.id])
        response = self.client.patch(url, {"assigned_to": [self.ann.id, self.ben.id]}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(self.unassigned.assigned_to.count(), 2)
        self.assertIn("Nobody yet", self._titles(self.ben))

    def test_assignment_history_is_lead_only(self):
        url = reverse("communications:support-request-assignment-history", args=[self.mine.id])
        self.client.force_authenticate(user=self.lead)
        self.assertEqual(self.client.get(url).status_code, status.HTTP_200_OK)
        for user in (self.ann, self.admin, make_leadership(), self.owner):
            self.client.force_authenticate(user=user)
            self.assertEqual(self.client.get(url).status_code, status.HTTP_403_FORBIDDEN, user.role)
