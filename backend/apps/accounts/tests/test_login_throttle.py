"""Security review finding #9: the "auth" 60/min IP scope protects the
endpoint, but attempts against ONE account should rate-limit on the
account, not the requesting IP — so guessing multiple passwords for one
mailbox trips its own bucket even when the guesses arrive from several
offices, while unfocused traffic stays unaffected.
"""
from django.core.cache import cache
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import User
from apps.core.tests.throttle_helpers import patch_throttle_rates


class AttemptedUsernameThrottleTests(APITestCase):
    def setUp(self):
        self.enterContext(patch_throttle_rates(auth="1000000/minute", login_user="3/min"))
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="zuzu", email="zuzu@ee.org", password="Right-Pass0rd!", first_name="Z", last_name="U"
        )

    def _attempt(self, email="zuzu@ee.org", password="wrong"):
        return self.client.post("/api/auth/login/", {"email": email, "password": password}, format="json")

    def test_fourth_email_attempt_is_429_sooner_than_the_first_three(self):
        for i in range(3):
            self.assertIn(self._attempt().status_code, (400, 401))
        self.assertEqual(self._attempt().status_code, 429)

    def test_right_password_on_attempt_two_not_blocked(self):
        self.assertIn(self._attempt(password="nope-1").status_code, (400, 401))
        self.assertEqual(self._attempt(password="Right-Pass0rd!").status_code, 200)

    def test_other_account_attempts_are_independent_buckets(self):
        other = User.objects.create_user(
            username="yony", email="yony@ee.org", password="Right-Pass0rd!", first_name="Y", last_name="O"
        )
        for _ in range(3):
            self.assertIn(self._attempt().status_code, (400, 401))
        # zuzu's bucket is spent; the NEXT attempt against zuzu is 429...
        self.assertEqual(self._attempt().status_code, 429)
        # ...while the same-strength spray against a different mailbox
        # is still evaluated on its credentials (fresh bucket).
        self.assertIn(self._attempt(email=other.email).status_code, (400, 401))

    def test_empty_email_relies_on_ip_scope_instead(self):
        res = self.client.post("/api/auth/login/", {"email": "   ", "password": "x"}, format="json")
        self.assertIn(res.status_code, (400, 401))