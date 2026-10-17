from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0006_user_title"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="sex",
            field=models.CharField(blank=True, default="", max_length=10),
        ),
    ]
