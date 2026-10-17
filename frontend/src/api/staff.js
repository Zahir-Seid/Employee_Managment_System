import api from "./client";

export const staffApi = {
  list: (params) => api.get("/auth/staff/", { params }),
  // Name search over active staff, open to every signed-in user (used by
  // pickers like Operational Request "To").
  directory: (params) => api.get("/auth/staff-directory/", { params }),
  get: (id) => api.get(`/auth/staff/${id}/`),
  create: (data) => api.post("/auth/staff/", data),
  update: (id, data) => api.patch(`/auth/staff/${id}/`, data),
  // Permanent delete (staff request, brought in-app rather than requiring
  // Django's own /admin/ site). The backend blocks this with a clear 400
  // if the account owns any events, deactivate (update({is_active:
  // false})) remains the safe fallback for an account that already does.
  remove: (id) => api.delete(`/auth/staff/${id}/`),
  // Admin-initiated password reset, no current password needed, unlike
  // the self-service change-password flow.
  setPassword: (id, newPassword) => api.post(`/auth/staff/${id}/set-password/`, { new_password: newPassword }),
};
