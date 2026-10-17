from rest_framework import serializers

from .models import SavedReport


class SavedReportSerializer(serializers.ModelSerializer):
    """Reports Module spec §19. `filters` accepts whatever JSON object the
    saving report's own filter state already looks like — validated only
    as "is this actually a JSON object," not against a fixed per-report
    schema, since each report_type has its own filter field set and that
    set can grow over time without needing a migration here.
    """

    created_by_name = serializers.SerializerMethodField()
    report_type_label = serializers.CharField(source="get_report_type_display", read_only=True)

    class Meta:
        model = SavedReport
        fields = [
            "id", "name", "report_type", "report_type_label", "filters",
            "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username

    def validate_filters(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Filters must be a JSON object.")
        return value
