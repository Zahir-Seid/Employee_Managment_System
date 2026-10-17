from django.apps import AppConfig
from django.db.models.signals import post_migrate


def _seed_defaults_after_migrate(sender, **kwargs):
    # Deferred import: models aren't ready to use until post_migrate fires.
    from .seed import seed_defaults

    seed_defaults()


class ConfigurationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.configuration"
    label = "configuration"

    def ready(self):
        # Fires after every `migrate` (dev, prod, and the throwaway test
        # database Django's test runner builds via its own internal
        # migrate call) — see apps/configuration/seed.py for why this
        # can't be left as a manual step.
        post_migrate.connect(_seed_defaults_after_migrate, sender=self)
