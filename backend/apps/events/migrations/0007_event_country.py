from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("events", "0006_remove_operational_request_description"),
    ]

    operations = [
        migrations.AddField(
            model_name="event",
            name="country",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
    ]
