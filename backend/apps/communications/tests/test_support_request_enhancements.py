from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.core.tests.factories import make_comms_lead, make_communications, make_event, make_staff, make_user
from apps.communications.models import SupportRequest, SupportRequestStatus


def _create_support_request(client, owner, event, **overrides):
    payload = {"support_types": ["banner"]}
    payload.update(overrides)
    response = client.post(
        reverse("communications:support-request-create", args=[event.id]),
        payload,
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED, response.data
    return SupportRequest.objects.get(pk=response.data["id"])


class SupportRequestDefaultsTests(APITestCase):
    """New support request defaults: Unassigned."""

    def setUp(self):
        self.staff = make_staff()
        self.client.force_authenticate(user=self.staff)
        self.event = make_event(self.staff, needs_comms_support=True)

    def test_new_request_is_unassigned(self):
        sr = _create_support_request(self.client, self.staff, self.event)
        self.assertEqual(sr.status, SupportRequestStatus.UNASSIGNED)
        self.assertTrue(sr.is_unassigned)


class PriorityAutomationTests(APITestCase):
    """Priority is derived purely from days-until-event, never stored."""

    def setUp(self):
        self.staff = make_staff()
        self.client.force_authenticate(user=self.staff)

    def test_far_out_event_is_normal_priority(self):
        event = make_event(self.staff, needs_comms_support=True, days_from_today=30)
        sr = _create_support_request(self.client, self.staff, event)
        self.assertEqual(sr.priority, "normal")

    def test_event_within_a_week_is_high_priority(self):
        event = make_event(self.staff, needs_comms_support=True, days_from_today=5)
        sr = _create_support_request(self.client, self.staff, event)
        self.assertEqual(sr.priority, "high")

    def test_event_within_three_days_is_urgent_priority(self):
        event = make_event(self.staff, needs_comms_support=True, days_from_today=2)
        sr = _create_support_request(self.client, self.staff, event)
        self.assertEqual(sr.priority, "urgent")


class AssignmentTests(APITestCase):
    """Lead-only, whole-request assignment — one staff, multiple staff,
    different assignees per request, the Lead assigning themselves, Lead
    + staff together, and reassignment.
    """

    def setUp(self):
        self.lead = make_comms_lead()
        self.comms_a = make_communications(email="a@ee.org")
        self.comms_b = make_communications(email="b@ee.org")
        self.staff = make_staff()
        self.event_1 = make_event(self.staff, needs_comms_support=True)
        self.event_2 = make_event(self.staff, needs_comms_support=True)
        self.client.force_authenticate(user=self.staff)
        self.sr_1 = _create_support_request(self.client, self.staff, self.event_1)
        self.sr_2 = _create_support_request(self.client, self.staff, self.event_2)
        self.client.force_authenticate(user=self.lead)

    def _assign(self, sr, user_ids):
        return self.client.patch(
            reverse("communications:support-request-assign", args=[sr.id]),
            {"assigned_to": [str(u) for u in user_ids]},
            format="json",
        )

    def test_lead_can_assign_one_staff_member(self):
        response = self._assign(self.sr_1, [self.comms_a.id])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.sr_1.refresh_from_db()
        self.assertEqual(list(self.sr_1.assigned_to.all()), [self.comms_a])

    def test_lead_can_assign_multiple_staff_members(self):
        response = self._assign(self.sr_1, [self.comms_a.id, self.comms_b.id])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.sr_1.refresh_from_db()
        self.assertEqual(set(self.sr_1.assigned_to.all()), {self.comms_a, self.comms_b})

    def test_different_staff_for_different_requests(self):
        self._assign(self.sr_1, [self.comms_a.id])
        self._assign(self.sr_2, [self.comms_b.id])
        self.sr_1.refresh_from_db()
        self.sr_2.refresh_from_db()
        self.assertEqual(list(self.sr_1.assigned_to.all()), [self.comms_a])
        self.assertEqual(list(self.sr_2.assigned_to.all()), [self.comms_b])

    def test_lead_can_assign_themselves(self):
        response = self._assign(self.sr_1, [self.lead.id])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.sr_1.refresh_from_db()
        self.assertEqual(list(self.sr_1.assigned_to.all()), [self.lead])

    def test_lead_plus_staff_assigned_together(self):
        response = self._assign(self.sr_1, [self.lead.id, self.comms_a.id])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.sr_1.refresh_from_db()
        self.assertEqual(set(self.sr_1.assigned_to.all()), {self.lead, self.comms_a})

    def test_reassignment_replaces_previous_assignees(self):
        self._assign(self.sr_1, [self.comms_a.id])
        response = self._assign(self.sr_1, [self.comms_b.id])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.sr_1.refresh_from_db()
        self.assertEqual(list(self.sr_1.assigned_to.all()), [self.comms_b])

    def test_non_lead_communications_cannot_assign(self):
        self.client.force_authenticate(user=self.comms_a)
        response = self._assign(self.sr_1, [self.comms_a.id])
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_cannot_assign(self):
        self.client.force_authenticate(user=self.staff)
        response = self._assign(self.sr_1, [self.comms_a.id])
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class StatusProgressionTests(APITestCase):
    """Unassigned -> Assigned -> In Progress -> Completed, plus Declined
    (Lead-only), and permission scoping for regular assignees.
    """

    def setUp(self):
        self.lead = make_comms_lead()
        self.comms_a = make_communications(email="a@ee.org")
        self.comms_b = make_communications(email="b@ee.org")
        self.staff = make_staff()
        self.event = make_event(self.staff, needs_comms_support=True)
        self.client.force_authenticate(user=self.staff)
        self.sr = _create_support_request(self.client, self.staff, self.event)

    def _set_status(self, new_status):
        return self.client.patch(
            reverse("communications:support-request-status", args=[self.sr.id]),
            {"status": new_status},
            format="json",
        )

    def test_lead_can_progress_status_through_full_lifecycle(self):
        self.client.force_authenticate(user=self.lead)
        for target in ["in_progress", "completed"]:
            response = self._set_status(target)
            self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
            self.sr.refresh_from_db()
            self.assertEqual(self.sr.status, target)

    def test_lead_can_decline(self):
        self.client.force_authenticate(user=self.lead)
        response = self._set_status("declined")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.sr.refresh_from_db()
        self.assertEqual(self.sr.status, SupportRequestStatus.DECLINED)

    def test_assigned_staff_can_progress_status(self):
        self.sr.assigned_to.add(self.comms_a)
        self.client.force_authenticate(user=self.comms_a)
        response = self._set_status("in_progress")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_assigned_staff_cannot_decline(self):
        self.sr.assigned_to.add(self.comms_a)
        self.client.force_authenticate(user=self.comms_a)
        response = self._set_status("declined")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_unassigned_staff_cannot_change_status(self):
        self.sr.assigned_to.add(self.comms_a)
        self.client.force_authenticate(user=self.comms_b)
        response = self._set_status("in_progress")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_event_owner_cannot_change_status(self):
        self.client.force_authenticate(user=self.staff)
        response = self._set_status("in_progress")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class ExistingFunctionalityPreservedTests(APITestCase):
    """Existing To-Do/Calendar/list behavior keeps working unmodified."""

    def setUp(self):
        self.staff = make_staff()
        self.comms = make_communications()
        self.event = make_event(self.staff, needs_comms_support=True)
        self.client.force_authenticate(user=self.staff)
        self.sr = _create_support_request(self.client, self.staff, self.event)

    def test_todo_items_still_auto_generated(self):
        self.assertEqual(self.sr.todo_items.count(), 1)

    def test_staff_can_still_list_their_own_requests(self):
        response = self.client.get(reverse("communications:support-request-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [r["id"] for r in response.data["results"]] if "results" in response.data else [
            r["id"] for r in response.data
        ]
        self.assertIn(str(self.sr.id), ids)

    def test_calendar_still_accessible_to_communications(self):
        self.client.force_authenticate(user=self.comms)
        response = self.client.get(reverse("communications:calendar"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class AdminSeesEverySupportRequestTests(APITestCase):
    """Regression: Admin has `is_staff_role` too, which used to scope the
    Support Requests list to events the Admin personally owns, so the page
    said "No Communications Support Requests found" while requests existed.
    Staff stay limited to their own events.
    """

    def setUp(self):
        self.staff = make_staff()
        self.other_staff = make_staff(email="other@ee.org")
        self.admin = make_user(email="admin@ee.org", role=Role.ADMIN)
        self.own = _make_request_for(self.client, self.staff)
        self.theirs = _make_request_for(self.client, self.other_staff)

    def _ids(self, user):
        self.client.force_authenticate(user=user)
        response = self.client.get(reverse("communications:support-request-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = response.data["results"] if "results" in response.data else response.data
        return {r["id"] for r in rows}

    def test_admin_sees_requests_on_events_they_do_not_own(self):
        self.assertEqual(self._ids(self.admin), {str(self.own.id), str(self.theirs.id)})

    def test_admin_can_open_a_request_on_someone_elses_event(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(reverse("communications:support-request-detail", args=[self.theirs.id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_staff_still_only_sees_their_own(self):
        self.assertEqual(self._ids(self.staff), {str(self.own.id)})


def _make_request_for(client, owner):
    event = make_event(owner, needs_comms_support=True)
    client.force_authenticate(user=owner)
    return _create_support_request(client, owner, event)
