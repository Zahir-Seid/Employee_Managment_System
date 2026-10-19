"""Security review finding #2: the embeds on GET /api/events/{id}/ carry the
same visibility rules as the dedicated endpoints they duplicate. A plain
Staff member who doesn't own the event must see `support_request: null`
and `post_event_report: null` although the event itself is readable
("any event can be opened read-only"); an unassigned Communications
member must not read the support request either; the owner, assigned
comms, Lead, Leadership and Admin keep full embeds.
"""
from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.communications.models import SupportRequest
from apps.reports.models import PostEventReport
from apps.core.tests.factories import make_communications, make_event, make_leadership, make_staff, make_user


class EventDetailEmbedVisibilityTests(APITestCase):
    def setUp(self):
        self.owner = make_staff(email="embed-owner@ee.org")
        self.other_staff = make_staff(email="embed-other@ee.org")
        self.comms = make_communications(email="embed-comms@ee.org")
        self.leader = make_leadership(email="embed-lead@ee.org")
        self.admin = make_user(email="embed-admin@ee.org", role=Role.ADMIN)
        self.event = make_event(self.owner, title="Embed Event", needs_comms_support=True)
        self.sr = SupportRequest.objects.create(
            event=self.event, support_types=["photographer"], notes="camera crew directive"
        )
        self.report = PostEventReport.objects.create(event=self.event)

    def _detail(self, user):
        self.client.force_authenticate(user=user)
        res = self.client.get(f"/api/events/{self.event.id}/")
        self.assertEqual(res.status_code, 200)
        return res.data

    def test_owner_sees_full_embeds(self):
        data = self._detail(self.owner)
        self.assertEqual(data["support_request"]["notes"], "camera crew directive")
        self.assertIsNotNone(data["post_event_report"])

    def test_other_staff_gets_null_embeds_and_no_side_door(self):
        # The dedicated endpoints refuse the same data; the embeds must not
        # become a side door around them.
        self.client.force_authenticate(user=self.other_staff)
        self.assertEqual(self.client.get(f"/api/events/{self.event.id}/post-event-report/").status_code, 403)
        data = self._detail(self.other_staff)
        self.assertIsNone(data["support_request"])
        self.assertIsNone(data["post_event_report"])

    def test_unassigned_communications_gets_null_support_request_embed(self):
        # Same story as /api/support-requests/{id}/ returning 404 for this
        # user (mirrors the live PoC in the security review).
        data = self._detail(self.comms)
        self.assertIsNone(data["support_request"])
        self.assertIsNotNone(data["post_event_report"])  # comms may read reports

    def test_assigned_communications_sees_the_support_request(self):
        self.sr.assigned_to.add(self.comms)
        data = self._detail(self.comms)
        self.assertEqual(data["support_request"]["notes"], "camera crew directive")

    def test_leadership_and_admin_see_everything(self):
        for user in (self.leader, self.admin):
            with self.subTest(role=user.role):
                data = self._detail(user)
                self.assertEqual(data["support_request"]["notes"], "camera crew directive")
                self.assertIsNotNone(data["post_event_report"])

    def test_serializer_without_request_context_fails_closed(self):
        # No request in context (e.g. internal/queued serialization)
        # embeds nothing rather than everything.
        from apps.events.serializers import EventDetailSerializer

        data = EventDetailSerializer(self.event)
        self.assertIsNone(data.data["support_request"])
        self.assertIsNone(data.data["post_event_report"])