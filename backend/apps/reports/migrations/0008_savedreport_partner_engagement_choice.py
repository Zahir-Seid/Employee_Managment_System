from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('reports', '0007_savedreport'),
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
                ],
                max_length=20,
            ),
        ),
    ]
