from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User


class TVDisplaySettingsTests(APITestCase):
    """Phase 44 (role/permission control): GET is every authenticated role
    (the live TV and every role's read-only settings page need it). PATCH
    uses `IsAdminOrLeadership` (apps/core/permissions.py) — see
    test_leadership_cannot_update_settings below for an important caveat:
    that permission class's actual check currently only allows Admin/
    superuser, despite its name.
    """

    def setUp(self):
        self.staff = User.objects.create_user(username="staff2", email="staff2@x.com", password="x", role=Role.STAFF)
        self.comms = User.objects.create_user(username="comms2", email="comms2@x.com", password="x", role=Role.COMMUNICATIONS)
        self.leader = User.objects.create_user(username="lead2", email="lead2@x.com", password="x", role=Role.LEADERSHIP)
        self.admin = User.objects.create_user(username="admin2", email="admin2@x.com", password="x", role=Role.ADMIN)

    def test_every_role_can_read_settings(self):
        for user in (self.staff, self.comms, self.leader, self.admin):
            self.client.force_authenticate(user)
            resp = self.client.get("/api/tv-display/settings/")
            self.assertEqual(resp.status_code, status.HTTP_200_OK, f"{user.role} should be able to read settings")

    def test_default_settings_do_not_include_last_weeks_events(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/tv-display/settings/")
        keys = [s["key"] for s in resp.data["sections"]]
        self.assertNotIn("recent_events", keys)
        self.assertEqual(keys[0], "todays_activities")
        # Today's Activities is a manual queue now, so it starts Off.
        self.assertFalse(resp.data["sections"][0]["enabled"])

    def test_only_automatic_queues_are_enabled_by_default(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/tv-display/settings/")
        for s in resp.data["sections_display"]:
            self.assertEqual(s["enabled"], s["is_automatic"], s["key"])

    def test_legacy_last_weeks_events_entry_is_stripped_from_saved_settings(self):
        from apps.tv_display.models import TVDisplaySettings

        obj = TVDisplaySettings.get_settings()
        obj.sections = [{"key": "recent_events", "enabled": True, "duration_seconds": None}, *obj.sections]
        obj.save()
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/tv-display/settings/")
        self.assertNotIn("recent_events", [s["key"] for s in resp.data["sections"]])

    def test_admin_can_update_settings(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch("/api/tv-display/settings/", {"screen_duration_seconds": 20}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["screen_duration_seconds"], 20)

    def test_leadership_cannot_update_settings(self):
        """Documents ACTUAL current behavior, not necessarily intended
        behavior — flagging this, don't quietly rely on it. The shared
        `IsAdminOrLeadership` permission class (apps/core/permissions.py),
        used here AND for Configuration's System Settings/dropdown lists,
        Events, Communications, and Accounts, is named/documented as
        "Admin or Leadership" but its actual check is
        `role == Role.ADMIN or is_superuser` — Role.LEADERSHIP is never
        checked at all. That's a pre-existing bug outside TV Display's
        scope (it predates this feature and affects 4 other apps), so
        this test asserts today's real behavior rather than masking the
        discrepancy or silently "fixing" a widely shared permission class
        as a side effect of testing one feature.
        """
        self.client.force_authenticate(self.leader)
        resp = self.client.patch("/api/tv-display/settings/", {"is_active": False}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_cannot_update_settings(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.patch("/api/tv-display/settings/", {"is_active": False}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_communications_cannot_update_master_settings(self):
        """Communications manages slide *content* (test_slides.py), not the
        master on/off + section order + timing — that stays Admin/
        Leadership only, same as before Communications got any TV Display
        access at all.
        """
        self.client.force_authenticate(self.comms)
        resp = self.client.patch("/api/tv-display/settings/", {"is_active": False}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_screen_duration_below_minimum_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch("/api/tv-display/settings/", {"screen_duration_seconds": 1}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_settings_is_a_true_singleton(self):
        self.client.force_authenticate(self.admin)
        first = self.client.get("/api/tv-display/settings/").data
        self.client.patch("/api/tv-display/settings/", {"screen_duration_seconds": 25}, format="json")
        second = self.client.get("/api/tv-display/settings/").data
        # Same row updated in place, not a second one created — updated_at
        # should change but nothing about this being a second record.
        self.assertEqual(second["screen_duration_seconds"], 25)
        self.assertNotEqual(first["updated_at"], second["updated_at"])

    def test_reordering_sections_is_persisted(self):
        self.client.force_authenticate(self.admin)
        current = self.client.get("/api/tv-display/settings/").data["sections"]
        reordered = list(reversed(current))
        resp = self.client.patch("/api/tv-display/settings/", {"sections": reordered}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual([s["key"] for s in resp.data["sections"]], [s["key"] for s in reordered])

    def test_invalid_section_keys_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(
            "/api/tv-display/settings/",
            {"sections": [{"key": "not_a_real_section", "enabled": True}]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_content_mode_defaults_automatic_for_automatic_sections_manual_for_the_rest(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/tv-display/settings/")
        by_key = {s["key"]: s for s in resp.data["sections_display"]}
        self.assertEqual(by_key["todays_activities"]["content_mode"], "manual")
        self.assertEqual(by_key["upcoming_events"]["content_mode"], "automatic")
        self.assertEqual(by_key["staff_spotlight"]["content_mode"], "manual")
        self.assertEqual(by_key["system_dashboard_picks"]["content_mode"], "manual")
        self.assertEqual(by_key["home_news"]["content_mode"], "manual")
        self.assertEqual(by_key["home_major_events"]["content_mode"], "manual")
        self.assertEqual(by_key["home_announcements"]["content_mode"], "manual")

    def test_home_content_sections_present_and_not_automatic(self):
        """News (Home Page) / Major Events (Home Page) / Announcements
        (Home Page) each ship as their own fixed queue, like Announcements/
        Staff Spotlight, but are never treated as automatic — nothing
        shows until someone adds content (from here or from Home Page >
        Manage Content, since it's the same apps.content.HomeContent pool,
        still added through the one shared form regardless of which of
        these three queues you opened it from)."""
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/tv-display/settings/")
        keys = [s["key"] for s in resp.data["sections"]]
        by_key = {s["key"]: s for s in resp.data["sections_display"]}
        for key in ("home_news", "home_major_events", "home_announcements"):
            self.assertIn(key, keys)
            self.assertFalse(by_key[key]["is_automatic"])
            self.assertFalse(by_key[key]["is_custom"])

    def test_admin_can_set_a_manual_section_to_automatic(self):
        # A manual-slide section (no automatic data source yet) can now be
        # switched to "automatic" too, same as the reverse was already
        # allowed for the 4 automatic sections — it's a reserved, settings-
        # only choice either way (see models._default_sections).
        self.client.force_authenticate(self.admin)
        current = self.client.get("/api/tv-display/settings/").data["sections"]
        updated = [
            {**s, "content_mode": "automatic"} if s["key"] == "staff_spotlight" else s for s in current
        ]
        resp = self.client.patch("/api/tv-display/settings/", {"sections": updated}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        by_key = {s["key"]: s for s in resp.data["sections_display"]}
        self.assertEqual(by_key["staff_spotlight"]["content_mode"], "automatic")

    def test_invalid_content_mode_value_rejected(self):
        self.client.force_authenticate(self.admin)
        current = self.client.get("/api/tv-display/settings/").data["sections"]
        updated = [
            {**s, "content_mode": "sometimes"} if s["key"] == "announcements" else s for s in current
        ]
        resp = self.client.patch("/api/tv-display/settings/", {"sections": updated}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_dashboard_picks_default_to_all_disabled(self):
        """Phase 32/25: opt-in, not opt-out — unlike `sections` (everything
        on by default), no dashboard should appear until an Admin
        specifically picks it.
        """
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/tv-display/settings/")
        self.assertTrue(all(not p["enabled"] for p in resp.data["dashboard_picks"]))

    def test_admin_can_enable_a_dashboard_pick(self):
        self.client.force_authenticate(self.admin)
        current = self.client.get("/api/tv-display/settings/").data["dashboard_picks"]
        updated = [dict(p, enabled=(p["key"] == "org_summary")) for p in current]
        resp = self.client.patch("/api/tv-display/settings/", {"dashboard_picks": updated}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        enabled_keys = [p["key"] for p in resp.data["dashboard_picks"] if p["enabled"]]
        self.assertEqual(enabled_keys, ["org_summary"])

    def test_dashboard_picks_display_includes_labels(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.get("/api/tv-display/settings/")
        labels = {p["key"]: p["label"] for p in resp.data["dashboard_picks_display"]}
        self.assertEqual(labels["org_summary"], "Organization Summary")
        self.assertEqual(labels["region_breakdown"], "Events by Region")

    def test_invalid_dashboard_pick_keys_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(
            "/api/tv-display/settings/",
            {"dashboard_picks": [{"key": "not_a_real_dashboard", "enabled": True}]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_staff_cannot_enable_dashboard_picks(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.patch(
            "/api/tv-display/settings/",
            {"dashboard_picks": [{"key": "org_summary", "enabled": True}]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
