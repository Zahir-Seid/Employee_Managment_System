from django.contrib import admin

from .models import HomeContent, SiteSettings


@admin.register(HomeContent)
class HomeContentAdmin(admin.ModelAdmin):
    list_display = ["title", "content_type", "is_published", "is_active", "is_featured", "created_at"]
    list_filter = ["content_type", "is_published", "is_active", "is_featured"]
    search_fields = ["title", "description"]


@admin.register(SiteSettings)
class SiteSettingsAdmin(admin.ModelAdmin):
    list_display = ["km_resource_title", "km_resource_url", "updated_at"]
