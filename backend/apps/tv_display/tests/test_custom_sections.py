from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.tv_display.models import TVDisplaySettings, TVDisplaySlide


class TVDisplayCustomSectionTests(APITestCase):
    """Admin-created TV Display queues beyond the fixed SECTION_KEYS
    (e.g. "Live Announcement") — see models.make_custom_section_key and
    the two views in views.py. Communications/Admin only (same gate as
    slide authoring, IsCommunicationsOrAdmin), not the wider Admin/
    Leadership/Communications gate on the rest of TVDisplaySettingsView.
    """

    def setUp(self):
        self.staff = User.objects.create_user(username="staff3", email="staff3@x.com", password="x", role=Role.STAFF)
        self.comms = User.objects.create_user(username="comms3", email="comms3@x.com", password="x", role=Role.COMMUNICATIONS)
        self.leader = User.objects.create_user(username="lead3", email="lead3@x.com", password="x", role=Role.LEADERSHIP)
        self.admin = User.objects.create_user(username="admin3", email="admin3@x.com", password="x", role=Role.ADMIN)

    def test_comms_can_create_a_custom_queue(self):
        self.client.force_authenticate(self.comms)
        resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Live Announcement"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        matches = [s for s in resp.data["sections"] if s.get("custom")]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["label"], "Live Announcement")
        self.assertTrue(matches[0]["enabled"])
        self.assertTrue(matches[0]["key"].startswith("custom_"))

    def test_admin_can_create_a_custom_queue(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Staff Spotlight 2"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_leadership_cannot_create_a_custom_queue(self):
        self.client.force_authenticate(self.leader)
        resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Live Announcement"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_cannot_create_a_custom_queue(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Live Announcement"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_blank_label_rejected(self):
        self.client.force_authenticate(self.comms)
        resp = self.client.post("/api/tv-display/custom-sections/", {"label": "   "}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_new_queue_is_added_to_the_end_of_the_rotation(self):
        self.client.force_authenticate(self.comms)
        resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Live Announcement"}, format="json")
        self.assertEqual(resp.data["sections"][-1]["label"], "Live Announcement")

    def test_slide_can_be_added_to_a_custom_queue(self):
        self.client.force_authenticate(self.comms)
        create_resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Live Announcement"}, format="json")
        key = next(s["key"] for s in create_resp.data["sections"] if s.get("custom"))

        slide_resp = self.client.post(
            "/api/tv-display/slides/",
            {"section_key": key, "title": "Office closed Friday", "message": "Back Monday."},
            format="json",
        )
        self.assertEqual(slide_resp.status_code, status.HTTP_201_CREATED, slide_resp.data)
        self.assertEqual(slide_resp.data["section_label"], "Live Announcement")

    def test_slide_cannot_be_added_to_an_unknown_key(self):
        self.client.force_authenticate(self.comms)
        resp = self.client.post(
            "/api/tv-display/slides/",
            {"section_key": "not_a_real_key", "title": "X"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_comms_can_rename_a_custom_queue(self):
        self.client.force_authenticate(self.comms)
        create_resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Live Announcement"}, format="json")
        key = next(s["key"] for s in create_resp.data["sections"] if s.get("custom"))

        rename_resp = self.client.patch(f"/api/tv-display/custom-sections/{key}/", {"label": "Breaking News"}, format="json")
        self.assertEqual(rename_resp.status_code, status.HTTP_200_OK, rename_resp.data)
        renamed = next(s for s in rename_resp.data["sections"] if s["key"] == key)
        self.assertEqual(renamed["label"], "Breaking News")

    def test_renaming_does_not_change_the_key_or_orphan_slides(self):
        self.client.force_authenticate(self.comms)
        create_resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Live Announcement"}, format="json")
        key = next(s["key"] for s in create_resp.data["sections"] if s.get("custom"))
        self.client.post(
            "/api/tv-display/slides/", {"section_key": key, "title": "Hello"}, format="json"
        )

        self.client.patch(f"/api/tv-display/custom-sections/{key}/", {"label": "Breaking News"}, format="json")

        self.assertEqual(TVDisplaySlide.objects.filter(section_key=key).count(), 1)
        slide_resp = self.client.get("/api/tv-display/slides/", {"section_key": key})
        results = slide_resp.data["results"] if isinstance(slide_resp.data, dict) else slide_resp.data
        self.assertEqual(results[0]["section_label"], "Breaking News")

    def test_comms_can_delete_a_custom_queue_and_its_slides(self):
        self.client.force_authenticate(self.comms)
        create_resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Live Announcement"}, format="json")
        key = next(s["key"] for s in create_resp.data["sections"] if s.get("custom"))
        self.client.post("/api/tv-display/slides/", {"section_key": key, "title": "Hello"}, format="json")

        delete_resp = self.client.delete(f"/api/tv-display/custom-sections/{key}/")
        self.assertEqual(delete_resp.status_code, status.HTTP_200_OK, delete_resp.data)
        self.assertFalse(any(s["key"] == key for s in delete_resp.data["sections"]))
        self.assertEqual(TVDisplaySlide.objects.filter(section_key=key).count(), 0)

    def test_leadership_cannot_rename_or_delete_a_custom_queue(self):
        self.client.force_authenticate(self.comms)
        create_resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Live Announcement"}, format="json")
        key = next(s["key"] for s in create_resp.data["sections"] if s.get("custom"))

        self.client.force_authenticate(self.leader)
        rename_resp = self.client.patch(f"/api/tv-display/custom-sections/{key}/", {"label": "X"}, format="json")
        self.assertEqual(rename_resp.status_code, status.HTTP_403_FORBIDDEN)
        delete_resp = self.client.delete(f"/api/tv-display/custom-sections/{key}/")
        self.assertEqual(delete_resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_rename_of_unknown_key_returns_404(self):
        self.client.force_authenticate(self.comms)
        resp = self.client.patch("/api/tv-display/custom-sections/does_not_exist/", {"label": "X"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_general_settings_save_preserves_custom_queues(self):
        """A PATCH to the main /settings/ endpoint (e.g. reordering
        sections) must round-trip a custom queue's `custom`/`label`
        fields untouched — dropping them would make the entry fail
        validation (or silently lose its label) the next time it's saved.
        """
        self.client.force_authenticate(self.comms)
        create_resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Live Announcement"}, format="json")
        sections = create_resp.data["sections"]

        patch_resp = self.client.patch(
            "/api/tv-display/settings/",
            {
                "sections": [
                    {
                        "key": s["key"],
                        "enabled": s["enabled"],
                        "duration_seconds": s.get("duration_seconds"),
                        **({"custom": True, "label": s["label"]} if s.get("custom") else {}),
                    }
                    for s in sections
                ]
            },
            format="json",
        )
        self.assertEqual(patch_resp.status_code, status.HTTP_200_OK, patch_resp.data)
        custom_entry = next(s for s in patch_resp.data["sections"] if s.get("custom"))
        self.assertEqual(custom_entry["label"], "Live Announcement")

    def test_settings_save_rejects_a_fabricated_unlisted_key(self):
        """A PATCH that tries to slip in a brand-new section key directly
        (bypassing the custom-sections endpoints) must be rejected -
        creating a queue is only valid through POST /custom-sections/.
        """
        self.client.force_authenticate(self.admin)
        instance = TVDisplaySettings.get_settings()
        sections = list(instance.sections) + [{"key": "made_up_key", "enabled": True}]
        resp = self.client.patch("/api/tv-display/settings/", {"sections": sections}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
