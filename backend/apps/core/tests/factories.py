"""Shared test data factories. Kept dependency-free (no factory_boy) so the
test suite has no extra requirements beyond what's already in requirements.txt.
"""
from datetime import timedelta

from django.utils import timezone

from apps.accounts.models import Role, User
from apps.events.models import Event, EngagementLevel, EventCategory, EventType, ModeOfEvent, SupportLevelChoice


def make_user(email="user@ee.org", role=Role.STAFF, **kwargs):
    user = User.objects.create_user(
        username=email,
        email=email,
        password="TestPass123!",
        role=role,
        first_name=kwargs.pop("first_name", "Test"),
        last_name=kwargs.pop("last_name", "User"),
        **kwargs,
    )
    return user


def make_staff(email="staff@ee.org", **kwargs):
    return make_user(email=email, role=Role.STAFF, **kwargs)


def make_communications(email="comms@ee.org", **kwargs):
    return make_user(email=email, role=Role.COMMUNICATIONS, **kwargs)


def make_comms_lead(email="commslead@ee.org", **kwargs):
    return make_user(email=email, role=Role.COMMS_LEAD, **kwargs)


def make_leadership(email="lead@ee.org", **kwargs):
    return make_user(email=email, role=Role.LEADERSHIP, **kwargs)


def make_event(owner, category=EventCategory.INTERNAL, needs_comms_support=False, days_from_today=10, **kwargs):
    today = timezone.localdate()
    defaults = {
        "title": "Test Event",
        "description": "A test event description.",
        "start_date": today + timedelta(days=days_from_today),
        "end_date": today + timedelta(days=days_from_today + 1),
        "venue": "Test Venue",
        "city": "Addis Ababa",
        "region": "Addis Ababa",
        "organization_lead_agency": "EE",
        "thematic_area": "Digital Health",
        "event_type": EventType.WORKSHOP,
        "mode_of_event": ModeOfEvent.IN_PERSON,
        "engagement_level": EngagementLevel.ORGANIZER,
        "support_level": SupportLevelChoice.TECHNICAL,
        "personal_objective": "Attend and represent EE.",
        "expected_outcome": "A successful event.",
        "expected_participants": 50,
    }
    defaults.update(kwargs)
    return Event.objects.create(
        owner=owner, category=category, needs_comms_support=needs_comms_support, **defaults
    )


def make_past_event(owner, **kwargs):
    """An event whose end_date has already passed, for Post-Event Report tests (FR29)."""
    return make_event(owner, days_from_today=-10, **kwargs)
