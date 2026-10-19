"""Security review finding #3: behind the reverse proxy every request
reached Django from the nginx container, and DRF's default identity
handling either (a) merged everyone into one bucket or (b) — with
client-supplied X-Forwarded-For appended by nginx — let a single client
mint unlimited buckets by rotating spoofed prefixes. With
NUM_PROXIES=1 (TRUSTED_PROXY_COUNT), the identity is the LAST XFF hop:
the one the trusted proxy appended.
"""
from django.conf import settings
from django.test import RequestFactory, override_settings
from rest_framework.test import APIClient, APITestCase
from rest_framework.throttling import ScopedRateThrottle

from apps.accounts.models import User
from apps.core.tests.throttle_helpers import patch_throttle_rates

TRUST_ONE_PROXY = {
    **settings.REST_FRAMEWORK,
    "NUM_PROXIES": 1,
}


@override_settings(REST_FRAMEWORK=TRUST_ONE_PROXY)
class TrustedProxyIdentityTests(APITestCase):
    def _request(self, xff, remote="172.18.0.5"):
        return RequestFactory().get("/api/auth/login/", HTTP_X_FORWARDED_FOR=xff, REMOTE_ADDR=remote)

    def test_last_hop_wins_over_spoofed_prefix(self):
        ident_a = ScopedRateThrottle().get_ident(self._request("6.6.6.6, 7.7.7.7"))
        ident_b = ScopedRateThrottle().get_ident(self._request("8.8.8.8, 7.7.7.7"))
        self.assertEqual(ident_a, "7.7.7.7")
        self.assertEqual(ident_b, "7.7.7.7")

    def test_no_xff_uses_remote_addr(self):
        request = RequestFactory().get("/api/auth/login/", REMOTE_ADDR="172.18.0.5")
        self.assertEqual(ScopedRateThrottle().get_ident(request), "172.18.0.5")


class TrustedProxyBucketSharingTests(APITestCase):
    """End-to-end: rotating the spoofable prefix must NOT rotate buckets."""

    def setUp(self):
        self.enterContext(patch_throttle_rates(auth="1000000/minute", login_user="2/min"))
        from django.core.cache import cache

        cache.clear()
        User.objects.create_user(
            username="spoof", email="spoof@ee.org", password="Right-Pass0rd!", first_name="S", last_name="P"
        )
        self.client = APIClient()

    def _attempt(self, prefix):
        return self.client.post(
            "/api/auth/login/",
            {"email": "spoof@ee.org", "password": "wrong"},
            format="json",
            HTTP_X_FORWARDED_FOR=f"{prefix}, 10.0.0.1",
        )

    def test_every_spoofed_prefix_shares_the_trusted_bucket(self):
        self.assertEqual(self._attempt("9.9.9.9").status_code, 401)
        self.assertEqual(self._attempt("8.8.8.8").status_code, 401)
        # Third try from yet another forged prefix: same bucket, spent.
        self.assertEqual(self._attempt("7.7.7.7").status_code, 429)
