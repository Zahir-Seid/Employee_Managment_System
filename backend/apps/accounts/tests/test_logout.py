"""Security review finding #6: signing out now revokes the presented
refresh token server-side instead of just "the client forgets it".
"""
from django.conf import settings
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import User
from apps.audit.models import ActionType, AuditLog


THROTTLES_OFF = {
    **settings.REST_FRAMEWORK,
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {
        **settings.REST_FRAMEWORK.get("DEFAULT_THROTTLE_RATES", {}),
        "auth": "1000000/minute",
    },
}


@override_settings(REST_FRAMEWORK=THROTTLES_OFF)
class LogoutRevokesRefreshTokenTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="halu", email="halu@ee.org", password="Old-Passw0rd!", first_name="Hal", last_name="U"
        )

    def _login(self):
        res = self.client.post("/api/auth/login/", {"email": self.user.email, "password": "Old-Passw0rd!"}, format="json")
        self.assertEqual(res.status_code, 200)
        return res.data

    def test_logout_blacklists_the_presented_refresh_token(self):
        tokens = self._login()
        res = self.client.post("/api/auth/logout/", {"refresh": tokens["refresh"]}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            self.client.post("/api/auth/refresh/", {"refresh": tokens["refresh"]}, format="json").status_code, 401
        )
        # Signout revokes the session, not the account: the (still valid)
        # access token of another device keeps working.
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)

    def test_logout_is_audited(self):
        self._login()
        self.client.post("/api/auth/logout/", {"refresh": self._login()["refresh"]}, format="json")
        entry = AuditLog.objects.filter(action_type=ActionType.LOGOUT, user=self.user).first()
        self.assertIsNotNone(entry)
        self.assertIn("logged out", entry.description)

    def test_missing_or_bad_tokens_still_get_calm_200(self):
        self.assertEqual(self.client.post("/api/auth/logout/", {}, format="json").status_code, 200)
        self.assertEqual(
            self.client.post("/api/auth/logout/", {"refresh": "not-a-token"}, format="json").status_code, 200
        )

    def test_logout_endpoint_needs_no_access_token(self):
        # No Authorization header, no access token at all: presenting the
        # still-live refresh token is enough (the access token may have
        # expired by the time the user signs out).
        tokens = self._login()
        self.client.credentials()
        res = self.client.post("/api/auth/logout/", {"refresh": tokens["refresh"]}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            self.client.post("/api/auth/refresh/", {"refresh": tokens["refresh"]}, format="json").status_code, 401
        )
