from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import SavedReport
from .serializers_saved_reports import SavedReportSerializer


class SavedReportViewSet(viewsets.ModelViewSet):
    """Reports Module spec §19 — Saved Reports. See models.SavedReport's
    docstring for why this stores/re-runs filters rather than caching
    results, and why saves are private to their creator rather than
    shared org-wide.

    Open access to all four roles (any authenticated user can save their
    own filter combinations for whichever reports they can already
    reach) — the actual data-visibility check happens when a saved
    report is *opened*, at that report's own permission-checked endpoint,
    not here.
    """

    serializer_class = SavedReportSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return SavedReport.objects.filter(created_by=self.request.user).select_related("created_by")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        """Spec §19's [Duplicate] action — a copy the user can then
        rename/re-filter independently of the original, rather than a
        second reference to the same row.
        """
        original = self.get_object()
        copy = SavedReport.objects.create(
            name=f"{original.name} (Copy)",
            report_type=original.report_type,
            filters=original.filters,
            created_by=request.user,
        )
        return Response(SavedReportSerializer(copy).data, status=201)
