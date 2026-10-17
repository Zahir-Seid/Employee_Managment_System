import api from "./client";

function extractFilename(contentDisposition, fallback) {
  if (!contentDisposition) return fallback;
  const match = contentDisposition.match(/filename="?([^"]+)"?/);
  return match ? match[1] : fallback;
}

async function fetchFile(url, params) {
  try {
    const response = await api.get(url, { params, responseType: "blob" });
    const filename = extractFilename(response.headers["content-disposition"], "EMS_report");
    return { blob: response.data, filename };
  } catch (error) {
    // With responseType: "blob", axios never parses an error response body
    // as JSON, it hands back the raw bytes as an opaque Blob, even for a
    // perfectly ordinary validation error (e.g. "no events match this
    // period/filter combination"). Without unwrapping it here, every
    // failed fetch surfaces as a meaningless generic "Request failed"
    // with zero indication of what actually went wrong.
    const blob = error?.response?.data;
    if (blob instanceof Blob && blob.type.includes("json")) {
      try {
        error.response.data = JSON.parse(await blob.text());
      } catch {
        // Not valid JSON after all, leave the error as-is.
      }
    }
    throw error;
  }
}

function saveBlob(blob, filename) {
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

async function downloadFile(url, params, fallbackFilename) {
  const { blob, filename } = await fetchFile(url, params);
  saveBlob(blob, filename || fallbackFilename);
}

export const reportsApi = {
  // Post-Event Report lifecycle
  getReportForEvent: (eventId) => api.get(`/events/${eventId}/post-event-report/`),
  createReport: (eventId, data) => api.post(`/events/${eventId}/post-event-report/`, data),
  updateReport: (reportId, data) => api.patch(`/post-event-reports/${reportId}/`, data),
  submitReport: (reportId) => api.post(`/post-event-reports/${reportId}/submit/`),
  uploadPhoto: (reportId, file) => {
    const formData = new FormData();
    formData.append("image", file);
    return api.post(`/post-event-reports/${reportId}/photos/`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deletePhoto: (photoId) => api.delete(`/post-event-reports/photos/${photoId}/`),

  // Stage 6: report generation. Sent as `file_format` (not `format`) ,
  // DRF's own content-negotiation reserves `?format=` for its
  // json/browsable-api format-suffix feature, and silently 404s when the
  // value doesn't match one of those (see views_generation.py for the
  // full explanation). Renaming the param avoids that collision entirely.
  preview: (params) => api.get("/reports/preview/", { params }),
  // Fetches the generated file into memory without triggering a browser
  // download, used for the "Generate -> View or Download" flow, where
  // View opens the PDF inline (browsers render PDFs natively) or scrolls
  // to the on-screen preview for Word/Excel (which browsers can't render
  // inline), and Download saves the already-fetched blob without
  // re-fetching it.
  fetchGenerated: ({ format, ...rest }) => fetchFile("/reports/generate/", { ...rest, file_format: format }),
  saveGeneratedFile: saveBlob,
  download: ({ format, ...rest }) => downloadFile("/reports/generate/", { ...rest, file_format: format }, "EMS_report"),
  downloadEventPdf: (eventId, eventTitle) =>
    downloadFile(`/events/${eventId}/pdf/`, null, `${eventTitle || "event"}.pdf`),

  // Organizational Performance Report (phase 1), JSON data endpoint, not
  // a file download; the frontend renders it directly.
  getOrganizationalPerformanceReport: (params) => api.get("/reports/organizational-performance/", { params }),

  // Event Activity Report (Reports Module spec §14, phase 1), same
  // JSON-data-endpoint pattern as the Management Report above.
  getEventActivityReport: (params) => api.get("/reports/event-activity/", { params }),

  // Communications Report (Reports Module spec §15/§16, phase 1)
  getCommunicationsReport: (params) => api.get("/reports/communications/", { params }),

  // Partner Engagement Report (Reports Module spec §17, phase 2)
  getPartnerEngagementReport: (params) => api.get("/reports/partner-engagement/", { params }),

  getAnnualEventReport: (params) => api.get("/reports/annual/", { params }),

  // Excel/PDF export for the Reports Module (spec §32), a dedicated,
  // fresh export pipeline (services/report_export.py) rather than the
  // older Stage 6 fetchGenerated/download above, which builds an
  // entirely different cover-paged document for a single event/period
  // scope. `export_format` (not `format`, same reason as `file_format`
  // above) selects xlsx or pdf; the same filters shown on screen are
  // passed through so the export always matches what's visible.
  exportEventActivityReport: ({ format, ...params }) =>
    downloadFile("/reports/event-activity/", { ...params, export_format: format }, `Event_Activity_Report.${format}`),
  exportCommunicationsReport: ({ format, ...params }) =>
    downloadFile("/reports/communications/", { ...params, export_format: format }, `Communications_Report.${format}`),
  exportPartnerEngagementReport: ({ format, ...params }) =>
    downloadFile(
      "/reports/partner-engagement/",
      { ...params, export_format: format },
      `Partner_Engagement_Report.${format}`
    ),
  exportAnnualEventReport: ({ format, ...params }) =>
    downloadFile("/reports/annual/", { ...params, export_format: format }, `Annual_Event_Report.${format}`),
  exportManagementReport: ({ format, ...params }) =>
    downloadFile(
      "/reports/organizational-performance/",
      { ...params, export_format: format },
      `Management_Report.${format}`
    ),

  // Saved Reports (spec §19), CRUD + duplicate over a saved
  // report_type/filters combination. Opening a saved report is just
  // navigating to that report_type's page with `filters` as the initial
  // filter state (see ReportsHub), nothing special to fetch here for
  // "Open."
  listSavedReports: () => api.get("/reports/saved-reports/"),
  createSavedReport: (data) => api.post("/reports/saved-reports/", data),
  updateSavedReport: (id, data) => api.patch(`/reports/saved-reports/${id}/`, data),
  deleteSavedReport: (id) => api.delete(`/reports/saved-reports/${id}/`),
  duplicateSavedReport: (id) => api.post(`/reports/saved-reports/${id}/duplicate/`),
};
