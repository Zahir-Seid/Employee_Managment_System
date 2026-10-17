from django.db import migrations


def set_todays_activities_manual(apps, schema_editor):
    """Today's Activities is now a manual slide queue, so any saved
    settings that still say it is "automatic" are switched to "manual"."""
    TVDisplaySettings = apps.get_model("tv_display", "TVDisplaySettings")
    for obj in TVDisplaySettings.objects.all():
        changed = False
        for item in obj.sections:
            if item.get("key") == "todays_activities" and item.get("content_mode") == "automatic":
                item["content_mode"] = "manual"
                changed = True
        if changed:
            obj.save(update_fields=["sections"])


class Migration(migrations.Migration):

    dependencies = [
        ("tv_display", "0011_remove_recent_events"),
    ]

    operations = [
        migrations.RunPython(set_todays_activities_manual, migrations.RunPython.noop),
    ]
