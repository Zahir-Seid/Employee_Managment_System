import api from "./client";

// TV Display Settings, singleton, same shape as configApi's System
// Settings. GET is any authenticated user; PATCH is Admin/Leadership only
// (enforced server-side too).

// Slide payloads (create/update) are plain JSON unless they contain a
// `photo` File (Staff Spotlight/Celebrations/Announcements, Phase 27/29/
// 26), in that case the whole payload has to go as multipart/form-data
// in one request instead, same as apps/reports's photo upload pattern.
function toRequestBody(data) {
  if (!(data.photo instanceof File)) return { body: data, headers: undefined };
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    formData.append(key, value);
  });
  return { body: formData, headers: { "Content-Type": "multipart/form-data" } };
}

export const tvDisplayApi = {
  getSettings: () => api.get("/tv-display/settings/"),
  updateSettings: (data) => api.patch("/tv-display/settings/", data),
  // Manually-added slides for the 5 non-automatic sections (Staff
  // Spotlight, Celebrations, Announcements, Recognitions, Quick
  // Information). GET is any authenticated user (paginated, {count,
  // next, previous, results}); write is Communications/Admin only,
  // enforced server-side too (see IsCommunicationsOrAdmin).
  listSlides: (params) => api.get("/tv-display/slides/", { params }),
  createSlide: (data) => {
    const { body, headers } = toRequestBody(data);
    return api.post("/tv-display/slides/", body, headers && { headers });
  },
  updateSlide: (id, data) => {
    const { body, headers } = toRequestBody(data);
    return api.patch(`/tv-display/slides/${id}/`, body, headers && { headers });
  },
  deleteSlide: (id) => api.delete(`/tv-display/slides/${id}/`),
  // Admin-created queues beyond the fixed sections (e.g. "Live
  // Announcement"), Communications/Admin only, same as slide
  // management. Each call returns the full, updated TVDisplaySettings
  // payload so the caller can just replace its local `settings` state.
  createCustomSection: (label) => api.post("/tv-display/custom-sections/", { label }),
  renameCustomSection: (key, label) => api.patch(`/tv-display/custom-sections/${key}/`, { label }),
  deleteCustomSection: (key) => api.delete(`/tv-display/custom-sections/${key}/`),
};
