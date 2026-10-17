from rest_framework import serializers

from .models import Event


class EventListSerializer(serializers.ModelSerializer):
    """Powers the My Events table (UI/UX Section 5): Event Title, Category,
    Region, Event Date, Status, Communications Support, Report Status, Actions.
    """

    owner_name = serializers.CharField(source="owner.get_full_name", read_only=True)
    communications_support = serializers.SerializerMethodField()
    report_status = serializers.SerializerMethodField()
    # True once the event ended more than REPORT_SUBMISSION_WINDOW_DAYS (5)
    # days ago with no submitted Event Status Report; the Events list shows
    # "Overdue" in the Report Status column from that point on.
    is_report_overdue = serializers.BooleanField(read_only=True)
    is_editable = serializers.BooleanField(read_only=True)
    # Computed six-way status (see Event.get_computed_status) alongside the raw
    # `status`, which the Postpone/Cancel/Reopen actions still use.
    computed_status = serializers.CharField(source="get_computed_status", read_only=True)
    status_display = serializers.CharField(source="get_status_label", read_only=True)
    event_type_label = serializers.CharField(source="event_type_full_label", read_only=True)
    location_label = serializers.CharField(read_only=True)
    # Actual submitted headcount, never blended with expected counts.
    participants_total = serializers.SerializerMethodField()
    # {"code", "label", "color"}; see Event.days_until_event_display.
    days_until_event = serializers.DictField(source="days_until_event_display", read_only=True)

    class Meta:
        model = Event
        fields = [
            "id", "title", "category", "event_type", "review_meeting_type", "event_type_other", "event_type_label",
            "mode_of_event", "country", "region", "location_label", "thematic_area",
            "start_date", "end_date", "status", "computed_status", "status_display",
            "owner", "owner_name", "communications_support",
            "report_status", "is_report_overdue", "is_editable", "created_at",
            "total_expected_participants", "expected_participants", "participants_total",
            "days_until_event",
        ]

    def get_communications_support(self, obj):
        if not obj.needs_comms_support:
            return "Not Requested"
        if not obj.has_support_request:
            return "Requested (Pending Submission)"
        return "Requested"

    def get_report_status(self, obj):
        if not obj.has_post_event_report:
            return "Pending"
        return "Completed" if obj.has_submitted_report else "Draft"

    def get_participants_total(self, obj):
        # None means the frontend should show the expected count instead.
        if not obj.has_submitted_report:
            return None
        return obj.post_event_report.participants_total


class EventDetailSerializer(serializers.ModelSerializer):
    """Powers the read-only Event Details page (UI/UX Section 11), which
    nests Communications Support and Event Status Report data. Those nested
    serializers are imported lazily to avoid circular imports between apps.
    """

    owner_name = serializers.CharField(source="owner.get_full_name", read_only=True)
    is_editable = serializers.BooleanField(read_only=True)
    is_report_overdue = serializers.BooleanField(read_only=True)
    # Saves the frontend from re-deriving the Lead/Organizer/Co-organizer rule
    # (see Event.ee_leads).
    ee_leads = serializers.BooleanField(read_only=True)
    computed_status = serializers.CharField(source="get_computed_status", read_only=True)
    status_display = serializers.CharField(source="get_status_label", read_only=True)
    event_type_label = serializers.CharField(source="event_type_full_label", read_only=True)
    location_label = serializers.CharField(read_only=True)
    support_request = serializers.SerializerMethodField()
    post_event_report = serializers.SerializerMethodField()
    operational_request_to_name = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "id", "owner", "owner_name", "category", "event_type", "review_meeting_type", "event_type_other",
            "event_type_label", "mode_of_event", "title", "description",
            "start_date", "end_date", "venue", "city", "country", "region", "location_label",
            "organization_lead_agency", "thematic_area", "engagement_level", "co_organizer_name", "ee_leads",
            "support_level", "total_expected_participants", "expected_participants", "personal_objective", "expected_outcome",
            "needs_comms_support", "status", "computed_status", "status_display", "status_reason",
            "has_operational_request", "operational_request_to",
            "operational_request_to_name",
            "is_editable", "is_report_overdue", "big_event_photo",
            "support_request", "post_event_report", "created_at", "updated_at",
        ]

    def get_operational_request_to_name(self, obj):
        user = obj.operational_request_to
        return (user.get_full_name() or user.email) if user else ""

    def get_support_request(self, obj):
        if not obj.has_support_request:
            return None
        from apps.communications.serializers import SupportRequestSerializer

        return SupportRequestSerializer(obj.support_request).data

    def get_post_event_report(self, obj):
        if not obj.has_post_event_report:
            return None
        from apps.reports.serializers import PostEventReportSerializer

        return PostEventReportSerializer(obj.post_event_report, context=self.context).data


