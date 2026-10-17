import api from "./client";

export const eventsApi = {
  list: (params) => api.get("/events/", { params }),
  retrieve: (id) => api.get(`/events/${id}/`),
  create: (data) => api.post("/events/", data),
  update: (id, data) => api.patch(`/events/${id}/`, data),
  // Item 4: Postpone/Cancel/Reopen as dedicated lifecycle actions,
  // separate from the regular edit, action: "postpone"|"cancel"|"reopen".
  statusAction: (id, action, reason, dates) =>
    api.post(`/events/${id}/status-action/`, { action, reason, ...dates }),
  // Item 5: this event's full history (edits, postpones, cancels, reopens).
  history: (id) => api.get(`/events/${id}/history/`),

  // Item 7.4 (Admin Page > Events): full visibility + write access to any
  // event, not scoped to "my own", the Admin Page equivalent of the
  // endpoints above.
  adminList: (params) => api.get("/events/admin/", { params }),
  adminCreate: (data) => api.post("/events/admin/", data),
  adminRetrieve: (id) => api.get(`/events/admin/${id}/`),
  adminUpdate: (id, data) => api.patch(`/events/admin/${id}/`, data),
  adminStatusAction: (id, action, reason, dates) =>
    api.post(`/events/admin/${id}/status-action/`, { action, reason, ...dates }),

  // Big Events (Dashboard): admin-only cover photo, uploaded/cleared
  // separately from the rest of an event's edit form (see
  // EventAdminDetailPanel's Photo tab).
  adminUploadBigEventPhoto: (id, file) => {
    const formData = new FormData();
    formData.append("big_event_photo", file);
    return api.patch(`/events/admin/${id}/`, formData, { headers: { "Content-Type": "multipart/form-data" } });
  },
  adminClearBigEventPhoto: (id) => api.patch(`/events/admin/${id}/`, { big_event_photo: null }),
};
