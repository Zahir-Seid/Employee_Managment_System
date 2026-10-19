from datetime import date, timedelta

from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.content.models import HomeContent, HomeContentType, SiteSettings
from apps.core.tests.factories import make_user

# 1x1 transparent PNG, valid enough for Pillow/ImageField validation.
TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


class HomeFeedTests(APITestCase):
    def setUp(self):
        self.admin = make_user(email="admin1@ee.org", role=Role.ADMIN)
        self.staff = make_user(email="staff1@ee.org", role=Role.STAFF)

    def test_tv_and_home_content_are_kept_separate(self):
        # Added for the TV only -> never on the Home Page; added for the
        # Home Page only -> never on the TV; legacy "both" shows in each.
        for title, audience in [("TV only", "tv"), ("Home only", "home"), ("Legacy", "both")]:
            HomeContent.objects.create(
                content_type=HomeContentType.ANNOUNCEMENT, title=title, description="x", audience=audience
            )
        home = [a["title"] for a in self.client.get("/api/home/feed/").data["announcements"]]
        tv = [a["title"] for a in self.client.get("/api/home/feed/?audience=tv&all=1").data["announcements"]]
        self.assertEqual(sorted(home), ["Home only", "Legacy"])
        self.assertEqual(sorted(tv), ["Legacy", "TV only"])

    def test_manage_list_filters_by_audience(self):
        HomeContent.objects.create(content_type=HomeContentType.NEWS, title="T", audience="tv", publish_date=date.today())
        HomeContent.objects.create(content_type=HomeContentType.NEWS, title="H", audience="home", publish_date=date.today())
        resp = self.client.get("/api/home/content/?audience=tv")
        titles = [i["title"] for i in (resp.data if isinstance(resp.data, list) else resp.data["results"])]
        self.assertEqual(titles, ["T"])

    def test_anonymous_manage_list_only_returns_currently_showable_items(self):
        """Security review #4: GET /api/home/content/ is AllowAny, so an
        anonymous caller must get exactly what the public feed would show
        today — unpublished drafts and future-scheduled rows stay internal
        until they authenticate. The Manage Content page itself (the only
        consumer that needs the full list) is always authenticated.
        """
        HomeContent.objects.create(content_type=HomeContentType.NEWS, title="Published", audience="home", publish_date=date.today())
        HomeContent.objects.create(
            content_type=HomeContentType.NEWS, title="Unpublished Draft", audience="home", publish_date=date.today(),
            is_published=False,
        )
        HomeContent.objects.create(
            content_type=HomeContentType.ANNOUNCEMENT, title="Deactivated", audience="home", publish_date=date.today(),
            is_active=False,
        )
        list_resp = self.client.get("/api/home/content/")
        list_items = list_resp.data if isinstance(list_resp.data, list) else list_resp.data["results"]
        anon_titles = [i["title"] for i in list_items]
        self.assertIn("Published", anon_titles)
        self.assertNotIn("Unpublished Draft", anon_titles)
        self.assertNotIn("Deactivated", anon_titles)
        self.client.force_authenticate(user=self.admin)
        authed_resp = self.client.get("/api/home/content/")
        authed_items = authed_resp.data if isinstance(authed_resp.data, list) else authed_resp.data["results"]
        authed_titles = [i["title"] for i in authed_items]
        self.assertIn("Unpublished Draft", authed_titles)
        self.assertIn("Deactivated", authed_titles)

    def test_tv_feed_all_param_skips_home_page_cap(self):
        # The Home page caps each section at 6; the TV Display asks for
        # ?all=1 so every showable item (e.g. a 7th Major Event) reaches it.
        for i in range(8):
            HomeContent.objects.create(
                content_type=HomeContentType.MAJOR_EVENT,
                title=f"Major {i}",
                description="x",
                start_date=date.today() + timedelta(days=i),
                end_date=date.today() + timedelta(days=i),
            )
        capped = self.client.get("/api/home/feed/")
        self.assertEqual(len(capped.data["major_events"]), 6)
        full = self.client.get("/api/home/feed/?all=1")
        self.assertEqual(len(full.data["major_events"]), 8)

    def test_public_feed_hides_inactive_and_shows_active(self):
        HomeContent.objects.create(
            content_type=HomeContentType.NEWS,
            title="Old inactive",
            description="x",
            publish_date=date.today(),
            is_active=False,
        )
        HomeContent.objects.create(
            content_type=HomeContentType.NEWS,
            title="Fresh news",
            description="x",
            publish_date=date.today(),
        )
        resp = self.client.get("/api/home/feed/")
        self.assertEqual(resp.status_code, 200)
        titles = [n["title"] for n in resp.data["latest_news"]]
        self.assertIn("Fresh news", titles)
        self.assertNotIn("Old inactive", titles)

    def test_featured_respects_date_window(self):
        HomeContent.objects.create(
            content_type=HomeContentType.ANNOUNCEMENT,
            title="Expired announcement",
            description="x",
            start_date=date.today() - timedelta(days=10),
            end_date=date.today() - timedelta(days=1),
            is_featured=True,
        )
        HomeContent.objects.create(
            content_type=HomeContentType.ANNOUNCEMENT,
            title="Live announcement",
            description="x",
            start_date=date.today() - timedelta(days=1),
            end_date=date.today() + timedelta(days=5),
            is_featured=True,
        )
        resp = self.client.get("/api/home/feed/")
        titles = [f["title"] for f in resp.data["announcements"]]
        self.assertIn("Live announcement", titles)
        self.assertNotIn("Expired announcement", titles)

    def test_anonymous_cannot_create_content(self):
        resp = self.client.post("/api/home/content/", {
            "content_type": "news",
            "title": "Should fail",
            "description": "x",
            "publish_date": str(date.today()),
        })
        self.assertEqual(resp.status_code, 401)

    def test_staff_cannot_create_content(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.post("/api/home/content/", {
            "content_type": "news",
            "title": "Should fail",
            "description": "x",
            "publish_date": str(date.today()),
        })
        self.assertEqual(resp.status_code, 403)

    def test_admin_can_create_and_edit_news(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.client.force_authenticate(self.admin)
        photo = SimpleUploadedFile("news.png", TINY_PNG, content_type="image/png")
        resp = self.client.post("/api/home/content/", {
            "content_type": "news",
            "title": "New piece",
            "description": "body text",
            "publish_date": str(date.today()),
            "image": photo,
        }, format="multipart")
        self.assertEqual(resp.status_code, 201, resp.data)
        content_id = resp.data["id"]

        resp = self.client.patch(f"/api/home/content/{content_id}/", {"title": "Edited piece"})
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["title"], "Edited piece")

    def test_news_requires_publish_date(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.client.force_authenticate(self.admin)
        photo = SimpleUploadedFile("news.png", TINY_PNG, content_type="image/png")
        resp = self.client.post("/api/home/content/", {
            "content_type": "news",
            "title": "No date",
            "description": "body",
            "image": photo,
        }, format="multipart")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("publish_date", resp.data["errors"])

    def test_site_settings_public_get_and_gated_patch(self):
        resp = self.client.get("/api/home/site-settings/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["km_resource_url"], "https://www.ee.org")

        resp = self.client.patch("/api/home/site-settings/", {"km_resource_url": "https://example.org"})
        self.assertEqual(resp.status_code, 401)

        self.client.force_authenticate(self.admin)
        resp = self.client.patch("/api/home/site-settings/", {"km_resource_url": "https://example.org"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(SiteSettings.get_settings().km_resource_url, "https://example.org")

    def test_content_list_is_paginated(self):
        # Manage Content's list view inherits the project-wide
        # PageNumberPagination default (config/settings.py REST_FRAMEWORK)
        # rather than a plain array — the frontend list() must unwrap
        # `results` accordingly (see HomeContentPanel.jsx / api/content.js).
        HomeContent.objects.create(
            content_type=HomeContentType.NEWS, title="A", description="x", publish_date=date.today()
        )
        resp = self.client.get("/api/home/content/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("results", resp.data)
        self.assertIn("count", resp.data)

    def test_remove_image_clears_existing_photo(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.client.force_authenticate(self.admin)
        photo = SimpleUploadedFile("news.png", TINY_PNG, content_type="image/png")
        resp = self.client.post("/api/home/content/", {
            "content_type": "news",
            "title": "Has photo",
            "description": "body",
            "publish_date": str(date.today()),
            "image": photo,
        }, format="multipart")
        self.assertEqual(resp.status_code, 201, resp.data)
        content_id = resp.data["id"]
        self.assertTrue(resp.data["image"])

        resp = self.client.patch(f"/api/home/content/{content_id}/", {"remove_image": True})
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(resp.data["image"])


class HomeEventsCarouselTests(APITestCase):
    """Recently Held (automatic from Events) + Upcoming Events (Add Content)."""

    def setUp(self):
        from apps.core.tests.factories import make_event, make_past_event

        self.admin = make_user(email="admin2@ee.org", role=Role.ADMIN)
        self.make_event = make_event
        self.make_past_event = make_past_event

    def test_held_events_are_automatic_recent_first_and_exclude_cancelled(self):
        from apps.events.models import EventStatus

        old = self.make_past_event(self.admin, title="Older held")
        newer = self.make_past_event(self.admin, title="Newer held")
        old.start_date = old.end_date = date.today() - timedelta(days=30)
        old.save()
        newer.start_date = newer.end_date = date.today() - timedelta(days=3)
        newer.save()
        cancelled = self.make_past_event(self.admin, title="Cancelled one")
        cancelled.status = EventStatus.CANCELLED
        cancelled.save()
        self.make_event(self.admin, title="Future one", days_from_today=10)

        resp = self.client.get("/api/home/feed/")
        titles = [e["title"] for e in resp.data["held_events"]]
        self.assertEqual(titles, ["Newer held", "Older held"])
        self.assertIsNone(resp.data["held_events"][0]["image"])

    def test_held_events_capped_at_twelve(self):
        for i in range(15):
            self.make_past_event(self.admin, title=f"Held {i}")
        resp = self.client.get("/api/home/feed/")
        self.assertEqual(len(resp.data["held_events"]), 12)

    def test_upcoming_events_soonest_first_and_expire(self):
        # Home Page Upcoming Events are automatic, read from the Event
        # Registry: logged events that have not started yet, soonest first.
        # Started, passed and cancelled events are left out.
        from apps.core.tests.factories import make_event

        owner = make_user(email="upcoming-owner@ee.org", role=Role.STAFF)
        make_event(owner, title="Later", days_from_today=20)
        make_event(owner, title="Sooner", days_from_today=2)
        make_event(owner, title="Already over", days_from_today=-5)
        make_event(owner, title="Already started", days_from_today=0)
        cancelled = make_event(owner, title="Cancelled", days_from_today=4)
        cancelled.status = "cancelled"
        cancelled.save()
        resp = self.client.get("/api/home/feed/")
        titles = [e["title"] for e in resp.data["upcoming_events"]]
        self.assertEqual(titles, ["Sooner", "Later"])

    def test_add_upcoming_event_requires_date_and_location(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            "/api/home/content/",
            {"content_type": "upcoming_event", "title": "No details"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("start_date", resp.data["errors"])
        self.assertIn("location", resp.data["errors"])

        resp = self.client.post(
            "/api/home/content/",
            {
                "content_type": "upcoming_event",
                "title": "Regional Workshop",
                "start_date": str(date.today() + timedelta(days=7)),
                "location": "Hawassa",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)


class RecentMomentsTests(APITestCase):
    """Home page Recent Moments: photos from events held within the past 30
    days (by event date), newest event first; empty when there are none."""

    def setUp(self):
        import shutil
        import tempfile

        from django.test import override_settings

        self._media = tempfile.mkdtemp()
        self._override = override_settings(MEDIA_ROOT=self._media)
        self._override.enable()
        self.addCleanup(self._override.disable)
        self.addCleanup(shutil.rmtree, self._media, True)
        self.staff = make_user(email="moments@ee.org", role=Role.STAFF)

    def _photo(self, title, days_ago_end, status="logged", n=1):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from apps.core.tests.factories import make_event
        from apps.reports.models import EventPhoto, PostEventReport

        # make_event ends a day after its start, so start = -(ended + 1).
        event = make_event(self.staff, title=title, days_from_today=-(days_ago_end + 1))
        if status != "logged":
            event.status = status
            event.save()
        report = PostEventReport.objects.create(event=event)
        for i in range(n):
            EventPhoto.objects.create(
                post_event_report=report, image=SimpleUploadedFile(f"{title}-{i}.png", TINY_PNG, content_type="image/png")
            )
        return event

    def _titles(self):
        data = self.client.get("/api/home/feed/").data["event_photos"]
        return [p["event_title"] for p in data]

    def test_only_events_from_the_past_30_days_newest_first(self):
        self._photo("ended 31 days ago", 31)
        self._photo("ended 29 days ago", 29)
        self._photo("ended 2 days ago", 2)
        self._photo("ended 10 days ago", 10, n=2)
        titles = self._titles()
        self.assertEqual(
            titles,
            ["ended 2 days ago", "ended 10 days ago", "ended 10 days ago", "ended 29 days ago"],
        )

    def test_future_cancelled_and_postponed_events_are_not_shown(self):
        self._photo("not held yet", -5)  # ends 5 days in the future
        self._photo("cancelled", 3, status="cancelled")
        self._photo("postponed", 3, status="postponed")
        self._photo("held", 3)
        self.assertEqual(self._titles(), ["held"])

    def test_nothing_in_window_gives_empty_list_so_section_is_hidden(self):
        self._photo("too old", 60)
        self.assertEqual(self._titles(), [])
