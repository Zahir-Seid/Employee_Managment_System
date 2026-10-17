import django_filters
from rest_framework import generics
from rest_framework.response import Response

from apps.core.permissions import IsCommunicationsOrLeadership

from .categories import build_summary
from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = AuditLog
        fields = ["action_type", "object_type", "object_id", "user"]


class AuditLogListView(generics.ListAPIView):
    """Read-only audit trail view (FR49). Restricted to Communications and
    Leadership — Staff do not have a use case for viewing the full system
    audit trail per the UI/UX navigation matrix (Section 17), and exposing
    it would let staff see actions on events they don't own.
    """

    serializer_class = AuditLogSerializer
    permission_classes = [IsCommunicationsOrLeadership]
    filterset_class = AuditLogFilter
    search_fields = ["description", "object_id"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]
    queryset = AuditLog.objects.select_related("user").all()

    def list(self, request, *args, **kwargs):
        # Drop entries identical in user, action, object and description that
        # land within 2 seconds of each other (duplicate logs of one action);
        # later repeats of the same action are kept.
        queryset = self.filter_queryset(self.get_queryset())
        deduped = []
        seen_key = None
        seen_time = None
        for entry in queryset:
            key = (entry.user_id, entry.action_type, entry.object_type, entry.object_id, entry.description)
            if key == seen_key and seen_time is not None and abs((seen_time - entry.created_at).total_seconds()) <= 2:
                continue
            deduped.append(entry)
            seen_key = key
            seen_time = entry.created_at

        page = self.paginate_queryset(deduped)
        serializer = self.get_serializer(page if page is not None else deduped, many=True)
        # Summarise the same filtered, de-duplicated set the list shows.
        summary = build_summary(deduped)
        if page is not None:
            response = self.get_paginated_response(serializer.data)
            response.data["summary"] = summary
            return response
        return Response({"results": serializer.data, "summary": summary})
