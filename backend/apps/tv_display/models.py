import re
import uuid

from django.conf import settings
from django.db import models

from apps.reports.validators import validate_photo_file

# Default rotation order. Upcoming Events and Event Analytics are automatic
# (live Events/Dashboard data); the rest are manually authored queues.
SECTION_KEYS = [
    "todays_activities",
    "upcoming_events",
    "staff_spotlight",
    "celebrations",
    "announcements",
    "home_news",
    "home_major_events",
    "home_announcements",
    "recognitions",
    "quick_information",
    "system_dashboards",
    "system_dashboard_picks",
]

# Section keys that used to exist and were removed entirely.
REMOVED_SECTION_KEYS = {"recent_events"}

SECTION_LABELS = {
    "staff_spotlight": "Staff Spotlight",
    "todays_activities": "Today's Activities",
    "upcoming_events": "Upcoming Events",
    "celebrations": "Celebrations",
    # Named "TV Announcements" so it isn't confused with the Home-content queue.
    "announcements": "TV Announcements",
    "home_news": "News",
    "home_major_events": "Major Events",
    "home_announcements": "Announcements",
    "recognitions": "Recognitions",
    "quick_information": "Quick Information",
    "system_dashboards": "Event Analytics",
    "system_dashboard_picks": "System Dashboards",
}

# Sections that pull live Events/Dashboard data by default. Descriptive only:
# the serializer uses it to tell the frontend which "Manage" control to show.
AUTOMATIC_SECTION_KEYS = {"upcoming_events", "system_dashboards"}

# Admin-selected dashboards (see DASHBOARD_PICK_LABELS) rather than slides.
DASHBOARD_PICK_SECTION_KEYS = {"system_dashboard_picks"}

# Queues backed by the public Home Page content pool (apps.content.HomeContent)
# rather than TVDisplaySlide.
HOME_CONTENT_SECTION_KEYS = {"home_news", "home_major_events", "home_announcements"}

HOME_CONTENT_TYPE_BY_SECTION_KEY = {
    "home_news": "news",
    "home_major_events": "major_event",
    "home_announcements": "announcement",
}

# Dashboards an Admin can choose from. Each reuses data apps.dashboard already
# computes for the shared TV payload.
DASHBOARD_PICK_KEYS = ["org_summary", "participant_overview", "region_breakdown", "comms_support"]

DASHBOARD_PICK_LABELS = {
    "org_summary": "Organization Summary",
    "participant_overview": "Participant Overview",
    "region_breakdown": "Events by Region",
    "comms_support": "Communications Support Overview",
}

CONTENT_MODE_AUTOMATIC = "automatic"
CONTENT_MODE_MANUAL = "manual"
CONTENT_MODES = (CONTENT_MODE_AUTOMATIC, CONTENT_MODE_MANUAL)

# Same period vocabulary as the main Dashboard's Weekly/Monthly/... toggle.
ANALYTICS_PERIOD_CHOICES = (
    ("all", "All"),
    ("weekly", "Weekly"),
    ("monthly", "Monthly"),
    ("quarterly", "Quarterly"),
    ("yearly", "Yearly"),
)
ANALYTICS_PERIODS = [key for key, _ in ANALYTICS_PERIOD_CHOICES]


def _default_section_entry(key):
    """Default settings for one built-in section. Only automatic queues start
    enabled; `duration_seconds=None` follows the shared screen duration."""
    return {
        "key": key,
        "enabled": key in AUTOMATIC_SECTION_KEYS,
        "duration_seconds": None,
        "content_mode": CONTENT_MODE_AUTOMATIC if key in AUTOMATIC_SECTION_KEYS else CONTENT_MODE_MANUAL,
    }


def _default_sections():
    return [_default_section_entry(key) for key in SECTION_KEYS]


