import api from "./client";

export const auditApi = {
  list: (params) => api.get("/audit-logs/", { params }),
};
