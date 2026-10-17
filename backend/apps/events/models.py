from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Case, CharField, F, Q, When

from apps.core.models import TimeStampedModel


class EventCategory(models.TextChoices):
    """FR6: Category is the first field selected and drives the entire
    decision flow (FR9-FR11, FR25-FR27, FR36).
    """

    INTERNATIONAL = "international", "International"
    NATIONAL = "national", "National"
    SUB_REGIONAL = "sub_regional", "Sub-national"
    INTERNAL = "internal", "Internal"


class EventStatus(models.TextChoices):
    """The raw, stored lifecycle values (unchanged by the Event Status
    Update below). LOGGED is deliberately the one value covering three
    different displayed statuses — Upcoming, Ongoing, and Held — see
    Event.get_computed_status/COMPUTED_STATUS_LABELS just below: the
    distinction between those three is date-driven and never stored,
    only ever computed fresh.
    """

    LOGGED = "logged", "Ongoing"
    POSTPONED = "postponed", "Postponed"
    CANCELLED = "cancelled", "Cancelled"
    COMPLETED = "completed", "Completed"


# Statuses shown and filtered on everywhere. Upcoming/Ongoing/Held are computed
# from today's date against the event dates (never stored) and subdivide the
# single stored LOGGED status. Completed is set when a Post-Event Report is
# submitted; Postponed/Cancelled are explicit lifecycle actions that take
# priority over the date-based statuses.
# An Event Status Report is due within this many days after the event ends.
# Until then a missing or unsubmitted report is Pending/Draft; after it, Overdue.
REPORT_SUBMISSION_WINDOW_DAYS = 5


def report_overdue_cutoff(today=None):
    """Events that ended before this date are past their report deadline."""
    from django.utils import timezone

    return (today or timezone.localdate()) - timedelta(days=REPORT_SUBMISSION_WINDOW_DAYS)


EVENT_DISPLAY_STATUS_ORDER = ["upcoming", "ongoing", "held", "completed", "postponed", "cancelled"]


def filter_events_by_display_status(qs, value):
    """Translates one of the six status-filter values above into an
    actual queryset filter. Upcoming/Ongoing/Held all share the single
    raw `status` column value (EventStatus.LOGGED) and are only told
    apart by each event's own start/end dates against today, so they
    need a compound date filter rather than a plain equality filter.
    Used by every "filter events by status" surface in the app (My
    Events, Admin Events, Dashboard, the Dashboard's Upcoming Events
    card) so none of them can drift out of sync with what
    Event.get_computed_status actually computes for an individual event.
    Unrecognized values are a no-op (returns `qs` unfiltered).
    """
    from django.utils import timezone

    today = timezone.localdate()
    if value == "upcoming":
        return qs.filter(status=EventStatus.LOGGED, start_date__gt=today)
    if value == "ongoing":
        return qs.filter(status=EventStatus.LOGGED, start_date__lte=today, end_date__gte=today)
    if value == "held":
        return qs.filter(status=EventStatus.LOGGED, end_date__lt=today)
    if value in (EventStatus.COMPLETED, EventStatus.POSTPONED, EventStatus.CANCELLED):
        return qs.filter(status=value)
    return qs


def distinct_display_statuses(qs):
    """Which of the six display statuses actually occur among the events
    in `qs`, in Upcoming→Ongoing→Held→Completed→Postponed→Cancelled
    order — used to build "Status" filter-dropdown options. Needs a
    Python pass over the (lightweight, `.only()`-restricted) queryset for
    the same reason filter_events_by_display_status does: three of the
    six share one raw DB value and are only distinguished per-instance.
    """
    present = {e.get_computed_status() for e in qs.only("id", "status", "start_date", "end_date")}
    return [code for code in EVENT_DISPLAY_STATUS_ORDER if code in present]


class EngagementLevel(models.TextChoices):
    """Replaces the original single 'EE's Role' free-text field (per
    updated requirements) with a defined set of engagement roles.
    """

    ORGANIZER = "organizer", "Organizer"
    CO_ORGANIZER = "co_organizer", "Co-organizer"
    FACILITATOR = "facilitator", "Facilitator"
    # Covers speaker, moderator, panelist and presenter.
    PRESENTER = "presenter", "Presenter"
    # Retired options, kept so older events still read correctly.
    INVITED_PARTICIPANT = "invited_participant", "Invited Participant"
    SPEAKER = "speaker", "Speaker"
    PANELIST = "panelist", "Panelist"


class SupportLevelChoice(models.TextChoices):
    """Companion field to Engagement Level (updated requirement): what kind
    of support EE is providing to the event, distinct from Communications
    Support (which concerns banners/photographers/etc., not funding/technical
    assistance).
    """

    FINANCIAL = "financial", "Financial"
    TECHNICAL = "technical", "Technical"
    BOTH = "both", "Both"


