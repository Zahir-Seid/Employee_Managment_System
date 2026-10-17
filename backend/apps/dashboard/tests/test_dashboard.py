from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.core.tests.factories import make_communications, make_event, make_staff
from apps.events.models import EventCategory
from apps.reports.models import PostEventReport, ReportStatus


class DashboardSummaryTests(APITestCase):
    """FR35-FR39 + updated requirement #7 (Engagement Level breakdown,
    participant counts, Upcoming Events).
    """

    def setUp(self):
        self.staff = make_staff()
        self.comms = make_communications()
        self.event1 = make_event(self.staff, category=EventCategory.INTERNATIONAL, title="Intl 1", expected_participants=40)
        self.event2 = make_event(self.staff, category=EventCategory.INTERNAL, needs_comms_support=True, title="Internal 1", expected_participants=20)
        make_event(self.staff, category=EventCategory.INTERNAL, needs_comms_support=False, title="Internal 2", expected_participants=10)

    def test_staff_dashboard_only_counts_their_own_events(self):
        other_staff = make_staff(email="other@ee.org")
        make_event(other_staff, title="Other 1")
        self.client.force_authenticate(user=other_staff)
        response = self.client.get(reverse("dashboard:dashboard"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["summary"]["total_events"], 1)

    def test_communications_dashboard_is_org_wide(self):
        self.client.force_authenticate(user=self.comms)
        response = self.client.get(reverse("dashboard:dashboard"))
        self.assertEqual(response.data["summary"]["total_events"], 3)

    def test_staff_with_no_events_still_see_big_and_upcoming_events(self):
        owner = make_staff(email="owner@ee.org")
        make_event(owner, category=EventCategory.INTERNATIONAL, title="Big One")
        newcomer = make_staff(email="newcomer@ee.org")
        self.client.force_authenticate(user=newcomer)

        dashboard = self.client.get(reverse("dashboard:dashboard"))
        self.assertEqual(dashboard.data["summary"]["total_events"], 0)

        big = self.client.get(reverse("dashboard:big-events"))
        self.assertEqual(big.status_code, status.HTTP_200_OK)
        self.assertIn("Big One", [e["title"] for e in big.data["results"]])

        upcoming = self.client.get(reverse("dashboard:upcoming-events-list"))
        self.assertIn("Big One", [e["title"] for e in upcoming.data["results"]])

    def test_staff_still_see_everyones_upcoming_events(self):
        other_staff = make_staff(email="other@ee.org")
        self.client.force_authenticate(user=other_staff)
        response = self.client.get(reverse("dashboard:upcoming-events-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = [e["title"] for e in response.data["results"]]
        self.assertIn("Intl 1", titles)

    def test_summary_counts_by_category(self):
        self.client.force_authenticate(user=self.comms)
        response = self.client.get(reverse("dashboard:dashboard"))
        summary = response.data["summary"]
        self.assertEqual(summary["international_events"], 1)
        self.assertEqual(summary["internal_events"], 2)
        self.assertEqual(summary["total_events"], 3)

    def test_participant_stats_computed_correctly(self):
        """Actuals only, from submitted Event Status Reports — matches the
        rule used everywhere else in the Reports module (see
        apps.dashboard.services.get_participant_stats' docstring). The
        two events with no submitted report (one with none at all, one
        with expected_participants=10 but never reported) don't
        contribute their *expected* headcount here, only event1's real
        submitted numbers do.
        """
        PostEventReport.objects.create(
            event=self.event1, status=ReportStatus.SUBMITTED, participants_male=30, participants_female=20
        )
        self.client.force_authenticate(user=self.comms)
        response = self.client.get(reverse("dashboard:dashboard"))
        stats = response.data["participant_stats"]
        self.assertEqual(stats["total_participants"], 50)
        self.assertEqual(stats["average_participants"], 50.0)

    def test_invalid_scope_rejected(self):
        self.client.force_authenticate(user=self.comms)
        response = self.client.get(reverse("dashboard:dashboard"), {"scope": "single_event"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_thematic_area_scope_returns_sectioned_breakdown(self):
        self.client.force_authenticate(user=self.comms)
        response = self.client.get(reverse("dashboard:dashboard"), {"scope": "thematic_area"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("thematic_areas", response.data)
        self.assertIn("Digital Health", response.data["thematic_areas"])

    def test_category_filter_narrows_results(self):
        self.client.force_authenticate(user=self.comms)
        response = self.client.get(reverse("dashboard:dashboard"), {"category": "international"})
        self.assertEqual(response.data["summary"]["total_events"], 1)

    def test_date_range_scopes_charts_for_tv_display_analytics(self):
        """The TV Display's Event Analytics screen (Phase 18) asks for
        date_from/date_to spanning the current calendar year so
        charts.monthly_trend and charts.by_category default to "this
        year" instead of all-time — this is the exact request shape
        TvDisplay.jsx sends, proven against real events rather than
        assumed from reading the filter code.
        """
        from datetime import date

        from apps.core.tests.factories import make_past_event

        old_event = make_past_event(self.staff, title="Two years ago", category=EventCategory.INTERNAL)
        old_event.start_date = date(date.today().year - 2, 3, 1)
        old_event.end_date = date(date.today().year - 2, 3, 2)
        old_event.save(update_fields=["start_date", "end_date"])

        self.client.force_authenticate(user=self.comms)
        year = date.today().year
        response = self.client.get(
            reverse("dashboard:dashboard"),
            {"date_from": f"{year}-01-01", "date_to": f"{year}-12-31"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # The 3 setUp events (all created "today" via make_event's default
        # days_from_today) fall inside the current year and should count;
        # the 2-years-ago event must not.
        self.assertEqual(response.data["summary"]["total_events"], 3)
        self.assertIn("monthly_trend", response.data["charts"])
        self.assertIn("by_category", response.data["charts"])
        total_from_trend = sum(m["count"] for m in response.data["charts"]["monthly_trend"])
        self.assertEqual(total_from_trend, 3)


class TVDisplayUpcomingEventsScopeTests(APITestCase):
    """Characterizes a real gap found while testing the TV Display's
    Upcoming Events screen: get_upcoming_events (and get_upcoming_count_30d)
    scope to the logged-in user's OWN events when that user's role is
    Staff (FR3's "My Events" rule) — correct for a Staff member's personal
    Dashboard, but wrong for a shared office TV, where whichever account
    happens to be logged into that browser is incidental and every viewer
    expects to see the whole organization's upcoming events regardless.

    This first test proves the gap exists as shipped; the second proves
    the fix (an explicit ?upcoming_scope=org override, additive and
    opt-in, leaving every existing caller's behavior unchanged).
    """

    def setUp(self):
        self.staff_a = make_staff(email="staff.a@ee.org")
        self.staff_b = make_staff(email="staff.b@ee.org")
        make_event(self.staff_a, title="Staff A's event", days_from_today=5)
        make_event(self.staff_b, title="Staff B's event", days_from_today=6)

    def test_staff_role_only_sees_own_upcoming_events_by_default(self):
        """This is the existing, intentional behavior for a Staff member's
        own Dashboard (FR3) — asserting it so the fix below is proven
        additive, not a silent behavior change for that existing case.
        """
        self.client.force_authenticate(user=self.staff_a)
        response = self.client.get(reverse("dashboard:dashboard"))
        titles = [e["title"] for e in response.data["upcoming_events"]]
        self.assertIn("Staff A's event", titles)
        self.assertNotIn("Staff B's event", titles)

    def test_org_wide_override_shows_every_staff_members_upcoming_events(self):
        self.client.force_authenticate(user=self.staff_a)
        response = self.client.get(reverse("dashboard:dashboard"), {"upcoming_scope": "org"})
        titles = [e["title"] for e in response.data["upcoming_events"]]
        self.assertIn("Staff A's event", titles)
        self.assertIn("Staff B's event", titles)


class UpcomingEventsEnhancementTests(APITestCase):
    """Dashboard Upcoming Events Enhancement: the org-wide List/Aggregate
    endpoints behind the Dashboard's Upcoming Events card and its "View
    All" page (apps/dashboard/upcoming_events.py).
    """

    def setUp(self):
        self.staff_a = make_staff(email="a@ee.org", first_name="Hana", last_name="Alem")
        self.staff_b = make_staff(email="b@ee.org", first_name="Abel", last_name="Tesfaye")
        self.comms = make_communications()
        self.list_url = reverse("dashboard:upcoming-events-list")
        self.aggregate_url = reverse("dashboard:upcoming-events-aggregate")
        self.options_url = reverse("dashboard:upcoming-events-filter-options")

        self.a_event = make_event(
            self.staff_a, title="DHIS2 Training", days_from_today=2, category=EventCategory.INTERNAL,
            thematic_area="Digital Health",
        )
        self.b_event = make_event(
            self.staff_b, title="MFR Workshop", days_from_today=5, category=EventCategory.INTERNATIONAL,
            thematic_area="Health Financing",
        )
        self.b_event_2 = make_event(
            self.staff_b, title="Data Review Meeting", days_from_today=9, category=EventCategory.INTERNAL,
            thematic_area="Digital Health",
        )
        # Started before today: no longer "upcoming".
        self.past_event = make_event(self.staff_a, title="Already Started", days_from_today=-3)

    def _titles(self, response):
        return [e["title"] for e in response.data["results"]]

    def test_requires_authentication(self):
        for url in (self.list_url, self.aggregate_url, self.options_url):
            self.assertEqual(self.client.get(url).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_staff_sees_other_staffs_upcoming_events(self):
        self.client.force_authenticate(user=self.staff_a)
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = self._titles(response)
        self.assertIn("MFR Workshop", titles)
        self.assertIn("Data Review Meeting", titles)
        self.assertIn("DHIS2 Training", titles)

    def test_events_that_started_before_today_are_excluded(self):
        self.client.force_authenticate(user=self.staff_a)
        self.assertNotIn("Already Started", self._titles(self.client.get(self.list_url)))

    def test_ordered_nearest_first(self):
        self.client.force_authenticate(user=self.staff_a)
        self.assertEqual(
            self._titles(self.client.get(self.list_url)),
            ["DHIS2 Training", "MFR Workshop", "Data Review Meeting"],
        )

    def test_page_size_5_returns_next_five_in_order(self):
        for i in range(4):
            make_event(self.staff_b, title=f"Later {i}", days_from_today=20 + i)
        self.client.force_authenticate(user=self.staff_a)
        response = self.client.get(self.list_url, {"page_size": 5})
        self.assertEqual(len(response.data["results"]), 5)
        self.assertEqual(response.data["count"], 7)
        self.assertEqual(self._titles(response)[:3], ["DHIS2 Training", "MFR Workshop", "Data Review Meeting"])

    def test_list_item_has_no_program_field(self):
        self.client.force_authenticate(user=self.staff_a)
        item = self.client.get(self.list_url).data["results"][0]
        self.assertNotIn("program", item)
        for key in ("title", "start_date", "category", "thematic_area", "region", "owner_id", "owner_name"):
            self.assertIn(key, item)

    def test_owner_filter(self):
        self.client.force_authenticate(user=self.staff_a)
        response = self.client.get(self.list_url, {"owner": str(self.staff_b.id)})
        self.assertEqual(self._titles(response), ["MFR Workshop", "Data Review Meeting"])

    def test_category_thematic_and_search_filters(self):
        self.client.force_authenticate(user=self.staff_a)
        response = self.client.get(self.list_url, {"category": EventCategory.INTERNATIONAL})
        self.assertEqual(self._titles(response), ["MFR Workshop"])
        response = self.client.get(self.list_url, {"thematic_area": "Digital Health"})
        self.assertEqual(self._titles(response), ["DHIS2 Training", "Data Review Meeting"])
        response = self.client.get(self.list_url, {"search": "workshop"})
        self.assertEqual(self._titles(response), ["MFR Workshop"])

    def test_date_range_filter(self):
        self.client.force_authenticate(user=self.staff_a)
        today = timezone.localdate()
        response = self.client.get(
            self.list_url,
            {"date_from": (today + timedelta(days=4)).isoformat(), "date_to": (today + timedelta(days=6)).isoformat()},
        )
        self.assertEqual(self._titles(response), ["MFR Workshop"])

    def test_aggregate_uses_real_data_and_respects_filters(self):
        self.client.force_authenticate(user=self.staff_a)
        data = self.client.get(self.aggregate_url).data
        self.assertEqual(data["total"], 3)
        self.assertEqual(sum(r["count"] for r in data["by_category"]), 3)
        self.assertEqual(sum(r["count"] for r in data["by_thematic_area"]), 3)
        self.assertEqual(sorted(r["count"] for r in data["by_owner"]), [1, 2])
        self.assertNotIn("by_program", data)

        filtered = self.client.get(self.aggregate_url, {"owner": str(self.staff_b.id)}).data
        self.assertEqual(filtered["total"], 2)
        self.assertEqual([r["count"] for r in filtered["by_owner"]], [2])

    def test_filter_options_are_real_and_org_wide(self):
        self.client.force_authenticate(user=self.staff_a)
        options = self.client.get(self.options_url).data
        self.assertEqual({o["value"] for o in options["owners"]}, {str(self.staff_a.id), str(self.staff_b.id)})
        self.assertEqual({o["value"] for o in options["thematic_areas"]}, {"Digital Health", "Health Financing"})
        self.assertNotIn("programs", options)

    def test_upcoming_30d_kpi_is_org_wide_for_staff(self):
        # 3 upcoming events, all within 30 days, 2 of them owned by someone else.
        self.client.force_authenticate(user=self.staff_a)
        response = self.client.get(reverse("dashboard:dashboard"))
        self.assertEqual(response.data["upcoming_count_30d"], 3)


class RegionBreakdownCountryTests(APITestCase):
    """International events count under their country in "by Region" charts,
    so Ethiopian regions stay clean."""

    def test_international_events_group_by_country(self):
        from apps.dashboard.services import get_region_breakdown
        from apps.events.models import Event

        owner = make_staff()
        make_event(owner, category=EventCategory.NATIONAL, city="Hawassa", region="Sidama")
        make_event(owner, category=EventCategory.INTERNATIONAL, city="Nairobi", region="Nairobi County", country="Kenya")
        make_event(owner, category=EventCategory.INTERNATIONAL, city="Mombasa", region="Mombasa County", country="Kenya")
        rows = {r["region"]: r["count"] for r in get_region_breakdown(Event.objects.all())}
        self.assertEqual(rows, {"Sidama": 1, "Kenya": 2})