def reconcile_sections(sections):
    """Bring a saved `sections` list in line with the current code.

    - Keeps everything the admin chose (order, on/off, timing, content mode,
      custom queues and their labels).
    - Drops entries that are neither a current built-in nor a custom queue
      (retired sections), and duplicates.
    - Adds any current built-in that is missing, with its normal default,
      placed right after the built-in that precedes it in SECTION_KEYS.
    - Fills in a missing `content_mode`.
    Pure function: returns a new list and never mutates its input.
    """
    result = []
    seen = set()
    for item in sections if isinstance(sections, list) else []:
        if not isinstance(item, dict):
            continue
        key = item.get("key")
        if not key or key in seen or key in REMOVED_SECTION_KEYS:
            continue
        if key not in SECTION_KEYS and not item.get("custom"):
            continue  # retired/unknown built-in
        seen.add(key)
        entry = dict(item)
        if "enabled" not in entry or not isinstance(entry["enabled"], bool):
            entry["enabled"] = bool(entry.get("enabled", key in AUTOMATIC_SECTION_KEYS))
        if key in SECTION_KEYS and entry.get("content_mode") not in CONTENT_MODES:
            entry["content_mode"] = CONTENT_MODE_AUTOMATIC if key in AUTOMATIC_SECTION_KEYS else CONTENT_MODE_MANUAL
        elif entry.get("custom") and entry.get("content_mode") not in CONTENT_MODES:
            entry["content_mode"] = CONTENT_MODE_MANUAL
        result.append(entry)

    for index, key in enumerate(SECTION_KEYS):
        if key in seen:
            continue
        position = 0
        for prev_key in reversed(SECTION_KEYS[:index]):
            at = next((i for i, e in enumerate(result) if e["key"] == prev_key), None)
            if at is not None:
                position = at + 1
                break
        result.insert(position, _default_section_entry(key))
        seen.add(key)
    return result


def reconcile_dashboard_picks(picks):
    """Same idea for `dashboard_picks`: keep known picks (and their on/off),
    drop unknown ones, add missing ones switched off."""
    result = []
    seen = set()
    for item in picks if isinstance(picks, list) else []:
        if isinstance(item, dict) and item.get("key") in DASHBOARD_PICK_KEYS and item["key"] not in seen:
            seen.add(item["key"])
            result.append({"key": item["key"], "enabled": bool(item.get("enabled"))})
    for key in DASHBOARD_PICK_KEYS:
        if key not in seen:
            result.append({"key": key, "enabled": False})
    return result


def _default_dashboard_picks():
    """Dashboard picks are opt-in, so they all start off."""
    return [{"key": key, "enabled": False} for key in DASHBOARD_PICK_KEYS]


# Sections backed by manually authored TVDisplaySlide rows. This includes the
# automatic ones, which become ordinary slide queues when switched to "manual".
MANUAL_SLIDE_SECTION_KEYS = [
    key
    for key in SECTION_KEYS
    if key not in DASHBOARD_PICK_SECTION_KEYS
    and key not in HOME_CONTENT_SECTION_KEYS
]


# Admin-created queues live as extra entries in TVDisplaySettings.sections:
# {"key", "enabled", "custom": True, "label", "duration_seconds"}. A custom
# queue's key never changes once created, since TVDisplaySlide.section_key
# points at it.
def make_custom_section_key(label):
    """Build a URL/DB-safe key from the label plus a random suffix so queues
    with the same name never collide."""
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")[:20] or "queue"
    return f"custom_{slug}_{uuid.uuid4().hex[:6]}"


def get_custom_section_keys():
    """Keys of every custom queue on the singleton TVDisplaySettings row."""
    return [item["key"] for item in TVDisplaySettings.get_settings().sections if item.get("custom")]


def get_section_label(section_key):
    """Label for a built-in or custom section, falling back to the raw key
    (e.g. for a custom queue that has since been deleted)."""
    if section_key in SECTION_LABELS:
        return SECTION_LABELS[section_key]
    for item in TVDisplaySettings.get_settings().sections:
        if item["key"] == section_key:
            return item.get("label", section_key)
    return section_key


