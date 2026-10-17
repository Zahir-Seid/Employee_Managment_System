from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel
from apps.events.models import Event
from apps.reports.validators import validate_photo_file


class HomeContentType(models.TextChoices):
    MAJOR_EVENT = "major_event", "Major Event"
    ANNOUNCEMENT = "announcement", "Announcement"
    NEWS = "news", "News"
    # Lightweight "save the date" entry (name, date, location, no photo) that
    # disappears once its date has passed.
    UPCOMING_EVENT = "upcoming_event", "Upcoming Event"


class HomeContentAudience(models.TextChoices):
    """Where an item is shown. Content added from Home Page > Manage Content
    is "home" (public Home Page only); content added from a TV Display queue
    is "tv" (TV screen only) - adding in one place does NOT add it to the
    other. "both" only exists for items created before this split, so
    whatever was already showing in both places keeps doing so.
    """

    HOME = "home", "Home Page"
    TV = "tv", "TV Display"
    BOTH = "both", "Home Page and TV Display"


class HomeContent(TimeStampedModel):
    """Home Page Dynamic Content Update: backs the three admin-authored
    content types shown on the public Home page (Major Event, Announcement,
    News). One table for all three rather than three separate models,
    matching the existing single-model/many-sections pattern already used
    for TV Display slides (apps.tv_display.TVDisplaySlide) — each type
    only reads/writes the subset of the shared field pool that applies to
    it (doc "Common Content Controls" section); Manage Content > Add
    Content only shows the relevant fields once a Content Type is picked.

    Event Photos are deliberately NOT part of this model — per the doc,
    that section is fully automatic, pulled straight from the existing
    apps.reports.EventPhoto records (Event Status Report photos), never
    admin-authored here (no duplicate upload path). KM Resource is also
    not a repeatable item here — it's the one permanent external-link
    card, whose text/link live on SiteSettings below so Admin/
    Communications can edit it without going through Add Content.
    """

    content_type = models.CharField(max_length=20, choices=HomeContentType.choices)
    audience = models.CharField(
        max_length=10, choices=HomeContentAudience.choices, default=HomeContentAudience.HOME
    )

    title = models.CharField(max_length=255)
    # Shared body text: News body, Major Event description, Announcement summary.
    description = models.TextField(blank=True, default="")
    image = models.ImageField(
        upload_to="home_content/%Y/%m/", blank=True, null=True, validators=[validate_photo_file]
    )

    # News only; news has no expiry.
    publish_date = models.DateField(null=True, blank=True)

    # Major Event / Announcement display window; content stops showing after
    # end_date at read time (see is_currently_showable).
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)

    # Major Event only; used when no Event record is linked.
    location = models.CharField(max_length=255, blank=True, default="")
    linked_event = models.ForeignKey(
        Event,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="home_content_entries",
        help_text=(
            "Major Event only: optionally point at a real logged Event so title/date/location "
            "auto-fill from it and the card's action button opens that event's real detail page."
        ),
    )

    is_published = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    # For Major Events, featured also means "the current spotlight".
    is_featured = models.BooleanField(default=False)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TimeStampedModel.Meta):
        pass

    def __str__(self):
        return f"{self.get_content_type_display()}: {self.title or self.linked_event_id}"

    @property
    def effective_title(self):
        if self.linked_event_id and self.content_type == HomeContentType.MAJOR_EVENT:
            return self.title or self.linked_event.title
        return self.title

    @property
    def effective_start_date(self):
        if self.linked_event_id and self.content_type == HomeContentType.MAJOR_EVENT:
            return self.linked_event.start_date
        return self.start_date

    @property
    def effective_end_date(self):
        if self.linked_event_id and self.content_type == HomeContentType.MAJOR_EVENT:
            return self.linked_event.end_date
        return self.end_date

    @property
    def effective_location(self):
        if self.linked_event_id and self.content_type == HomeContentType.MAJOR_EVENT:
            parts = [p for p in [self.linked_event.location_label] if p]
            return ", ".join(parts)
        return self.location

    def is_currently_showable(self, today):
        """Doc §7 (Publication and Active Dates), as refined in practice:
        News and Announcement show immediately once published+active, with
        no date gating at all. Major Event's Start/End Date are the
        event's own dates, shown on the spotlight card for the viewer's
        benefit (doc §11: "the event's dates, for display") — not a
        display window to gate on. A Major Event is meant to advertise an
        upcoming event, so it must keep showing right up until the event
        actually happens; gating it on "has the event started yet" would
        hide the promotion for the entire lead-up period, which defeats
        the point of featuring it. So for Major Event we only check the
        end date (stop showing once the event is over).
        """
        if not self.is_active or not self.is_published:
            return False
        if self.content_type == HomeContentType.MAJOR_EVENT:
            end = self.effective_end_date
            if end and end < today:
                return False
        if self.content_type == HomeContentType.UPCOMING_EVENT:
            last_day = self.end_date or self.start_date
            if last_day and last_day < today:
                return False
        return True


class SiteSettings(TimeStampedModel):
    """Singleton holding the one permanent, admin-editable piece of Home
    Page content that isn't a repeatable HomeContent item: the "EE News
    & Success Stories" external link card (doc §1) — always shown, its
    link/title/description editable by Admin/Communications without an
    Add Content step.
    """

    km_resource_title = models.CharField(max_length=150, default="EE News & Success Stories")
    km_resource_description = models.CharField(
        max_length=300, default="See the latest updates and impact stories from EE globally."
    )
    km_resource_url = models.URLField(default="https://www.ee.org")
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TimeStampedModel.Meta):
        verbose_name = "Home Page Site Settings"
        verbose_name_plural = "Home Page Site Settings"

    def __str__(self):
        return "Home Page Site Settings"

    @classmethod
    def get_settings(cls):
        obj = cls.objects.order_by("created_at").first()
        if obj is None:
            obj = cls.objects.create()
        return obj
