from datetime import date, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, permissions
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import ActionType, ObjectType
from apps.audit.utils import log_action
from apps.core.permissions import IsCommunicationsOrAdmin
from apps.events.models import Event, EventStatus
from apps.reports.models import EventPhoto

from .models import HomeContent, HomeContentAudience, HomeContentType, SiteSettings
from .serializers import (
    HomeContentSerializer,
    HomeEventPhotoSerializer,
    HomeHeldEventSerializer,
    HomeUpcomingEventSerializer,
    LinkedEventLiteSerializer,
    SiteSettingsSerializer,
)


# Max items sent per Home carousel (shown 4 at a time, paged with Prev/Next).
HOME_CAROUSEL_LIMIT = 12
# Recent Moments only uses photos from events held within this many days.
RECENT_MOMENTS_DAYS = 30


class HomeContentListCreateView(generics.ListCreateAPIView):
    """Manage Content list (doc §5: Home Page -> Manage Content -> Add
    Content). GET is unauthenticated-friendly (AllowAny) because the
    Manage Content list view itself lives behind an authenticated
    frontend route, but nothing here is confidential (it's the same
    news/announcements the public Home page shows), and the public Home
    page's own reads go through HomeFeedView below rather than this one.
    Optional `?content_type=` filter for the Add Content type picker.
    Write access (adding content) is Communications/Admin only, matching
    the TV Display slide-authoring precedent (IsCommunicationsOrAdmin).
    """

    serializer_class = HomeContentSerializer
    # multipart when a photo is attached, JSON otherwise.
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.AllowAny()]
        return [IsCommunicationsOrAdmin()]

    def get_queryset(self):
        authenticated = bool(
            getattr(self.request, "user", None) and self.request.user.is_authenticated
        )
        qs = HomeContent.objects.select_related("linked_event", "created_by").all()
        content_type = self.request.query_params.get("content_type")
        if content_type:
            qs = qs.filter(content_type=content_type)
        # ?audience=home or ?audience=tv (each also includes legacy "both" rows).
        audience = self.request.query_params.get("audience")
        if audience in (HomeContentAudience.HOME, HomeContentAudience.TV):
            qs = qs.filter(audience__in=[audience, HomeContentAudience.BOTH])
        if authenticated:
            # The Manage Content work surface: every row, including drafts,
            # expired and future-scheduled items.
            return qs.order_by("-created_at")
        # Security review #4: this list is reachable unauthenticated
        # (AllowAny on GET), so an anonymous caller gets exactly what the
        # public feed would show today — drafts and future-scheduled rows
        # stay internal until they authenticate. Python-level because
        # "showable" also depends on a linked Event's own dates (see
        # HomeContent.is_currently_showable and HomeFeedView).
        today = timezone.localdate()
        return [
            item
            for item in qs.order_by("-created_at")
            if item.is_currently_showable(today)
        ]

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user)
        log_action(
            ActionType.CREATED,
            instance,
            user=self.request.user,
            description=f"Added \"{instance.effective_title}\" ({instance.get_content_type_display()}) to the Home Page.",
            object_type=ObjectType.HOME_CONTENT,
        )


class HomeContentDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Edit/remove a single Home Page content item. Same GET-open/write-
    gated split as the list view above."""

    queryset = HomeContent.objects.select_related("linked_event", "created_by").all()
    serializer_class = HomeContentSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.AllowAny()]
        return [IsCommunicationsOrAdmin()]

    def perform_update(self, serializer):
        instance = serializer.save()
        log_action(
            ActionType.UPDATED,
            instance,
            user=self.request.user,
            description=f"Updated \"{instance.effective_title}\" ({instance.get_content_type_display()}) on the Home Page.",
            object_type=ObjectType.HOME_CONTENT,
        )

    def perform_destroy(self, instance):
        log_action(
            ActionType.DELETED,
            instance,
            user=self.request.user,
            description=f"Removed \"{instance.effective_title}\" ({instance.get_content_type_display()}) from the Home Page.",
            object_type=ObjectType.HOME_CONTENT,
        )
        instance.delete()


class SiteSettingsView(APIView):
    """Singleton GET/PATCH for the one permanent, admin-editable piece of
    Home Page content: the "EE News & Success Stories" external link
    card (doc §1). GET is public (the card is always on the public Home
    page); PATCH is Communications/Admin only, same gate as content
    authoring.
    """

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.AllowAny()]
        return [IsCommunicationsOrAdmin()]

    def get(self, request):
        return Response(SiteSettingsSerializer(SiteSettings.get_settings()).data)

    def patch(self, request):
        instance = SiteSettings.get_settings()
        serializer = SiteSettingsSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        log_action(
            ActionType.UPDATED,
            instance,
            user=request.user,
            description="Updated the Home Page KM Resource card.",
            object_type=ObjectType.SITE_SETTINGS,
        )
        return Response(serializer.data)


class LinkableEventsView(generics.ListAPIView):
    """Lite Event list for the Major Event "link an existing Event" picker
    on the Add Content form (doc §11). Communications/Admin only, same
    gate as content authoring itself — this exists only to feed that form.
    Optional `?q=` search on title.
    """

    serializer_class = LinkedEventLiteSerializer
    permission_classes = [IsCommunicationsOrAdmin]

    def get_queryset(self):
        qs = Event.objects.order_by("-start_date")
        q = self.request.query_params.get("q")
        if q:
            qs = qs.filter(title__icontains=q)
        return qs[:25]


class HomeFeedView(APIView):
    """The public Home page's one-call read (doc §15 layout: Hero ->
    Featured Content -> Latest News -> Knowledge Resources -> Event
    Photos). AllowAny — this is the public landing page, reachable
    logged-out. "Currently showable" (doc §7: publish window,
    published/active flags) is evaluated in Python via
    HomeContent.is_currently_showable rather than at the queryset level,
    since it also depends on a linked Event's own dates for Major Event
    items linked to a real Event record.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        today = timezone.localdate()
        # The Home page caps each section at 6; the TV queues pass ?all=1 to show
        # every showable item.
        no_cap = request.query_params.get("all") in ("1", "true", "True")
        section_cap = None if no_cap else 6
        # Public Home reads the default "home" audience; the TV asks for ?audience=tv.
        audience = (
            HomeContentAudience.TV
            if request.query_params.get("audience") == HomeContentAudience.TV
            else HomeContentAudience.HOME
        )
        all_content = HomeContent.objects.select_related("linked_event").filter(
            content_type__in=[
                HomeContentType.MAJOR_EVENT,
                HomeContentType.ANNOUNCEMENT,
                HomeContentType.NEWS,
                HomeContentType.UPCOMING_EVENT,
            ]
        )
        showable = [
            item
            for item in all_content
            if item.audience in (audience, HomeContentAudience.BOTH) and item.is_currently_showable(today)
        ]

        def by_type(content_type):
            return [item for item in showable if item.content_type == content_type]

        # Each section is capped at 6; Featured pins an item to the front of its
        # own type, then recency/urgency order applies.
        latest_news = sorted(
            by_type(HomeContentType.NEWS),
            key=lambda item: (
                not item.is_featured,
                -(item.publish_date or item.created_at.date()).toordinal(),
            ),
        )[:section_cap]

        announcements = sorted(
            by_type(HomeContentType.ANNOUNCEMENT),
            key=lambda item: (not item.is_featured, -item.created_at.timestamp()),
        )[:section_cap]

        # Soonest first, Featured pinned.
        major_events = sorted(
            by_type(HomeContentType.MAJOR_EVENT),
            key=lambda item: (not item.is_featured, item.effective_start_date or date.max),
        )[:section_cap]

        # Authored upcoming events, soonest first, capped at HOME_CAROUSEL_LIMIT.
        upcoming_events = sorted(
            by_type(HomeContentType.UPCOMING_EVENT),
            key=lambda item: item.start_date or date.max,
        )[:HOME_CAROUSEL_LIMIT]

        # The public Home page's Upcoming Events are automatic: read live from
        # the Event Registry, never from separately authored content. An event
        # qualifies by the same rule as the "Upcoming" display status (Event.
        # get_computed_status): still in the Logged state and not yet started,
        # so Cancelled, Postponed, Completed and already-started events drop
        # out, and creating/editing/rescheduling an event is reflected on the
        # next load. The TV audience keeps its own authored list unchanged.
        automatic_upcoming = None
        if audience == HomeContentAudience.HOME:
            automatic_upcoming = Event.objects.filter(
                status=EventStatus.LOGGED, start_date__gt=today
            ).order_by("start_date", "end_date", "title")[:HOME_CAROUSEL_LIMIT]

        # Recently Held is automatic: logged events past their end date or already
        # Completed, most recent first. Postponed/Cancelled are excluded.
        held_qs = (
            Event.objects.filter(
                Q(status=EventStatus.LOGGED, end_date__lt=today) | Q(status=EventStatus.COMPLETED)
            )
            .order_by("-end_date", "-start_date")[:HOME_CAROUSEL_LIMIT]
        )
        held_events = list(held_qs)
        first_photo = {}
        for photo in EventPhoto.objects.select_related("post_event_report").filter(
            post_event_report__event_id__in=[e.id for e in held_events]
        ).order_by("created_at"):
            first_photo.setdefault(photo.post_event_report.event_id, photo)
        held_rows = [
            {
                "id": e.id,
                "title": e.title,
                "start_date": e.start_date,
                "end_date": e.end_date,
                "photo": first_photo.get(e.id),
            }
            for e in held_events
        ]

        # Recent Moments: photos from events held within the past 30 days, by
        # event date (the event's end date falls between 30 days ago and today),
        # newest event first. Cancelled and Postponed events are left out. An
        # event's photos stay together in upload order. With nothing in the
        # window the list is empty and the Home page hides the section.
        window_start = today - timedelta(days=RECENT_MOMENTS_DAYS)
        photos = (
            EventPhoto.objects.select_related("post_event_report__event")
            .filter(
                post_event_report__event__status__in=[EventStatus.LOGGED, EventStatus.COMPLETED],
                post_event_report__event__end_date__gte=window_start,
                post_event_report__event__end_date__lte=today,
            )
            .order_by(
                "-post_event_report__event__end_date",
                "-post_event_report__event__start_date",
                "post_event_report__event_id",
                "created_at",
            )[:12]
        )

        context = {"request": request}
        return Response({
            "site_settings": SiteSettingsSerializer(SiteSettings.get_settings()).data,
            "latest_news": HomeContentSerializer(latest_news, many=True, context=context).data,
            "announcements": HomeContentSerializer(announcements, many=True, context=context).data,
            "major_events": HomeContentSerializer(major_events, many=True, context=context).data,
            "upcoming_events": (
                HomeUpcomingEventSerializer(automatic_upcoming, many=True, context=context).data
                if automatic_upcoming is not None
                else HomeContentSerializer(upcoming_events, many=True, context=context).data
            ),
            "held_events": HomeHeldEventSerializer(held_rows, many=True, context=context).data,
            "event_photos": HomeEventPhotoSerializer(photos, many=True, context=context).data,
        })
