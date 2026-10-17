from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.reports.tests.test_reports import _MINIMAL_JPEG


class TVDisplaySlideTests(APITestCase):
    def setUp(self):
        self.comms = User.objects.create_user(username="comms1", email="comms1@x.com", password="x", role=Role.COMMUNICATIONS)
        self.staff = User.objects.create_user(username="staff1", email="staff1@x.com", password="x", role=Role.STAFF)
        self.leader = User.objects.create_user(username="lead1", email="lead1@x.com", password="x", role=Role.LEADERSHIP)
        self.admin = User.objects.create_user(username="admin1", email="admin1@x.com", password="x", role=Role.ADMIN)

    def _photo(self, name="photo.jpg"):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile(name, _MINIMAL_JPEG, content_type="image/jpeg")

    def test_comms_can_create_slide(self):
        self.client.force_authenticate(self.comms)
        resp = self.client.post("/api/tv-display/slides/", {
            "section_key": "staff_spotlight", "title": "Welcome Abebe!", "message": "New program officer.",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["section_label"], "Staff Spotlight")

    def test_admin_can_create_slide(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post("/api/tv-display/slides/", {
            "section_key": "announcements", "title": "Office closed Friday",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_staff_cannot_create_slide(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.post("/api/tv-display/slides/", {
            "section_key": "announcements", "title": "Nope",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_leadership_cannot_create_slide(self):
        self.client.force_authenticate(self.leader)
        resp = self.client.post("/api/tv-display/slides/", {
            "section_key": "announcements", "title": "Nope2",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_automatic_capable_section_accepts_manual_slides(self):
        """Upcoming Events / Event Analytics can run on live data OR on
        manual slides (content mode Manual), so slides are accepted."""
        self.client.force_authenticate(self.comms)
        for key in ("upcoming_events", "system_dashboards"):
            resp = self.client.post("/api/tv-display/slides/", {
                "section_key": key, "title": "manual " + key,
            }, format="json")
            self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_dashboard_picks_section_key_rejected(self):
        self.client.force_authenticate(self.comms)
        resp = self.client.post("/api/tv-display/slides/", {
            "section_key": "system_dashboard_picks", "title": "bad",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_todays_activities_accepts_manual_slides(self):
        self.client.force_authenticate(self.comms)
        resp = self.client.post("/api/tv-display/slides/", {
            "section_key": "todays_activities", "title": "Staff meeting 2pm",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_home_content_section_keys_rejected(self):
        """None of the three Home Page content queues (News/Major Events/
        Announcements) are TVDisplaySlide-backed — they're all the same
        apps.content.HomeContent pool as Home Page > Manage Content, added
        via /api/home/content/ instead."""
        self.client.force_authenticate(self.comms)
        for key in ("home_news", "home_major_events", "home_announcements"):
            resp = self.client.post("/api/tv-display/slides/", {
                "section_key": key, "title": "bad",
            }, format="json")
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_any_authenticated_role_can_list(self):
        self.client.force_authenticate(self.comms)
        before = self.client.get("/api/tv-display/slides/").data["count"]
        self.client.post("/api/tv-display/slides/", {"section_key": "celebrations", "title": "Happy anniversary!"}, format="json")
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/tv-display/slides/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], before + 1)

    def test_optional_duration_blank_ok_then_set_then_delete(self):
        self.client.force_authenticate(self.comms)
        create = self.client.post("/api/tv-display/slides/", {"section_key": "quick_information", "title": "Wifi: EE-Guest"}, format="json")
        self.assertIsNone(create.data["duration_seconds"])
        slide_id = create.data["id"]
        update = self.client.patch(f"/api/tv-display/slides/{slide_id}/", {"duration_seconds": 20}, format="json")
        self.assertEqual(update.data["duration_seconds"], 20)
        delete = self.client.delete(f"/api/tv-display/slides/{slide_id}/")
        self.assertEqual(delete.status_code, status.HTTP_204_NO_CONTENT)

    def test_end_date_before_start_date_rejected(self):
        self.client.force_authenticate(self.comms)
        resp = self.client.post("/api/tv-display/slides/", {
            "section_key": "announcements", "title": "Bad dates",
            "start_date": "2026-09-20", "end_date": "2026-09-10",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_active_only_excludes_not_yet_started_slide(self):
        self.client.force_authenticate(self.comms)
        from datetime import date, timedelta
        future = (date.today() + timedelta(days=5)).isoformat()
        self.client.post("/api/tv-display/slides/", {
            "section_key": "announcements", "title": "Future announcement", "start_date": future,
        }, format="json")
        resp = self.client.get("/api/tv-display/slides/", {"active_only": 1, "section_key": "announcements"})
        titles = [s["title"] for s in resp.data["results"]]
        self.assertNotIn("Future announcement", titles)

    def test_active_only_excludes_expired_slide(self):
        self.client.force_authenticate(self.comms)
        from datetime import date, timedelta
        past = (date.today() - timedelta(days=5)).isoformat()
        self.client.post("/api/tv-display/slides/", {
            "section_key": "announcements", "title": "Expired announcement", "end_date": past,
        }, format="json")
        resp = self.client.get("/api/tv-display/slides/", {"active_only": 1, "section_key": "announcements"})
        titles = [s["title"] for s in resp.data["results"]]
        self.assertNotIn("Expired announcement", titles)

    def test_active_only_includes_slide_within_current_window(self):
        self.client.force_authenticate(self.comms)
        from datetime import date, timedelta
        start = (date.today() - timedelta(days=2)).isoformat()
        end = (date.today() + timedelta(days=2)).isoformat()
        self.client.post("/api/tv-display/slides/", {
            "section_key": "announcements", "title": "Current announcement", "start_date": start, "end_date": end,
        }, format="json")
        resp = self.client.get("/api/tv-display/slides/", {"active_only": 1, "section_key": "announcements"})
        titles = [s["title"] for s in resp.data["results"]]
        self.assertIn("Current announcement", titles)

    def test_active_only_still_excludes_inactive_slide_regardless_of_dates(self):
        self.client.force_authenticate(self.comms)
        create = self.client.post("/api/tv-display/slides/", {
            "section_key": "announcements", "title": "Manually turned off",
        }, format="json")
        self.client.patch(f"/api/tv-display/slides/{create.data['id']}/", {"is_active": False}, format="json")
        resp = self.client.get("/api/tv-display/slides/", {"active_only": 1, "section_key": "announcements"})
        titles = [s["title"] for s in resp.data["results"]]
        self.assertNotIn("Manually turned off", titles)

    def test_staff_spotlight_with_subtitle_and_photo(self):
        """Phase 27: Staff Spotlight needs Name (title) + Position
        (subtitle) + Photo, on top of the generic title/message every
        section already had — proves the whole multipart pipeline (file +
        regular fields in the same request) actually works end to end.
        """
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.client.force_authenticate(self.comms)
        photo = SimpleUploadedFile("headshot.jpg", _MINIMAL_JPEG, content_type="image/jpeg")
        resp = self.client.post(
            "/api/tv-display/slides/",
            {
                "section_key": "staff_spotlight",
                "title": "Abebe Bekele",
                "subtitle": "Program Officer, Digital Health",
                "message": "Joined the team this month, leading our new mHealth pilot.",
                "photo": photo,
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["subtitle"], "Program Officer, Digital Health")
        self.assertTrue(resp.data["photo"])

    def test_slide_without_photo_serializes_photo_as_falsy(self):
        self.client.force_authenticate(self.comms)
        resp = self.client.post("/api/tv-display/slides/", {
            "section_key": "recognitions", "title": "Selam Tesfaye", "message": "Outstanding contribution to the Digital Health program.",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertFalse(resp.data["photo"])

    def test_remove_photo_clears_existing_photo(self):
        self.client.force_authenticate(self.comms)
        photo = self._photo("headshot.jpg")
        create = self.client.post(
            "/api/tv-display/slides/",
            {"section_key": "staff_spotlight", "title": "Abebe Bekele", "photo": photo},
            format="multipart",
        )
        self.assertTrue(create.data["photo"])
        update = self.client.patch(
            f"/api/tv-display/slides/{create.data['id']}/", {"remove_photo": True}, format="multipart"
        )
        self.assertEqual(update.status_code, status.HTTP_200_OK, update.data)
        self.assertFalse(update.data["photo"])

    def test_replacing_photo_ignores_remove_photo_flag(self):
        """If both a new photo AND remove_photo=True are somehow sent in
        the same request, the new photo wins — "replace" beats "remove"
        rather than the two fighting to leave the slide in an ambiguous
        state.
        """
        self.client.force_authenticate(self.comms)
        create = self.client.post(
            "/api/tv-display/slides/",
            {"section_key": "staff_spotlight", "title": "Abebe Bekele", "photo": self._photo("first.jpg")},
            format="multipart",
        )
        first_photo_url = create.data["photo"]
        update = self.client.patch(
            f"/api/tv-display/slides/{create.data['id']}/",
            {"remove_photo": True, "photo": self._photo("second.jpg")},
            format="multipart",
        )
        self.assertTrue(update.data["photo"])
        self.assertNotEqual(update.data["photo"], first_photo_url)

    def test_editing_other_fields_leaves_existing_photo_untouched(self):
        self.client.force_authenticate(self.comms)
        create = self.client.post(
            "/api/tv-display/slides/",
            {"section_key": "staff_spotlight", "title": "Abebe Bekele", "photo": self._photo("headshot.jpg")},
            format="multipart",
        )
        update = self.client.patch(f"/api/tv-display/slides/{create.data['id']}/", {"title": "Updated Name"}, format="json")
        self.assertEqual(update.status_code, status.HTTP_200_OK, update.data)
        self.assertEqual(update.data["title"], "Updated Name")
        self.assertTrue(update.data["photo"])


class TVDisplaySlidePaginationTests(APITestCase):
    """The TV Display / settings panel need every slide in one request —
    the default page of 20 used to silently drop the rest."""

    def setUp(self):
        from apps.tv_display.models import TVDisplaySlide

        self.comms = User.objects.create_user(username="comms2", email="comms2@x.com", password="x", role=Role.COMMUNICATIONS)
        TVDisplaySlide.objects.bulk_create(
            [TVDisplaySlide(section_key="announcements", title=f"Slide {i}", order=i) for i in range(25)]
        )
        self.client.force_authenticate(self.comms)

    def test_default_page_size_unchanged(self):
        resp = self.client.get("/api/tv-display/slides/")
        self.assertEqual(resp.data["count"], 25)
        self.assertEqual(len(resp.data["results"]), 20)
        self.assertIsNotNone(resp.data["next"])

    def test_page_size_returns_all_slides_in_one_request(self):
        resp = self.client.get("/api/tv-display/slides/", {"page_size": 500, "active_only": 1})
        self.assertEqual(len(resp.data["results"]), 25)
        self.assertIsNone(resp.data["next"])
