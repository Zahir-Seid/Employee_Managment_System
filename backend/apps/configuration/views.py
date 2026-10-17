from rest_framework import generics, permissions
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.utils import log_action
from apps.audit.models import ActionType, ObjectType
from apps.core.permissions import IsAdminOrLeadership

from .models import ConfigListType, ConfigOption, SystemSettings
from .serializers import ConfigOptionSerializer, SystemSettingsSerializer, get_usage_count


class ConfigOptionListCreateView(generics.ListCreateAPIView):
    """Admin management list — returns every option (active and inactive)
    for the requested list_type so the admin page can show/toggle both.
    Optional `?list_type=` filter; without it, returns every list_type
    (used by the admin page's "all lists" overview).
    """

    serializer_class = ConfigOptionSerializer
    permission_classes = [IsAdminOrLeadership]

    def get_queryset(self):
        qs = ConfigOption.objects.select_related("created_by").all()
        list_type = self.request.query_params.get("list_type")
        if list_type:
            qs = qs.filter(list_type=list_type)
        return qs

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user)
        log_action(
            ActionType.CREATED,
            instance,
            user=self.request.user,
            description=f"Added \"{instance.label}\" to {instance.get_list_type_display()}",
            object_type=ObjectType.CONFIG_OPTION,
        )


class ConfigOptionDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Edit, deactivate, or permanently delete a single option.

    Rename/deactivate (PATCH) is always safe and always available — see
    perform_update below.

    Permanent delete (DELETE) is the newer, riskier action (staff
    request): only allowed when nothing currently references this
    option's value (usage_count == 0). Deleting a value that N existing
    events already store would either break those events' display or
    force every reader of category/status/etc. to defensively handle a
    dangling value, so when it's in use the API blocks it with a clear
    400 error explaining exactly why and what to do instead, rather than
    silently failing or corrupting data. Deactivating remains the safe
    fallback for retiring an option that's already in use.
    """

    serializer_class = ConfigOptionSerializer
    permission_classes = [IsAdminOrLeadership]
    queryset = ConfigOption.objects.select_related("created_by").all()

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action(
            ActionType.UPDATED,
            instance,
            user=self.request.user,
            description=f"Updated \"{instance.label}\" ({instance.get_list_type_display()})",
            object_type=ObjectType.CONFIG_OPTION,
        )

    def perform_destroy(self, instance):
        usage_count = get_usage_count(instance.list_type, instance.value)
        if usage_count > 0:
            raise ValidationError(
                {
                    "detail": (
                        f"Can't delete \"{instance.label}\" - it's used by {usage_count} existing "
                        f"record{'s' if usage_count != 1 else ''}. Deactivate it instead: that hides it from "
                        "new events without breaking the ones that already use it."
                    )
                }
            )
        label, list_type_display, instance_id = instance.label, instance.get_list_type_display(), instance.id
        instance.delete()
        log_action(
            ActionType.DELETED,
            instance_id,
            user=self.request.user,
            description=f"Deleted \"{label}\" from {list_type_display}",
            object_type=ObjectType.CONFIG_OPTION,
        )


class ActiveConfigOptionsView(APIView):
    """Public (any authenticated user) read endpoint the Event forms and
    Dashboard filters call once to populate their Thematic Area, Engagement
    Level, and Lead Organization dropdowns — replacing the old hardcoded
    frontend arrays. Only active options are returned, grouped by list_type,
    each as `{value, label}` in display order.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        # Self-heal: the option lists are seeded by `migrate` (post_migrate
        # signal). A database that was created, restored or copied without
        # a migrate run afterwards has NO rows for some lists, and every
        # dropdown then shows only its hardcoded "Other" entry. If a list
        # has no rows at all (not "all deactivated" - that is an admin's
        # deliberate choice and is respected), seed the defaults now.
        # seed_defaults() only creates what is missing, so this is safe.
        from .seed import DEFAULTS, seed_defaults

        existing = set(ConfigOption.objects.values_list("list_type", flat=True).distinct())
        if any(list_type not in existing for list_type in DEFAULTS):
            seed_defaults()
        options = ConfigOption.objects.filter(is_active=True).order_by("list_type", "order", "label")
        grouped = {list_type: [] for list_type, _ in ConfigListType.choices}
        for opt in options:
            grouped[opt.list_type].append({"value": opt.value, "label": opt.label})
        return Response(grouped)


class SystemSettingsView(APIView):
    """Singleton GET/PATCH — notification emails, photo limits, default
    Dashboard period. GET is any authenticated user (the Dashboard reads
    default_dashboard_period on load for everyone, not just admins);
    PATCH is Admin-only, same as the ConfigOption lists above.
    """

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.IsAuthenticated()]
        return [IsAdminOrLeadership()]

    def get(self, request):
        return Response(SystemSettingsSerializer(SystemSettings.get_settings()).data)

    def patch(self, request):
        instance = SystemSettings.get_settings()
        serializer = SystemSettingsSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        log_action(
            ActionType.UPDATED,
            instance,
            user=request.user,
            description="Updated System Settings.",
            object_type=ObjectType.CONFIG_OPTION,
        )
        return Response(serializer.data)
