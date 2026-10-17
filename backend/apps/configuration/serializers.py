from rest_framework import serializers

from .models import ConfigListType, ConfigOption, SystemSettings


def get_usage_count(list_type, value):
    """How many existing records actually use this value right now —
    surfaced on the Configuration page so an admin editing or
    deactivating an option can see the real-world impact before acting,
    not just an abstract "this might be in use somewhere" warning.
    Doesn't block anything (deactivating stays safe regardless of this
    number, by design — see ConfigOptionDetailView), it's purely
    informational.
    """
    from apps.communications.models import SupportRequest
    from apps.events.models import Event

    field_for_list_type = {
        ConfigListType.THEMATIC_AREA: "thematic_area",
        ConfigListType.ENGAGEMENT_LEVEL: "engagement_level",
        ConfigListType.LEAD_ORGANIZATION: "organization_lead_agency",
        ConfigListType.REGION: "region",
        ConfigListType.CATEGORY: "category",
        ConfigListType.EVENT_STATUS: "status",
        ConfigListType.SUPPORT_LEVEL: "support_level",
    }
    if list_type == ConfigListType.SUPPORT_TYPE:
        # Count in Python: JSONField `contains` lookups aren't supported on SQLite.
        return sum(1 for types in SupportRequest.objects.values_list("support_types", flat=True) if value in types)

    field = field_for_list_type.get(list_type)
    if not field:
        return 0
    return Event.objects.filter(**{field: value}).count()


class ConfigOptionSerializer(serializers.ModelSerializer):
    list_type_display = serializers.CharField(source="get_list_type_display", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    usage_count = serializers.SerializerMethodField()

    class Meta:
        model = ConfigOption
        fields = [
            "id",
            "list_type",
            "list_type_display",
            "value",
            "label",
            "order",
            "is_active",
            "usage_count",
            "created_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else None

    def get_usage_count(self, obj):
        return get_usage_count(obj.list_type, obj.value)

    def validate_value(self, value):
        return value.strip()

    def validate_label(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Label can't be blank.")
        return value


class SystemSettingsSerializer(serializers.ModelSerializer):
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SystemSettings
        fields = [
            "notification_from_email",
            "notification_copy_to_email",
            "max_photos_per_report",
            "max_photo_size_mb",
            "default_dashboard_period",
            "registration_allowed_domains",
            "updated_at",
            "updated_by_name",
        ]
        read_only_fields = ["updated_at", "updated_by_name"]

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.username if obj.updated_by else None

    def validate_registration_allowed_domains(self, value):
        domains = [d.strip().lstrip("@").lower() for d in (value or "").split(",")]
        domains = [d for d in domains if d]
        if not domains:
            raise serializers.ValidationError(
                "At least one domain is required — otherwise nobody can self-register."
            )
        for d in domains:
            if "." not in d or " " in d:
                raise serializers.ValidationError(f"\"{d}\" doesn't look like a valid domain (e.g. ee.org).")
        return ", ".join(domains)

    def validate_max_photos_per_report(self, value):
        from django.conf import settings

        if value < 1:
            raise serializers.ValidationError("Must be at least 1.")
        if value > settings.HARD_MAX_PHOTOS_PER_EVENT:
            raise serializers.ValidationError(
                f"Can't exceed {settings.HARD_MAX_PHOTOS_PER_EVENT}: that's the server's hard technical "
                "ceiling (changing it requires a developer/redeploy, not just this setting)."
            )
        return value

    def validate_max_photo_size_mb(self, value):
        from django.conf import settings

        if value < 1:
            raise serializers.ValidationError("Must be at least 1.")
        if value > settings.HARD_MAX_PHOTO_SIZE_MB:
            raise serializers.ValidationError(
                f"Can't exceed {settings.HARD_MAX_PHOTO_SIZE_MB}MB: that's the server's hard technical "
                "ceiling (changing it requires a developer/redeploy, not just this setting)."
            )
        return value
