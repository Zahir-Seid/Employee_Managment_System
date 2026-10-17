from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)


def health_check(request):
    """No-auth connectivity probe. The frontend pings this on load (and
    periodically) to show an immediate, unmistakable banner if the
    backend isn't reachable — rather than only surfacing a generic
    'Network Error' the next time someone happens to click Login.
    """
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health_check, name="health-check"),

    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),

    path("api/auth/", include("apps.accounts.urls")),
    path("api/events/", include("apps.events.urls")),
    path("api/", include("apps.communications.urls")),
    path("api/", include("apps.reports.urls")),
    path("api/dashboard/", include("apps.dashboard.urls")),
    path("api/audit-logs/", include("apps.audit.urls")),
    path("api/", include("apps.notifications.urls")),
    path("api/", include("apps.configuration.urls")),
    path("api/tv-display/", include("apps.tv_display.urls")),
    path("api/", include("apps.content.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