class EventType(models.TextChoices):
    """New field (staff request): what format the event takes — distinct
    from `category`, which is about scope/audience (International/National/
    Sub-national/Internal). Kept alongside `category` rather than replacing it,
    since the two describe different axes of the same event.
    """

    TRAINING = "training", "Training"
    WORKSHOP = "workshop", "Workshop"
    CONFERENCE = "conference", "Conference"
    SUPPORTIVE_SUPERVISION = "supportive_supervision", "Supportive Supervision"
    # Stored as "rm" (it was "RM" before it was renamed) so existing events keep working.
    RM = "rm", "Review Meeting"
    OTHER = "other", "Other"


class ReviewMeetingType(models.TextChoices):
    """Second step for a Review Meeting: which review it is."""

    ANNUAL = "annual", "Annual"
    MID_TERM = "mid_term", "Mid-term"


# Event Type filters list Review Meeting as two entries, one per kind. They are
# stored as event_type "rm" plus review_meeting_type.
REVIEW_MEETING_FILTER_VALUES = {
    "rm_annual": ReviewMeetingType.ANNUAL,
    "rm_mid_term": ReviewMeetingType.MID_TERM,
}


def filter_events_by_event_type(queryset, value):
    """Filter by an Event Type, including rm_annual / rm_mid_term."""
    if value in REVIEW_MEETING_FILTER_VALUES:
        return queryset.filter(event_type=EventType.RM, review_meeting_type=REVIEW_MEETING_FILTER_VALUES[value])
    return queryset.filter(event_type=value)


class ModeOfEvent(models.TextChoices):
    """New field (staff request): In-person vs Virtual. Only two,
    mutually-exclusive options — rendered as a segmented toggle on the
    form rather than a dropdown, per the request."""

    IN_PERSON = "in_person", "In-person"
    VIRTUAL = "virtual", "Virtual"


