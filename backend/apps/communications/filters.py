import django_filters
from django.utils import timezone
from datetime import timedelta

from .models import PRIORITY_HIGH_WITHIN_DAYS, PRIORITY_URGENT_WITHIN_DAYS, SupportRequest


class SupportRequestFilter(django_filters.FilterSet):
    """Support Requests Enhancement filters: `status`, `priority` (derived
    from the event's date — see SupportRequest.priority — so filtering by
    it is done via the equivalent event__start_date range rather than a
    DB column, keeping this queryset-based/paginate-friendly instead of
    filtering a fetched Python list), and `assigned_to_me` (for the
    Requested Supports tab's "assigned to me" quick filter).
    """

    completed = django_filters.BooleanFilter(method="filter_completed")
    priority = django_filters.ChoiceFilter(
        choices=[("normal", "Normal"), ("high", "High"), ("urgent", "Urgent")], method="filter_priority"
    )
    assigned_to_me = django_filters.BooleanFilter(method="filter_assigned_to_me")
    unread = django_filters.BooleanFilter(method="filter_unread")

    class Meta:
        model = SupportRequest
        fields = ["status", "completed", "priority", "assigned_to_me", "unread"]

    def filter_completed(self, queryset, name, value):
        if value:
            return queryset.exclude(todo_items__is_done=False).distinct()
        return queryset.filter(todo_items__is_done=False).distinct()

    def filter_priority(self, queryset, name, value):
        today = timezone.localdate()
        urgent_cutoff = today + timedelta(days=PRIORITY_URGENT_WITHIN_DAYS)
        high_cutoff = today + timedelta(days=PRIORITY_HIGH_WITHIN_DAYS)
        if value == "urgent":
            return queryset.filter(event__start_date__lte=urgent_cutoff)
        if value == "high":
            return queryset.filter(event__start_date__gt=urgent_cutoff, event__start_date__lte=high_cutoff)
        if value == "normal":
            return queryset.filter(event__start_date__gt=high_cutoff)
        return queryset

    def filter_assigned_to_me(self, queryset, name, value):
        user = getattr(self.request, "user", None)
        if value and user is not None:
            return queryset.filter(assigned_to=user)
        return queryset


    def filter_unread(self, queryset, name, value):
        """Requests with unread messages for the current user (only counts
        where they take part in the conversation: the requester, an assignee
        or the Communications Lead). Needs the `unread_count_annotation`
        added in the list view's queryset."""
        user = getattr(self.request, "user", None)
        if not value or user is None:
            return queryset
        queryset = queryset.filter(unread_count_annotation__gt=0)
        if not user.is_communications_lead:
            from django.db.models import Q

            queryset = queryset.filter(Q(event__owner=user) | Q(assigned_to=user)).distinct()
        return queryset
