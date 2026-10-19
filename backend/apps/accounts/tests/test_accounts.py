from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.core.tests.factories import make_staff


class LoginTests(APITestCase):
    """FR1/FR2: secure login with role embedded for frontend routing."""

    def setUp(self):
        from django.core.cache import cache

        cache.clear()  # keep the shared throttle buckets from leaking between tests
        self.user = make_staff(email="jane@ee.org")

    def test_login_with_correct_credentials_returns_tokens_and_role(self):
        response = self.client.post(
            reverse("accounts:login"),
            {"email": "jane@ee.org", "password": "TestPass123!"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        self.assertEqual(response.data["user"]["role"], "staff")

    def test_login_with_wrong_password_is_rejected(self):
        response = self.client.post(
            reverse("accounts:login"),
            {"email": "jane@ee.org", "password": "wrong-password"},
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_endpoint_requires_authentication(self):
        response = self.client.get(reverse("accounts:me"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_endpoint_returns_authenticated_user(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("accounts:me"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], "jane@ee.org")

    def test_login_survives_more_than_20_requests_per_hour(self):
        """Regression test: LoginView used to inherit the global 20/hour
        anon throttle, which a single office IP (several staff logging in
        over a normal morning, or a browser retrying) could exceed in
        minutes — the 21st request would get a 429 even with a correct
        password. LoginView now uses its own "auth" scope (60/min,
        settings.py), so 21 rapid attempts must all still be evaluated on
        their credentials, never short-circuited by the throttle.

        Finding #9 added a second, per-attempted-mailbox bucket
        ("login_user", 10/min): legitimate logins for DIFFERENT staff
        members from one office IP must not trip it, so this test rotates
        three mailboxes. Hammering exactly ONE mailbox is covered by
        AttemptedUsernameThrottleTests — that is the desired new behavior.
        """
        from django.core.cache import cache

        cache.clear()
        staff_emails = [f"rapid{i}@ee.org" for i in range(3)]
        for email in staff_emails:
            make_staff(email=email)
        for i in range(21):
            response = self.client.post(
                reverse("accounts:login"),
                {"email": staff_emails[i % 3], "password": "TestPass123!"},
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)


class ProfileTests(APITestCase):
    """UI/UX Section 15: users can update their own profile but never their own role."""

    def setUp(self):
        self.user = make_staff(email="jane@ee.org")
        self.client.force_authenticate(user=self.user)

    def test_user_cannot_escalate_own_role_via_profile_update(self):
        response = self.client.patch(
            reverse("accounts:profile-update"),
            {"role": "leadership", "position": "Program Officer"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.role, "staff")
        self.assertEqual(self.user.position, "Program Officer")

    def test_change_password_requires_correct_current_password(self):
        response = self.client.post(
            reverse("accounts:change-password"),
            {"current_password": "wrong", "new_password": "NewPass123!"},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_change_password_succeeds_with_correct_current_password(self):
        response = self.client.post(
            reverse("accounts:change-password"),
            {"current_password": "TestPass123!", "new_password": "NewPass123!"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NewPass123!"))
