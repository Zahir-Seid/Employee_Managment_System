from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    ordering = ["last_name", "first_name"]
    list_display = ["email", "username", "first_name", "last_name", "role", "department", "is_active"]
    list_filter = ["role", "department", "is_active"]
    search_fields = ["email", "username", "first_name", "last_name"]

    fieldsets = DjangoUserAdmin.fieldsets + (
        ("EMS Profile", {"fields": ("role", "position", "department", "profile_picture")}),
    )
    add_fieldsets = DjangoUserAdmin.add_fieldsets + (
        (
            "EMS Profile",
            {
                # Bug fix: first_name/last_name are required at the model
                # level (blank=False — this is what displays as the event
                # owner's name throughout the app), but Django's default
                # add_fieldsets only asks for username + password. That
                # meant the one form that actually creates a brand-new
                # account never asked for a name at all — only editing an
                # *existing* user (the fieldsets above) enforced it.
                "fields": ("first_name", "last_name", "email", "role", "position", "department"),
            },
        ),
    )
