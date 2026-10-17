import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Q


class Role(models.TextChoices):
    """The three roles defined by FR2, plus Admin (added on request): a
    4th role for the person who manages the admin-only Configuration page
    (dropdown lists, System Settings). Admin also carries full Staff-level
    day-to-day permissions (create/manage their own events) rather than
    being configuration-only — the reasoning: this person logs into the
    app normally day to day like anyone else, and only occasionally needs
    the Configuration page, so a second/separate account for daily use
    would just be friction. See apps/core/permissions.py for exactly
    where Admin is treated as "at least Staff" vs. "Configuration-gate".

    Support Requests Enhancement: added a 5th role, Communications Lead —
    the one person on the Communications team who assigns Support
    Requests (and individual items within them) to Communications staff,
    including themselves. A Comms Lead is still a full Communications
    team member everywhere Communications already had access (Support
    Requests, Calendar, TV Display slides, the Communications Report,
    etc. — see User.is_communications below and every permission class in
    apps/core/permissions.py that checks it); COMMS_LEAD is additive, not
    a replacement for COMMUNICATIONS, so existing Communications accounts
    are entirely unaffected unless deliberately switched to this new role.
    """

    STAFF = "staff", "Staff"
    COMMUNICATIONS = "communications", "Communications"
    COMMS_LEAD = "comms_lead", "Communications Lead"
    LEADERSHIP = "leadership", "Leadership/SMT"
    ADMIN = "admin", "Admin"


# Order used to pick the "main" role (the legacy single `role` column) when a
# user holds several roles.
ROLE_PRIORITY = [Role.ADMIN, Role.COMMS_LEAD, Role.COMMUNICATIONS, Role.LEADERSHIP, Role.STAFF]


def primary_role(roles):
    for r in ROLE_PRIORITY:
        if r in roles:
            return r.value
    return Role.STAFF.value


def role_q(*roles):
    """Q matching users that hold ANY of the given roles (main role or extra roles)."""
    q = Q(role__in=roles)
    # `roles` is a short list, so check each position. (JSONField
    # `contains` is not supported on SQLite and made event creation fail
    # with HTTP 500; indexed lookups work on SQLite and PostgreSQL alike.)
    for i in range(len(Role.values)):
        for r in roles:
            q |= Q(**{f"roles__{i}": r})
    return q


class User(AbstractUser):
    """Custom user model. Extends Django's AbstractUser with the role field
    required for role-based access control (FR1, FR2, FR47, FR48) and the
    profile fields shown on the Profile page (UI/UX Section 15).

    UUID primary key keeps user identifiers consistent with every other
    entity in the system and avoids leaking sequential user counts via
    the API.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    # Required (unlike AbstractUser) since Communications pages display the
    # owner's full name.
    # Chosen at registration (Mr, Mrs, Ms, Dr, Prof); blank for older accounts.
    title = models.CharField(max_length=10, blank=True, default="")
    first_name = models.CharField(max_length=150, blank=False)
    last_name = models.CharField(max_length=150, blank=False)
    # Optional; collected at registration, between first and last name.
    middle_name = models.CharField(max_length=150, blank=True, default="")
    # Chosen at registration (Female / Male); blank for older accounts.
    sex = models.CharField(max_length=10, blank=True, default="")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.STAFF)
    # Every role the user holds (a user can have several; access is the union).
    # `role` above stays as the main role for display and older code paths.
    roles = models.JSONField(default=list, blank=True)
    position = models.CharField(max_length=150, blank=True)
    department = models.CharField(max_length=150, blank=True)
    profile_picture = models.ImageField(upload_to="profile_pictures/", blank=True, null=True)
    # Label only; self-registered accounts are active Staff accounts straight
    # away. Any other role is assigned later by an Admin.
    # `is_active` does all the gating.
    self_registered = models.BooleanField(default=False)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    class Meta:
        ordering = ["last_name", "first_name"]

    def save(self, *args, **kwargs):
        # Keep `role` (main role) and `roles` (all roles) in step.
        if not self.roles:
            self.roles = [self.role]
        elif self.role not in self.roles:
            # `role` was changed on its own (older code path): it wins.
            self.roles = [self.role]
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.get_full_name() or self.username} ({self.roles_display})"

    @property
    def role_list(self):
        roles = list(self.roles or [])
        if self.role not in roles:
            roles.append(self.role)
        return roles

    @property
    def roles_display(self):
        labels = dict(Role.choices)
        return ", ".join(labels.get(r, r) for r in self.role_list)

    def has_role(self, *roles):
        return any(r in self.role_list for r in roles)

    @property
    def is_staff_only(self):
        """Staff and nothing broader: the only case limited to their own events."""
        return set(self.role_list) == {Role.STAFF.value}

    @property
    def is_plain_communications(self):
        """Communications team member without Lead/Admin/Leadership access."""
        return self.has_role(Role.COMMUNICATIONS) and not self.has_role(
            Role.COMMS_LEAD, Role.ADMIN, Role.LEADERSHIP
        )

    @property
    def is_admin_role(self):
        return self.has_role(Role.ADMIN)

    @property
    def is_staff_role(self):
        # Admin has Staff-level permissions plus Configuration access.
        return self.has_role(Role.STAFF, Role.ADMIN)

    @property
    def is_communications(self):
        return self.has_role(Role.COMMUNICATIONS, Role.COMMS_LEAD)

    @property
    def is_communications_lead(self):
        return self.has_role(Role.COMMS_LEAD)

    @property
    def is_leadership(self):
        return self.has_role(Role.LEADERSHIP)


class RegistrationOTP(models.Model):
    """User Registration Update: one row per in-progress self-registration,
    keyed by the (lowercased) email being verified. Overwritten in place
    on every request-otp / resend rather than accumulating history rows —
    there is never more than one *live* code for a given email, and
    nothing downstream needs the old ones once superseded.

    Never stores the OTP itself, only a salted hash of it (see
    apps.accounts.registration.hash_otp) — the same reasoning as never
    storing a plaintext password. `verification_token` is a second,
    separate secret issued only after the OTP is verified: it's what
    RegistrationCompleteSerializer actually trusts, so a guessed/leaked
    OTP six-digit code alone is never enough to create an account — the
    email step and the "fill in the rest of the form" step are bound
    together by this token rather than by the OTP surviving that whole
    window.
    """

    email = models.EmailField(unique=True)
    code_hash = models.CharField(max_length=64)
    attempts = models.PositiveSmallIntegerField(default=0)
    is_verified = models.BooleanField(default=False)
    verification_token = models.CharField(max_length=64, blank=True, default="")
    expires_at = models.DateTimeField()
    verification_token_expires_at = models.DateTimeField(null=True, blank=True)
    last_sent_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"OTP for {self.email} ({'verified' if self.is_verified else 'unverified'})"
