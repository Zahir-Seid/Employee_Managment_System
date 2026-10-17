# Support Requests Enhancement: adds the "Support Request Assigned"
# notification type.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='notification',
            name='notification_type',
            field=models.CharField(
                choices=[
                    ('new_event', 'New Event Logged'),
                    ('event_updated', 'Event Postponed/Cancelled/Changed'),
                    ('support_requested', 'Communications Support Requested'),
                    ('support_completed', 'Communications Support Completed'),
                    ('report_overdue', 'Event Status Report Overdue'),
                    ('support_assigned', 'Support Request Assigned'),
                ],
                max_length=30,
            ),
        ),
    ]
