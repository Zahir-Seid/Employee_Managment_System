from unittest import mock

from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts import registration
from apps.accounts.models import RegistrationOTP, User


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class PasswordResetTests(TestCase):
    """Forgot password: emailed 6-digit code, then a new password."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="abebe", email="abebe@ee.org", password="Old-Passw0rd!", first_name="Abebe", last_name="K"
        )
        patcher = mock.patch("apps.accounts.registration.is_domain_allowed", side_effect=lambda e: e.endswith("@ee.org"))
        patcher.start()
        self.addCleanup(patcher.stop)

    def _request(self, email="abebe@ee.org"):
        return self.client.post("/api/auth/password-reset/request-otp/", {"email": email}, format="json")

    def _code(self):
        with mock.patch("apps.accounts.registration._generate_code", return_value="123456"):
            RegistrationOTP.objects.all().delete()
            self._request()
        return "123456"

    def test_code_is_emailed_for_existing_account(self):
        self.assertEqual(self._request().status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("password reset", mail.outbox[0].subject)

    def test_unknown_email_gets_same_response_and_no_email(self):
        res = self._request("nobody@ee.org")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_full_flow_sets_new_password(self):
        code = self._code()
        res = self.client.post(
            "/api/auth/password-reset/verify-otp/", {"email": "abebe@ee.org", "code": code}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        token = res.data["verification_token"]
        res = self.client.post(
            "/api/auth/password-reset/complete/",
            {"email": "abebe@ee.org", "verification_token": token, "password": "New-Passw0rd!x"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("New-Passw0rd!x"))
        self.assertFalse(RegistrationOTP.objects.filter(email="abebe@ee.org").exists())

    def test_wrong_code_and_missing_token_are_rejected(self):
        self._code()
        res = self.client.post(
            "/api/auth/password-reset/verify-otp/", {"email": "abebe@ee.org", "code": "000000"}, format="json"
        )
        self.assertEqual(res.status_code, 400)
        res = self.client.post(
            "/api/auth/password-reset/complete/",
            {"email": "abebe@ee.org", "verification_token": "bad", "password": "New-Passw0rd!x"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Old-Passw0rd!"))

    def test_inactive_account_cannot_reset(self):
        self.user.is_active = False
        self.user.save()
        self._request()
        self.assertEqual(len(mail.outbox), 0)
