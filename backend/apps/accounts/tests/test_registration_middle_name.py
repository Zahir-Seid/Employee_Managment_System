from unittest import mock

from django.test import TestCase

from apps.accounts.models import User
from apps.accounts.serializers import RegistrationCompleteSerializer


class RegistrationMiddleNameTests(TestCase):
    """First, middle (optional) and last name are collected at registration."""

    def _register(self, **extra):
        data = {
            "email": "new.person@ee.org",
            "verification_token": "token",
            "title": "Mr",
            "first_name": "Abebe",
            "last_name": "Kebede",
            "sex": "Male",
            "password": "Str0ng-Passw0rd!",
            **extra,
        }
        with mock.patch("apps.accounts.serializers.registration.check_verification_token"), mock.patch(
            "apps.accounts.serializers.registration.is_domain_allowed", return_value=True
        ):
            serializer = RegistrationCompleteSerializer(data=data)
            self.assertTrue(serializer.is_valid(), serializer.errors)
            return serializer.save()

    def test_middle_name_is_saved_when_given(self):
        user = self._register(middle_name="Tadesse")
        self.assertEqual(User.objects.get(pk=user.pk).middle_name, "Tadesse")
        self.assertEqual((user.first_name, user.last_name), ("Abebe", "Kebede"))

    def test_middle_name_is_optional(self):
        self.assertEqual(self._register().middle_name, "")
        other = self._register(email="second@ee.org", middle_name="")
        self.assertEqual(other.middle_name, "")