class EventWriteSerializer(serializers.ModelSerializer):
    """Handles Create Event (Stages 2/6 of the UI/UX multi-step form) and
    edits to an existing event (locked once a Event Status Report exists —
    enforced in the view, not here, so this serializer stays reusable).
    """

    class Meta:
        model = Event
        fields = [
            "id", "category", "event_type", "review_meeting_type", "event_type_other", "mode_of_event", "title",
            "description", "start_date", "end_date",
            "venue", "city", "country", "region", "organization_lead_agency",
            "thematic_area", "engagement_level", "co_organizer_name", "support_level",
            "total_expected_participants", "expected_participants", "personal_objective", "expected_outcome",
            "needs_comms_support",
            "has_operational_request", "operational_request_to",
        ]
        read_only_fields = ["id"]
        extra_kwargs = {
            "support_level": {"required": False, "allow_blank": True},
            "country": {"required": False, "allow_blank": True},
            "review_meeting_type": {"required": False, "allow_blank": True},
            "event_type_other": {"required": False, "allow_blank": True},
            "expected_participants": {"required": False},
            "total_expected_participants": {"required": False},
            "co_organizer_name": {"required": False, "allow_blank": True},
            "personal_objective": {"required": False, "allow_blank": True},
            "expected_outcome": {"required": False, "allow_blank": True},
            "has_operational_request": {"required": False},
            "operational_request_to": {"required": False, "allow_null": True},
        }

    # `status` is deliberately not editable here; Postpone/Cancel go through
    # EventStatusActionView, which requires a reason. Thematic Area, Engagement
    # Level and Lead Organization accept custom "Other" values, so they are not
    # strictly validated against the ConfigOption lists.

    def validate(self, attrs):
        # International events must name their country (picked from the
        # worldwide list or typed in); every other category is Ethiopian
        # Region/City only, so any country is cleared. Checked on create and
        # whenever the category or country is part of the request, so older
        # International events (saved before Country existed) aren't blocked
        # from unrelated partial updates.
        category = attrs.get("category", getattr(self.instance, "category", None))
        country = (attrs.get("country", getattr(self.instance, "country", "")) or "").strip()
        if category == "international":
            if (self.instance is None or "category" in attrs or "country" in attrs) and not country:
                raise serializers.ValidationError({"country": "Country is required for international events."})
            attrs["country"] = country
        elif category is not None:
            attrs["country"] = ""

        # Event type follow-ups: a Review Meeting must say Annual or Mid-term,
        # and "Other" must say what it is. Checked on create and whenever the
        # type or its follow-up is part of the request, so unrelated partial
        # updates to an older event aren't blocked; follow-ups that don't
        # apply to the chosen type are cleared.
        event_type = attrs.get("event_type", getattr(self.instance, "event_type", None))
        touched = self.instance is None or "event_type" in attrs or "review_meeting_type" in attrs or "event_type_other" in attrs
        review_type = attrs.get("review_meeting_type", getattr(self.instance, "review_meeting_type", "")) or ""
        other_text = (attrs.get("event_type_other", getattr(self.instance, "event_type_other", "")) or "").strip()
        if event_type == "rm":
            if touched and review_type not in ("annual", "mid_term"):
                raise serializers.ValidationError({"review_meeting_type": "Choose Annual or Mid-term for a Review Meeting."})
            attrs["event_type_other"] = ""
        elif event_type == "other":
            if touched and not other_text:
                raise serializers.ValidationError({"event_type_other": "Please write what kind of event this is."})
            attrs["event_type_other"] = other_text
            attrs["review_meeting_type"] = ""
        elif event_type is not None:
            attrs["review_meeting_type"] = ""
            attrs["event_type_other"] = ""

        # Comms Support is required on create. DRF treats a missing boolean as
        # False for form-encoded data, so check the raw initial_data instead.
        if "needs_comms_support" not in self.initial_data and self.instance is None:
            raise serializers.ValidationError({
                "needs_comms_support": "This field is required for all events."
            })
        needs_support = attrs.get("needs_comms_support", getattr(self.instance, "needs_comms_support", None))
        if needs_support is None:
            raise serializers.ValidationError({
                "needs_comms_support": "This field is required for all events."
            })

        # Operational Request: only whether there is one and to whom. When
        # "Yes", the recipient is required; when "No", it is cleared. What
        # the request is about is deliberately not recorded.
        if self.instance is None or "has_operational_request" in attrs:
            if attrs.get("has_operational_request"):
                if not attrs.get("operational_request_to"):
                    raise serializers.ValidationError({
                        "operational_request_to": "Please choose who the request is for."
                    })
            else:
                attrs["has_operational_request"] = False
                attrs["operational_request_to"] = None

        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start_date and end_date and end_date < start_date:
            raise serializers.ValidationError({"end_date": "End date cannot be before the start date."})

        # EE leading in any capacity (Lead Organization, Organizer or
        # Co-organizer) requires both participant counts: the overall total
        # (total_expected_participants) and EE's own headcount
        # (expected_participants). When EE is NOT leading there is no overall
        # total to ask for: only EE's own headcount (expected_participants)
        # is required, and total_expected_participants is optional.
        lead_org = attrs.get("organization_lead_agency", getattr(self.instance, "organization_lead_agency", None))
        engagement_level = attrs.get("engagement_level", getattr(self.instance, "engagement_level", None))
        ee_leads = (lead_org or "").strip().upper() == "EE" or engagement_level in ("organizer", "co_organizer")

        total_participants = attrs.get(
            "total_expected_participants", getattr(self.instance, "total_expected_participants", None)
        )
        participants = attrs.get("expected_participants", getattr(self.instance, "expected_participants", None))

        if ee_leads:
            if total_participants is None:
                raise serializers.ValidationError({
                    "total_expected_participants": "Required when EE is the Lead Organization, Organizer, or Co-organizer."
                })
            if participants is None:
                raise serializers.ValidationError({
                    "expected_participants": "Required when EE is the Lead Organization, Organizer, or Co-organizer."
                })
            # The total can never be smaller than the EE headcount.
            if total_participants is not None and participants is not None and total_participants < participants:
                raise serializers.ValidationError({
                    "total_expected_participants": "Total participants must be equal to or greater than the number from EE."
                })
        else:
            if participants is None:
                raise serializers.ValidationError({
                    "expected_participants": "Required (number of participants from EE)."
                })

        # Personal Objective is required for everyone; Event Objective is
        # optional. On update, only enforced if the field is being sent, so
        # legacy events (created before this field existed) can still be
        # edited by other means.
        if self.instance is None or "personal_objective" in attrs:
            personal = attrs.get("personal_objective", getattr(self.instance, "personal_objective", None))
            if not (personal or "").strip():
                raise serializers.ValidationError({"personal_objective": "Personal objective relevant to EE is required."})

        # Support Level doesn't apply when EE leads; clear it. Compared
        # case-insensitively since the Configuration page lowercases values.
        if (lead_org or "").strip().upper() == "EE":
            attrs["support_level"] = ""
        else:
            support_level = attrs.get("support_level", getattr(self.instance, "support_level", None))
            if not support_level:
                raise serializers.ValidationError({
                    "support_level": "Required unless EE is the Lead Organization."
                })

        return attrs


