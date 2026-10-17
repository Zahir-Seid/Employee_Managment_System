from rest_framework import serializers

from .models import EventPhoto, FollowUpAction, PostEventReport


class FollowUpActionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FollowUpAction
        fields = ["id", "action", "responsible", "deadline"]


class EventPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventPhoto
        fields = ["id", "image", "created_at"]
        read_only_fields = ["id", "created_at"]


class PostEventReportSerializer(serializers.ModelSerializer):
    """Read serializer for the Event Status Report (UI/UX Section 12)."""

    follow_up_actions = FollowUpActionSerializer(many=True, read_only=True)
    photos = EventPhotoSerializer(many=True, read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    participants_total = serializers.ReadOnlyField()
    participants_by_organization = serializers.SerializerMethodField()

    class Meta:
        model = PostEventReport
        fields = [
            "id", "event", "status",
            "major_accomplishment", "best_practices_lessons_actions",
            "challenges_faced", "recommendation_conclusion",
            "participants_male", "participants_female", "participants_total",
            "participants_ee_staff", "participants_moh", "participants_rhb", "participants_zhd",
            "participants_university", "participants_partner", "participants_woho",
            "participants_hospital", "participants_health_center", "participants_health_post",
            "participants_other_count", "participants_by_organization",
            "event_social_links",
            "follow_up_actions", "photos", "created_at", "updated_at",
            "submitted_by_name", "submitted_at",
        ]
        read_only_fields = [
            "id", "event", "status", "created_at", "updated_at", "submitted_by_name", "submitted_at",
            "participants_total", "participants_by_organization",
        ]

    def get_submitted_by_name(self, obj):
        if not obj.submitted_by:
            return None
        return obj.submitted_by.get_full_name() or obj.submitted_by.username

    def get_participants_by_organization(self, obj):
        return [{"label": label, "count": count} for label, count in obj.participants_by_organization]


class PostEventReportCreateSerializer(serializers.ModelSerializer):
    """Write serializer for submitting a Event Status Report (FR29-FR34).
    Follow-up actions are accepted as a nested list; photos are uploaded
    via a separate multipart endpoint (see EventPhotoUploadView) since
    mixing nested file lists with JSON body fields is unreliable across
    HTML form / multipart boundaries.

    All the narrative fields below are `blank=True` on the model itself,
    so "Save allows incomplete data, only Submit requires everything
    filled in" (see the frontend form's validateForSubmit comment) is
    already the natural DRF behavior here — no per-field required=False
    overrides needed. Submit-time completeness is enforced separately,
    in PostEventReportSubmitView.
    """

    follow_up_actions = FollowUpActionSerializer(many=True, required=False)

    class Meta:
        model = PostEventReport
        fields = [
            "follow_up_actions",
            "major_accomplishment", "best_practices_lessons_actions",
            "challenges_faced", "recommendation_conclusion",
            "participants_male", "participants_female",
            "participants_ee_staff", "participants_moh", "participants_rhb", "participants_zhd",
            "participants_university", "participants_partner", "participants_woho",
            "participants_hospital", "participants_health_center", "participants_health_post",
            "participants_other_count",
            "event_social_links",
        ]

    def create(self, validated_data):
        actions_data = validated_data.pop("follow_up_actions", [])
        report = PostEventReport.objects.create(event=self.context["event"], **validated_data)
        for action in actions_data:
            FollowUpAction.objects.create(post_event_report=report, **action)
        return report

    def update(self, instance, validated_data):
        """Saving a draft again: when follow-up actions are sent they replace the
        saved list (the form always sends the full list)."""
        actions_data = validated_data.pop("follow_up_actions", None)
        report = super().update(instance, validated_data)
        if actions_data is not None:
            report.follow_up_actions.all().delete()
            for action in actions_data:
                FollowUpAction.objects.create(post_event_report=report, **action)
        return report
