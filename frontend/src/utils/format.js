export const CATEGORY_LABELS = {
  international: "International",
  national: "National",
  sub_regional: "Sub-national",
  internal: "Internal",
};

export const EVENT_STATUS_LABELS = {
  logged: "Ongoing",
  upcoming: "Upcoming",
  ongoing: "Ongoing",
  held: "Held",
  postponed: "Postponed",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const EVENT_TYPE_LABELS = {
  training: "Training",
  workshop: "Workshop",
  conference: "Conference",
  supportive_supervision: "Supportive Supervision",
  rm: "Review Meeting",
  other: "Other",
};

// One-line explanation shown under the Event Type box for the chosen type.
export const EVENT_TYPE_DESCRIPTIONS = {
  training: "A structured session to build participants' skills and knowledge on a specific topic.",
  workshop: "An interactive working session where participants discuss, develop or review a specific output together.",
  conference: "A larger gathering for presentations, panel discussions and knowledge sharing among many participants.",
  supportive_supervision:
    "A visit or session where supervisors give on-site guidance, coaching and feedback to improve performance.",
  rm: "A meeting to assess progress, results and challenges against plans and agree next steps.",
  other: "Any event that doesn't fit the types above.",
};

// Second step for a Review Meeting.
export const REVIEW_MEETING_TYPE_LABELS = {
  annual: "Annual",
  mid_term: "Mid-term",
};
export const REVIEW_MEETING_TYPE_DESCRIPTIONS = {
  annual: "Yearly review of overall progress and results against the annual plan.",
  mid_term: "Mid-year check on progress, with time to adjust plans for the rest of the period.",
};

// Event Type dropdown entries. Review Meeting appears twice, one per kind
// ("Review Meeting (Annual)"); they are stored as event_type "rm" plus
// review_meeting_type, and use the values rm_annual / rm_mid_term in the
// dropdowns and report filters.
export const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPE_LABELS).flatMap(([code, label]) =>
  code === "rm"
    ? Object.entries(REVIEW_MEETING_TYPE_LABELS).map(([kind, kindLabel]) => ({
        value: `rm_${kind}`,
        label: `${label} (${kindLabel})`,
      }))
    : [{ value: code, label }]
);

export function eventTypeOptionValue({ event_type, review_meeting_type }) {
  return event_type === "rm" ? `rm_${review_meeting_type || ""}` : event_type;
}

export function splitEventTypeOption(value) {
  return value.startsWith("rm_")
    ? { event_type: "rm", review_meeting_type: value.slice(3) }
    : { event_type: value, review_meeting_type: "" };
}

// "Review Meeting \u2013 Annual", "Other: Site visit", or just the type name.
export function formatEventType(event) {
  if (!event) return "-";
  if (event.event_type_label) return event.event_type_label;
  const base = EVENT_TYPE_LABELS[event.event_type] || event.event_type || "-";
  if (event.event_type === "rm" && event.review_meeting_type) {
    return `${base} \u2013 ${REVIEW_MEETING_TYPE_LABELS[event.review_meeting_type] || event.review_meeting_type}`;
  }
  if (event.event_type === "other" && event.event_type_other) return `${base}: ${event.event_type_other}`;
  return base;
}

export const MODE_OF_EVENT_LABELS = {
  in_person: "In-person",
  virtual: "Virtual",
};

// Lead Organization values that come from the Configuration admin page are
// auto-slugified to lowercase (e.g. "EE" -> "ee"), while seeded/legacy
// data uses the exact "EE" string, so every "is this EE?" check needs to
// be case-insensitive rather than an exact string match, or it silently
// breaks the moment someone re-adds "EE" through the Configuration UI.
export function isEE(organizationLeadAgency) {
  return (organizationLeadAgency || "").trim().toUpperCase() === "EE";
}

export const CATEGORY_RAIL_CLASS = {
  international: "category-rail-international",
  national: "category-rail-national",
  sub_regional: "category-rail-regional",
  internal: "category-rail-internal",
};

export const CATEGORY_DOT_CLASS = {
  international: "bg-category-international",
  national: "bg-category-national",
  sub_regional: "bg-category-regional",
  internal: "bg-category-internal",
};

export const CATEGORY_TEXT_CLASS = {
  international: "text-category-international",
  national: "text-category-national",
  sub_regional: "text-category-regional",
  internal: "text-category-internal",
};

export const ENGAGEMENT_LEVEL_LABELS = {
  organizer: "Organizer",
  co_organizer: "Co-organizer",
  facilitator: "Facilitator",
  presenter: "Presenter",
  // Retired options, kept so older events still show a proper label.
  invited_participant: "Invited Participant",
  speaker: "Speaker",
  panelist: "Panelist",
};

// Shown under the Engagement Level dropdown once an option is chosen.
export const ENGAGEMENT_LEVEL_DESCRIPTIONS = {
  organizer:
    "EE leads and owns this event, including planning and delivery. EE's contribution may be financial, technical, or both.",
  co_organizer:
    "EE organizes this event jointly with another organization and shares responsibility for it. EE's contribution may be financial, technical, or both.",
  facilitator:
    "EE guides or runs the sessions, discussions, or training, and may also provide financial support, technical support, or both.",
  presenter: "EE takes part on the programme as a speaker, moderator, panelist, or presenter.",
};

export const SUPPORT_LEVEL_LABELS = {
  financial: "Financial",
  technical: "Technical",
  both: "Both",
};

export const SUPPORT_TYPE_LABELS = {
  banner: "Banner",
  photographer: "Photographer",
  videographer: "Videographer",
  branded_materials: "Branded Materials",
  other: "Other",
};

export function formatDate(dateStr) {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateRange(start, end) {
  if (!start || !end) return "N/A";
  if (start === end) return formatDate(start);
  return `${formatDate(start)} to ${formatDate(end)}`;
}

export function formatDateTime(dateStr) {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function firstMessage(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      const innerKey = Object.keys(first)[0];
      if (innerKey) return `${innerKey}: ${firstMessage(first[innerKey])}`;
    }
    return String(first);
  }
  if (value && typeof value === "object") {
    const innerKey = Object.keys(value)[0];
    if (innerKey) return `${innerKey}: ${firstMessage(value[innerKey])}`;
  }
  return String(value);
}

export function extractErrorMessage(error) {
  if (!error?.response) {
    const detail = error?.message ? ` (${error.message})` : "";
    return `Could not reach the server${detail}. Check that the backend is running and that the frontend is pointed at the right URL.`;
  }

  const data = error.response.data;
  const status = error.response.status;

  if (typeof data === "string") {
    return `Unexpected response from the server (HTTP ${status}). This usually means the request hit the wrong URL rather than the Django API.`;
  }

  if (!data) return `Request failed with no response body (HTTP ${status}).`;

  // Prefer real field errors over a generic "detail" string, a generic
  // fallback detail (e.g. "Request could not be completed") is far less
  // useful than the actual validation message underneath it.
  if (data.errors && typeof data.errors === "object" && Object.keys(data.errors).length > 0) {
    const firstKey = Object.keys(data.errors)[0];
    return `${firstKey}: ${firstMessage(data.errors[firstKey])}`;
  }
  if (typeof data.detail === "string") return data.detail;
  return `Request failed (HTTP ${status}).`;
}
