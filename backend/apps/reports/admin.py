from django.contrib import admin

from .models import EventPhoto, FollowUpAction, PostEventReport


class FollowUpActionInline(admin.TabularInline):
    model = FollowUpAction
    extra = 0


class EventPhotoInline(admin.TabularInline):
    model = EventPhoto
    extra = 0


@admin.register(PostEventReport)
class PostEventReportAdmin(admin.ModelAdmin):
    list_display = ["event", "status", "created_at"]
    list_filter = ["status"]
    search_fields = ["event__title"]
    inlines = [FollowUpActionInline, EventPhotoInline]
