from django.core.management.base import BaseCommand

from apps.configuration.seed import seed_defaults


class Command(BaseCommand):
    help = (
        "Seeds default options for every admin-managed list — Thematic Area, Engagement "
        "Level, Lead Organization, Category, Status, Support Level, and Support Type. "
        "Idempotent and safe to re-run any time. Note: this also runs automatically after "
        "every `migrate` via the post_migrate signal (see apps/configuration/apps.py) — "
        "running it by hand is only needed if you want to confirm/force it explicitly."
    )

    def handle(self, *args, **options):
        created_count = seed_defaults()
        self.stdout.write(self.style.SUCCESS(f"Seeded {created_count} new config option(s)."))
