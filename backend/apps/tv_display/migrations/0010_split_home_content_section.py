from django.db import migrations


def split_home_content_section(apps_registry, schema_editor):
    """Replaces the single combined "home_content" section (added in
    0009) with three separately orderable/toggleable queues - News (Home
    Page), Major Events (Home Page), Announcements (Home Page) - so each
    can sit wherever makes sense in the rotation on its own, instead of
    always moving together as one. The "Add content" form itself is
    unchanged (still the shared Home Page > Manage Content form, still
    where you pick News/Major Event/Announcement) - this migration only
    touches which TV Display queues exist, not how content is added.
    Every row gets all three, in that order, at the position the old
    combined entry held, carrying its enabled/content_mode forward.
    """
    TVDisplaySettings = apps_registry.get_model("tv_display", "TVDisplaySettings")
    for instance in TVDisplaySettings.objects.all():
        sections = list(instance.sections)
        keys = [item.get("key") for item in sections]
        if "home_news" in keys or "home_major_events" in keys or "home_announcements" in keys:
            continue  # already split (or a fresh row that never had home_content)
        try:
            old_index = next(i for i, item in enumerate(sections) if item.get("key") == "home_content")
        except StopIteration:
            continue  # row predates 0009 and never got home_content either
        old_entry = sections[old_index]
        replacement = [
            {
                "key": key,
                "enabled": old_entry.get("enabled", True),
                "duration_seconds": old_entry.get("duration_seconds"),
                "content_mode": old_entry.get("content_mode", "manual"),
            }
            for key in ("home_news", "home_major_events", "home_announcements")
        ]
        sections[old_index : old_index + 1] = replacement
        instance.sections = sections
        instance.save(update_fields=["sections"])


def noop_reverse(apps_registry, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("tv_display", "0009_home_content_section"),
    ]

    operations = [
        migrations.RunPython(split_home_content_section, noop_reverse),
    ]
