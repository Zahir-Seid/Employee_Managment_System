# Engagement Level is now Organizer, Co-organizer, Facilitator, Presenter.
# Invited Participant, Speaker and Panelist are soft-disabled rather than
# deleted so existing events that use them keep their label; they just stop
# appearing in the dropdown for new events. Presenter is added (or
# re-activated) and the four options are put in order.
from django.db import migrations

ENGAGEMENT_LEVEL = "engagement_level"
RETIRED = ["invited_participant", "speaker", "panelist"]
ORDER = [
    ("organizer", "Organizer"),
    ("co_organizer", "Co-organizer"),
    ("facilitator", "Facilitator"),
    ("presenter", "Presenter"),
]


def apply(apps, schema_editor):
    ConfigOption = apps.get_model("configuration", "ConfigOption")
    ConfigOption.objects.filter(list_type=ENGAGEMENT_LEVEL, value__in=RETIRED).update(is_active=False)
    for order, (value, label) in enumerate(ORDER):
        obj, created = ConfigOption.objects.get_or_create(
            list_type=ENGAGEMENT_LEVEL, value=value, defaults={"label": label, "order": order}
        )
        if not created:
            obj.order = order
            if value == "presenter":
                obj.is_active = True
            obj.save(update_fields=["order", "is_active"] if value == "presenter" else ["order"])


def revert(apps, schema_editor):
    ConfigOption = apps.get_model("configuration", "ConfigOption")
    ConfigOption.objects.filter(list_type=ENGAGEMENT_LEVEL, value__in=RETIRED).update(is_active=True)
    ConfigOption.objects.filter(list_type=ENGAGEMENT_LEVEL, value="presenter").update(is_active=False)


class Migration(migrations.Migration):

    dependencies = [
        ("configuration", "0003_registration_allowed_domains"),
    ]

    operations = [migrations.RunPython(apply, revert)]
