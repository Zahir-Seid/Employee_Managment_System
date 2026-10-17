from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.tv_display.models import SECTION_KEYS, TVDisplaySettings


def _frontend_save_payload(settings_json):
    """Exactly what TVDisplaySettingsPanel.handleSave sends: every section
    from the last response, carrying the custom/label markers through."""
    return {
        "is_active": settings_json["is_active"],
        "screen_duration_seconds": settings_json["screen_duration_seconds"],
        "sections": [
            {
                "key": s["key"],
                "enabled": s["enabled"],
                "duration_seconds": s.get("duration_seconds"),
                "content_mode": s.get("content_mode") or "manual",
                **({"custom": True, "label": s["label"]} if s.get("custom") else {}),
            }
            for s in settings_json["sections"]
        ],
        "dashboard_picks": [{"key": p["key"], "enabled": p["enabled"]} for p in settings_json["dashboard_picks"]],
        "analytics_period": settings_json.get("analytics_period") or "monthly",
        "analytics_period_selection": settings_json.get("analytics_period_selection") or {},
    }


class QueueFlowTests(APITestCase):
    """add -> save -> persist -> display -> edit -> delete, end to end.

    The important cases are the ones where the saved settings row is OLDER
    than the code (built-in sections added/renamed/removed since it was
    saved): previously the row was never reconciled with SECTION_KEYS, so
    the very next Save was rejected and queue changes looked like they
    "didn't stick".
    """

    def setUp(self):
        self.comms = User.objects.create_user(username="c1", email="c1@x.com", password="x", role=Role.COMMUNICATIONS)
        self.client.force_authenticate(self.comms)

    def _flow(self):
        # add
        resp = self.client.post("/api/tv-display/custom-sections/", {"label": "Live Announcement"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        created = [s for s in resp.data["sections"] if s.get("custom")]
        self.assertEqual(len(created), 1)
        key = created[0]["key"]
        # the add response itself already contains it (immediate display)
        self.assertIn(key, [s["key"] for s in resp.data["sections_display"]])

        # persist: a fresh GET shows it
        got = self.client.get("/api/tv-display/settings/")
        self.assertEqual(got.status_code, 200)
        self.assertIn(key, [s["key"] for s in got.data["sections"]])

        # save settings (what the panel's Save button sends) must be accepted
        # and must keep the queue
        saved = self.client.patch("/api/tv-display/settings/", _frontend_save_payload(got.data), format="json")
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertIn(key, [s["key"] for s in saved.data["sections"]])
        again = self.client.get("/api/tv-display/settings/")
        self.assertIn(key, [s["key"] for s in again.data["sections"]])
        # every built-in section is present too
        for built_in in SECTION_KEYS:
            self.assertIn(built_in, [s["key"] for s in again.data["sections"]])

        # display: a slide can be authored into it and is listed
        slide = self.client.post("/api/tv-display/slides/", {"section_key": key, "title": "Hello"}, format="json")
        self.assertEqual(slide.status_code, status.HTTP_201_CREATED, slide.data)
        listed = self.client.get("/api/tv-display/slides/")
        rows = listed.data["results"] if isinstance(listed.data, dict) else listed.data
        self.assertTrue(any(r["section_key"] == key for r in rows))

        # edit: rename persists
        ren = self.client.patch(f"/api/tv-display/custom-sections/{key}/", {"label": "Breaking News"}, format="json")
        self.assertEqual(ren.status_code, 200, ren.data)
        after_rename = self.client.get("/api/tv-display/settings/")
        self.assertEqual(next(s["label"] for s in after_rename.data["sections"] if s["key"] == key), "Breaking News")

        # delete: queue and its slides are gone
        dele = self.client.delete(f"/api/tv-display/custom-sections/{key}/")
        self.assertIn(dele.status_code, (200, 204), getattr(dele, "data", None))
        after_delete = self.client.get("/api/tv-display/settings/")
        self.assertNotIn(key, [s["key"] for s in after_delete.data["sections"]])
        rows = self.client.get("/api/tv-display/slides/").data
        rows = rows["results"] if isinstance(rows, dict) else rows
        self.assertFalse(any(r["section_key"] == key for r in rows))

    def test_full_flow_on_fresh_settings(self):
        self._flow()

    def test_full_flow_when_saved_settings_predate_current_sections(self):
        """A row saved by an older version: missing built-ins, holding
        retired keys, and an entry without content_mode."""
        row = TVDisplaySettings.get_settings()
        row.sections = [
            {"key": "todays_activities", "enabled": True, "duration_seconds": None},
            {"key": "upcoming_events", "enabled": True, "duration_seconds": 20, "content_mode": "automatic"},
            {"key": "home_content", "enabled": True, "duration_seconds": None},  # retired key
            {"key": "recent_events", "enabled": True, "duration_seconds": None},  # retired key
        ]
        row.dashboard_picks = []  # older row without picks
        row.save()
        self._flow()

    def test_existing_choices_survive_reconciliation(self):
        row = TVDisplaySettings.get_settings()
        row.sections = [
            {"key": "upcoming_events", "enabled": False, "duration_seconds": 20, "content_mode": "manual"},
            {"key": "staff_spotlight", "enabled": True, "duration_seconds": None, "content_mode": "manual"},
        ]
        row.save()
        got = self.client.get("/api/tv-display/settings/").data
        by_key = {s["key"]: s for s in got["sections"]}
        self.assertFalse(by_key["upcoming_events"]["enabled"])
        self.assertEqual(by_key["upcoming_events"]["duration_seconds"], 20)
        self.assertEqual(by_key["upcoming_events"]["content_mode"], "manual")
        self.assertTrue(by_key["staff_spotlight"]["enabled"])
        # order of what the admin had is preserved, missing ones appended
        keys = [s["key"] for s in got["sections"]]
        self.assertLess(keys.index("upcoming_events"), keys.index("staff_spotlight"))
        self.assertEqual(sorted(k for k in keys if k in SECTION_KEYS), sorted(SECTION_KEYS))
