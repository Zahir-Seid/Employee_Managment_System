from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_user_roles"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="title",
            field=models.CharField(blank=True, default="", max_length=10),
        ),
    ]
