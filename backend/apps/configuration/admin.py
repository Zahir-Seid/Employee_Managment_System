from django.contrib import admin

from .models import ConfigOption


@admin.register(ConfigOption)
class ConfigOptionAdmin(admin.ModelAdmin):
    list_display = ["label", "list_type", "value", "order", "is_active", "created_by"]
    list_filter = ["list_type", "is_active"]
    search_fields = ["label", "value"]
    ordering = ["list_type", "order", "label"]
