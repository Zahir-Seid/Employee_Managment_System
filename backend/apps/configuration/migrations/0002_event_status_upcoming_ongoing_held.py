# Event Status Update: the single "logged" ConfigOption (event_status
# list) used to cover every not-yet-postponed/cancelled/completed event
# under one label ("Ongoing"). It now needs to become three separate,
# individually labeled/orderable options — Upcoming, Ongoing, Held — to
# match the six-way computed status in apps.events.models.Event.
# get_computed_status. This can't be done by re-running seed_defaults()
# alone: that function is deliberately additive-only (get_or_create), so
# it would just create new "ongoing"/"held" rows alongside the old
# "logged" row forever, leaving a stale, confusing duplicate in the
# Configuration page's Status list. This migration does the one-time,
# irreversible-in-spirit-but-reversible-in-code rename that
# seed_defaults() can't:
#   - the existing "logged" row becomes "upcoming" / "Upcoming"
#   - new "ongoing" / "Ongoing" and "held" / "Held" rows are added
#   - all six rows are (re-)ordered to the spec's own sequence:
#     Upcoming, Ongoing, Held, Completed, Postponed, Cancelled
# On a brand-new database, the "logged" row won't exist yet at migration
# time (seeding happens via the post_migrate signal, which fires only
# after every migration — including this one — has already run), so the
# rename step below is a no-op there; apps/configuration/seed.py's
# DEFAULTS has been updated separately to seed the correct six rows
# directly for that case.
from django.db import migrations


EVENT_STATUS = "event_status"


def rename_logged_to_upcoming(apps, schema_editor):
    ConfigOption = apps.get_model("configuration", "ConfigOption")

    ConfigOption.objects.filter(list_type=EVENT_STATUS, value="logged").update(
        value="upcoming", label="Upcoming", order=0
    )
    ConfigOption.objects.get_or_create(
        list_type=EVENT_STATUS, value="ongoing", defaults={"label": "Ongoing", "order": 1}
    )
    ConfigOption.objects.get_or_create(
        list_type=EVENT_STATUS, value="held", defaults={"label": "Held", "order": 2}
    )
    # Normalize display order for the three unchanged statuses too, so
    # every install ends up matching the spec's exact sequence rather
    # than whatever order they happened to be created/reordered in before.
    for value, order in (("completed", 3), ("postponed", 4), ("cancelled", 5)):
        ConfigOption.objects.filter(list_type=EVENT_STATUS, value=value).update(order=order)


def rename_upcoming_to_logged(apps, schema_editor):
    """Reverse: fold Upcoming back into "logged"/"Ongoing" and drop the
    Ongoing/Held rows this migration added. Existing Events are
    unaffected either way — their raw `status` column was never touched,
    only these ConfigOption label/order rows were.
    """
    ConfigOption = apps.get_model("configuration", "ConfigOption")

    ConfigOption.objects.filter(list_type=EVENT_STATUS, value="upcoming").update(
        value="logged", label="Ongoing", order=0
    )
    ConfigOption.objects.filter(list_type=EVENT_STATUS, value__in=["ongoing", "held"]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('configuration', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(rename_logged_to_upcoming, rename_upcoming_to_logged),
    ]
