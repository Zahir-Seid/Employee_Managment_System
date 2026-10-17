from rest_framework import serializers

from apps.events.models import Event

from .models import HomeContent, HomeContentType, SiteSettings


class LinkedEventLiteSerializer(serializers.ModelSerializer):
    """Minimal Event shape for the Major Event "link an existing Event"
    picker, and for echoing the linked event back on a HomeContent item."""

    location = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = ["id", "title", "start_date", "end_date", "location"]

    def get_location(self, obj):
        parts = [p for p in [obj.location_label] if p]
        return ", ".join(parts)


class HomeContentSerializer(serializers.ModelSerializer):
    """Covers both Manage Content (full read/write, Communications/Admin)
    and the public Home page payload (read-only there). Type-specific
    requiredness is enforced in validate() rather than at the field
    level, since one form/model backs three different content types
    (doc §5: the form only shows the fields relevant to the selected type).
    """

    linked_event_detail = LinkedEventLiteSerializer(source="linked_event", read_only=True)
    content_type_display = serializers.CharField(source="get_content_type_display", read_only=True)
    effective_title = serializers.CharField(read_only=True)
    effective_start_date = serializers.DateField(read_only=True)
    effective_end_date = serializers.DateField(read_only=True)
    effective_location = serializers.CharField(read_only=True)
    created_by_name = serializers.SerializerMethodField()
    # Write-only, not a model field: a plain multipart PATCH has no way to
    # say "clear this file field" (omitting `image` just means "leave it
    # alone", same as every other optional field here). This is the
    # explicit "yes, actually remove it" signal, same pattern as
    # TVDisplaySlide.remove_photo — handled in update() below.
    remove_image = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = HomeContent
        fields = [
            "id",
            "content_type",
            "content_type_display",
            "audience",
            "title",
            "description",
            "image",
            "remove_image",
            "publish_date",
            "start_date",
            "end_date",
            "location",
            "linked_event",
            "linked_event_detail",
            "is_published",
            "is_active",
            "is_featured",
            "effective_title",
            "effective_start_date",
            "effective_end_date",
            "effective_location",
            "created_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() if obj.created_by else None

    def update(self, instance, validated_data):
        remove_image = validated_data.pop("remove_image", False)
        if remove_image and not validated_data.get("image"):
            instance.image.delete(save=False)
            instance.image = None
        return super().update(instance, validated_data)

    def create(self, validated_data):
        validated_data.pop("remove_image", None)
        return super().create(validated_data)

    def validate(self, attrs):
        def current(field, default=None):
            if field in attrs:
                return attrs[field]
            return getattr(self.instance, field, default)

        content_type = current("content_type")
        errors = {}

        if content_type == HomeContentType.NEWS:
            if not current("image"):
                errors["image"] = "News requires a photo."
            if not current("publish_date"):
                errors["publish_date"] = "News requires a publish date."
        elif content_type == HomeContentType.ANNOUNCEMENT:
            pass  # No dates: an Announcement shows immediately, like News.
        elif content_type == HomeContentType.MAJOR_EVENT:
            linked_event = current("linked_event")
            if not linked_event:
                if not current("location", ""):
                    errors["location"] = "Provide a location, or link an existing Event instead."
                if not current("start_date"):
                    errors["start_date"] = "Provide a start date, or link an existing Event instead."
                if not current("end_date"):
                    errors["end_date"] = "Provide an end date, or link an existing Event instead."

        elif content_type == HomeContentType.UPCOMING_EVENT:
            if not current("start_date"):
                errors["start_date"] = "An Upcoming Event requires a date."
            if not current("location", ""):
                errors["location"] = "An Upcoming Event requires a location."
            start, end = current("start_date"), current("end_date")
            if start and end and end < start:
                errors["end_date"] = "End date can't be before the start date."

        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class HomeEventPhotoSerializer(serializers.Serializer):
    """Doc §10: Event Photos, pulled automatically from existing Event
    Status Report photos — no admin authoring, no separate photo model."""

    id = serializers.UUIDField()
    image = serializers.SerializerMethodField()
    event_title = serializers.SerializerMethodField()
    event_id = serializers.SerializerMethodField()
    # The Home page's "Recent moments" slideshow shows the event's date
    # alongside its title.
    event_start_date = serializers.SerializerMethodField()
    event_end_date = serializers.SerializerMethodField()

    def get_image(self, obj):
        request = self.context.get("request")
        try:
            url = obj.image.url
        except ValueError:
            return None
        return request.build_absolute_uri(url) if request else url

    def get_event_title(self, obj):
        return obj.post_event_report.event.title

    def get_event_start_date(self, obj):
        return obj.post_event_report.event.start_date

    def get_event_end_date(self, obj):
        return obj.post_event_report.event.end_date

    def get_event_id(self, obj):
        return obj.post_event_report.event_id


class SiteSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = ["km_resource_title", "km_resource_description", "km_resource_url", "updated_at"]
        read_only_fields = ["updated_at"]


class HomeUpcomingEventSerializer(serializers.ModelSerializer):
    """Home Page Upcoming Events card, built straight from the Event record
    (no separate Home record). `location` is Venue, City."""

    location = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = ["id", "title", "start_date", "end_date", "location"]

    def get_location(self, obj):
        return ", ".join(part for part in (obj.venue, obj.city) if part)


class HomeHeldEventSerializer(serializers.Serializer):
    """Recently Held carousel card: title, date range, and one photo.
    Built from a plain dict (see HomeFeedView) rather than an Event
    instance, so the photo can be looked up in one batch query instead
    of once per event."""

    id = serializers.UUIDField()
    title = serializers.CharField()
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    image = serializers.SerializerMethodField()

    def get_image(self, obj):
        photo = obj.get("photo")
        if not photo:
            return None
        request = self.context.get("request")
        try:
            url = photo.image.url
        except ValueError:
            return None
        return request.build_absolute_uri(url) if request else url
