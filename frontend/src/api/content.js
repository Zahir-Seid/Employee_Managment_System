import api from "./client";

// Home Page Dynamic Content Update. Multipart is only needed when a
// photo File is attached (News requires one; Major Event/Announcement
// photos are optional), same pattern as tvDisplay.js's slide payloads.
function toRequestBody(data) {
  if (!(data.image instanceof File)) return { body: data, headers: undefined };
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    formData.append(key, value);
  });
  return { body: formData, headers: { "Content-Type": "multipart/form-data" } };
}

export const contentApi = {
  // Public Home page's one-call read: { site_settings, featured,
  // latest_news, event_photos }. No auth required.
  getHomeFeed: (params) => api.get("/home/feed/", { params }),

  // Manage Content (Communications/Admin). GET is open (paginated? no ,
  // plain array, dataset is small); write is server-gated too.
  listContent: (params) => api.get("/home/content/", { params }),
  createContent: (data) => {
    const { body, headers } = toRequestBody(data);
    return api.post("/home/content/", body, headers && { headers });
  },
  updateContent: (id, data) => {
    const { body, headers } = toRequestBody(data);
    return api.patch(`/home/content/${id}/`, body, headers && { headers });
  },
  deleteContent: (id) => api.delete(`/home/content/${id}/`),

  // The permanent "EE News & Success Stories" KM Resource card.
  getSiteSettings: () => api.get("/home/site-settings/"),
  updateSiteSettings: (data) => api.patch("/home/site-settings/", data),

  // Event picker for Major Event's "link an existing Event" option.
  listLinkableEvents: (q) => api.get("/home/linkable-events/", { params: q ? { q } : undefined }),
};
