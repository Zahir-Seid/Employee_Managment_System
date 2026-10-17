from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("events", "0004_event_operational_request"),
    ]

    operations = [
        migrations.AddField(
            model_name="event",
            name="personal_objective",
            field=models.TextField(blank=True, default=""),
        ),
    ]
