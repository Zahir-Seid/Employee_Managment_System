# User Registration Update: adds the "New Registration Pending Approval"
# and "Account Approved" notification types.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0002_add_support_assigned_type'),
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
                    ('registration_pending', 'New Registration Pending Approval'),
                    ('account_approved', 'Account Approved'),
                ],
                max_length=30,
            ),
        ),
    ]
