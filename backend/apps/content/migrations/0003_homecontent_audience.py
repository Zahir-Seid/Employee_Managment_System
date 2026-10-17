from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("content", "0002_upcoming_event_type"),
    ]

    operations = [
        # Existing rows were shared between the Home Page and the TV, so
        # they start as "both" and keep showing in both places; anything
        # added from now on defaults to "home" and is set explicitly by
        # whichever screen adds it.
        migrations.AddField(
            model_name="homecontent",
            name="audience",
            field=models.CharField(
                choices=[("home", "Home Page"), ("tv", "TV Display"), ("both", "Home Page and TV Display")],
                default="both",
                max_length=10,
            ),
        ),
        migrations.AlterField(
            model_name="homecontent",
            name="audience",
            field=models.CharField(
                choices=[("home", "Home Page"), ("tv", "TV Display"), ("both", "Home Page and TV Display")],
                default="home",
                max_length=10,
            ),
        ),
    ]
