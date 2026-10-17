from django.db import migrations, models


def fill_roles(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    for u in User.objects.all():
        u.roles = [u.role]
        u.save(update_fields=["roles"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0004_user_middle_name")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="roles",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(fill_roles, migrations.RunPython.noop),
    ]
