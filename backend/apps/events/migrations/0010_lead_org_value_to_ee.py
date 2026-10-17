# Data migration: the organization value "JSI" is now "EE". Existing events and
# Configuration dropdown options that stored "JSI" are converted so the
# "is this the home organization?" checks keep working.
from django.db import migrations


def jsi_to_ee(apps, schema_editor):
    Event = apps.get_model("events", "Event")
    ConfigOption = apps.get_model("configuration", "ConfigOption")

    for field in ("organization_lead_agency", "co_organizer_name"):
        for ev in Event.objects.exclude(**{field: ""}).only("pk", field):
            if (getattr(ev, field) or "").strip().upper() == "JSI":
                Event.objects.filter(pk=ev.pk).update(**{field: "EE"})

    for opt in ConfigOption.objects.filter(list_type="lead_organization"):
        if (opt.value or "").strip().upper() == "JSI" or (opt.label or "").strip().upper() == "JSI":
            clash = ConfigOption.objects.filter(list_type=opt.list_type, value="EE").exclude(pk=opt.pk).exists()
            if clash:
                continue
            ConfigOption.objects.filter(pk=opt.pk).update(value="EE", label="EE")


class Migration(migrations.Migration):

    dependencies = [
        ("events", "0009_alter_event_expected_participants"),
        ("configuration", "0008_alter_systemsettings_registration_allowed_domains"),
    ]

    operations = [
        migrations.RunPython(jsi_to_ee, migrations.RunPython.noop),
    ]
