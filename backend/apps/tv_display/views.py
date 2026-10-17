
from django.db import models
from django.utils import timezone
from rest_framework import generics, permissions
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import ActionType, ObjectType
from apps.audit.utils import log_action
from apps.core.permissions import IsAdminOrLeadershipOrCommunications, IsCommunicationsOrAdmin

from .models import CONTENT_MODE_MANUAL, TVDisplaySettings, TVDisplaySlide, get_section_label, make_custom_section_key
from .serializers import TVDisplaySettingsSerializer, TVDisplaySlideSerializer


class TVDisplaySettingsView(APIView):
    """Singleton GET/PATCH for the TV Display's on/off, order, and timing
    settings. GET is any authenticated user (the live /tv-display screen
    will eventually read this to know what to show — see models.py);
    PATCH is Admin/Leadership/Communications, managed from Admin >
    Communications > Display. Communications was widened to match Admin
    in full (see IsAdminOrLeadershipOrCommunications) rather than being
    limited to slide authoring only.
    """

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.IsAuthenticated()]
        return [IsAdminOrLeadershipOrCommunications()]

    def get(self, request):
        return Response(TVDisplaySettingsSerializer(TVDisplaySettings.get_settings()).data)

    def patch(self, request):
        instance = TVDisplaySettings.get_settings()
        serializer = TVDisplaySettingsSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        log_action(
            ActionType.UPDATED,
            instance,
            user=request.user,
            description="Updated TV Display Settings.",
            object_type=ObjectType.TV_DISPLAY_SETTINGS,
        )
        return Response(serializer.data)


class TVDisplaySlidePagination(PageNumberPagination):
    """Same {count, next, previous, results} shape as before, plus an opt-in
    `?page_size=` (up to 500). The TV Display and the settings panel each
    need EVERY slide in one request, not just the first default page of 20 —
    with more than 20 slides, the rest (ordered by section_key, so custom
    queues' slides among them) were silently never shown on the TV or listed
    in the panel. Callers that don't send page_size get the old behavior.
    """

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 500


class TVDisplaySlideListCreateView(generics.ListCreateAPIView):
    """List/create manually-added TV Display slides (Staff Spotlight,
    Celebrations, Announcements, Recognitions, Quick Information).

    GET is any authenticated user, same as TVDisplaySettingsView — the
    live /tv-display screen needs to read active slides, and every role
    already sees the settings page read-only. Optional `?section_key=`
    filter for the management UI; `?active_only=1` for the live screen
    (only slides currently meant to actually show). Write access is
    Communications/Admin only (IsCommunicationsOrAdmin), narrower than
    the Admin/Leadership who control the master settings.
    """

    serializer_class = TVDisplaySlideSerializer
    pagination_class = TVDisplaySlidePagination

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.IsAuthenticated()]
        return [IsCommunicationsOrAdmin()]

    def get_queryset(self):
        qs = TVDisplaySlide.objects.select_related("created_by").all()
        section_key = self.request.query_params.get("section_key")
        if section_key:
            qs = qs.filter(section_key=section_key)
        if self.request.query_params.get("active_only"):
            # "Currently showable" = is_active and today within [start_date, end_date]
            # (blank means unbounded). Computed at read time so expired slides keep
            # their schedule and can be rescheduled.
            today = timezone.localdate()
            qs = qs.filter(is_active=True).filter(
                models.Q(start_date__isnull=True) | models.Q(start_date__lte=today)
            ).filter(
                models.Q(end_date__isnull=True) | models.Q(end_date__gte=today)
            )
        return qs

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user)
        log_action(
            ActionType.CREATED,
            instance,
            user=self.request.user,
            description=f"Added \"{instance.title}\" to {get_section_label(instance.section_key)} on TV Display.",
            object_type=ObjectType.TV_DISPLAY_SLIDE,
        )


class TVDisplaySlideDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Edit or remove a single slide. Same Communications/Admin write
    gate as the list/create view above; GET included for completeness
    (the management UI works off the list view, not this one).
    """

    queryset = TVDisplaySlide.objects.select_related("created_by").all()
    serializer_class = TVDisplaySlideSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.IsAuthenticated()]
        return [IsCommunicationsOrAdmin()]

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action(
            ActionType.UPDATED,
            instance,
            user=self.request.user,
            description=f"Updated \"{instance.title}\" ({get_section_label(instance.section_key)}) on TV Display.",
            object_type=ObjectType.TV_DISPLAY_SLIDE,
        )

    def perform_destroy(self, instance):
        log_action(
            ActionType.DELETED,
            instance,
            user=self.request.user,
            description=f"Removed \"{instance.title}\" ({get_section_label(instance.section_key)}) from TV Display.",
            object_type=ObjectType.TV_DISPLAY_SLIDE,
        )
        instance.delete()


class TVDisplayCustomSectionCreateView(APIView):
    """Add a brand-new TV Display queue beyond the fixed SECTION_KEYS
    (e.g. "Live Announcement") — the admin gives it a name, and it starts
    behaving exactly like Announcements/Staff Spotlight/etc: its own
    add/edit/remove slide list, reorderable and toggle-able in the
    section list like every other section.

    Takes effect immediately (appended to TVDisplaySettings.sections and
    saved right away) rather than being staged behind the settings page's
    "Save Settings" button — same immediate-action pattern as adding a
    slide. Communications/Admin only, the same content-authoring gate as
    slide management (IsCommunicationsOrAdmin), not the wider Admin/
    Leadership/Communications gate on the rest of TVDisplaySettingsView -
    creating a new content queue is an authoring decision, not a
    display-configuration one.
    """

    permission_classes = [IsCommunicationsOrAdmin]

    def post(self, request):
        label = (request.data.get("label") or "").strip()
        if not label:
            return Response({"label": ["A name is required."]}, status=400)
        if len(label) > 60:
            return Response({"label": ["Keep it under 60 characters."]}, status=400)

        instance = TVDisplaySettings.get_settings()
        existing_keys = {item["key"] for item in instance.sections}
        key = make_custom_section_key(label)
        while key in existing_keys:
            key = make_custom_section_key(label)

        instance.sections = [
            *instance.sections,
            {
                "key": key,
                "enabled": True,
                "duration_seconds": None,
                "custom": True,
                "label": label,
                # Custom queues are always slide-authored.
                "content_mode": CONTENT_MODE_MANUAL,
            },
        ]
        instance.updated_by = request.user
        instance.save()
        log_action(
            ActionType.CREATED,
            instance,
            user=request.user,
            description=f"Added a new TV Display queue: \"{label}\".",
            object_type=ObjectType.TV_DISPLAY_SETTINGS,
        )
        return Response(TVDisplaySettingsSerializer(instance).data, status=201)


class TVDisplayCustomSectionDetailView(APIView):
    """Rename or remove a custom queue created via the view above.

    Renaming only touches its `label` - the generated `key` is permanent,
    since it's the same join key TVDisplaySlide.section_key already
    points at; changing it would silently orphan any slides already added
    under the old key.

    Deleting takes the queue out of the rotation order entirely AND
    deletes every slide already added to it, rather than just hiding it -
    Communications/Admin asked to be able to remove a queue outright, not
    leave it present-but-disabled with orphaned content nobody can reach.
    """

    permission_classes = [IsCommunicationsOrAdmin]

    def _get_entry(self, instance, key):
        for item in instance.sections:
            if item["key"] == key and item.get("custom"):
                return item
        return None

    def patch(self, request, key):
        instance = TVDisplaySettings.get_settings()
        entry = self._get_entry(instance, key)
        if entry is None:
            return Response({"detail": "Custom queue not found."}, status=404)

        label = (request.data.get("label") or "").strip()
        if not label:
            return Response({"label": ["A name is required."]}, status=400)
        if len(label) > 60:
            return Response({"label": ["Keep it under 60 characters."]}, status=400)

        old_label = entry.get("label", key)
        instance.sections = [
            {**item, "label": label} if item["key"] == key else item for item in instance.sections
        ]
        instance.updated_by = request.user
        instance.save()
        log_action(
            ActionType.UPDATED,
            instance,
            user=request.user,
            description=f"Renamed TV Display queue \"{old_label}\" to \"{label}\".",
            object_type=ObjectType.TV_DISPLAY_SETTINGS,
        )
        return Response(TVDisplaySettingsSerializer(instance).data)

    def delete(self, request, key):
        instance = TVDisplaySettings.get_settings()
        entry = self._get_entry(instance, key)
        if entry is None:
            return Response({"detail": "Custom queue not found."}, status=404)

        label = entry.get("label", key)
        instance.sections = [item for item in instance.sections if item["key"] != key]
        instance.updated_by = request.user
        instance.save()
        deleted_count, _ = TVDisplaySlide.objects.filter(section_key=key).delete()
        log_action(
            ActionType.DELETED,
            instance,
            user=request.user,
            description=f"Removed TV Display queue \"{label}\" (and {deleted_count} slide(s) in it).",
            object_type=ObjectType.TV_DISPLAY_SETTINGS,
        )
        return Response(TVDisplaySettingsSerializer(instance).data)
