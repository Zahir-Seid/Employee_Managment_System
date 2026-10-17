import io
import shutil
import tempfile
import zipfile
from pathlib import Path

from django.conf import settings
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.communications.models import (
    ImmutableRecordError,
    SupportRequest,
    SupportRequestMessage,
    SupportRequestStatus,
)
from apps.core.tests.factories import make_comms_lead, make_communications, make_event, make_staff
from apps.notifications.models import Notification, NotificationType

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _docx_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("word/document.xml", "<doc/>")
    return buf.getvalue()


class MessageFeatureTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        # Safety: only ever delete a folder inside a disposable test-media
        # directory (created by config.settings_test), so a misconfigured
        # PRIVATE_MEDIA_ROOT can never wipe real attachments.
        root = Path(settings.PRIVATE_MEDIA_ROOT).resolve()
        if root.parent.name.startswith("jeems-test-media-") and root.parent.parent == Path(tempfile.gettempdir()).resolve():
            shutil.rmtree(root, ignore_errors=True)

    def setUp(self):
        self.lead = make_comms_lead()
        self.comms_a = make_communications(email="a@ee.org")
        self.comms_b = make_communications(email="b@ee.org")
        self.staff = make_staff()
        self.event = make_event(self.staff, needs_comms_support=True)
        self.client.force_authenticate(user=self.staff)
        r = self.client.post(
            reverse("communications:support-request-create", args=[self.event.id]),
            {"support_types": ["banner"]},
            format="json",
        )
        self.sr = SupportRequest.objects.get(pk=r.data["id"])
        self.sr.assigned_to.add(self.comms_a)
        self.sr.sync_assignment_status()
        self.url = reverse("communications:support-request-messages", args=[self.sr.id])
        mail.outbox.clear()

    def _post(self, data, **extra):
        return self.client.post(self.url, data, format="multipart", **extra)

    # --- attachments ---
    def test_attachment_only_message_and_secure_download(self):
        f = SimpleUploadedFile("photo.png", PNG, content_type="image/png")
        r = self._post({"attachments": [f]})
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        att = r.data["attachments"][0]
        self.assertTrue(att["is_image"])
        self.assertEqual(att["name"], "photo.png")
        download = self.client.get("/api" + att["url"])
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download["X-Content-Type-Options"], "nosniff")
        # another requester can't see it; unauthenticated can't either
        self.client.force_authenticate(user=make_staff(email="other@ee.org"))
        self.assertEqual(self.client.get("/api" + att["url"]).status_code, 404)
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get("/api" + att["url"]).status_code, (401, 403))
        # Communications members only reach attachments on requests assigned to them
        self.client.force_authenticate(user=self.comms_b)
        self.assertEqual(self.client.get("/api" + att["url"]).status_code, 404)
        self.sr.assigned_to.add(self.comms_b)
        self.assertEqual(self.client.get("/api" + att["url"]).status_code, 200)

    def test_valid_office_and_text_files_accepted(self):
        files = [
            SimpleUploadedFile("brief.docx", _docx_bytes()),
            SimpleUploadedFile("data.csv", b"a,b\n1,2\n"),
            SimpleUploadedFile("note.txt", b"hello"),
        ]
        r = self._post({"body": "see files", "attachments": files})
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(len(r.data["attachments"]), 3)

    def test_rejects_bad_type_fake_content_empty_oversize_and_too_many(self):
        cases = [
            SimpleUploadedFile("run.exe", b"MZ" + b"0" * 50),
            SimpleUploadedFile("fake.png", b"this is not a png"),
            SimpleUploadedFile("empty.txt", b""),
            SimpleUploadedFile("big.txt", b"a" * (10 * 1024 * 1024 + 1)),
            SimpleUploadedFile("script.svg", b"<svg onload=alert(1)/>"),
        ]
        for f in cases:
            r = self._post({"body": "x", "attachments": [f]})
            self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST, f.name)
        six = [SimpleUploadedFile(f"f{i}.txt", b"x") for i in range(6)]
        self.assertEqual(self._post({"body": "x", "attachments": six}).status_code, 400)
        self.assertEqual(SupportRequestMessage.objects.count(), 0)

    def test_empty_message_rejected(self):
        self.assertEqual(self._post({"body": "  "}).status_code, 400)

    # --- replies ---
    def test_reply_reference_and_chronological_order(self):
        first = self._post({"body": "Need the banner size?"}).data
        self.client.force_authenticate(user=self.comms_a)
        r = self._post({"body": "3x2m please", "reply_to": first["id"]})
        self.assertEqual(str(r.data["reply_to"]), str(first["id"]))
        self.assertEqual(r.data["reply_to_summary"]["excerpt"], "Need the banner size?")
        listing = self.client.get(self.url).data
        self.assertEqual([m["body"] for m in listing], ["Need the banner size?", "3x2m please"])

    def test_reply_to_other_request_rejected(self):
        e2 = make_event(self.staff, needs_comms_support=True)
        r2 = self.client.post(
            reverse("communications:support-request-create", args=[e2.id]), {"support_types": ["banner"]}, format="json"
        )
        other = SupportRequest.objects.get(pk=r2.data["id"])
        foreign = SupportRequestMessage.objects.create(support_request=other, sender=self.staff, body="x")
        self.assertEqual(self._post({"body": "hi", "reply_to": str(foreign.id)}).status_code, 400)

    # --- immutability ---
    def test_messages_are_immutable(self):
        msg = SupportRequestMessage.objects.create(support_request=self.sr, sender=self.staff, body="hi")
        msg.body = "changed"
        with self.assertRaises(ImmutableRecordError):
            msg.save()
        with self.assertRaises(ImmutableRecordError):
            msg.delete()
        with self.assertRaises(ImmutableRecordError):
            SupportRequestMessage.objects.filter(pk=msg.pk).update(body="x")
        with self.assertRaises(ImmutableRecordError):
            SupportRequestMessage.objects.filter(pk=msg.pk).delete()
        for method in ("patch", "put", "delete"):
            r = getattr(self.client, method)(f"{self.url}{msg.id}/")
            self.assertIn(r.status_code, (404, 405))

    def test_deleting_the_whole_request_still_works(self):
        SupportRequestMessage.objects.create(support_request=self.sr, sender=self.staff, body="hi")
        self.sr.delete()
        self.assertEqual(SupportRequestMessage.objects.count(), 0)

    # --- permissions & resolved state ---
    def test_read_only_when_resolved_until_lead_reopens(self):
        self._post({"body": "before"})
        self.client.force_authenticate(user=self.lead)
        self.client.patch(
            reverse("communications:support-request-status", args=[self.sr.id]), {"status": "completed"}, format="json"
        )
        r = self._post({"body": "after"})
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(len(self.client.get(self.url).data), 1)  # still readable
        self.client.force_authenticate(user=self.staff)
        self.assertEqual(self._post({"body": "requester after"}).status_code, 403)
        self.client.force_authenticate(user=self.lead)
        self.client.patch(
            reverse("communications:support-request-status", args=[self.sr.id]), {"status": "assigned"}, format="json"
        )
        self.client.force_authenticate(user=self.staff)
        self.assertEqual(self._post({"body": "requester after reopen"}).status_code, 201)
        self.assertEqual(len(self.client.get(self.url).data), 2)

    def test_non_assigned_comms_cannot_open_or_post(self):
        self.client.force_authenticate(user=self.comms_b)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self._post({"body": "hi"}).status_code, 404)

    # --- unread ---
    def test_unread_count_badge_filter_and_mark_read(self):
        list_url = reverse("communications:support-request-list")
        self.client.force_authenticate(user=self.comms_a)
        self._post({"body": "Question?", "is_clarification_request": "true"})
        self.client.force_authenticate(user=self.staff)
        row = self.client.get(list_url).data["results"][0]
        self.assertEqual(row["unread_count"], 1)
        self.assertEqual(self.client.get(list_url, {"unread": "true"}).data["count"], 1)
        msgs = self.client.get(self.url).data
        self.assertTrue(msgs[0]["is_unread"])
        # sender doesn't see own message as unread; non-participant sees 0
        self.client.force_authenticate(user=self.comms_a)
        self.assertEqual(self.client.get(list_url).data["results"][0]["unread_count"], 0)
        self.client.force_authenticate(user=self.comms_b)
        self.assertEqual(self.client.get(list_url).data["count"], 0)
        self.assertEqual(self.client.get(list_url, {"unread": "true"}).data["count"], 0)
        # requester opens thread -> cleared, bell notifications read
        self.client.force_authenticate(user=self.staff)
        r = self.client.post(
            reverse("communications:support-request-messages-read", args=[self.sr.id]),
            {"up_to": msgs[-1]["created_at"]},
            format="json",
        )
        self.assertEqual(r.status_code, 204)
        self.assertEqual(self.client.get(list_url).data["results"][0]["unread_count"], 0)
        self.assertEqual(self.client.get(list_url, {"unread": "true"}).data["count"], 0)
        self.assertFalse(
            Notification.objects.filter(recipient=self.staff, notification_type=NotificationType.SUPPORT_CLARIFICATION, is_read=False).exists()
        )

    # --- notifications / email ---
    def test_ordinary_message_notifies_and_emails_once_per_person(self):
        # Lead is also an assignee: still only one notification.
        self.sr.assigned_to.add(self.lead)
        self._post({"body": "hello team"})
        kind = NotificationType.SUPPORT_MESSAGE
        self.assertEqual(Notification.objects.filter(recipient=self.lead, notification_type=kind).count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.comms_a, notification_type=kind).count(), 1)
        # Every notification is also emailed, once per person (no duplicates).
        addrs = [addr for m in mail.outbox for addr in m.to]
        self.assertIn(self.lead.email, addrs)
        self.assertIn(self.comms_a.email, addrs)
        self.assertEqual(len(addrs), len(set(addrs)))

    def test_clarification_request_emails_requester(self):
        self.client.force_authenticate(user=self.comms_a)
        self._post({"body": "Which size?", "is_clarification_request": "true"})
        addrs = [addr for m in mail.outbox for addr in m.to]
        self.assertIn(self.staff.email, addrs)
        self.assertNotIn(self.comms_a.email, addrs)  # never the sender
        self.assertEqual(len(addrs), len(set(addrs)))

    def test_clarification_provided_and_direct_reply_email(self):
        self.client.force_authenticate(user=self.comms_a)
        q = self._post({"body": "Which size?", "is_clarification_request": "true"}).data
        mail.outbox.clear()
        self.client.force_authenticate(user=self.staff)
        self._post({"body": "3x2m", "reply_to": q["id"]})
        self.sr.refresh_from_db()
        self.assertEqual(self.sr.status, SupportRequestStatus.CLARIFICATION_PROVIDED)
        recipients = {addr for m in mail.outbox for addr in m.to}
        self.assertIn(self.comms_a.email, recipients)
        mail.outbox.clear()
        self.client.force_authenticate(user=self.comms_a)
        self._post({"body": "thanks, ordinary follow-up"})
        self.assertIn(self.staff.email, [addr for m in mail.outbox for addr in m.to])
        mail.outbox.clear()
        self._post({"body": "a reply to you", "reply_to": q["id"]})  # own message: no self notification
        self.assertNotIn(self.comms_a.email, [addr for m in mail.outbox for addr in m.to])
