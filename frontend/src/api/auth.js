import api from "./client";

export const authApi = {
  login: (email, password) => api.post("/auth/login/", { email, password }),
  me: () => api.get("/auth/me/"),
  updateProfile: (data) => api.patch("/auth/profile/", data),
  changePassword: (currentPassword, newPassword) =>
    api.post("/auth/change-password/", {
      current_password: currentPassword,
      new_password: newPassword,
    }),
  // User Registration Update: self-service registration, OTP-verified.
  requestRegistrationOtp: (email) => api.post("/auth/register/request-otp/", { email }),
  verifyRegistrationOtp: (email, code) => api.post("/auth/register/verify-otp/", { email, code }),
  completeRegistration: (data) => api.post("/auth/register/complete/", data),
  // Forgot password: emailed 6-digit code, then a new password.
  requestPasswordResetOtp: (email) => api.post("/auth/password-reset/request-otp/", { email }),
  verifyPasswordResetOtp: (email, code) => api.post("/auth/password-reset/verify-otp/", { email, code }),
  completePasswordReset: (data) => api.post("/auth/password-reset/complete/", data),
};
