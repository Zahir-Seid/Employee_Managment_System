"""Security review finding #1: a stolen refresh token must die the moment
the account's credential is rotated. Every password-mutating flow —
self-service Change Password, Admin Set Password, and the email-OTP
Password Reset — has to revoke the user's outstanding refresh tokens by
blacklisting them (see apps.accounts.tokens). These tests drive each flow
through its real endpoint and then replay the pre-change refresh token,
which token_blacklist must now reject.
"""
from unittest import mock

from django.test import override_settings
from rest_framework.test import APIClient, APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts import registration
from apps.accounts.models import RegistrationOTP, Role, User
from apps.core.tests.factories import make_user
from apps.core.tests.throttle_helpers import patch_throttle_rates

# These tests exercise token revocation, not rate limiting — and the
# throttle counters live in the process-wide default cache keyed identically
# for every APIClient ("testserver"), so earlier tests in the suite
# (e.g. the password-reset OTP flow tests) can leave the hourly otp/auth
# buckets exhausted when these tests run. Raise the scoped rates and clear
# the cache at each setUp: token blacklisting, not throttling, is under
# test here. (DRF snapshots DEFAULT_THROTTLE_RATES as a class attribute at
# import time, so override_settings does NOT reach the throttles - see
# apps/core/tests/throttle_helpers.py.)


def _fresh_throttle_state():
    from django.core.cache import cache

    cache.clear()


def _assert_old_refresh_rejected(client, refresh_token):
    """After the fix the replay gets rejected (401 TokenError from
    token_blacklist); assert it is no longer mintable either way."""
    res = client.post("/api/auth/refresh/", {"refresh": refresh_token}, format="json")
    return res.status_code


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class ChangePasswordRevokesRefreshTokensTests(APITestCase):
    NEW_PASSWORD = "New-Passw0rd!9"
    OLD_PASSWORD = "Old-Passw0rd!"

    def setUp(self):
        self.enterContext(patch_throttle_rates(auth="1000000/minute", otp_request="1000000/hour", otp_verify="1000000/hour"))
        _fresh_throttle_state()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="kiya", email="kiya@ee.org", password=self.OLD_PASSWORD,
            first_name="Kiya", last_name="User",
        )

    def _login_refresh_token(self):
        res = self.client.post(
            "/api/auth/login/", {"email": self.user.email, "password": self.OLD_PASSWORD}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        refresh = res.data["refresh"]
        # Sanity: the token works before the password change.
        self.assertEqual(self.client.post("/api/auth/refresh/", {"refresh": refresh}, format="json").status_code, 200)
        return refresh

    def test_change_password_blocklists_stolen_refresh_token(self):
        stolen = self._login_refresh_token()
        self.client.force_authenticate(user=self.user)
        res = self.client.post(
            "/api/auth/change-password/",
            {"current_password": self.OLD_PASSWORD, "new_password": self.NEW_PASSWORD},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        status = _assert_old_refresh_rejected(APIClient(), stolen)
        self.assertNotEqual(status, 200)
        # The rotated credential works, and a fresh login mints a live token.
        res = self.client.post("/api/auth/login/", {"email": self.user.email, "password": self.NEW_PASSWORD}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.client.post("/api/auth/refresh/", {"refresh": res.data["refresh"]}, format="json").status_code, 200)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class AdminSetPasswordRevokesRefreshTokensTests(APITestCase):
    NEW_PASSWORD = "Reset-Passw0rd!7"

    def setUp(self):
        self.enterContext(patch_throttle_rates(auth="1000000/minute", otp_request="1000000/hour", otp_verify="1000000/hour"))
        _fresh_throttle_state()
        self.client = APIClient()
        self.target = make_user(email="target@ee.org")
        self.admin = make_user(email="admin-token-kill@ee.org", role=Role.ADMIN)

    def test_set_password_blocklists_stolen_refresh_token(self):
        refresh = str(RefreshToken.for_user(self.target))
        # Sanity: works before the admin resets it.
        self.assertEqual(self.client.post("/api/auth/refresh/", {"refresh": refresh}, format="json").status_code, 200)
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(
            f"/api/auth/staff/{self.target.id}/set-password/", {"new_password": self.NEW_PASSWORD}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        status = _assert_old_refresh_rejected(APIClient(), refresh)
        self.assertNotEqual(status, 200)
        self.assertTrue(self.target.refresh_from_db() or self.target.check_password(self.NEW_PASSWORD))


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class OtpPasswordResetRevokesRefreshTokensTests(APITestCase):
    NEW_PASSWORD = "New-Passw0rd!11"

    def setUp(self):
        self.enterContext(patch_throttle_rates(auth="1000000/minute", otp_request="1000000/hour", otp_verify="1000000/hour"))
        _fresh_throttle_state()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="melka", email="melka@ee.org", password="Old-Passw0rd5!",
            first_name="Melka", last_name="User",
        )
        patcher = mock.patch(
            "apps.accounts.registration.is_domain_allowed", side_effect=lambda e: e.endswith("@ee.org")
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.refresh = str(RefreshToken.for_user(self.user))

    def test_password_reset_complete_blocklists_stolen_refresh_token(self):
        # Sanity: works before the reset.
        self.assertEqual(self.client.post("/api/auth/refresh/", {"refresh": self.refresh}, format="json").status_code, 200)
        with mock.patch("apps.accounts.registration._generate_code", return_value="654321"):
            RegistrationOTP.objects.all().delete()
            self.assertEqual(
                self.client.post("/api/auth/password-reset/request-otp/", {"email": "melka@ee.org"}, format="json").status_code,
                200,
            )
        res = self.client.post(
            "/api/auth/password-reset/verify-otp/", {"email": "melka@ee.org", "code": "654321"}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        res = self.client.post(
            "/api/auth/password-reset/complete/",
            {"email": "melka@ee.org", "verification_token": res.data["verification_token"], "password": self.NEW_PASSWORD},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        status = _assert_old_refresh_rejected(APIClient(), self.refresh)
        self.assertNotEqual(status, 200)
        # The reset credential mints a fresh, live token pair.
        res = self.client.post("/api/auth/login/", {"email": "melka@ee.org", "password": self.NEW_PASSWORD}, format="json")
        self.assertEqual(res.status_code, 200)
