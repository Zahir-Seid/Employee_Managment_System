from django.db import migrations


def add_home_content_section_to_existing_settings(apps_registry, schema_editor):
    """Same reasoning as migration 0003/0006's backfills: any TVDisplaySettings
    row saved before "News, Major Events & Announcements" (home_content)
    existed needs it added to its `sections` list so it's a reorderable/
    toggleable entry going forward. Inserted right after "announcements" so
    a freshly-backfilled row groups it with the other content sections
    (new rows get this position for free via SECTION_KEYS/_default_sections).
    Starts enabled but "manual" — same as every other manual section,
    nothing shows on the TV until an Admin/Communications user adds
    something via Add Content (which is the same Home Page content pool,
    see apps.content.HomeContent), matching "not automatic" for this
    section.
    """
    TVDisplaySettings = apps_registry.get_model("tv_display", "TVDisplaySettings")
    for instance in TVDisplaySettings.objects.all():
        keys = [item.get("key") for item in instance.sections]
        if "home_content" in keys:
            continue
        sections = list(instance.sections)
        entry = {
            "key": "home_content",
            "enabled": True,
            "duration_seconds": None,
            "content_mode": "manual",
        }
        try:
            insert_at = next(i for i, item in enumerate(sections) if item.get("key") == "announcements") + 1
        except StopIteration:
            insert_at = len(sections)
        sections.insert(insert_at, entry)
        instance.sections = sections
        instance.save(update_fields=["sections"])


def noop_reverse(apps_registry, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("tv_display", "0008_tvdisplaysettings_analytics_period"),
    ]

    operations = [
        migrations.RunPython(add_home_content_section_to_existing_settings, noop_reverse),
    ]
