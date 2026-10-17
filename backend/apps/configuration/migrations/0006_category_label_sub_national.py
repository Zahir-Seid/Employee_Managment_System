# Display-name change only: the "Sub-regional" category is now called
# "Sub-national". The stored value (sub_regional) is deliberately unchanged, so
# existing events, saved reports and audit history are not touched. Only the
# category option's label is updated, and only while it still has the old
# default label, so a label an admin customised is kept.
from django.db import migrations

CATEGORY = "category"
VALUE = "sub_regional"
OLD_LABEL, NEW_LABEL = "Sub-regional", "Sub-national"


def _relabel(apps, old_label, new_label):
    ConfigOption = apps.get_model("configuration", "ConfigOption")
    ConfigOption.objects.filter(list_type=CATEGORY, value=VALUE, label=old_label).update(label=new_label)


def forwards(apps, schema_editor):
    _relabel(apps, OLD_LABEL, NEW_LABEL)


def backwards(apps, schema_editor):
    _relabel(apps, NEW_LABEL, OLD_LABEL)


class Migration(migrations.Migration):
    dependencies = [
        ("configuration", "0005_rename_regional_category_to_sub_regional"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
