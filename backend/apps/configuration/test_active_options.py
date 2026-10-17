from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.configuration.models import ConfigListType, ConfigOption

ALWAYS = (ConfigListType.LEAD_ORGANIZATION, ConfigListType.THEMATIC_AREA, ConfigListType.ENGAGEMENT_LEVEL)


class ActiveOptionsSelfHealTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="s1", email="s1@x.com", password="x", role=Role.STAFF)
        self.client.force_authenticate(self.user)

    def test_unseeded_lists_are_filled_in(self):
        ConfigOption.objects.filter(list_type__in=ALWAYS).delete()
        resp = self.client.get("/api/config-options/active/")
        self.assertEqual(resp.status_code, 200)
        for list_type in ALWAYS:
            self.assertGreater(len(resp.data[list_type]), 0, list_type)

    def test_admin_deactivating_everything_is_respected(self):
        ConfigOption.objects.filter(list_type=ConfigListType.THEMATIC_AREA).update(is_active=False)
        resp = self.client.get("/api/config-options/active/")
        self.assertEqual(resp.data[ConfigListType.THEMATIC_AREA], [])

    def test_admin_edits_are_not_overwritten(self):
        ConfigOption.objects.filter(list_type=ConfigListType.LEAD_ORGANIZATION).delete()
        ConfigOption.objects.create(list_type=ConfigListType.LEAD_ORGANIZATION, value="ACME", label="ACME", order=0)
        resp = self.client.get("/api/config-options/active/")
        self.assertEqual([o["value"] for o in resp.data[ConfigListType.LEAD_ORGANIZATION]], ["ACME"])