class AdminEventCreateSerializer(EventWriteSerializer):
    """Item 7.4 (Admin Page > Events): identical to EventWriteSerializer
    (same validation — a EE-led event still needs the same fields
    regardless of who's submitting it), plus one writable field regular
    Create Event doesn't expose: `owner`, since an admin is creating this
    on someone else's behalf rather than for themselves.
    """

    class Meta(EventWriteSerializer.Meta):
        fields = EventWriteSerializer.Meta.fields + ["owner"]
        extra_kwargs = {**EventWriteSerializer.Meta.extra_kwargs, "owner": {"required": True}}


class AdminEventUpdateSerializer(EventWriteSerializer):
    """Item 7.5 (Staff tab reassign-owner): EventWriteSerializer (used for
    both the owner's own edits and, until this bug fix, admin edits too)
    doesn't include `owner` in its fields at all — correct for the
    owner's own edit flow (they should never be able to reassign their
    own event to someone else), but it meant the Admin page's "make this
    person the owner" action was silently a no-op: a 200 response with
    the owner unchanged, confirmed by actually PATCHing it and checking
    the result, not just reading the serializer. `owner` here is
    optional (unlike AdminEventCreateSerializer, where it's required) —
    most admin edits aren't a reassignment.
    """

    class Meta(EventWriteSerializer.Meta):
        # big_event_photo is admin-only and attached after the event exists.
        fields = EventWriteSerializer.Meta.fields + ["owner", "big_event_photo"]
        extra_kwargs = {
            **EventWriteSerializer.Meta.extra_kwargs,
            "owner": {"required": False},
            # allow_null lets a JSON PATCH remove the photo.
            "big_event_photo": {"required": False, "allow_null": True},
        }
