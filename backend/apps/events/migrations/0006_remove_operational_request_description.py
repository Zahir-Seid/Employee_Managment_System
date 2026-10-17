from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("events", "0005_event_personal_objective"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="event",
            name="operational_request_description",
        ),
    ]
