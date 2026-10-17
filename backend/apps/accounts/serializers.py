from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from . import registration
from .models import Role, RegistrationOTP, User, primary_role


class EMSTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Custom login serializer (FR1: secure login for all EE staff).

    Authenticates by email (USERNAME_FIELD) and embeds the user's role
    directly in the JWT payload so the frontend can route/gate navigation
    (UI/UX Section 17) without an extra round trip, while the backend still
    re-validates the role server-side on every request via permission classes.
    """

    username_field = User.USERNAME_FIELD

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["roles"] = user.role_list
        token["full_name"] = user.get_full_name() or user.username
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    role_display = serializers.CharField(source="roles_display", read_only=True)
    roles = serializers.ListField(source="role_list", read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "email", "username", "title", "first_name", "last_name", "full_name",
            "role", "roles", "role_display", "position", "department", "profile_picture",
            "is_active", "is_superuser", "date_joined",
        ]
        read_only_fields = ["id", "role", "roles", "is_active", "is_superuser", "date_joined", "username"]


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """Restricted serializer for the Profile page (UI/UX Section 15):
    users may update their own name/position/department/picture, but never
    their own role — role changes are an administrative action outside v1
    scope (Section 14, deferred).
    """

    class Meta:
        model = User
        fields = ["first_name", "last_name", "position", "department", "profile_picture"]


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        validate_password(value)
        return value

    def save(self, **kwargs):
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user


class StaffSerializer(serializers.ModelSerializer):
    """Admin-facing (Configuration > Staff): unlike UserSerializer above,
    role/department/position/is_active are all writable here — this is
    exactly the capability an Admin already has via Django's built-in
    /admin/ site (apps/accounts/admin.py UserAdmin), brought into the
    app's own Admin page per that request. Self-service ProfileUpdateSerializer
    stays locked down to name/position/department/picture only; this one
    is a separate, admin-only surface.
    """

    full_name = serializers.CharField(source="get_full_name", read_only=True)
    role_display = serializers.CharField(source="roles_display", read_only=True)
    # All roles the user holds; writable. `role` stays as the main role.
    roles = serializers.ListField(
        child=serializers.ChoiceField(choices=Role.choices), required=False, allow_empty=False
    )

    class Meta:
        model = User
        fields = [
            "id", "email", "username", "title", "first_name", "last_name", "full_name",
            "role", "roles", "role_display", "position", "department", "is_active",
            "is_superuser", "date_joined", "self_registered",
        ]
        read_only_fields = ["id", "is_superuser", "date_joined", "self_registered"]

    def validate_email(self, value):
        qs = User.objects.filter(email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def _sync_superuser_from_role(self, user):
        # Keep is_superuser in step with role=Admin in both directions, so Admins
        # can use Django's /admin/ and demoted users lose that access.
        is_admin = user.has_role(Role.ADMIN)
        if user.is_superuser != is_admin:
            user.is_superuser = is_admin
            user.is_staff = is_admin  # Django's own /admin/ site login also requires this.
            user.save(update_fields=["is_superuser", "is_staff"])

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["roles"] = instance.role_list
        return data

    def _normalize_roles(self, validated_data):
        # Keep `role` (main role) and `roles` (all roles) consistent.
        if "roles" in validated_data:
            roles = list(dict.fromkeys(validated_data["roles"]))
            validated_data["roles"] = roles
            validated_data["role"] = primary_role(roles)
        elif "role" in validated_data:
            validated_data["roles"] = [validated_data["role"]]

    def create(self, validated_data):
        self._normalize_roles(validated_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        self._normalize_roles(validated_data)
        user = super().update(instance, validated_data)
        self._sync_superuser_from_role(user)
        return user


class SetPasswordSerializer(serializers.Serializer):
    """Admin-initiated password reset (Admin Page > Users): unlike
    ChangePasswordSerializer above, no current_password is required —
    the admin is setting it on someone else's behalf, matching Django
    admin's own "set password" form for a user.
    """

    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        validate_password(value, user=self.context.get("target_user"))
        return value

    def save(self, **kwargs):
        user = self.context["target_user"]
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user


class StaffCreateSerializer(StaffSerializer):
    """Same fields as StaffSerializer, plus the one thing account creation
    needs that editing doesn't: a password. Uses Django's full
    validate_password (matches whatever password policy is configured,
    same as self-service Change Password) rather than a hand-rolled check.
    """

    password = serializers.CharField(write_only=True, min_length=8)

    class Meta(StaffSerializer.Meta):
        fields = StaffSerializer.Meta.fields + ["password"]

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("A user with this username already exists.")
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        self._normalize_roles(validated_data)
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        self._sync_superuser_from_role(user)
        return user


class RegistrationRequestOTPSerializer(serializers.Serializer):
    """Step 2-4 of the flow: person enters their org email, we check the
    domain and that no account already exists for it, then send the OTP.
    """

    email = serializers.EmailField()

    def validate_email(self, value):
        email = registration.normalize_email(value)
        if not registration.is_domain_allowed(email):
            raise serializers.ValidationError(
                "Registration is only open to official EE organizational email addresses."
            )
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists — log in instead.")
        return email

    def save(self):
        try:
            expires_in, cooldown_seconds = registration.request_otp(self.validated_data["email"])
        except registration.OTPError as exc:
            raise serializers.ValidationError({"detail": str(exc)})
        return {"expires_in": expires_in, "resend_cooldown": cooldown_seconds}


class RegistrationVerifyOTPSerializer(serializers.Serializer):
    """Step 5-6: person enters the code they received. On success returns
    a verification_token the frontend carries into the final step —
    without it, RegistrationCompleteSerializer refuses to create the
    account (see registration.check_verification_token), so this step
    can't be skipped no matter what the frontend sends afterward.
    """

    email = serializers.EmailField()
    code = serializers.CharField(max_length=6, min_length=6)

    def save(self):
        email = registration.normalize_email(self.validated_data["email"])
        try:
            token = registration.verify_otp(email, self.validated_data["code"])
        except registration.OTPError as exc:
            raise serializers.ValidationError({"detail": str(exc)})
        return {"verification_token": token}


class PasswordResetRequestOTPSerializer(serializers.Serializer):
    """Forgot password, step 1: email a 6-digit code. Same response whether
    or not the email has an account, so it can't be used to find accounts.
    """

    email = serializers.EmailField()

    def save(self):
        try:
            expires_in, cooldown_seconds = registration.request_password_reset_otp(self.validated_data["email"])
        except registration.OTPError as exc:
            raise serializers.ValidationError({"detail": str(exc)})
        return {"expires_in": expires_in, "resend_cooldown": cooldown_seconds}


class PasswordResetVerifyOTPSerializer(serializers.Serializer):
    """Forgot password, step 2: check the code; returns a verification_token
    that the final step requires.
    """

    email = serializers.EmailField()
    code = serializers.CharField(max_length=6, min_length=6)

    def save(self):
        email = registration.normalize_email(self.validated_data["email"])
        if registration.get_resettable_user(email) is None:
            raise serializers.ValidationError({"detail": "Incorrect code. Please check it and try again."})
        try:
            token = registration.verify_otp(email, self.validated_data["code"])
        except registration.OTPError as exc:
            raise serializers.ValidationError({"detail": str(exc)})
        return {"verification_token": token}


class PasswordResetCompleteSerializer(serializers.Serializer):
    """Forgot password, step 3: set the new password, only with a valid
    verification_token from step 2.
    """

    email = serializers.EmailField()
    verification_token = serializers.CharField(write_only=True)
    password = serializers.CharField(write_only=True, min_length=8)

    def validate(self, attrs):
        email = registration.normalize_email(attrs["email"])
        try:
            registration.check_verification_token(email, attrs["verification_token"])
        except registration.OTPError as exc:
            raise serializers.ValidationError({"detail": str(exc)})
        user = registration.get_resettable_user(email)
        if user is None:
            raise serializers.ValidationError({"detail": "Email verification is required before resetting your password."})
        validate_password(attrs["password"], user)
        attrs["email"] = email
        attrs["user"] = user
        return attrs

    def save(self):
        user = self.validated_data["user"]
        user.set_password(self.validated_data["password"])
        user.save(update_fields=["password"])
        # Remove the code so it can't be reused.
        RegistrationOTP.objects.filter(email=self.validated_data["email"]).delete()
        return user


class RegistrationCompleteSerializer(serializers.ModelSerializer):
    """Step 7-8: the account information + password form, only reachable
    with a still-valid verification_token from the step above. Always
    creates an active Staff-role account (no Admin approval needed) —
    role/activation are deliberately not fields here, unlike
    StaffCreateSerializer, so a self-registering user can never grant
    themselves anything beyond the lowest-privilege starting point.
    """

    email = serializers.EmailField()
    verification_token = serializers.CharField(write_only=True)
    password = serializers.CharField(write_only=True, min_length=8)
    title = serializers.ChoiceField(choices=["Mr", "Mrs", "Ms", "Dr", "Prof"])
    sex = serializers.ChoiceField(choices=["Female", "Male"])

    class Meta:
        model = User
        fields = [
            "email", "verification_token", "title", "first_name", "middle_name", "last_name", "sex", "password",
        ]
        extra_kwargs = {"middle_name": {"required": False, "allow_blank": True}}

    def validate(self, attrs):
        email = registration.normalize_email(attrs["email"])
        try:
            registration.check_verification_token(email, attrs["verification_token"])
        except registration.OTPError as exc:
            raise serializers.ValidationError({"detail": str(exc)})
        # Re-check in case the allow-list or account state changed since OTP
        # verification.
        if not registration.is_domain_allowed(email):
            raise serializers.ValidationError(
                {"email": "Registration is only open to official EE organizational email addresses."}
            )
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError({"email": "An account with this email already exists."})
        attrs["email"] = email
        return attrs

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        validated_data.pop("verification_token")
        password = validated_data.pop("password")
        email = validated_data["email"]
        user = User(
            **validated_data,
            username=registration.generate_username(email),
            role=Role.STAFF,
            is_active=True,
            self_registered=True,
        )
        user.set_password(password)
        user.save()
        # Remove the OTP so it can't be reused.
        RegistrationOTP.objects.filter(email=email).delete()
        return user
