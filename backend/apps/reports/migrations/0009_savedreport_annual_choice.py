from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('reports', '0008_savedreport_partner_engagement_choice'),
    ]

    operations = [
        migrations.AlterField(
            model_name='savedreport',
            name='report_type',
            field=models.CharField(
                choices=[
                    ('management', 'Management Report'),
                    ('event_activity', 'Event Activity Report'),
                    ('communications', 'Communications Report'),
                    ('partner_engagement', 'Partner Engagement Report'),
                    ('annual', 'Annual Event Report'),
                ],
                max_length=20,
            ),
        ),
    ]
