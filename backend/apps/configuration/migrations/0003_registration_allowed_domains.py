# User Registration Update: adds the admin-editable "which email domains
# may self-register" field to the existing System Settings singleton.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("configuration", "0002_event_status_upcoming_ongoing_held"),
    ]

    operations = [
        migrations.AddField(
            model_name="systemsettings",
            name="registration_allowed_domains",
            field=models.CharField(default="jsi.org", max_length=500),
        ),
    ]
