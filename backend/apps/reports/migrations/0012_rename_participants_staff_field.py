from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("reports", "0011_posteventreport_event_social_links"),
    ]

    operations = [
        migrations.RenameField(
            model_name="posteventreport",
            old_name="participants_jsi_staff",
            new_name="participants_ee_staff",
        ),
    ]
