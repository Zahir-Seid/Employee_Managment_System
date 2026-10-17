import django_filters
from django.db.models import Q
from django.utils import timezone

from .days_until import DAYS_UNTIL_EVENT_CHOICES, filter_by_days_until_event
from .models import (
    EVENT_DISPLAY_STATUS_ORDER,
    REVIEW_MEETING_FILTER_VALUES,
    Event,
    EventType,
    filter_events_by_display_status,
    filter_events_by_event_type,
    report_overdue_cutoff,
)


class EventFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="start_date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="start_date", lookup_expr="lte")
    # Plain event types, plus rm_annual / rm_mid_term for the two Review Meetings.
    event_type = django_filters.ChoiceFilter(
        choices=list(EventType.choices) + [(code, code) for code in REVIEW_MEETING_FILTER_VALUES],
        method="filter_event_type",
    )
    # Accepts display statuses (see filter_events_by_display_status).
    status = django_filters.ChoiceFilter(
        choices=[(code, code) for code in EVENT_DISPLAY_STATUS_ORDER], method="filter_status"
    )
    # See apps.events.days_until.
    days_until_event = django_filters.ChoiceFilter(
        choices=DAYS_UNTIL_EVENT_CHOICES, method="filter_days_until_event"
    )

    # Mirrors EventListSerializer.report_status: pending = no report, draft =
    # saved, completed = submitted. "due" = ended within the report submission
    # window and not yet submitted (pending or draft); backs the Sidebar badge.
    # "overdue" = ended before that window and still not submitted.
    report_status = django_filters.ChoiceFilter(
        choices=[("pending", "Pending"), ("draft", "Draft"), ("completed", "Completed"), ("due", "Due"), ("overdue", "Overdue")],
        method="filter_report_status",
    )

    # Event Status Report pages (Pending, Upcoming, Completed, Overdue; Draft
    # has no sidebar link but is still a real status). One source of truth for
    # both the lists and the Sidebar counts. The report's own state (no report
    # / draft / submitted) is kept separate from the event's timing, and every
    # unsubmitted report lands in exactly one of Pending, Upcoming or Overdue:
    #   pending   = reports awaiting action whose deadline has not passed: events
    #               that ended within the report window with no report started
    #               (shown as Pending), plus every saved draft (shown as Draft,
    #               never relabelled Pending). Saving a draft keeps it a draft.
    #   upcoming  = event has not ended yet and no report was started. Drafts
    #               never appear here.
    #   completed = report submitted. Drafts never appear here.
    #   overdue   = event ended before the report window and the report is not
    #               submitted. Includes drafts; each row shows its real status
    #               (Draft or Pending).
    #   draft     = every saved-but-unsent report whatever the timing. No
    #               sidebar link, but still reachable (?status=draft).
    report_view = django_filters.ChoiceFilter(
        choices=[
            ("draft", "Draft"),
            ("pending", "Pending"),
            ("upcoming", "Upcoming"),
            ("completed", "Completed"),
            ("overdue", "Overdue"),
        ],
        method="filter_report_view",
    )

    class Meta:
        model = Event
        fields = ["category", "event_type", "mode_of_event", "status", "region", "thematic_area", "owner", "needs_comms_support"]

    def filter_report_view(self, queryset, name, value):
        today = timezone.localdate()
        cutoff = report_overdue_cutoff(today)
        if value == "draft":
            return queryset.filter(post_event_report__isnull=False).exclude(post_event_report__status="submitted")
        if value == "pending":
            return (
                queryset.filter(end_date__gte=cutoff)
                .exclude(post_event_report__status="submitted")
                .filter(
                    Q(post_event_report__isnull=True, end_date__lte=today)
                    | Q(post_event_report__isnull=False)
                )
            )
        if value == "upcoming":
            return queryset.filter(post_event_report__isnull=True, end_date__gt=today)
        if value == "completed":
            return queryset.filter(post_event_report__status="submitted")
        if value == "overdue":
            return queryset.filter(end_date__lt=cutoff).exclude(post_event_report__status="submitted")
        return queryset

    def filter_report_status(self, queryset, name, value):
        if value == "pending":
            return queryset.filter(post_event_report__isnull=True)
        if value == "draft":
            return queryset.filter(post_event_report__isnull=False).exclude(post_event_report__status="submitted")
        if value == "completed":
            return queryset.filter(post_event_report__status="submitted")
        if value == "due":
            today = timezone.localdate()
            return queryset.filter(end_date__lte=today, end_date__gte=report_overdue_cutoff(today)).exclude(
                post_event_report__status="submitted"
            )
        if value == "overdue":
            return queryset.filter(end_date__lt=report_overdue_cutoff()).exclude(post_event_report__status="submitted")
        return queryset

    def filter_event_type(self, queryset, name, value):
        return filter_events_by_event_type(queryset, value)

    def filter_status(self, queryset, name, value):
        return filter_events_by_display_status(queryset, value)

    def filter_days_until_event(self, queryset, name, value):
        return filter_by_days_until_event(queryset, value)
