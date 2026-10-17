from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.core.tests.factories import make_event, make_staff
from apps.reports.models import PostEventReport, ReportStatus


class ReportViewFilterTests(APITestCase):
    """Event Status Report pages: Draft / Pending / Upcoming / Completed /
    Overdue. The report's own state is kept separate from the event's timing.
    """

    def setUp(self):
        self.staff = make_staff()
        self.client.force_authenticate(user=self.staff)

        def ev(title, days_from_today, report=None):
            # end_date = start + 1 day, so days_from_today=-3 ended 2 days ago.
            e = make_event(self.staff, title=title, days_from_today=days_from_today)
            if report:
                PostEventReport.objects.create(event=e, status=report)
            return e

        self.upcoming_plain = ev("upcoming no report", 10)
        self.upcoming_draft = ev("upcoming with draft", 10, ReportStatus.DRAFT)
        self.recent_none = ev("ended recently no report", -3)
        self.recent_draft = ev("ended recently draft", -3, ReportStatus.DRAFT)
        self.recent_done = ev("ended recently submitted", -3, ReportStatus.SUBMITTED)
        self.late_none = ev("overdue no report", -20)
        self.late_draft = ev("overdue draft", -20, ReportStatus.DRAFT)
        self.late_done = ev("overdue but submitted", -20, ReportStatus.SUBMITTED)

    def _titles(self, view):
        response = self.client.get(reverse("event-list"), {"report_view": view, "page_size": 100})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return {row["title"] for row in response.data["results"]}, response.data["count"]

    def test_draft_shows_every_draft_whatever_the_event_timing(self):
        titles, count = self._titles("draft")
        self.assertEqual(titles, {"upcoming with draft", "ended recently draft", "overdue draft"})
        self.assertEqual(count, 3)

    def test_pending_has_not_started_reports_and_drafts_each_with_its_real_status(self):
        titles, _ = self._titles("pending")
        self.assertEqual(titles, {"ended recently no report", "ended recently draft", "upcoming with draft"})
        response = self.client.get(reverse("event-list"), {"report_view": "pending", "page_size": 100})
        statuses = {row["title"]: row["report_status"] for row in response.data["results"]}
        # A draft is labelled Draft, never Pending; only a report not started
        # at all is Pending. A submitted report is never in this list.
        self.assertEqual(
            statuses,
            {"ended recently no report": "Pending", "ended recently draft": "Draft", "upcoming with draft": "Draft"},
        )

    def test_upcoming_never_contains_drafts(self):
        titles, _ = self._titles("upcoming")
        self.assertEqual(titles, {"upcoming no report"})
        self.assertNotIn("upcoming with draft", titles)

    def test_completed_never_contains_drafts(self):
        titles, _ = self._titles("completed")
        self.assertEqual(titles, {"ended recently submitted", "overdue but submitted"})

    def test_overdue_includes_drafts_and_still_lists_them_under_draft(self):
        overdue, _ = self._titles("overdue")
        self.assertEqual(overdue, {"overdue no report", "overdue draft"})
        draft, _ = self._titles("draft")
        self.assertIn("overdue draft", draft)

    def test_overdue_rows_report_their_real_status(self):
        response = self.client.get(reverse("event-list"), {"report_view": "overdue", "page_size": 100})
        statuses = {row["title"]: row["report_status"] for row in response.data["results"]}
        self.assertEqual(statuses, {"overdue no report": "Pending", "overdue draft": "Draft"})

    def test_every_event_is_in_exactly_one_of_pending_upcoming_completed_overdue(self):
        seen = {}
        for view in ("pending", "upcoming", "completed", "overdue"):
            titles, _ = self._titles(view)
            for t in titles:
                self.assertNotIn(t, seen, f"{t} is in both {seen.get(t)} and {view}")
                seen[t] = view
        self.assertEqual(len(seen), 8)

    def test_saving_a_draft_keeps_it_a_draft_and_never_turns_it_pending(self):
        from apps.core.tests.factories import make_past_event

        event = make_past_event(self.staff, title="saved draft")
        created = self.client.post(reverse("reports:report-create", args=[event.id]), {"major_accomplishment": "a"})
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(created.data["status"], "draft")
        saved = self.client.patch(reverse("reports:report-update", args=[created.data["id"]]), {"major_accomplishment": "b"})
        self.assertEqual(saved.status_code, status.HTTP_200_OK)
        self.assertEqual(PostEventReport.objects.get(event=event).status, ReportStatus.DRAFT)
        response = self.client.get(reverse("event-list"), {"page_size": 100})
        row = next(r for r in response.data["results"] if r["title"] == "saved draft")
        self.assertEqual(row["report_status"], "Draft")

    def test_counts_match_lists(self):
        for view in ("draft", "pending", "upcoming", "completed", "overdue"):
            titles, count = self._titles(view)
            self.assertEqual(len(titles), count)