class Event(TimeStampedModel):
    """Core event record (Stage 2, FR5-FR12).

    Schema note: the FRS (FR7) lists "City/Region" as a single field, but
    the Dashboard (FR35) and Reports (FR41/FR43) both require independent
    filtering/grouping by Region. We therefore split this into `city` and
    `region` as two columns rather than one composite string — this is a
    normalization decision, not new business logic: no requirement or
    workflow rule is added or removed, the same data is simply stored in a
    queryable shape.
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="events",
        help_text="Auto-filled from the logged-in staff account (FR8).",
    )
    # Category, engagement level, support level and similar fields are plain
    # CharFields validated against the admin-managed ConfigOption table.
    category = models.CharField(max_length=20)
    # Event Type (format) and Mode are fixed, closed sets rather than ConfigOptions.
    event_type = models.CharField(max_length=30, choices=EventType.choices)
    # Only used when event_type is "rm" (Review Meeting): Annual or Mid-term.
    review_meeting_type = models.CharField(max_length=10, choices=ReviewMeetingType.choices, blank=True, default="")
    # Only used when event_type is "other": what kind of event it is, in the user's own words.
    event_type_other = models.CharField(max_length=100, blank=True, default="")
    mode_of_event = models.CharField(max_length=20, choices=ModeOfEvent.choices)
    title = models.CharField(max_length=255)
    description = models.TextField()  # Required (updated requirement).
    start_date = models.DateField()
    end_date = models.DateField()
    venue = models.CharField(max_length=255)
    city = models.CharField(max_length=150)
    # For International events, region/city are the state/province and city
    # inside this country (worldwide, picked or typed in). Blank for every other
    # category, which stay on the Ethiopian Region/City lists.
    country = models.CharField(max_length=100, blank=True, default="")
    region = models.CharField(max_length=150)
    organization_lead_agency = models.CharField(max_length=255)

    thematic_area = models.CharField(max_length=150)

    engagement_level = models.CharField(max_length=30)
    # Only relevant when engagement_level is "co_organizer".
    co_organizer_name = models.CharField(max_length=255, blank=True, default="")

    # Not applicable when EE is the Lead Organization.
    support_level = models.CharField(max_length=20, blank=True, default="")

    # Labelled "Personal Objective relevant to EE" in the UI: the staff member's own purpose
    # for the event. Required on create (enforced in the serializer).
    personal_objective = models.TextField(blank=True, default="")

    # Labelled "Event Objective" in the UI. Always optional.
    expected_outcome = models.TextField(blank=True, default="")

    # Total (overall) headcount, asked ONLY when EE is Lead Organization,
    # Organizer or Co-organizer (required then, not asked otherwise);
    # enforced conditionally in the serializer.
    total_expected_participants = models.PositiveIntegerField(null=True, blank=True)

    # EE's own headcount: always required ("Expected Number of Participants
    # from EE"), whether or not EE is leading.
    expected_participants = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Estimated/expected number of participants, captured at logging time. "
        "Number of participants from EE.",
    )

    # Asked for every event regardless of Category.
    needs_comms_support = models.BooleanField(
        help_text="Whether Communications support is needed. Asked for all event categories."
    )

    # Operational Request: asked on the last step of Create Event, independent
    # of Communications support. Says what is needed and from which staff member.
    has_operational_request = models.BooleanField(default=False)
    operational_request_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="operational_requests_received",
    )

    # Completed is only ever set automatically; other values are admin-managed.
    status = models.CharField(max_length=20, default=EventStatus.LOGGED)
    # Latest reason from a Postpone/Cancel/Reopen action; the full history is in
    # the audit log.
    status_reason = models.TextField(blank=True, default="")

    # Set when the overdue-report reminder is sent so the scheduled command
    # notifies once per event; cleared when the report is submitted.
    report_overdue_notified_at = models.DateTimeField(null=True, blank=True)

    # Optional promotional cover shown in the Dashboard's Big Events section,
    # separate from the post-event EventPhoto gallery.
    big_event_photo = models.ImageField(upload_to="big_event_photos/%Y/%m/", blank=True, null=True)

    class Meta(TimeStampedModel.Meta):
        indexes = [
            models.Index(fields=["category"]),
            models.Index(fields=["event_type"]),
            models.Index(fields=["mode_of_event"]),
            models.Index(fields=["status"]),
            models.Index(fields=["region"]),
            models.Index(fields=["thematic_area"]),
            models.Index(fields=["start_date"]),
            models.Index(fields=["engagement_level"]),
        ]

    def __str__(self):
        return f"{self.title} ({self.get_category_label()})"

    def _config_label(self, list_type, value):
        """Shared lookup behind get_category_label/get_status_label/
        get_support_level_label/get_engagement_level_label — all four
        fields moved off static `choices=` to the admin-managed
        ConfigOption table (Configuration page), so Django's auto-
        generated get_FOO_display() no longer works for any of them
        (it only exists for fields that still declare `choices=`).
        Falls back to the raw stored value if the option was since
        deleted, so old records never show a blank/broken label.
        """
        from apps.configuration.models import ConfigOption

        option = ConfigOption.objects.filter(list_type=list_type, value=value).first()
        return option.label if option else value

    @property
    def location_label(self):
        """City, region (and country for International events) as one line.

        International events add the country ("Nairobi, Nairobi County, Kenya")
        and drop repeats ("Geneva, Geneva, Switzerland" -> "Geneva, Switzerland").
        Every other category keeps the existing "City, Region" text unchanged.
        """
        if self.category != EventCategory.INTERNATIONAL or not self.country:
            return ", ".join(part for part in (self.city, self.region) if part)
        parts = []
        for part in (self.city, self.region, self.country):
            part = (part or "").strip()
            if part and part not in parts:
                parts.append(part)
        return ", ".join(parts)

    @property
    def region_group_label(self):
        """What this event counts under in "by Region" charts and reports:
        the country for International events (so Ethiopian regions stay clean),
        the Region for everything else.
        """
        if self.category == EventCategory.INTERNATIONAL and self.country:
            return self.country
        return self.region

    @property
    def event_type_full_label(self):
        """Event type as people read it: "Review Meeting \u2013 Annual", "Other: <text>"."""
        label = self.get_event_type_display()
        if self.event_type == EventType.RM and self.review_meeting_type:
            return f"{label} \u2013 {self.get_review_meeting_type_display()}"
        if self.event_type == EventType.OTHER and self.event_type_other:
            return f"{label}: {self.event_type_other}"
        return label

    def get_category_label(self):
        from apps.configuration.models import ConfigListType

        return self._config_label(ConfigListType.CATEGORY, self.category)

    def get_status_label(self):
        from apps.configuration.models import ConfigListType

        return self._config_label(ConfigListType.EVENT_STATUS, self.get_computed_status())

    def get_computed_status(self):
        """Event Status Update: Upcoming/Ongoing/Held/Completed/Postponed/
        Cancelled — see EVENT_DISPLAY_STATUS_ORDER's comment above for the
        full rules. Always computed fresh from today's date; never stored.
        """
        if self.status != EventStatus.LOGGED:
            return self.status
        from django.utils import timezone

        today = timezone.localdate()
        if today < self.start_date:
            return "upcoming"
        if today <= self.end_date:
            return "ongoing"
        return "held"

    def get_support_level_label(self):
        from apps.configuration.models import ConfigListType

        return self._config_label(ConfigListType.SUPPORT_LEVEL, self.support_level)

    # Days-until display: always computed from today's date and start_date,
    # independent of status and of SupportRequest.priority.
    DAYS_UNTIL_GREEN_THRESHOLD = 14  # > this many days: green
    DAYS_UNTIL_YELLOW_THRESHOLD = 8  # this many days up to GREEN_THRESHOLD: yellow
    # 1 day up to YELLOW_THRESHOLD - 1: orange. 0: blue/Today. Negative and
    # still running: blue/Event Started. Past end_date: gray/Event Passed.

    @property
    def days_until_event(self):
        """Event Start Date − Current Date, in days. Negative once
        start_date is in the past (including for the rest of a
        multi-day event's run and after it's fully over) — callers
        needing the human label/color should use
        days_until_event_display below rather than re-deriving it from
        this raw number, since "Event Started" vs "Event Passed" also
        depends on end_date, not just this value.
        """
        from django.utils import timezone

        return (self.start_date - timezone.localdate()).days

    @property
    def days_until_event_display(self):
        """Returns {"code", "label", "color"} for the Days Until Event
        badge shown across event/support-request lists. `code` is the
        stable machine value the Days Until Event *filter* (All/Today/
        Within 3 Days/.../Event Passed) matches against — see
        apps.events.days_until.filter_by_days_until_event.
        """
        from django.utils import timezone

        today = timezone.localdate()
        days = (self.start_date - today).days
        days_text = f"{days} day" if days == 1 else f"{days} days"

        if days > self.DAYS_UNTIL_GREEN_THRESHOLD:
            return {"code": "more_than_14", "label": days_text, "color": "green"}
        if days >= self.DAYS_UNTIL_YELLOW_THRESHOLD:
            return {"code": "within_14", "label": days_text, "color": "yellow"}
        if days >= 1:
            return {"code": "within_7", "label": days_text, "color": "orange"}
        if days == 0:
            return {"code": "today", "label": "Today", "color": "blue"}
        if today <= self.end_date:
            return {"code": "event_started", "label": "Event Started", "color": "blue"}
        return {"code": "event_passed", "label": "Event Passed", "color": "gray"}

    def get_engagement_level_label(self):
        from apps.configuration.models import ConfigListType

        return self._config_label(ConfigListType.ENGAGEMENT_LEVEL, self.engagement_level)

    def get_thematic_area_label(self):
        from apps.configuration.models import ConfigListType

        return self._config_label(ConfigListType.THEMATIC_AREA, self.thematic_area)

    @property
    def ee_leads(self):
        """True when EE is leading this event in any capacity — Lead
        Organization, Organizer, or Co-organizer — as opposed to only an
        invited participant/speaker/panelist/facilitator. Same rule
        EventWriteSerializer.validate already applies (inline there, kept
        as-is) for the "Total/Expected Participants required" check;
        exposed here as a property too so the Event Status Report's own
        Participation section (only asked when EE is leading, since a
        purely-attending EE can't be expected to know other orgs'
        headcounts) can share the exact same rule.
        """
        return (self.organization_lead_agency or "").strip().upper() == "EE" or self.engagement_level in (
            "organizer",
            "co_organizer",
        )

    def clean(self):
        if self.end_date < self.start_date:
            raise ValidationError("End date cannot be before the start date.")

    @property
    def has_support_request(self):
        return hasattr(self, "support_request")

    @property
    def has_post_event_report(self):
        return hasattr(self, "post_event_report")

    @property
    def has_submitted_report(self):
        """Distinguishes a saved draft (UI/UX Section 12 Save button) from
        a final submission (FR33/FR34) -- only the latter locks the event
        and counts as satisfying FR37 overdue-report flag.
        """
        return self.has_post_event_report and self.post_event_report.status == "submitted"

    @property
    def is_editable(self):
        """FR-derived (UI/UX Section 5/11): the owner may edit an event only
        until its Event Status Report has been submitted; afterward it is
        locked to preserve the integrity of what was reported against it.
        A saved-but-not-submitted draft does not lock the event.
        """
        return not self.has_submitted_report

    @property
    def is_report_overdue(self):
        """FR37: flag events past the report submission window with no
        submitted report."""
        return self.end_date < report_overdue_cutoff() and not self.has_submitted_report


def with_region_group(queryset):
    """Annotate `region_group` on an Event queryset (see Event.region_group_label)
    so charts, filters and lists can group/filter International events by country.
    """
    return queryset.annotate(
        region_group=Case(
            When(Q(category=EventCategory.INTERNATIONAL) & ~Q(country=""), then=F("country")),
            default=F("region"),
            output_field=CharField(),
        )
    )
