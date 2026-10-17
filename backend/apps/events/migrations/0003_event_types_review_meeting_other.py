from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("events", "0002_event_big_event_photo"),
    ]

    operations = [
        migrations.AlterField(
            model_name="event",
            name="event_type",
            field=models.CharField(
                choices=[
                    ("training", "Training"),
                    ("workshop", "Workshop"),
                    ("conference", "Conference"),
                    ("supportive_supervision", "Supportive Supervision"),
                    ("rm", "Review Meeting"),
                    ("other", "Other"),
                ],
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="event",
            name="review_meeting_type",
            field=models.CharField(
                blank=True,
                choices=[("annual", "Annual"), ("mid_term", "Mid-term")],
                default="",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="event",
            name="event_type_other",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
    ]
