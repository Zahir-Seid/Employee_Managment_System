from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tv_display', '0007_alter_tvdisplayslide_section_key'),
    ]

    operations = [
        migrations.AddField(
            model_name='tvdisplaysettings',
            name='analytics_period',
            field=models.CharField(
                choices=[
                    ('all', 'All'),
                    ('weekly', 'Weekly'),
                    ('monthly', 'Monthly'),
                    ('quarterly', 'Quarterly'),
                    ('yearly', 'Yearly'),
                ],
                default='monthly',
                help_text="Which period Event Analytics is scoped to (mirrors the main Dashboard's period toggle).",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='tvdisplaysettings',
            name='analytics_period_selection',
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text=(
                    "Optional specific week/month/quarter/year for analytics_period "
                    "(same shape as the Dashboard's period picker). Leave a key out "
                    "to keep tracking the current one, e.g. an empty dict with "
                    "analytics_period='monthly' always means 'this month'."
                ),
            ),
        ),
    ]
