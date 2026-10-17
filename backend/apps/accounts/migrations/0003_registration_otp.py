# User Registration Update: self-service, OTP-verified registration.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_add_comms_lead_role"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="self_registered",
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name="RegistrationOTP",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("email", models.EmailField(max_length=254, unique=True)),
                ("code_hash", models.CharField(max_length=64)),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("is_verified", models.BooleanField(default=False)),
                ("verification_token", models.CharField(blank=True, default="", max_length=64)),
                ("expires_at", models.DateTimeField()),
                ("verification_token_expires_at", models.DateTimeField(blank=True, null=True)),
                ("last_sent_at", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
        ),
    ]
