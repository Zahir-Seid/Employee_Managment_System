import api from "./client";

export const configApi = {
  // Admin management, all options (active + inactive) for a given list_type.
  list: (listType) => api.get("/config-options/", { params: { list_type: listType } }),
  create: (data) => api.post("/config-options/", data),
  update: (id, data) => api.patch(`/config-options/${id}/`, data),
  // Permanent delete (staff request). The backend blocks this with a 400
  // and a clear "used by N existing records" message when the option is
  // still in use, deactivate (update({is_active: false})) remains the
  // safe fallback for retiring an in-use option.
  remove: (id) => api.delete(`/config-options/${id}/`),

  // Public, active options only, grouped by list_type, for populating
  // Event form dropdowns (Thematic Area, Engagement Level, Lead Organization,
  // Region, Category, Support Type, Status, Support Level).
  active: () => api.get("/config-options/active/"),

  // System Settings, singleton (notification emails, photo limits,
  // default Dashboard period).
  getSystemSettings: () => api.get("/system-settings/"),
  updateSystemSettings: (data) => api.patch("/system-settings/", data),
};
