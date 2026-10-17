from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class ConfigListType(models.TextChoices):
    """Which dropdown/list this option belongs to.

    Originally scoped to lists that were already effectively free-form
    (plain CharField on Event, validated only by a hardcoded frontend
    array). Category, Status, Support Level, and Support Type were
    deliberately excluded from that first pass — Category/Status drive
    fixed color-coding throughout the UI (badges, charts, the calendar)
    and Status additionally has special automatic behavior (Completed is
    only ever set by report submission, never manually); Support Type
    auto-generates To-Do checklist items. None of that logic breaks by
    making the values admin-editable — colors/behavior fall back
    gracefully for any option an admin adds that isn't in the fixed
    color/behavior maps — but it's still a genuinely different kind of
    risk than "just a label," worth remembering when adding new options
    here: the UI will render them, but they may show a neutral gray color
    or (for Support Type) simply not have an auto-generated checklist item.
    """

    THEMATIC_AREA = "thematic_area", "Thematic Area"
    ENGAGEMENT_LEVEL = "engagement_level", "Engagement Level"
    LEAD_ORGANIZATION = "lead_organization", "Lead Organization"
    REGION = "region", "Region"
    SUPPORT_TYPE = "support_type", "Support Type"
    CATEGORY = "category", "Category"
    EVENT_STATUS = "event_status", "Status"
    SUPPORT_LEVEL = "support_level", "Support Level"


class ConfigOption(TimeStampedModel):
    """A single admin-managed entry in one of the lists above.

    `value` is what actually gets stored on the Event record (e.g.
    "co_organizer" for an Engagement Level, or "Data and Digital Health"
    for a Thematic Area, where value and label happen to be the same
    string). `label` is always what's shown in the UI.

    Options are soft-disabled (`is_active=False`) rather than hard-deleted
    by default, so existing Events that already reference a retired value
    keep displaying it correctly instead of showing a blank/broken field —
    dropdowns for NEW events only offer active options.
    """

    list_type = models.CharField(max_length=30, choices=ConfigListType.choices)
    value = models.CharField(max_length=150, help_text="The value stored on records. Not shown to end users.")
    label = models.CharField(max_length=150, help_text="What's shown in dropdowns.")
    order = models.PositiveIntegerField(default=0, help_text="Lower numbers appear first in dropdowns.")
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TimeStampedModel.Meta):
        ordering = ["list_type", "order", "label"]
        constraints = [
            models.UniqueConstraint(fields=["list_type", "value"], name="unique_config_value_per_list_type"),
        ]
        indexes = [
            models.Index(fields=["list_type", "is_active"]),
        ]

    def __str__(self):
        return f"{self.label} ({self.get_list_type_display()})"


class DashboardPeriod(models.TextChoices):
    WEEKLY = "weekly", "Weekly"
    MONTHLY = "monthly", "Monthly"
    QUARTERLY = "quarterly", "Quarterly"
    YEARLY = "yearly", "Yearly"


class SystemSettings(models.Model):
    """Singleton (always pk=1) holding the handful of values that used to
    require an env var + redeploy to change: notification email
    addresses, Event Status Report photo limits, and which period the
    Dashboard opens to by default. Admin-editable via the Configuration
    page's System Settings tab — the whole point being nobody needs a
    developer to change these again.

    Deliberately NOT the same mechanism as ConfigOption (that's a list of
    many rows per list_type; this is exactly one row of scalar settings) —
    a get_settings() classmethod below enforces the singleton and creates
    the row with sane defaults the first time anything asks for it, so
    there's never a "which row is the real one" ambiguity and no
    migration data-fixture is needed to bootstrap it.
    """

    # Both optional: blank falls back to settings.DEFAULT_FROM_EMAIL / no copy.
    notification_from_email = models.EmailField(
        blank=True,
        help_text="\"From\" address on outgoing notification emails. Leave blank to use the server default.",
    )
    notification_copy_to_email = models.EmailField(
        blank=True,
        help_text="If set, every notification email also sends a copy here (e.g. a shared admin inbox).",
    )

    # Per-request photo limits (see apps/reports/validators.py). They must stay
    # below the hard upload ceiling in settings.py and apply without a restart.
    max_photos_per_report = models.PositiveIntegerField(default=5)
    max_photo_size_mb = models.PositiveIntegerField(default=5)

    default_dashboard_period = models.CharField(
        max_length=20, choices=DashboardPeriod.choices, default=DashboardPeriod.MONTHLY
    )

    # Comma-separated email domains allowed to self-register, e.g.
    # "ee.org, ee.org.et" (see apps.accounts.registration.is_domain_allowed).
    registration_allowed_domains = models.CharField(max_length=500, default="ee.org, ee.com")

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name = "System Settings"
        verbose_name_plural = "System Settings"

    def __str__(self):
        return "System Settings"

    def save(self, *args, **kwargs):
        self.pk = 1  # enforce singleton regardless of how it's constructed
        super().save(*args, **kwargs)

    @classmethod
    def get_settings(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
