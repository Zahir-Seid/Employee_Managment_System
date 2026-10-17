# Communications Support Request Assignment update: adds the "assignment
# removed", "message" and "clarification" notification types.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0003_add_registration_types'),
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
                    ('support_unassigned', 'Support Request Assignment Removed'),
                    ('support_message', 'Support Request Message'),
                    ('support_clarification', 'Support Request Clarification'),
                    ('registration_pending', 'New Registration Pending Approval'),
                    ('account_approved', 'Account Approved'),
                ],
                max_length=30,
            ),
        ),
    ]
