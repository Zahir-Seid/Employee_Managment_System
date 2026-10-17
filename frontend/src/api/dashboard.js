import api from "./client";

export const dashboardApi = {
  get: (params) => api.get("/dashboard/", { params }),
  // Item 24: standalone, always-unfiltered overdue count + list ,
  // scope: "own" (Staff's own events) or "org" (every event).
  getOverdueAlerts: (scope) => api.get("/dashboard/overdue-alerts/", { params: { scope } }),
  // Dashboard Upcoming Events Enhancement, org-wide for every role, List
  // (paginated, {count, next, previous, results}) and Aggregate views,
  // plus the dropdown values for the filter bar. Shared by the Dashboard
  // card (page_size: 5) and the "View All" full page (normal pagination).
  getUpcomingEvents: (params) => api.get("/dashboard/upcoming-events/", { params }),
  getUpcomingEventsAggregate: (params) => api.get("/dashboard/upcoming-events/aggregate/", { params }),
  getUpcomingEventsFilterOptions: () => api.get("/dashboard/upcoming-events/filter-options/"),
  // Big Events section: International/National events, Upcoming or
  // Ongoing only, unpaginated {count, results}.
  getBigEvents: () => api.get("/dashboard/big-events/"),
};

export const auditApi = {
  list: (params) => api.get("/audit-logs/", { params }),
};
