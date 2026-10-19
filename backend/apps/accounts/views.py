from django.db.models import Q
from django.db.models.deletion import ProtectedError
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.audit.models import ActionType, ObjectType
from apps.audit.utils import log_action
from apps.core.permissions import IsAdminOrLeadership

from .models import Role, User, role_q
from .serializers import (
    ChangePasswordSerializer,
    EMSTokenObtainPairSerializer,
    PasswordResetCompleteSerializer,
    PasswordResetRequestOTPSerializer,
    PasswordResetVerifyOTPSerializer,
    ProfileUpdateSerializer,
    RegistrationCompleteSerializer,
    RegistrationRequestOTPSerializer,
    RegistrationVerifyOTPSerializer,
    SetPasswordSerializer,
    StaffCreateSerializer,
    StaffSerializer,
    UserSerializer,
)
from .throttling import AttemptedUsernameThrottle


class LoginView(TokenObtainPairView):
    """FR1: secure login for all EE staff. Returns access/refresh tokens
    plus the authenticated user's profile so the frontend can render the
    correct sidebar/permissions immediately (UI/UX Section 17).

    Uses the "auth" throttle scope (settings.py) instead of the global
    20/hour anon rate — see that setting's comment for why the default
    was too tight for real login traffic.
    """

    serializer_class = EMSTokenObtainPairSerializer
    # Two independent buckets: "auth" limits one IP (shared office NAT),
    # login_user limits attempts against one *email* no matter where
    # they come from (finding #9 — credential stuffing / password
    # spraying one account). See apps/accounts/throttling.py.
    throttle_classes = [ScopedRateThrottle, AttemptedUsernameThrottle]
    throttle_scope = "auth"
    username_field = EMSTokenObtainPairSerializer.username_field

    def post(self, request, *args, **kwargs):
        # Reimplements TokenObtainPairView.post() instead of wrapping it so the
        # authenticated user is available for the LOGIN audit entry. Logouts
        # are audited at LogoutView (the refresh token gets blacklisted there)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.user
        log_action(
            ActionType.LOGIN,
            user,
            user=user,
            description=f"{user.get_full_name() or user.email} logged in.",
        )
        return Response(serializer.validated_data, status=status.HTTP_200_OK)


class RefreshView(TokenRefreshView):
    """JWT refresh endpoint. Refresh tokens are NOT rotated (see
    settings.SIMPLE_JWT ROTATE_REFRESH_TOKENS=False); theft containment
    relies on every password-mutating flow tapping
    apps.accounts.tokens.blacklist_outstanding_refresh_tokens, which
    revokes all of a user's outstanding refresh tokens the moment their
    credential changes — the token_blacklist app then rejects them on the
    next refresh attempt.

    Same "auth" throttle scope as LoginView, and for the same reason — an
    always-on TV Display screen refreshes its token unattended every
    access-token lifetime, so this endpoint sees steady anonymous traffic
    that the old global anon rate wasn't sized for.
    """
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class LogoutView(APIView):
    """POST /auth/logout/ {"refresh": <token>} — blacklists this session's
    refresh token so it can never be refreshed again.

    Security review finding #6: until now "logout" just meant the client
    discarding its token, so a stolen or saved refresh token kept working
    for its full lifetime. The token_blacklist app already re-checks
    every refresh against the blacklist (finding #1's fix relies on the
    same mechanism); this endpoint is how an end user — not only a
    password change — writes a revocation.

    AllowAny on purpose: the access token may have expired by the time
    the user signs out; possession of the refresh token is the proof.
    "auth" throttle scope, same as login/refresh. Anything wrong with
    the presented token (expired, already blacklisted, malformed,
    missing) still returns a calm 200 — logging out must not fail
    loudly on the way out.
    """
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        raw = request.data.get("refresh")
        if raw:
            try:
                token = RefreshToken(raw)
                token.blacklist()
                user = User.objects.filter(pk=token.get("user_id", "")).first()
                if user:
                    log_action(
                        ActionType.LOGOUT,
                        user,
                        user=user,
                        description=f"{user.get_full_name() or user.email} logged out.",
                    )
            except TokenError:
                pass
        return Response({"detail": "Logged out."}, status=status.HTTP_200_OK)


class MeView(generics.RetrieveAPIView):
    """Returns the currently authenticated user's profile (UI/UX Section 15)."""

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user


class ProfileUpdateView(generics.UpdateAPIView):
    """Allows a user to update their own profile fields only (UI/UX Section 15)."""

    serializer_class = ProfileUpdateSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Password updated successfully."}, status=status.HTTP_200_OK)


