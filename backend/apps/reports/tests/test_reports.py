
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.core.tests.factories import make_communications, make_event, make_leadership, make_past_event, make_staff
from apps.reports.tests.helpers import attach_photos


class PostEventReportSubmissionTests(APITestCase):
    """FR29 (only after event date), FR33 (status -> Completed), FR34 (no
    second submission).
    """

    def setUp(self):
        self.staff = make_staff()
        self.client.force_authenticate(user=self.staff)

    def test_cannot_create_report_before_event_end_date(self):
        future_event = make_event(self.staff, days_from_today=10)
        response = self.client.post(
            reverse("reports:report-create", args=[future_event.id]),
            {"major_accomplishment": "x"},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_can_create_draft_report_after_event_date(self):
        past_event = make_past_event(self.staff)
        response = self.client.post(
            reverse("reports:report-create", args=[past_event.id]),
            {"major_accomplishment": "x"},
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], "draft")

    def test_draft_does_not_lock_event_or_complete_it(self):
        past_event = make_past_event(self.staff)
        self.client.post(
            reverse("reports:report-create", args=[past_event.id]),
            {"major_accomplishment": "x"},
        )
        past_event.refresh_from_db()
        self.assertTrue(past_event.is_editable)
        self.assertEqual(past_event.status, "logged")

    def test_submit_sets_event_to_completed_and_locks_it(self):
        past_event = make_past_event(self.staff)
        create_response = self.client.post(
            reverse("reports:report-create", args=[past_event.id]),
            {
                "major_accomplishment": "a", "best_practices_lessons_actions": "b",
                "recommendation_conclusion": "c",
                "participants_male": 10, "participants_female": 5,
                "participants_ee_staff": 15,
            },
        )
        report_id = create_response.data["id"]
        attach_photos(self.client, report_id)

        submit_response = self.client.post(reverse("reports:report-submit", args=[report_id]))
        self.assertEqual(submit_response.status_code, status.HTTP_200_OK)

        past_event.refresh_from_db()
        self.assertEqual(past_event.status, "completed")
        self.assertFalse(past_event.is_editable)

    def test_submit_does_not_require_partnership_opportunities(self):
        """"Partnership opportunities" (recommendation_conclusion) is
        optional — not every event surfaces a future partnership
        opportunity, unlike Event Overview / Key Learnings & Action
        Points, which are still required."""
        past_event = make_past_event(self.staff)
        create_response = self.client.post(
            reverse("reports:report-create", args=[past_event.id]),
            {
                "major_accomplishment": "a", "best_practices_lessons_actions": "b",
                "participants_male": 10, "participants_female": 5,
                "participants_ee_staff": 15,
            },
        )
        report_id = create_response.data["id"]
        attach_photos(self.client, report_id)

        submit_response = self.client.post(reverse("reports:report-submit", args=[report_id]))
        self.assertEqual(submit_response.status_code, status.HTTP_200_OK)

    def test_cannot_submit_when_organization_breakdown_does_not_match_total(self):
        past_event = make_past_event(self.staff)
        create_response = self.client.post(
            reverse("reports:report-create", args=[past_event.id]),
            {
                "major_accomplishment": "a", "best_practices_lessons_actions": "b",
                "recommendation_conclusion": "c",
                "participants_male": 10, "participants_female": 5,
                # Deliberately left at 0 — org breakdown (0) != Male+Female (15).
            },
        )
        report_id = create_response.data["id"]

        submit_response = self.client.post(reverse("reports:report-submit", args=[report_id]))
        self.assertEqual(submit_response.status_code, status.HTTP_400_BAD_REQUEST)
        # Errors come back nested under "errors" (see core/exceptions.py's
        # custom_exception_handler) — every other error assertion in this
        # app follows that same envelope, so this test was checking a shape
        # the API never actually returns.
        self.assertIn("participants_by_organization", submit_response.data["errors"])

    def test_cannot_submit_the_same_report_twice(self):
        past_event = make_past_event(self.staff)
        create_response = self.client.post(
            reverse("reports:report-create", args=[past_event.id]),
            {
                "major_accomplishment": "a", "best_practices_lessons_actions": "b",
                "recommendation_conclusion": "c",
                "participants_male": 10, "participants_female": 5,
                "participants_ee_staff": 15,
            },
        )
        report_id = create_response.data["id"]
        self.client.post(reverse("reports:report-submit", args=[report_id]))

        second_attempt = self.client.post(reverse("reports:report-submit", args=[report_id]))
        self.assertEqual(second_attempt.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_create_a_second_report_for_the_same_event(self):
        past_event = make_past_event(self.staff)
        self.client.post(
            reverse("reports:report-create", args=[past_event.id]),
            {"major_accomplishment": "x"},
        )
        response = self.client.post(
            reverse("reports:report-create", args=[past_event.id]),
            {"major_accomplishment": "x2"},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ReportAccessControlTests(APITestCase):
    """Basic access control on a submitted report. (The earlier Sensitive-flag
    masking tests were removed along with the is_sensitive field itself,
    per the product decision to drop that feature from Post-Event Reports.)
    """

    def setUp(self):
        self.staff = make_staff(email="owner@ee.org")
        self.other_staff = make_staff(email="other@ee.org")
        self.comms = make_communications()
        self.leadership = make_leadership()

        self.event = make_past_event(self.staff)
        self.client.force_authenticate(user=self.staff)
        create_response = self.client.post(
            reverse("reports:report-create", args=[self.event.id]),
            {
                "major_accomplishment": "Accomplishment details.",
            },
        )
        self.report_id = create_response.data["id"]

    def test_owner_can_view_own_report(self):
        self.client.force_authenticate(user=self.staff)
        response = self.client.get(reverse("reports:report-create", args=[self.event.id]))
        self.assertEqual(response.data["major_accomplishment"], "Accomplishment details.")

    def test_communications_can_view_any_report(self):
        self.client.force_authenticate(user=self.comms)
        response = self.client.get(reverse("reports:report-create", args=[self.event.id]))
        self.assertEqual(response.data["major_accomplishment"], "Accomplishment details.")

    def test_leadership_can_view_any_report(self):
        self.client.force_authenticate(user=self.leadership)
        response = self.client.get(reverse("reports:report-create", args=[self.event.id]))
        self.assertEqual(response.data["major_accomplishment"], "Accomplishment details.")

    def test_non_owner_staff_cannot_view_another_staff_members_report_at_all(self):
        self.client.force_authenticate(user=self.other_staff)
        response = self.client.get(reverse("reports:report-create", args=[self.event.id]))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


import base64

_MINIMAL_PNG_B64 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


# A genuine minimal 1x1 pixel JPEG. Bug fix: tests previously used
# `b"0" * size_bytes` as fake "image" content — Django's ImageField uses
# Pillow to actually decode uploaded files, so fake bytes are correctly
# rejected as "not a valid image" regardless of the app code being right,
# which made every "valid upload should succeed" test fail for the wrong
# reason. This is real, Pillow-decodable JPEG data.
_MINIMAL_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQ"
    "CgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ"
    "EBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAA"
    "AAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="
)


class PhotoUploadValidationTests(APITestCase):
    """FR45: JPG/PNG only, 5MB max, 5 photos max per event."""

    def setUp(self):
        self.staff = make_staff()
        self.client.force_authenticate(user=self.staff)
        self.event = make_past_event(self.staff)
        create_response = self.client.post(
            reverse("reports:report-create", args=[self.event.id]),
            {"major_accomplishment": "x"},
        )
        self.report_id = create_response.data["id"]

    def _upload(self, filename="photo.jpg", content_type="image/jpeg", content=None):
        file = SimpleUploadedFile(filename, content if content is not None else _MINIMAL_JPEG, content_type=content_type)
        return self.client.post(
            reverse("reports:report-photo-upload", args=[self.report_id]), {"image": file}, format="multipart"
        )

    def test_valid_jpg_upload_succeeds(self):
        response = self._upload()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_disallowed_file_extension_rejected(self):
        response = self._upload(filename="document.pdf", content_type="application/pdf", content=b"not an image")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_fake_png_bytes_rejected_regression(self):
        """Security review #5: bytes must match the extension. Pillow's
        decodability check already rejects undecodable junk — but it
        sniffs BYTES, not extensions, so the interesting mismatch below
        is a *decodable* image in the wrong extension."""
        decoy = SimpleUploadedFile("polyglot.png", b"<html><script>alert(1)</script></html>", content_type="image/png")
        response = self.client.post(
            reverse("reports:report-photo-upload", args=[self.report_id]), {"image": decoy}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_jpeg_bytes_named_png_rejected(self):
        # Pillow happily decodes a JPEG regardless of its .png name, so
        # the old extension-only validator (before finding #5's signature
        # step) ACCEPTED this file and stored/served a JPEG as image/png.
        response = self._upload(filename="sneaky.png", content=_MINIMAL_JPEG, content_type="image/png")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("doesn't look like", str(response.data))

    def test_png_bytes_named_jpg_rejected(self):
        response = self._upload(filename="photo.jpg", content=_MINIMAL_PNG_B64, content_type="image/jpeg")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("doesn't look like", str(response.data))

    def test_png_content_named_jpg_accepted_when_bytes_match_jpeg(self):
        # The real JPEG constant already proves decodability; here we
        # only assert a *valid* jpeg-in-jpg-name still passes (mirroring
        # the existing success test with an extension flip).
        response = self._upload(filename="renamed.jpg", content=_MINIMAL_JPEG, content_type="image/jpeg")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_oversized_file_rejected(self):
        # Size is checked before Pillow ever tries to decode the content,
        # so fake filler bytes are fine here — this test is purely about
        # the size limit, not image validity.
        response = self._upload(content=b"0" * (6 * 1024 * 1024))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_sixth_photo_rejected(self):
        for _ in range(5):
            response = self._upload()
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        sixth = self._upload()
        self.assertEqual(sixth.status_code, status.HTTP_400_BAD_REQUEST)
