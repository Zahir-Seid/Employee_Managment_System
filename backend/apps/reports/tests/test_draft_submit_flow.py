from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.core.tests.factories import make_past_event, make_staff
from apps.reports.models import FollowUpAction
from apps.reports.tests.helpers import attach_photos


def _form_payload(**overrides):
    """What the report form sends on Save Draft and on Submit."""
    payload = {
        "major_accomplishment": "We trained 40 facilitators.",
        "best_practices_lessons_actions": "Start earlier.",
        "challenges_faced": "",
        "recommendation_conclusion": "",
        "participants_male": 10,
        "participants_female": 5,
        "participants_ee_staff": 15,
        "follow_up_actions": [],
        "event_social_links": [],
    }
    payload.update(overrides)
    return payload


class SavedDraftTests(APITestCase):
    """A saved draft can be saved again and then submitted."""

    def setUp(self):
        self.staff = make_staff()
        self.client.force_authenticate(user=self.staff)
        self.event = make_past_event(self.staff)
        created = self.client.post(reverse("reports:report-create", args=[self.event.id]), _form_payload(), format="json")
        self.report_id = created.data["id"]
        self.update_url = reverse("reports:report-update", args=[self.report_id])

    def test_saving_a_draft_again_works(self):
        response = self.client.patch(self.update_url, _form_payload(major_accomplishment="Edited"), format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

    def test_update_returns_the_whole_report_so_the_form_can_keep_using_its_id(self):
        response = self.client.patch(self.update_url, _form_payload(), format="json")
        self.assertEqual(response.data["id"], str(self.report_id))
        self.assertEqual(response.data["status"], "draft")
        self.assertIn("photos", response.data)

    def test_follow_up_actions_replace_the_saved_list(self):
        action = {"action": "Share the report", "responsible": "Hana", "deadline": "2027-03-01"}
        self.client.patch(self.update_url, _form_payload(follow_up_actions=[action, action]), format="json")
        self.assertEqual(FollowUpAction.objects.filter(post_event_report_id=self.report_id).count(), 2)
        self.client.patch(self.update_url, _form_payload(follow_up_actions=[action]), format="json")
        self.assertEqual(FollowUpAction.objects.filter(post_event_report_id=self.report_id).count(), 1)
        self.client.patch(self.update_url, _form_payload(follow_up_actions=[]), format="json")
        self.assertEqual(FollowUpAction.objects.filter(post_event_report_id=self.report_id).count(), 0)

    def test_a_patch_without_follow_up_actions_leaves_them_alone(self):
        action = {"action": "Share the report", "responsible": "Hana", "deadline": "2027-03-01"}
        self.client.patch(self.update_url, _form_payload(follow_up_actions=[action]), format="json")
        self.client.patch(self.update_url, {"challenges_faced": "Venue changed"}, format="json")
        self.assertEqual(FollowUpAction.objects.filter(post_event_report_id=self.report_id).count(), 1)

    def test_saved_draft_can_be_submitted_the_way_the_form_does_it(self):
        # Submit: save the form again, upload the photos, then submit.
        saved = self.client.patch(self.update_url, _form_payload(), format="json")
        attach_photos(self.client, saved.data["id"])
        response = self.client.post(reverse("reports:report-submit", args=[saved.data["id"]]))
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, "completed")

    def test_submitted_report_cannot_be_edited(self):
        attach_photos(self.client, self.report_id)
        self.client.post(reverse("reports:report-submit", args=[self.report_id]))
        response = self.client.patch(self.update_url, _form_payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_only_the_event_owner_can_save_the_draft(self):
        self.client.force_authenticate(user=make_staff(email="other@ee.org"))
        response = self.client.patch(self.update_url, _form_payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
