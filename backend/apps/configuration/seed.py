"""Default option values for every admin-managed ConfigOption list.

Mirrors the values that used to be hardcoded in the frontend
(utils/locations.js THEMATIC_AREA_OPTIONS / LEAD_ORGANIZATIONS,
utils/format.js ENGAGEMENT_LEVEL_LABELS) and the various enums still kept
on the Event/SupportRequest models for exactly this reference purpose
(EventCategory, EventStatus, SupportLevelChoice, SupportType).

Seeding these is required for the app to work at all on a fresh database:
Category, Status, Support Level, Support Type, Thematic Area, Engagement
Level, and Lead Organization are all validated against this table (see
events/serializers.py, communications/serializers.py) rather than fixed
choices, so an empty table rejects every Event/Support Request submission
with an "invalid value" error that looks like the app itself is broken.

`seed_defaults()` is called from two places so this can never be
forgotten: the `seed_config_options` management command (for anyone who
wants to run/re-run it explicitly) and the `post_migrate` signal handler
in apps.py (so it also runs automatically right after every `migrate` —
including the throwaway test database Django's test runner builds via its
own internal `migrate` call, which is what lets the test suite create
Events/Support Requests without every test file needing its own seed
step).
"""

from .models import ConfigListType

DEFAULTS = {
    ConfigListType.THEMATIC_AREA: [
        "Data and Digital Health",
        "RMNCH",
        "Immunization",
        "Supply Chain",
        "Health Security",
    ],
    ConfigListType.ENGAGEMENT_LEVEL: [
        ("organizer", "Organizer"),
        ("co_organizer", "Co-organizer"),
        ("facilitator", "Facilitator"),
        # Presenter covers speaker, moderator, panelist and presenter.
        ("presenter", "Presenter"),
    ],
    ConfigListType.LEAD_ORGANIZATION: [
        "EE",
        "MOH",
        "EPHI",
        "USAID",
        "WHO",
        "UNICEF",
    ],
    ConfigListType.CATEGORY: [
        ("international", "International"),
        ("national", "National"),
        ("sub_regional", "Sub-national"),
        ("internal", "Internal"),
    ],
    ConfigListType.EVENT_STATUS: [
        # Upcoming/Ongoing/Held are computed from one lifecycle state but each
        # needs its own option so it can be relabelled and reordered.
        ("upcoming", "Upcoming"),
        ("ongoing", "Ongoing"),
        ("held", "Held"),
        ("completed", "Completed"),
        ("postponed", "Postponed"),
        ("cancelled", "Cancelled"),
    ],
    ConfigListType.SUPPORT_LEVEL: [
        ("financial", "Financial"),
        ("technical", "Technical"),
        ("both", "Both"),
    ],
    ConfigListType.SUPPORT_TYPE: [
        ("banner", "Banner"),
        ("photographer", "Photographer"),
        ("videographer", "Videographer"),
        ("branded_materials", "Branded Materials"),
        ("other", "Other"),
    ],
    # "Other" is a UI escape hatch and isn't seeded, like Thematic Area and Lead
    # Organization.
    ConfigListType.REGION: [
        "Addis Ababa",
        "Dire Dawa",
        "Afar",
        "Amhara",
        "Benishangul-Gumuz",
        "Gambela",
        "Harari",
        "Oromia",
        "Sidama",
        "SNNPR",
        "Somali",
        "South West Ethiopia",
        "Tigray",
    ],
}


def seed_defaults():
    """Idempotent: only ever fills in options that don't already exist, so
    it's always safe to call — on every migrate, in every environment,
    even against a database an admin has already customized via the
    Configuration page. Also makes sure the SystemSettings singleton row
    exists (with defaults), so System Settings is never a 404/500 on a
    genuinely fresh database either.
    """
    from .models import ConfigOption, SystemSettings

    created_count = 0
    for list_type, entries in DEFAULTS.items():
        for order, entry in enumerate(entries):
            value, label = entry if isinstance(entry, tuple) else (entry, entry)
            _, created = ConfigOption.objects.get_or_create(
                list_type=list_type,
                value=value,
                defaults={"label": label, "order": order},
            )
            if created:
                created_count += 1

    SystemSettings.get_settings()  # creates the singleton row if missing

    return created_count
