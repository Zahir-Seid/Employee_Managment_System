from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.core.tests.factories import make_communications, make_event, make_leadership, make_staff
from apps.events.models import EventCategory


class EventCreationTests(APITestCase):
    """Stage 2 (FR5-FR12) and updated requirement #1: Comms Support
    Yes/No is required for every category, not just Internal.
    """

    def setUp(self):
        self.staff = make_staff()
        self.client.force_authenticate(user=self.staff)

    def _valid_payload(self, **overrides):
        payload = {
            "category": EventCategory.INTERNATIONAL,
            "event_type": "training",
            "mode_of_event": "in_person",
            "title": "Global Health Summit",
            "description": "A summit on global health.",
            "start_date": "2027-01-10",
            "end_date": "2027-01-12",
            "venue": "Convention Center",
            "city": "Nairobi",
            "country": "Kenya",
            "region": "Nairobi County",
            "organization_lead_agency": "WHO",
            "thematic_area": "Digital Health",
            "engagement_level": "organizer",
            "support_level": "technical",
            "total_expected_participants": 250,
            "expected_participants": 100,
            "personal_objective": "Represent EE and share our findings.",
            "expected_outcome": "Improved regional coordination.",
            "needs_comms_support": True,
        }
        payload.update(overrides)
        return payload

    def test_needs_comms_support_required_regardless_of_category(self):
        payload = self._valid_payload(category=EventCategory.INTERNATIONAL)
        del payload["needs_comms_support"]
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("needs_comms_support", response.data["errors"])

    def test_international_event_can_request_comms_support(self):
        """Reversal of the original Internal-only restriction."""
        payload = self._valid_payload(category=EventCategory.INTERNATIONAL, needs_comms_support=True)
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["id"])

    def test_owner_is_auto_filled_from_logged_in_user(self):
        payload = self._valid_payload()
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    # --- Participant counts: Total is only required when EE leads ---------

    def test_total_participants_required_when_ee_leads(self):
        for overrides in (
            {"engagement_level": "organizer"},
            {"engagement_level": "co_organizer", "co_organizer_name": "Partner Org"},
            {"organization_lead_agency": "EE", "engagement_level": "speaker"},
        ):
            payload = self._valid_payload(**overrides)
            del payload["total_expected_participants"]
            response = self.client.post(reverse("event-list"), payload)
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, overrides)
            self.assertIn("total_expected_participants", response.data["errors"], overrides)

    def test_total_participants_not_required_when_ee_does_not_lead(self):
        payload = self._valid_payload(engagement_level="speaker", organization_lead_agency="WHO")
        del payload["total_expected_participants"]
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_ee_headcount_still_required_when_ee_does_not_lead(self):
        payload = self._valid_payload(engagement_level="speaker", organization_lead_agency="WHO")
        del payload["total_expected_participants"]
        del payload["expected_participants"]
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("expected_participants", response.data["errors"])

    def test_description_is_required(self):
        payload = self._valid_payload()
        del payload["description"]
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_international_event_requires_a_country(self):
        payload = self._valid_payload(country="")
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("country", response.data["errors"])

    def test_international_location_is_saved_and_labelled_with_the_country(self):
        response = self.client.post(reverse("event-list"), self._valid_payload())
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        detail = self.client.get(reverse("event-detail", args=[response.data["id"]]))
        self.assertEqual(detail.data["country"], "Kenya")
        self.assertEqual(detail.data["location_label"], "Nairobi, Nairobi County, Kenya")

    def test_label_does_not_repeat_when_city_and_region_match(self):
        payload = self._valid_payload(city="Geneva", region="Geneva", country="Switzerland")
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        detail = self.client.get(reverse("event-detail", args=[response.data["id"]]))
        self.assertEqual(detail.data["location_label"], "Geneva, Switzerland")

    def test_country_is_cleared_for_non_international_events(self):
        payload = self._valid_payload(category=EventCategory.NATIONAL, city="Hawassa", region="Sidama", country="Kenya")
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        detail = self.client.get(reverse("event-detail", args=[response.data["id"]]))
        self.assertEqual(detail.data["country"], "")
        self.assertEqual(detail.data["location_label"], "Hawassa, Sidama")

    def test_end_date_before_start_date_rejected(self):
        payload = self._valid_payload(start_date="2027-01-12", end_date="2027-01-10")
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_new_event_types_are_accepted(self):
        for event_type in ("conference", "supportive_supervision"):
            response = self.client.post(reverse("event-list"), self._valid_payload(event_type=event_type))
            self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_review_meeting_requires_annual_or_mid_term(self):
        response = self.client.post(reverse("event-list"), self._valid_payload(event_type="rm"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("review_meeting_type", response.data["errors"])

    def test_review_meeting_with_a_choice_saves_and_reads_back_with_its_label(self):
        payload = self._valid_payload(event_type="rm", review_meeting_type="mid_term")
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        detail = self.client.get(reverse("event-detail", args=[response.data["id"]]))
        self.assertEqual(detail.data["review_meeting_type"], "mid_term")
        self.assertEqual(detail.data["event_type_label"], "Review Meeting \u2013 Mid-term")

    def test_other_requires_a_written_description(self):
        response = self.client.post(reverse("event-list"), self._valid_payload(event_type="other"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("event_type_other", response.data["errors"])

    def test_other_keeps_the_written_text_in_its_label(self):
        payload = self._valid_payload(event_type="other", event_type_other="Site visit")
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        detail = self.client.get(reverse("event-detail", args=[response.data["id"]]))
        self.assertEqual(detail.data["event_type_label"], "Other: Site visit")

    def test_follow_ups_are_cleared_when_they_do_not_apply(self):
        payload = self._valid_payload(event_type="training", review_meeting_type="annual", event_type_other="x")
        response = self.client.post(reverse("event-list"), payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        detail = self.client.get(reverse("event-detail", args=[response.data["id"]]))
        self.assertEqual(detail.data["review_meeting_type"], "")
        self.assertEqual(detail.data["event_type_other"], "")


class EventVisibilityTests(APITestCase):
    """FR3: staff see only their own events; Communications/Leadership see all."""

    def setUp(self):
        self.staff_a = make_staff(email="a@ee.org")
        self.staff_b = make_staff(email="b@ee.org")
        self.comms = make_communications()
        self.leadership = make_leadership()
        self.event_a = make_event(self.staff_a, title="Event A")
        self.event_b = make_event(self.staff_b, title="Event B")

    def test_staff_sees_only_own_events(self):
        self.client.force_authenticate(user=self.staff_a)
        response = self.client.get(reverse("event-list"))
        titles = [e["title"] for e in response.data["results"]]
        self.assertIn("Event A", titles)
        self.assertNotIn("Event B", titles)

    def test_staff_can_retrieve_another_staff_members_event_read_only(self):
        self.client.force_authenticate(user=self.staff_a)
        url = reverse("event-detail", args=[self.event_b.id])
        self.assertEqual(self.client.get(url).status_code, status.HTTP_200_OK)
        response = self.client.patch(url, {"title": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_communications_sees_all_events(self):
        self.client.force_authenticate(user=self.comms)
        response = self.client.get(reverse("event-list"))
        titles = [e["title"] for e in response.data["results"]]
        self.assertIn("Event A", titles)
        self.assertIn("Event B", titles)

    def test_leadership_cannot_create_events(self):
        self.client.force_authenticate(user=self.leadership)
        response = self.client.post(reverse("event-list"), {"title": "Nope"})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class EventEditLockTests(APITestCase):
    """UI/UX Section 5/11: editable until the Post-Event Report is submitted (not merely drafted)."""

    def setUp(self):
        self.staff = make_staff()
        self.event = make_event(self.staff)

    def test_event_is_editable_before_any_report(self):
        self.assertTrue(self.event.is_editable)

    def test_event_stays_editable_with_draft_report(self):
        from apps.reports.models import PostEventReport, ReportStatus

        PostEventReport.objects.create(
            event=self.event, status=ReportStatus.DRAFT,
        )
        self.event.refresh_from_db()
        self.assertTrue(self.event.is_editable)

    def test_event_locked_after_report_submitted(self):
        from apps.reports.models import PostEventReport, ReportStatus

        PostEventReport.objects.create(
            event=self.event, status=ReportStatus.SUBMITTED,
        )
        self.event.refresh_from_db()
        self.assertFalse(self.event.is_editable)

        self.client.force_authenticate(user=self.staff)
        response = self.client.patch(reverse("event-detail", args=[self.event.id]), {"title": "New Title"})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class StatusActionPostponeDatesTests(APITestCase):
    """New behavior: postpone requires a new (rescheduled) start/end date
    and updates the event's actual dates with it, so the Calendar and
    every other date-driven view picks it up automatically. Cancel/reopen
    are unaffected — they never take dates.
    """

    def setUp(self):
        self.staff = make_staff()
        self.event = make_event(self.staff)
        self.client.force_authenticate(user=self.staff)

    def test_postpone_without_new_dates_is_rejected(self):
        response = self.client.post(
            reverse("event-status-action", args=[self.event.id]),
            {"action": "postpone", "reason": "Venue unavailable"},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("new_start_date", response.data.get("errors", response.data))

    def test_postpone_with_new_dates_updates_event(self):
        response = self.client.post(
            reverse("event-status-action", args=[self.event.id]),
            {
                "action": "postpone",
                "reason": "Venue unavailable",
                "new_start_date": "2027-05-01",
                "new_end_date": "2027-05-02",
            },
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.event.refresh_from_db()
        self.assertEqual(str(self.event.start_date), "2027-05-01")
        self.assertEqual(str(self.event.end_date), "2027-05-02")
        self.assertEqual(self.event.status, "postponed")

    def test_cancel_does_not_require_dates(self):
        response = self.client.post(
            reverse("event-status-action", args=[self.event.id]),
            {"action": "cancel", "reason": "Funding withdrawn"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class ReportStatusFilterTests(APITestCase):
    """`?report_status=` gives an exact server-side count (the Sidebar's
    Draft / Pending badge uses draft): only saved-but-not-submitted reports.
    """

    def setUp(self):
        from apps.reports.models import PostEventReport, ReportStatus

        self.staff = make_staff()
        self.client.force_authenticate(user=self.staff)
        # 25 ended events with drafts: more than one page (20), so a count
        # taken from the first page of results would be wrong.
        self.drafts = [make_event(self.staff, days_from_today=-5 - i) for i in range(25)]
        for event in self.drafts:
            PostEventReport.objects.create(event=event, status=ReportStatus.DRAFT)
        self.submitted = make_event(self.staff, days_from_today=-40)
        PostEventReport.objects.create(event=self.submitted, status=ReportStatus.SUBMITTED)
        self.not_started = make_event(self.staff, days_from_today=-41)

    def test_draft_count_counts_only_saved_drafts_across_all_pages(self):
        response = self.client.get(reverse("event-list"), {"report_status": "draft"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 25)

    def test_pending_and_completed_are_separate(self):
        pending = self.client.get(reverse("event-list"), {"report_status": "pending"})
        completed = self.client.get(reverse("event-list"), {"report_status": "completed"})
        self.assertEqual(pending.data["count"], 1)
        self.assertEqual(completed.data["count"], 1)
