import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("events", "0003_event_types_review_meeting_other"),
    ]

    operations = [
        migrations.AddField(
            model_name="event",
            name="has_operational_request",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="event",
            name="operational_request_description",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="event",
            name="operational_request_to",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="operational_requests_received",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
