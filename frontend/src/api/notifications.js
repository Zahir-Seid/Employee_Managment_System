import api from "./client";

export const notificationsApi = {
  list: () => api.get("/notifications/"),
  unreadCount: () => api.get("/notifications/unread-count/"),
  markRead: (id) => api.post("/notifications/mark-read/", id ? { id } : {}),
};
