from django.urls import path

from .views import (
    ChangePasswordView,
    LoginView,
    LogoutView,
    MeView,
    PasswordResetCompleteView,
    PasswordResetRequestOTPView,
    PasswordResetVerifyOTPView,
    ProfileUpdateView,
    RefreshView,
    RegistrationCompleteView,
    RegistrationRequestOTPView,
    RegistrationVerifyOTPView,
    SetPasswordView,
    StaffDetailView,
    StaffDirectoryView,
    StaffListCreateView,
)

app_name = "accounts"

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("refresh/", RefreshView.as_view(), name="refresh"),
    path("me/", MeView.as_view(), name="me"),
    path("profile/", ProfileUpdateView.as_view(), name="profile-update"),
    path("change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("staff-directory/", StaffDirectoryView.as_view(), name="staff-directory"),
    path("staff/", StaffListCreateView.as_view(), name="staff-list"),
    path("staff/<uuid:pk>/", StaffDetailView.as_view(), name="staff-detail"),
    path("staff/<uuid:pk>/set-password/", SetPasswordView.as_view(), name="staff-set-password"),
    # User Registration Update
    path("register/request-otp/", RegistrationRequestOTPView.as_view(), name="register-request-otp"),
    path("register/verify-otp/", RegistrationVerifyOTPView.as_view(), name="register-verify-otp"),
    path("register/complete/", RegistrationCompleteView.as_view(), name="register-complete"),
    path("password-reset/request-otp/", PasswordResetRequestOTPView.as_view(), name="password-reset-request-otp"),
    path("password-reset/verify-otp/", PasswordResetVerifyOTPView.as_view(), name="password-reset-verify-otp"),
    path("password-reset/complete/", PasswordResetCompleteView.as_view(), name="password-reset-complete"),
]
