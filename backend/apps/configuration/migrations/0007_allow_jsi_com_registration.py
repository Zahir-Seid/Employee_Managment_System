# Adds jsi.com to the self-registration allow-list (keeps any existing domains).
from django.db import migrations, models


def add_jsi_com(apps, schema_editor):
    SystemSettings = apps.get_model("configuration", "SystemSettings")
    for row in SystemSettings.objects.all():
        domains = [d.strip() for d in (row.registration_allowed_domains or "").split(",") if d.strip()]
        if "jsi.com" not in [d.lstrip("@").lower() for d in domains]:
            domains.append("jsi.com")
            row.registration_allowed_domains = ", ".join(domains)
            row.save(update_fields=["registration_allowed_domains"])


class Migration(migrations.Migration):

    dependencies = [
        ("configuration", "0006_category_label_sub_national"),
    ]

    operations = [
        migrations.AlterField(
            model_name="systemsettings",
            name="registration_allowed_domains",
            field=models.CharField(default="jsi.org, jsi.com", max_length=500),
        ),
        migrations.RunPython(add_jsi_com, migrations.RunPython.noop),
    ]
