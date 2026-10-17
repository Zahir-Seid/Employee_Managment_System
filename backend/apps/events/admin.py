from django.contrib import admin

from .models import Event


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = [
        "title", "category", "owner", "region", "start_date", "end_date",
        "status", "engagement_level", "support_level", "expected_participants",
    ]
    list_filter = ["category", "status", "region", "thematic_area", "engagement_level", "support_level"]
    search_fields = ["title", "venue", "city", "organization_lead_agency", "owner__email"]
    date_hierarchy = "start_date"
    autocomplete_fields = ["owner"]