def _assert_not_last_admin(instance):
    """Shared by StaffDetailView's perform_update (deactivate/demote) and
    perform_destroy (delete): a deactivated/demoted/deleted account could
    itself have been the only remaining Admin — check against every
    *other* account that could still reach the Configuration/Users pages
    (Admin role or Django superuser), not just a raw role count, since a
    superuser with role=staff still has that access too.
    """
    still_has_access = (
        User.objects.exclude(pk=instance.pk)
        .filter(is_active=True)
        .filter(role_q(Role.ADMIN) | Q(is_superuser=True))
        .exists()
    )
    if not still_has_access:
        raise PermissionDenied(
            "This is the last active account with Admin access. Give another account Admin access first."
        )


class StaffListCreateView(generics.ListCreateAPIView):
    """Admin Page > Staff (item 7.2): list every account and create new
    ones. Same capability as Django admin's User list/add, admin-only.
    """

    queryset = User.objects.all().order_by("last_name", "first_name")
    permission_classes = [IsAdminOrLeadership]
    filterset_fields = ["role", "department", "is_active"]
    search_fields = ["email", "username", "first_name", "last_name"]

    def get_serializer_class(self):
        return StaffCreateSerializer if self.request.method == "POST" else StaffSerializer


class StaffDirectoryView(generics.ListAPIView):
    """Name search over active staff for pickers such as "Operational
    Request to". Open to any signed-in user (the full Staff list above is
    admin-only) and exposes only id, name and email.
    """

    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = User.objects.filter(is_active=True)
        term = (self.request.query_params.get("search") or "").strip()
        for word in term.split():
            qs = qs.filter(Q(first_name__icontains=word) | Q(last_name__icontains=word) | Q(email__icontains=word))
        return qs.order_by("first_name", "last_name")[:20]

    def list(self, request, *args, **kwargs):
        return Response([
            {"id": u.id, "name": u.get_full_name() or u.email, "email": u.email}
            for u in self.get_queryset()
        ])


class StaffDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Edit, deactivate, or permanently delete a single account (Admin
    Page > Users) — brought fully in-app rather than requiring Django's
    own /admin/ site, per that request.

    Delete (staff request, same pattern as ConfigOption/apps/configuration
    /views.py): `Event.owner` is a PROTECTed FK, so the database itself
    refuses to delete a user who owns any events — caught below and
    turned into a clear 400 instead of a raw 500. Every other relation
    (audit log entries, completed to-do items, created config options)
    uses SET_NULL, so those are harmless and don't block deletion.
    Deactivating remains the safe fallback for retiring an account that
    already owns events.
    """

    queryset = User.objects.all()
    serializer_class = StaffSerializer
    permission_classes = [IsAdminOrLeadership]

    def perform_update(self, serializer):
        instance = serializer.instance
        going_inactive = "is_active" in serializer.validated_data and not serializer.validated_data["is_active"]
        going_active = "is_active" in serializer.validated_data and serializer.validated_data["is_active"]
        validated = serializer.validated_data
        new_roles = validated.get("roles") or ([validated["role"]] if "role" in validated else None)
        losing_admin_access = new_roles is not None and Role.ADMIN not in new_roles

        if going_inactive and instance.pk == self.request.user.pk:
            raise PermissionDenied("You can't deactivate your own account.")

        if (going_inactive or (losing_admin_access and instance.is_admin_role)) and not instance.is_superuser:
            _assert_not_last_admin(instance)

        # Legacy: accounts self-registered before approval was removed may still
        # be inactive; enabling one of those notifies the user they can log in.
        newly_approved = instance.self_registered and not instance.is_active and going_active

        old_roles = instance.role_list
        old_labels = instance.roles_display
        old_active = instance.is_active
        serializer.save()

        # Only log real role/activation changes, not no-op PATCHes.
        role_changed = new_roles is not None and set(new_roles) != set(old_roles)
        active_changed = "is_active" in serializer.validated_data and serializer.validated_data["is_active"] != old_active
        if role_changed or active_changed:
            label = instance.get_full_name() or instance.email
            parts = []
            if role_changed:
                parts.append(f"role changed from {old_labels} to {instance.roles_display}")
            if active_changed:
                parts.append("activated" if instance.is_active else "deactivated")
            log_action(
                ActionType.UPDATED,
                instance,
                user=self.request.user,
                description=f"User \"{label}\": {'; '.join(parts)}.",
            )

        if newly_approved:
            from apps.notifications.models import NotificationType
            from apps.notifications.utils import notify_user

            notify_user(
                instance,
                NotificationType.ACCOUNT_APPROVED,
                "Your EMS account has been approved. You can now log in.",
                link="/login",
            )

    def perform_destroy(self, instance):
        if instance.pk == self.request.user.pk:
            raise PermissionDenied("You can't delete your own account.")

        if not instance.is_superuser:
            _assert_not_last_admin(instance)

        label = instance.get_full_name() or instance.email
        instance_id = instance.id
        try:
            instance.delete()
        except ProtectedError:
            event_count = instance.events.count()
            raise ValidationError(
                {
                    "detail": (
                        f"Can't delete \"{label}\" - they own {event_count} event"
                        f"{'s' if event_count != 1 else ''}. Deactivate the account instead: that locks them out "
                        "without breaking the events, reports, and history already tied to them."
                    )
                }
            )
        log_action(
            ActionType.DELETED,
            instance_id,
            user=self.request.user,
            description=f"Deleted user \"{label}\"",
            object_type=ObjectType.USER,
        )


class SetPasswordView(APIView):
    """Admin Page > Users > Reset Password: an admin sets a new password
    for someone else's account directly (no current_password needed,
    unlike self-service ChangePasswordView), matching what Django's own
    /admin/ site offers for a user — brought in-app per that request.
    """

    permission_classes = [IsAdminOrLeadership]

    def post(self, request, pk):
        target_user = generics.get_object_or_404(User, pk=pk)
        serializer = SetPasswordSerializer(data=request.data, context={"target_user": target_user})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log_action(
            ActionType.UPDATED,
            target_user,
            user=request.user,
            description=f"Reset password for \"{target_user.get_full_name() or target_user.email}\"",
            object_type=ObjectType.USER,
        )
        return Response({"detail": "Password reset successfully."}, status=status.HTTP_200_OK)


class RegistrationRequestOTPView(APIView):
    """User Registration Update, step 2-4: person submits their org email;
    we verify the domain, confirm no account already exists, and email a
    one-time code. Public (AllowAny) — this is the very first step of an
    unauthenticated person creating an account, so there's no JWT yet.

    Uses its own throttle scope rather than "auth": this is anonymous,
    per-IP, and specifically about limiting how many verification emails
    a single source can trigger — a much tighter budget than login makes
    sense for (see settings.py's DEFAULT_THROTTLE_RATES for the numbers).
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp_request"

    def post(self, request):
        serializer = RegistrationRequestOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.save()
        return Response(
            {
                "detail": "A verification code has been sent to your email.",
                "expires_in": result["expires_in"],
                "resend_cooldown": result["resend_cooldown"],
            },
            status=status.HTTP_200_OK,
        )


class RegistrationVerifyOTPView(APIView):
    """Step 5-6: person submits the code they received. On success,
    returns the verification_token the frontend must carry into
    RegistrationCompleteView — registration cannot continue without it,
    per the spec's "do not allow registration to continue until the
    organizational email is successfully verified."
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp_verify"

    def post(self, request):
        serializer = RegistrationVerifyOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.save()
        return Response(
            {"detail": "Email verified.", "verification_token": result["verification_token"]},
            status=status.HTTP_200_OK,
        )


class RegistrationCompleteView(generics.CreateAPIView):
    """Step 7-8: the account-details + password form. Always creates an
    active Staff-role account (see RegistrationCompleteSerializer), so no
    Admin approval is needed to log in. Any other role can only be
    assigned afterwards by an Admin on the Users page (StaffDetailView).
    """

    serializer_class = RegistrationCompleteSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp_verify"

    def perform_create(self, serializer):
        user = serializer.save()
        log_action(
            ActionType.CREATED,
            user,
            description=f"Self-registered Staff account created: \"{user.email}\"",
            object_type=ObjectType.USER,
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(
            {"detail": "Your account has been created. You can now log in."},
            status=status.HTTP_201_CREATED,
        )


class PasswordResetRequestOTPView(APIView):
    """Forgot password, step 1: email a 6-digit code (public)."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp_request"

    def post(self, request):
        serializer = PasswordResetRequestOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.save()
        return Response(
            {
                "detail": "If this email has an account, a verification code has been sent to it.",
                "expires_in": result["expires_in"],
                "resend_cooldown": result["resend_cooldown"],
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetVerifyOTPView(APIView):
    """Forgot password, step 2: check the code, return the verification token."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp_verify"

    def post(self, request):
        serializer = PasswordResetVerifyOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.save()
        return Response(
            {"detail": "Email verified.", "verification_token": result["verification_token"]},
            status=status.HTTP_200_OK,
        )


class PasswordResetCompleteView(APIView):
    """Forgot password, step 3: set the new password."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp_verify"

    def post(self, request):
        serializer = PasswordResetCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        log_action(
            ActionType.UPDATED,
            user,
            user=user,
            description=f"Password reset via email verification: \"{user.email}\"",
            object_type=ObjectType.USER,
        )
        return Response({"detail": "Your password has been reset. You can now log in."}, status=status.HTTP_200_OK)
