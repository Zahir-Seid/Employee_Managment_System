from rest_framework import serializers


from .models import (
    AUTOMATIC_SECTION_KEYS,
    CONTENT_MODE_AUTOMATIC,
    CONTENT_MODE_MANUAL,
    CONTENT_MODES,
    DASHBOARD_PICK_KEYS,
    DASHBOARD_PICK_LABELS,
    MANUAL_SLIDE_SECTION_KEYS,
    SECTION_KEYS,
    SECTION_LABELS,
    TVDisplaySettings,
    TVDisplaySlide,
    get_custom_section_keys,
    get_section_label,
)


class TVDisplaySettingsSerializer(serializers.ModelSerializer):
    # `sections_display` enriches the plain writable `sections` list with labels
    # and flags so the frontend doesn't hardcode them.
    sections_display = serializers.SerializerMethodField()
    dashboard_picks_display = serializers.SerializerMethodField()

    class Meta:
        model = TVDisplaySettings
        fields = [
            "is_active",
            "screen_duration_seconds",
            "sections",
            "sections_display",
            "dashboard_picks",
            "dashboard_picks_display",
            "analytics_period",
            "analytics_period_selection",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]

    def get_sections_display(self, instance):
        return [
            {
                "key": item["key"],
                "enabled": item["enabled"],
                "duration_seconds": item.get("duration_seconds"),
                "label": item.get("label", item["key"]) if item.get("custom") else SECTION_LABELS.get(item["key"], item["key"]),
                "is_automatic": item["key"] in AUTOMATIC_SECTION_KEYS,
                "is_custom": bool(item.get("custom")),
                # Older saved rows may lack content_mode; default by section type.
                "content_mode": item.get(
                    "content_mode",
                    CONTENT_MODE_AUTOMATIC if item["key"] in AUTOMATIC_SECTION_KEYS else CONTENT_MODE_MANUAL,
                ),
            }
            for item in instance.sections
        ]

    def get_dashboard_picks_display(self, instance):
        return [
            {"key": item["key"], "enabled": item["enabled"], "label": DASHBOARD_PICK_LABELS.get(item["key"], item["key"])}
            for item in instance.dashboard_picks
        ]

    def validate_sections(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Must be a list.")

        keys = [item.get("key") for item in value if isinstance(item, dict)]
        if len(keys) != len(value):
            raise serializers.ValidationError("Each entry must be an object with 'key' and 'enabled'.")
        if len(keys) != len(set(keys)):
            raise serializers.ValidationError("Duplicate section keys aren't allowed.")

        # Every built-in key must appear exactly once. Anything else must be a
        # custom queue, which is added/removed via the custom-sections endpoints.
        fixed_keys = [k for k in keys if k in SECTION_KEYS]
        custom_keys = [k for k in keys if k not in SECTION_KEYS]
        if sorted(fixed_keys) != sorted(SECTION_KEYS):
            raise serializers.ValidationError(
                f"Must contain exactly these built-in sections, no duplicates or missing ones: {', '.join(SECTION_KEYS)}."
            )
        for item in value:
            if item["key"] in custom_keys:
                if not item.get("custom"):
                    raise serializers.ValidationError(f"'{item.get('key')}' isn't a recognized section.")
                if not isinstance(item.get("label"), str) or not item.get("label").strip():
                    raise serializers.ValidationError(f"Custom queue '{item.get('key')}' needs a non-empty label.")
            if not isinstance(item.get("enabled"), bool):
                raise serializers.ValidationError(f"'{item.get('key')}' is missing a boolean 'enabled'.")
            # duration_seconds is optional; omitted or null follows the shared duration.
            if "duration_seconds" in item:
                duration = item.get("duration_seconds")
                if duration is not None and (not isinstance(duration, int) or isinstance(duration, bool) or duration < 3):
                    raise serializers.ValidationError(
                        f"'{item.get('key')}' duration_seconds must be null (automatic) or a whole number of at least 3 seconds."
                    )
            # content_mode is optional for the same reason.
            if "content_mode" in item:
                content_mode = item.get("content_mode")
                if content_mode not in CONTENT_MODES:
                    raise serializers.ValidationError(
                        f"'{item.get('key')}' content_mode must be one of: {', '.join(CONTENT_MODES)}."
                    )

        return value

    def validate_dashboard_picks(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Must be a list.")
        keys = [item.get("key") for item in value if isinstance(item, dict)]
        if len(keys) != len(value):
            raise serializers.ValidationError("Each entry must be an object with 'key' and 'enabled'.")
        if sorted(keys) != sorted(DASHBOARD_PICK_KEYS):
            raise serializers.ValidationError(
                f"Must contain exactly these dashboards, no duplicates or unknowns: {', '.join(DASHBOARD_PICK_KEYS)}."
            )
        for item in value:
            if not isinstance(item.get("enabled"), bool):
                raise serializers.ValidationError(f"'{item.get('key')}' is missing a boolean 'enabled'.")
        return value

    # analytics_period is validated by its model choices; this checks the JSON
    # companion ({"week", "month", "quarter", "year"}, each key optional).
    def validate_analytics_period_selection(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Must be an object.")
        allowed_keys = {"week", "month", "quarter", "year"}
        unknown = set(value) - allowed_keys
        if unknown:
            raise serializers.ValidationError(f"Unknown key(s): {', '.join(sorted(unknown))}.")
        bounds = {"week": (1, 4), "month": (1, 12), "quarter": (1, 4)}
        for key, (lo, hi) in bounds.items():
            if key in value:
                v = value[key]
                if isinstance(v, bool) or not isinstance(v, int) or not (lo <= v <= hi):
                    raise serializers.ValidationError(f"'{key}' must be a whole number between {lo} and {hi}.")
        if "year" in value:
            year = value["year"]
            if isinstance(year, bool) or not isinstance(year, int) or year < 2000 or year > 2100:
                raise serializers.ValidationError("'year' must be a whole number between 2000 and 2100.")
        return value

    def validate_screen_duration_seconds(self, value):
        if value < 3:
            raise serializers.ValidationError("Screen duration must be at least 3 seconds.")
        return value


class TVDisplaySlideSerializer(serializers.ModelSerializer):
    # Resolved via get_section_label() since custom queues have no model choices.
    section_label = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    # Explicit signal to clear the photo: omitting `photo` in a multipart request
    # leaves it untouched. Handled in update().
    remove_photo = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = TVDisplaySlide
        fields = [
            "id", "section_key", "section_label", "title", "subtitle", "message", "photo", "remove_photo",
            "duration_seconds", "is_active", "start_date", "end_date", "order",
            "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "section_label", "created_by_name", "created_at", "updated_at"]

    def update(self, instance, validated_data):
        remove_photo = validated_data.pop("remove_photo", False)
        if remove_photo and not validated_data.get("photo"):
            instance.photo.delete(save=False)
            instance.photo = None
        return super().update(instance, validated_data)

    def create(self, validated_data):
        validated_data.pop("remove_photo", None)
        return super().create(validated_data)

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else None

    def get_section_label(self, obj):
        return get_section_label(obj.section_key)

    def validate_section_key(self, value):
        valid_keys = set(MANUAL_SLIDE_SECTION_KEYS) | set(get_custom_section_keys())
        if value not in valid_keys:
            raise serializers.ValidationError(
                "Must be one of the built-in manual sections or an existing custom queue."
            )
        return value

    def validate_title(self, value):
        if not value.strip():
            raise serializers.ValidationError("Title is required.")
        return value

    def validate_duration_seconds(self, value):
        if value is not None and value < 3:
            raise serializers.ValidationError("Duration must be at least 3 seconds, or blank to use the shared duration.")
        return value

    def validate(self, attrs):
        # On PATCH only one date may be sent; fall back to the instance's value.
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "End date can't be before the start date."})
        return attrs
