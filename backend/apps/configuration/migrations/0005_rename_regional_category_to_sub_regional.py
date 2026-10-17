# Category rename: "Regional" (stored value "regional") becomes "Sub-regional"
# (stored value "sub_regional"). The value is stored in a few places, so this
# one-time data migration moves all of them together:
#   - events.Event.category                      (plain CharField, no choices)
#   - configuration.ConfigOption (category list) (value + label)
#   - reports.SavedReport.filters                (a saved "category" filter)
# Audit-trail entries are history and are left as they were written.
#
# seed_defaults() is additive-only (get_or_create), so on an existing install
# it cannot do the rename itself; on a brand-new database this migration is a
# no-op and seed.py already seeds "sub_regional" directly.
#
# The option's label is only changed when it still has the old default label
# ("Regional"), so a label an admin deliberately customised is kept.
from django.db import migrations

CATEGORY = "category"
OLD, NEW = "regional", "sub_regional"
OLD_LABEL, NEW_LABEL = "Regional", "Sub-regional"


def _swap(apps, old, new, old_label, new_label):
    Event = apps.get_model("events", "Event")
    ConfigOption = apps.get_model("configuration", "ConfigOption")
    SavedReport = apps.get_model("reports", "SavedReport")

    Event.objects.filter(category=old).update(category=new)

    option = ConfigOption.objects.filter(list_type=CATEGORY, value=old).first()
    if option is not None:
        if ConfigOption.objects.filter(list_type=CATEGORY, value=new).exists():
            # The target already exists (e.g. created by hand): drop the old
            # row instead of creating a duplicate.
            option.delete()
        else:
            option.value = new
            if option.label == old_label:
                option.label = new_label
            option.save(update_fields=["value", "label"])

    for report in SavedReport.objects.all():
        filters = report.filters
        if not isinstance(filters, dict):
            continue
        changed = False
        if filters.get("category") == old:
            filters["category"] = new
            changed = True
        categories = filters.get("categories")
        if isinstance(categories, list) and old in categories:
            filters["categories"] = [new if c == old else c for c in categories]
            changed = True
        if changed:
            report.filters = filters
            report.save(update_fields=["filters"])


def forwards(apps, schema_editor):
    _swap(apps, OLD, NEW, OLD_LABEL, NEW_LABEL)


def backwards(apps, schema_editor):
    _swap(apps, NEW, OLD, NEW_LABEL, OLD_LABEL)


class Migration(migrations.Migration):
    dependencies = [
        ("configuration", "0004_engagement_level_presenter"),
        ("events", "0006_remove_operational_request_description"),
        ("reports", "0011_posteventreport_event_social_links"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
