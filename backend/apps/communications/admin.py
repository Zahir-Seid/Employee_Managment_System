from django.contrib import admin

from .models import SupportRequest, TodoItem


class TodoItemInline(admin.TabularInline):
    model = TodoItem
    extra = 0
    readonly_fields = ["support_type", "label"]


@admin.register(SupportRequest)
class SupportRequestAdmin(admin.ModelAdmin):
    list_display = ["event", "created_at"]
    list_filter = []
    search_fields = ["event__title"]
    inlines = [TodoItemInline]


@admin.register(TodoItem)
class TodoItemAdmin(admin.ModelAdmin):
    list_display = ["label", "support_request", "is_done", "completed_at", "completed_by"]
    list_filter = ["is_done", "support_type"]
