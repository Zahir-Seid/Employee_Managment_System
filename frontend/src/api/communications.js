import api from "./client";

export const communicationsApi = {
  getSupportRequestForEvent: (eventId) => api.get(`/events/${eventId}/support-request/`),
  createSupportRequest: (eventId, data) => api.post(`/events/${eventId}/support-request/`, data),
  listSupportRequests: (params) => api.get("/support-requests/", { params }),
  retrieveSupportRequest: (id) => api.get(`/support-requests/${id}/`),
  toggleTodoItem: (todoItemId, data) => api.patch(`/support-requests/todo-items/${todoItemId}/`, data),
  deleteTodoItem: (todoItemId) => api.delete(`/support-requests/todo-items/${todoItemId}/`),
  getCalendar: (params) => api.get("/calendar/", { params }),
  // Calendar quick-add notes: a title saved on a date.
  listCalendarNotes: () => api.get("/calendar/notes/"),
  createCalendarNote: (data) => api.post("/calendar/notes/", data),
  deleteCalendarNote: (noteId) => api.delete(`/calendar/notes/${noteId}/`),
  // Item 3: durable list of Postponed/Cancelled events for Comms, not
  // limited to events that have an actual Support Request.
  listPostponedCancelledEvents: () => api.get("/postponed-cancelled-events/"),

  // Support Requests Enhancement: Overview tab, and Lead-only assignment
  // / status-progression actions on the requests tab.
  getOverview: () => api.get("/comms-overview/"),
  listCommunicationsTeam: () => api.get("/communications-team/"),
  assignSupportRequest: (id, userIds) => api.patch(`/support-requests/${id}/assign/`, { assigned_to: userIds }),
  // Messages & Clarifications: the conversation attached to a request.
  listSupportRequestMessages: (id) => api.get(`/support-requests/${id}/messages/`),
  // Multipart so a message can carry attachments (max 5 files, 10 MB each).
  postSupportRequestMessage: (id, { body = "", replyTo = null, isClarification = false, files = [] } = {}) => {
    const form = new FormData();
    form.append("body", body);
    if (replyTo) form.append("reply_to", replyTo);
    form.append("is_clarification_request", isClarification ? "true" : "false");
    files.forEach((f) => form.append("attachments", f));
    return api.post(`/support-requests/${id}/messages/`, form);
  },
  // Clears this user's unread badge/divider (up_to = newest message seen).
  markSupportRequestMessagesRead: (id, upTo) =>
    api.post(`/support-requests/${id}/messages/read/`, upTo ? { up_to: upTo } : {}),
  // Attachments are private: fetched with the auth header, never a public URL.
  fetchAttachmentBlob: (path) => api.get(path, { responseType: "blob" }),
  updateSupportRequestStatus: (id, status) => api.patch(`/support-requests/${id}/status/`, { status }),

  // Item 7.3 (Admin Page > Communications): full CRUD across every
  // Support Request, not scoped to "requests I need to action."
  adminList: (params) => api.get("/admin/support-requests/", { params }),
  adminCreate: (data) => api.post("/admin/support-requests/", data),
  adminUpdate: (id, data) => api.patch(`/admin/support-requests/${id}/`, data),
  adminDelete: (id) => api.delete(`/admin/support-requests/${id}/`),
};
