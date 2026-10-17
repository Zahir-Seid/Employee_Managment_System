from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    action_type_display = serializers.CharField(source="get_action_type_display", read_only=True)
    object_type_display = serializers.CharField(source="get_object_type_display", read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "id", "user", "user_name", "action_type", "action_type_display",
            "object_type", "object_type_display", "object_id", "description",
            "metadata", "created_at",
        ]
        read_only_fields = fields

    def get_user_name(self, obj):
        # Bug fix: get_full_name() returns "" (not None) when first_name/
        # last_name aren't populated on the user record, which is common
        # for accounts created via email/username rather than a name form.
        # The old `obj.user.get_full_name() if obj.user else "System"` only
        # checked whether obj.user existed, not whether the resulting name
        # was non-empty — so real users showed up blank in the Audit Trail
        # table instead of falling back to something identifiable.
        if not obj.user:
            return "System"
        return obj.user.get_full_name() or obj.user.get_username() or obj.user.email or "Unknown user"