class TVDisplaySettings(models.Model):
    """Singleton (always pk=1) holding the TV Display's on/off, order and
    timing settings, managed from Admin > Communications > Display.

    `sections` is a single ordered JSON list so reordering and toggling are
    one write. Each entry: {"key": <section key>, "enabled": <bool>, ...}.
    """

    is_active = models.BooleanField(
        default=True, help_text="Master on/off for the whole TV Display rotation."
    )
    screen_duration_seconds = models.PositiveIntegerField(
        default=15, help_text="How long each section stays on screen before rotating to the next."
    )
    sections = models.JSONField(default=_default_sections)
    analytics_period = models.CharField(
        max_length=10,
        choices=ANALYTICS_PERIOD_CHOICES,
        default="monthly",
        help_text="Which period Event Analytics is scoped to (mirrors the main Dashboard's period toggle).",
    )
    analytics_period_selection = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "Optional specific week/month/quarter/year for analytics_period "
            "(same shape as the Dashboard's period picker). Leave a key out "
            "to keep tracking the current one, e.g. an empty dict with "
            "analytics_period='monthly' always means 'this month'."
        ),
    )
    # Only used when "system_dashboard_picks" is enabled in `sections`.
    dashboard_picks = models.JSONField(default=_default_dashboard_picks)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def get_settings(cls):
        """Return the settings row, reconciled with the current built-in
        sections and dashboard picks.

        The saved JSON can predate changes to SECTION_KEYS/DASHBOARD_PICK_KEYS,
        and the serializer rejects a list that doesn't match the current
        built-ins, so every reader goes through here first.
        """
        instance, _ = cls.objects.get_or_create(pk=1)
        sections = reconcile_sections(instance.sections)
        picks = reconcile_dashboard_picks(instance.dashboard_picks)
        changed = []
        if sections != instance.sections:
            instance.sections = sections
            changed.append("sections")
        if picks != instance.dashboard_picks:
            instance.dashboard_picks = picks
            changed.append("dashboard_picks")
        if changed:
            instance.save(update_fields=changed)
        return instance

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def __str__(self):
        return "TV Display Settings"


class TVDisplaySlide(models.Model):
    """A manually added slide for one of the slide-based sections (or a custom
    queue), added by Communications or Admin.

    The TV cycles through every showable slide of a section in `order` then
    `created_at`. `duration_seconds` overrides the shared screen duration for
    this slide only.
    """

    # No `choices`: custom queues have generated keys. Valid values are
    # enforced in the serializer (MANUAL_SLIDE_SECTION_KEYS + custom keys) and
    # labels come from get_section_label().
    section_key = models.CharField(max_length=50)
    title = models.CharField(max_length=200)
    # Smaller line under the title, e.g. a position or work anniversary.
    subtitle = models.CharField(max_length=200, blank=True)
    message = models.TextField(blank=True)
    # Same photo rules as event report photos (apps.reports.EventPhoto).
    photo = models.ImageField(
        upload_to="tv_display_slides/%Y/%m/", null=True, blank=True, validators=[validate_photo_file]
    )
    duration_seconds = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Leave blank to use the shared TV Display duration for this slide too.",
    )
    is_active = models.BooleanField(default=True, help_text="Turn off to hide from the TV without deleting it.")
    # Optional schedule on top of is_active; "currently showable" is computed
    # from all three at read time rather than by flipping is_active.
    start_date = models.DateField(
        null=True, blank=True, help_text="First day this slide can appear. Leave blank to start immediately."
    )
    end_date = models.DateField(
        null=True, blank=True, help_text="Last day this slide can appear (inclusive). Leave blank for no end date."
    )
    order = models.PositiveIntegerField(default=0, help_text="Lower numbers show first within the same section.")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["section_key", "order", "created_at"]

    def __str__(self):
        return f"{get_section_label(self.section_key)}: {self.title}"
