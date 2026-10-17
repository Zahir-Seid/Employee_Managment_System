from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel
from apps.events.models import Event

from .validators import validate_photo_file


class ReportStatus(models.TextChoices):
    """The UI/UX spec (Section 12) shows separate Save and Submit buttons,
    so a draft state is needed: Save persists work-in-progress and keeps
    the event editable; Submit is the one-time final action that triggers
    FR33 (event -> Completed) and FR34 (no further submissions).
    """

    DRAFT = "draft", "Draft"
    SUBMITTED = "submitted", "Submitted"


class PostEventReport(TimeStampedModel):
    """Stage 4 (FR29-FR34): one-to-one with Event, which structurally
    enforces FR34 (no second submission for the same event) — a duplicate
    insert simply violates the database's unique constraint. Submission
    finality is governed by `status`, not by the row's mere existence,
    so a saved draft doesn't yet lock the event or count as "reported".
    """

    event = models.OneToOneField(Event, on_delete=models.CASCADE, related_name="post_event_report")
    status = models.CharField(max_length=10, choices=ReportStatus.choices, default=ReportStatus.DRAFT)

    major_accomplishment = models.TextField(
        blank=True,
        default="",
        help_text=(
            "The event at a glance: how the event flowed, major happenings, opening remarks, "
            "group works, presentations, pre-test/post-test results, workshop evaluation, etc."
        ),
    )
    best_practices_lessons_actions = models.TextField(
        blank=True,
        default="",
        help_text="Best practices identified / lessons learnt / action points / recommendations from the event.",
    )
    challenges_faced = models.TextField(blank=True, default="")
    recommendation_conclusion = models.TextField(blank=True, default="")

    # Participation: Male/Female totals plus a fixed per-organization breakdown,
    # modeled as plain columns since the organization list isn't configurable.
    participants_male = models.PositiveIntegerField(null=True, blank=True)
    participants_female = models.PositiveIntegerField(null=True, blank=True)

    participants_ee_staff = models.PositiveIntegerField(default=0)
    participants_moh = models.PositiveIntegerField(default=0, verbose_name="MOH")
    participants_rhb = models.PositiveIntegerField(default=0, verbose_name="RHB")
    participants_zhd = models.PositiveIntegerField(default=0, verbose_name="ZHD")
    participants_university = models.PositiveIntegerField(default=0)
    participants_partner = models.PositiveIntegerField(default=0)
    participants_woho = models.PositiveIntegerField(default=0, verbose_name="WoHO")
    participants_hospital = models.PositiveIntegerField(default=0)
    participants_health_center = models.PositiveIntegerField(default=0)
    participants_health_post = models.PositiveIntegerField(default=0)
    # Count for participants outside the organizations above; no label collected.
    participants_other_count = models.PositiveIntegerField(default=0)

    # Actual spend, entered after the event. Null means not entered yet, as
    # distinct from a spend of 0.
    total_expenditure = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # List of social media/post URLs; asked for regardless of ee_leads.
    event_social_links = models.JSONField(default=list, blank=True)

    @property
    def participants_total(self):
        """Total participants — Male + Female, per the "Total participants,
        split Male/Female" requirement. Returns None (rather than 0) when
        neither has been filled in yet, so the report/UI can distinguish
        "not entered" from "entered as zero"."""
        if self.participants_male is None and self.participants_female is None:
            return None
        return (self.participants_male or 0) + (self.participants_female or 0)

    @property
    def participants_by_organization(self):
        """Ordered (label, count) pairs for every organization row,
        including "Other" only when it has a label/count — used by the
        report generators and the on-screen report view so they don't each
        re-list the fixed organization set themselves."""
        rows = [
            ("EE Staff", self.participants_ee_staff),
            ("MOH", self.participants_moh),
            ("RHB", self.participants_rhb),
            ("ZHD", self.participants_zhd),
            ("University", self.participants_university),
            ("Partner", self.participants_partner),
            ("WoHO", self.participants_woho),
            ("Hospital", self.participants_hospital),
            ("Health Center", self.participants_health_center),
            ("Health Post", self.participants_health_post),
        ]
        if self.participants_other_count:
            rows.append(("Other", self.participants_other_count))
        return rows

    # Captured at submission for the report header (Submitted By / role / date);
    # null on drafts.
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta(TimeStampedModel.Meta):
        pass

    def __str__(self):
        return f"Event Status Report for {self.event.title}"


class FollowUpAction(TimeStampedModel):
    """FR30: repeatable Action / Responsible / Deadline rows on a report."""

    post_event_report = models.ForeignKey(PostEventReport, on_delete=models.CASCADE, related_name="follow_up_actions")
    action = models.CharField(max_length=500)
    responsible = models.CharField(max_length=255)
    deadline = models.DateField()

    class Meta(TimeStampedModel.Meta):
        ordering = ["deadline"]

    def __str__(self):
        return f"{self.action} ({self.responsible}, due {self.deadline})"


class EventPhoto(TimeStampedModel):
    """FR30/FR45: optional photos attached to a Event Status Report, capped
    at 5 files of up to 5MB each, JPG/PNG only.
    """

    post_event_report = models.ForeignKey(PostEventReport, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(upload_to="event_photos/%Y/%m/", validators=[validate_photo_file])

    class Meta(TimeStampedModel.Meta):
        ordering = ["created_at"]

    def __str__(self):
        return f"Photo for {self.post_event_report.event.title}"


class SavedReportType(models.TextChoices):
    """Reports Module spec §19 — one entry per report that actually
    exists today (services/*_report.py). Extend this, not a free-text
    field, as Partner Engagement/Annual Event are built, so an invalid
    value can never be saved and silently fail to open later.
    """

    MANAGEMENT = "management", "Management Report"
    EVENT_ACTIVITY = "event_activity", "Event Activity Report"
    COMMUNICATIONS = "communications", "Communications Report"
    PARTNER_ENGAGEMENT = "partner_engagement", "Partner Engagement Report"
    ANNUAL = "annual", "Annual Event Report"


class SavedReport(TimeStampedModel):
    """Saved Reports (spec §19) — a named report type + filter
    combination a user can reopen without re-selecting the same filters.
    Deliberately stores only the filters (a JSON object shaped exactly
    like that report's own query params — see each report's frontend
    page for the field list), never a cached copy of the report's
    results: spec §19 requires saved reports to be "permission-aware"
    and says "a user must not gain access to information simply because
    a report was previously saved." Storing filters only and re-running
    them live, through the same permission-checked, data-scoped view
    every direct visit to that report already goes through, makes that
    true by construction rather than needing a separate access check
    here — there's no snapshot of another user's data to leak.

    Scoped to the user who created it (`created_by`) rather than shared
    org-wide: the spec's own mockup table shows a "Created By" column
    implying multiple people's saves might be listed together, but
    nothing in the spec actually states saves are visible to other
    users, and no general permission-grant system exists yet to decide
    who could re-run someone else's exact filter set (e.g. a
    Responsible Person or Organization filter naming a specific person)
    — so, per this project's established default of excluding rather
    than guessing at a wider grant, saves stay private to their creator.
    """

    name = models.CharField(max_length=255)
    report_type = models.CharField(max_length=20, choices=SavedReportType.choices)
    filters = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="saved_reports")

    class Meta(TimeStampedModel.Meta):
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.get_report_type_display()})"
