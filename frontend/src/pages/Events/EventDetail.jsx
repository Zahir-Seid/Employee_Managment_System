import InternationalLocationFields from "../../components/events/InternationalLocationFields.jsx";
import { resolveLocation } from "../../utils/worldLocations.js";
import EventTypeFields from "../../components/events/EventTypeFields.jsx";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { eventsApi } from "../../api/events";
import { useAuth } from "../../auth/AuthContext.jsx";
import CategoryBadge from "../../components/common/CategoryBadge.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import Spinner, { PageLoader } from "../../components/common/Spinner.jsx";
import LoadError from "../../components/common/LoadError.jsx";
import PhotoLightbox from "../../components/common/PhotoLightbox.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import {
  MODE_OF_EVENT_LABELS,
  SUPPORT_LEVEL_LABELS,
  SUPPORT_TYPE_LABELS,
  extractErrorMessage,
  formatEventType,
  formatDate,
  formatDateRange,
  isEE,
} from "../../utils/format";
import { configApi } from "../../api/configuration";

function Section({ title, children }) {
  return (
    <div className="card p-5">
      <h3 className="text-base mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value, className = "" }) {
  return (
    <div className={className}>
      <p className="text-xs text-ink-faint uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-ink">{value ?? "N/A"}</p>
    </div>
  );
}

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [event, setEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [isEditing, setIsEditing] = useState(searchParams.get("edit") === "1");
  const [form, setForm] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  // Item 4: Postpone/Cancel/Reopen, dedicated lifecycle actions, separate
  // from the regular Edit form, always require a reason (except Reopen).
  const [statusActionModal, setStatusActionModal] = useState(null); // "postpone" | "cancel" | "reopen" | null
  const [statusActionReason, setStatusActionReason] = useState("");
  // Item 23: which report photo (by index) is open in the in-app lightbox,
  // or null when closed.
  const [lightboxIndex, setLightboxIndex] = useState(null);
  // Item 1: postponing needs a new date, not just a reason, this is what
  // makes the Calendar (and everywhere else) actually reflect the
  // reschedule instead of still showing the old date under a "Postponed"
  // badge.
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [isSubmittingStatusAction, setIsSubmittingStatusAction] = useState(false);
  // Item 5: this event's history (edits, postpones, cancels, reopens).
  const [history, setHistory] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [configOptions, setConfigOptions] = useState({
    thematic_area: [],
    engagement_level: [],
    lead_organization: [],
  });

  useEffect(() => {
    configApi
      .active()
      .then(({ data }) => setConfigOptions(data))
      .catch((error) => {
        showToast(
          "Couldn't load Thematic Area / Engagement Level / Lead Organization options. " +
            extractErrorMessage(error),
          "error"
        );
      });
  }, []);

  async function load() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const { data } = await eventsApi.retrieve(id);
      setEvent(data);
      setForm({
        title: data.title,
        description: data.description,
        start_date: data.start_date,
        end_date: data.end_date,
        venue: data.venue,
        city: data.city,
        country: data.country || "",
        region: data.region,
        organization_lead_agency: data.organization_lead_agency,
        thematic_area: data.thematic_area,
        engagement_level: data.engagement_level,
        support_level: data.support_level,
        expected_participants: data.expected_participants,
        personal_objective: data.personal_objective || "",
        expected_outcome: data.expected_outcome || "",
        category: data.category,
        event_type: data.event_type,
        review_meeting_type: data.review_meeting_type || "",
        event_type_other: data.event_type_other || "",
        mode_of_event: data.mode_of_event,
        needs_comms_support: data.needs_comms_support,
      });
    } catch (error) {
      setLoadError(extractErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Merge several fields at once (used by the worldwide location fields).
  function patch(fields) {
    setForm((f) => ({ ...f, ...fields }));
  }

  async function handleSaveEdit() {
    const typeErrors = {};
    if (!(form.personal_objective || "").trim()) {
      typeErrors.personal_objective = "Personal objective relevant to EE is required.";
    }
    if (form.event_type === "rm" && !form.review_meeting_type) {
      typeErrors.review_meeting_type = "Choose Annual or Mid-term for a Review Meeting.";
    }
    if (form.event_type === "other" && !(form.event_type_other || "").trim()) {
      typeErrors.event_type_other = "Please write what kind of event this is.";
    }
    if (form.category === "international") {
      const where = resolveLocation(form);
      if (!where.country) typeErrors.country = "Country is required for international events.";
      if (!where.region) typeErrors.region = "Region / state / province is required.";
      if (!where.city) typeErrors.city = "City is required.";
    }
    setFormErrors(typeErrors);
    if (Object.keys(typeErrors).length > 0) {
      showToast(Object.values(typeErrors)[0], "error");
      return;
    }
    setIsSaving(true);
    try {
      const { organizationLeadAgencyOther, thematicAreaOther, engagementLevelOther, countryOther, regionOther, cityOther, ...rest } = form;
      const where = form.category === "international" ? resolveLocation(form) : null;
      const payload = {
        ...rest,
        ...(where ? { country: where.country, region: where.region, city: where.city } : { country: "" }),
        organization_lead_agency:
          form.organization_lead_agency === "Other"
            ? (organizationLeadAgencyOther || "").trim()
            : form.organization_lead_agency,
        thematic_area:
          form.thematic_area === "Other" ? (thematicAreaOther || "").trim() : form.thematic_area,
        engagement_level:
          form.engagement_level === "Other" ? (engagementLevelOther || "").trim() : form.engagement_level,
      };
      await eventsApi.update(id, payload);
      showToast("Event updated.", "success");
      setIsEditing(false);
      searchParams.delete("edit");
      setSearchParams(searchParams);
      load();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function submitStatusAction() {
    setIsSubmittingStatusAction(true);
    try {
      await eventsApi.statusAction(
        id,
        statusActionModal,
        statusActionReason.trim(),
        statusActionModal === "postpone" ? { new_start_date: newStartDate, new_end_date: newEndDate } : undefined
      );
      showToast(
        `Event ${statusActionModal === "reopen" ? "reopened" : statusActionModal + "d"}.`,
        "success"
      );
      setStatusActionModal(null);
      setStatusActionReason("");
      setNewStartDate("");
      setNewEndDate("");
      load();
      if (showHistory) loadHistory();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSubmittingStatusAction(false);
    }
  }

  async function loadHistory() {
    try {
      const { data } = await eventsApi.history(id);
      setHistory(data);
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  }

  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history === null) loadHistory();
  }

  if (loadError) return <LoadError message={loadError} onRetry={load} />;
  if (isLoading || !event || !form) return <PageLoader />;

  const isOwner = user?.id === event.owner;
  const canEdit = isOwner && event.is_editable;
  // Bug fix: "Submit Report"/"Continue Report" used to show for any
  // "logged" (ongoing) event the owner had, including ones still in
  // progress, clicking it landed on the report form, which the backend
  // then rejected ("A Event Status Report can only be submitted after
  // the event date."). Same eligibility check PostEventReportsList.jsx
  // already uses: the event's end date must have passed.
  const eventHasEnded = event.end_date <= new Date().toISOString().slice(0, 10);
  // Item 5: EE leading in any capacity (Lead Org, Organizer, or
  // Co-organizer), drives which participant fields show and whether
  // Objective is the event's own or the staff member's personal purpose.
  const formEeLeads =
    isEE(form.organization_lead_agency) ||
    form.engagement_level === "organizer" ||
    form.engagement_level === "co_organizer";

  return (
    <div className="space-y-6 max-w-4xl">
      <button
        onClick={() => navigate(-1)}
        className="jm-back-btn"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl">{event.title}</h1>
            <StatusBadge label={event.status_display || event.status} />
          </div>
          <div className="flex items-center gap-3 text-sm text-ink-muted">
            <CategoryBadge category={event.category} />
            <span>|</span>
            <span>{formatEventType(event)}</span>
            <span>|</span>
            <span>{MODE_OF_EVENT_LABELS[event.mode_of_event] || event.mode_of_event}</span>
            <span>|</span>
            <span>{formatDateRange(event.start_date, event.end_date)}</span>
            <span>|</span>
            <span>{event.owner_name}</span>
          </div>
          {event.is_report_overdue && (
            <p className="text-xs text-warning mt-2">Event Status Report is overdue for this event.</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {canEdit && !isEditing && (
            <button className="btn-secondary" onClick={() => setIsEditing(true)}>
              Edit
            </button>
          )}
          {/* Item 4: Postpone/Cancel, separate, explicit actions from
              Regular Edit, each requiring a reason on record. */}
          {isOwner && event.is_editable && event.status === "logged" && (
            <>
              <button
                className="btn-secondary"
                onClick={() => {
                  setStatusActionModal("postpone");
                  setNewStartDate(event.start_date);
                  setNewEndDate(event.end_date);
                }}
              >
                Postpone
              </button>
              <button className="btn-secondary" onClick={() => setStatusActionModal("cancel")}>
                Cancel Event
              </button>
            </>
          )}
          {isOwner && event.is_editable && (event.status === "postponed" || event.status === "cancelled") && (
            <button className="btn-secondary" onClick={() => setStatusActionModal("reopen")}>
              Reopen
            </button>
          )}
          <button className="btn-secondary" onClick={toggleHistory}>
            {showHistory ? "Hide History" : "History"}
          </button>
          {isOwner && event.status === "logged" && eventHasEnded && (
            <Link to={`/events/${id}/report`} className="btn-secondary">
              {event.post_event_report ? "Continue Report" : "Submit Report"}
            </Link>
          )}
        </div>
      </div>

      {/* Item 4: reason modal for Postpone/Cancel/Reopen. */}
      {statusActionModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4">
          <div className="jm-card max-w-md w-full">
            <h3 className="text-base font-semibold text-ink mb-1">
              {statusActionModal === "postpone" && "Postpone this event"}
              {statusActionModal === "cancel" && "Cancel this event"}
              {statusActionModal === "reopen" && "Reopen this event"}
            </h3>
            <p className="text-sm text-ink-muted mb-3">
              {statusActionModal === "reopen"
                ? "This will set the event back to Logged."
                : "Communications will be notified. This is recorded in the event's history."}
            </p>
            {statusActionModal === "postpone" && (
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="form-label">
                    New start date <span className="text-warning">*</span>
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={newStartDate}
                    onChange={(e) => {
                      const value = e.target.value;
                      setNewStartDate(value);
                      if (newEndDate && value && newEndDate < value) setNewEndDate("");
                    }}
                  />
                </div>
                <div>
                  <label className="form-label">
                    New end date <span className="text-warning">*</span>
                  </label>
                  <input
                    type="date"
                    className="form-input disabled:bg-surface-sunken disabled:cursor-not-allowed"
                    value={newEndDate}
                    min={newStartDate || undefined}
                    disabled={!newStartDate}
                    title={!newStartDate ? "Choose the new start date first" : undefined}
                    onChange={(e) => setNewEndDate(e.target.value)}
                  />
                </div>
              </div>
            )}
            <label className="form-label">
              Reason {statusActionModal !== "reopen" && <span className="text-warning">*</span>}
            </label>
            <textarea
              className="form-input"
              rows={3}
              value={statusActionReason}
              onChange={(e) => setStatusActionReason(e.target.value)}
              placeholder={
                statusActionModal === "postpone"
                  ? "e.g. Venue unavailable, rescheduling pending"
                  : statusActionModal === "cancel"
                  ? "e.g. Funding withdrawn"
                  : "Optional note"
              }
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                className="btn-secondary"
                onClick={() => {
                  setStatusActionModal(null);
                  setStatusActionReason("");
                  setNewStartDate("");
                  setNewEndDate("");
                }}
                disabled={isSubmittingStatusAction}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={submitStatusAction}
                disabled={
                  isSubmittingStatusAction ||
                  (statusActionModal !== "reopen" && !statusActionReason.trim()) ||
                  (statusActionModal === "postpone" && (!newStartDate || !newEndDate))
                }
              >
                {isSubmittingStatusAction ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Item 5: event history, preserved rather than silently overwritten. */}
      {showHistory && (
        <Section title="History">
          {history === null ? (
            <p className="text-sm text-ink-faint">Loading...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-ink-faint">No history recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {history.map((h) => (
                <li key={h.id} className="text-sm border-l-2 border-line pl-3">
                  <p className="text-ink">{h.description}</p>
                  <p className="text-xs text-ink-faint mt-0.5">
                    {[h.user_name, formatDate(h.created_at)].filter(Boolean).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {isEditing ? (
        <Section title="Edit Event">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* The type itself can't change here; Review Meetings ask Annual / Mid-term, Other asks what it is. */}
            {(form.event_type === "rm" || form.event_type === "other") && (
              <EventTypeFields value={form} onChange={set} errors={formErrors} lockType />
            )}
            <div className="md:col-span-2">
              <label className="form-label">Title</label>
              <input className="form-input" value={form.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="form-label">Event Objective</label>
              <textarea
                className="form-input"
                rows={3}
                value={form.expected_outcome}
                onChange={(e) => set("expected_outcome", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="form-label">Personal Objective relevant to EE <span className="text-warning">*</span></label>
              <textarea
                className="form-input"
                rows={3}
                placeholder="What is your personal objective relevant to EE?"
                value={form.personal_objective}
                onChange={(e) => set("personal_objective", e.target.value)}
              />
              {formErrors.personal_objective && <p className="form-error">{formErrors.personal_objective}</p>}
            </div>
            <div className="md:col-span-2">
              <label className="form-label">Description</label>
              <textarea
                className="form-input"
                rows={3}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Start Date</label>
              <input
                type="date"
                className="form-input"
                value={form.start_date}
                onChange={(e) => set("start_date", e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">End Date</label>
              <input
                type="date"
                className="form-input"
                value={form.end_date}
                onChange={(e) => set("end_date", e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Venue</label>
              <input className="form-input" value={form.venue} onChange={(e) => set("venue", e.target.value)} />
            </div>
            {form.category === "international" ? (
              <InternationalLocationFields value={form} onChange={patch} errors={formErrors} />
            ) : (
              <>
                <div>
                  <label className="form-label">City</label>
                  <input className="form-input" value={form.city} onChange={(e) => set("city", e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Region</label>
                  <input className="form-input" value={form.region} onChange={(e) => set("region", e.target.value)} />
                </div>
              </>
            )}
            <div>
              <label className="form-label">Lead Organization</label>
              <select
                className="form-input"
                value={form.organization_lead_agency}
                onChange={(e) => set("organization_lead_agency", e.target.value)}
              >
                {form.organization_lead_agency &&
                  !configOptions.lead_organization.some((o) => o.value === form.organization_lead_agency) &&
                  form.organization_lead_agency !== "Other" && (
                    <option value={form.organization_lead_agency}>{form.organization_lead_agency}</option>
                  )}
                <option value="">Select an organization...</option>
                {configOptions.lead_organization.map((org) => (
                  <option key={org.value} value={org.value}>
                    {org.label}
                  </option>
                ))}
                <option value="Other">Other</option>
              </select>
              {form.organization_lead_agency === "Other" && (
                <input
                  className="form-input mt-2"
                  placeholder="Specify organization"
                  value={form.organizationLeadAgencyOther || ""}
                  onChange={(e) => set("organizationLeadAgencyOther", e.target.value)}
                />
              )}
            </div>
            <div>
              <label className="form-label">Thematic Area</label>
              <select
                className="form-input"
                value={form.thematic_area}
                onChange={(e) => set("thematic_area", e.target.value)}
              >
                {form.thematic_area &&
                  !configOptions.thematic_area.some((t) => t.value === form.thematic_area) &&
                  form.thematic_area !== "Other" && (
                    <option value={form.thematic_area}>{form.thematic_area}</option>
                  )}
                <option value="">Select a thematic area...</option>
                {configOptions.thematic_area.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
                <option value="Other">Other</option>
              </select>
              {form.thematic_area === "Other" && (
                <input
                  className="form-input mt-2"
                  placeholder="Specify thematic area"
                  value={form.thematicAreaOther || ""}
                  onChange={(e) => set("thematicAreaOther", e.target.value)}
                />
              )}
            </div>
            {/* Item 5: EE leading (Lead Org/Organizer/Co-organizer) shows
                both a total headcount and EE's own contingent. */}
            {formEeLeads && (
              <div>
                <label className="form-label">Total Expected Number of Participants</label>
                <input
                  type="number"
                  min="1"
                  className="form-input"
                  value={form.total_expected_participants || ""}
                  onChange={(e) => set("total_expected_participants", e.target.value)}
                />
              </div>
            )}
            <div>
              {/* Bug fix: this used to always say "...from EE" regardless
                  of whether EE actually leads/organizes/co-organizes the
                  event, wrong when it doesn't (EE is just attending
                  someone else's event, so there's no separate "EE's own
                  contingent" to distinguish from a total). Same field
                  either way, label reflects which one it actually means. */}
              <label className="form-label">
                Expected Number of Participants from EE
              </label>
              <input
                type="number"
                min="1"
                className="form-input"
                value={form.expected_participants}
                onChange={(e) => set("expected_participants", e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Engagement Level</label>
              <select
                className="form-input"
                value={form.engagement_level}
                onChange={(e) => set("engagement_level", e.target.value)}
              >
                {form.engagement_level &&
                  !configOptions.engagement_level.some((o) => o.value === form.engagement_level) &&
                  form.engagement_level !== "Other" && (
                    <option value={form.engagement_level}>{form.engagement_level}</option>
                  )}
                {configOptions.engagement_level.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
                <option value="Other">Other</option>
              </select>
              {form.engagement_level === "Other" && (
                <input
                  className="form-input mt-2"
                  placeholder="Specify engagement level"
                  value={form.engagementLevelOther || ""}
                  onChange={(e) => set("engagementLevelOther", e.target.value)}
                />
              )}
              {/* Item 6: Co-organizer needs to name which org is
                  co-organizing alongside EE. */}
              {form.engagement_level === "co_organizer" && (
                <input
                  className="form-input mt-2"
                  placeholder="Name of the co-organizing organization"
                  value={form.coOrganizerName || ""}
                  onChange={(e) => set("coOrganizerName", e.target.value)}
                />
              )}
            </div>
            {/* Item: not applicable when EE is the Lead Organization. */}
            {!isEE(form.organization_lead_agency) && (
              <div>
                <label className="form-label">Support Level</label>
                <select
                  className="form-input"
                  value={form.support_level}
                  onChange={(e) => set("support_level", e.target.value)}
                >
                  {Object.entries(SUPPORT_LEVEL_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-line">
            <button
              className="btn-secondary"
              onClick={() => {
                setIsEditing(false);
                load();
              }}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSaveEdit} disabled={isSaving}>
              {isSaving && <Spinner size={14} className="!text-white" />}
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </Section>
      ) : (
        <Section title="Basic Information">
          <div className="mb-4 pb-4 border-b border-line">
            <p className="text-xs text-ink-faint uppercase tracking-wide mb-0.5">Event Objective</p>
            <p className="text-sm text-ink whitespace-pre-wrap">{event.expected_outcome || "N/A"}</p>
          </div>
          <div className="mb-4 pb-4 border-b border-line">
            <p className="text-xs text-ink-faint uppercase tracking-wide mb-0.5">Personal Objective relevant to EE</p>
            <p className="text-sm text-ink whitespace-pre-wrap">{event.personal_objective || "N/A"}</p>
          </div>
          <div className="mb-4 pb-4 border-b border-line">
            <p className="text-xs text-ink-faint uppercase tracking-wide mb-0.5">Description</p>
            <p className="text-sm text-ink whitespace-pre-wrap">{event.description}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Status" value={event.status_display || event.status} />
            <Field label="Venue" value={event.venue} />
            <Field label="City" value={event.city} />
            <Field label="Region" value={event.region} />
            {event.category === "international" && event.country && <Field label="Country" value={event.country} />}
            <Field label="Lead Organization" value={event.organization_lead_agency} />
            <Field label="Thematic Area" value={event.thematic_area} />
            {/* Bug fix: matches the edit form's formEeLeads gate now
                (isEE(lead) OR organizer OR co_organizer), this used to
                omit the isEE(lead) case, and the label always said "...
                from EE" even when it wasn't applicable. */}
            <Field
              label={
                isEE(event.organization_lead_agency) ||
                event.engagement_level === "organizer" ||
                event.engagement_level === "co_organizer"
                  ? "Expected Number of Participants from EE"
                  : "Estimated Number of Participants"
              }
              value={event.expected_participants}
            />
            <Field
              label="Engagement Level"
              value={
                configOptions.engagement_level.find((o) => o.value === event.engagement_level)?.label ||
                event.engagement_level
              }
            />
            {!isEE(event.organization_lead_agency) && (
              <Field label="Support Level" value={SUPPORT_LEVEL_LABELS[event.support_level]} />
            )}
          </div>
        </Section>
      )}

      {(event.status === "postponed" || event.status === "cancelled") && event.status_reason && (
        <Section title={event.status === "postponed" ? "Postpone Reason" : "Cancellation Reason"}>
          <p className="text-sm text-ink whitespace-pre-wrap">{event.status_reason}</p>
        </Section>
      )}

      <Section title="Communications Support">
        {!event.needs_comms_support ? (
          <p className="text-sm text-ink-muted">No Communications support was requested for this event.</p>
        ) : !event.support_request ? (
          <p className="text-sm text-warning">
            Communications support was requested, but the request was never submitted.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">Support Requested</p>
                <ul className="space-y-1">
                  {event.support_request.support_types.map((type) => {
                    const description = event.support_request.support_details?.[type];
                    return (
                      <li key={type} className="text-sm text-ink">
                        <span className="font-medium">{SUPPORT_TYPE_LABELS[type] || type}</span>
                        {description && <span className="text-ink-muted">: {description}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <Field label="Notes" value={event.support_request.notes || "N/A"} className="col-span-2" />
            </div>
          </div>
        )}
      </Section>

      <Section title="Operation Request">
        {!event.has_operational_request ? (
          <p className="text-sm text-ink-muted">No operation request was made for this event.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Operation Request" value="Yes" />
            <Field label="Requested From" value={event.operational_request_to_name || "N/A"} />
          </div>
        )}
      </Section>

      <Section title="Event Status Report">
        {!event.post_event_report ? (
          <p className="text-sm text-ink-muted">No Event Status Report has been submitted yet.</p>
        ) : (
          <div className="space-y-4">
            <StatusBadge label={event.post_event_report.status === "submitted" ? "Completed" : "Draft"} />
            {event.post_event_report.major_accomplishment && (
              <div>
                <p className="text-xs font-bold text-ink uppercase tracking-wide mb-0.5">Event Overview</p>
                <p className="text-sm text-ink whitespace-pre-line">{event.post_event_report.major_accomplishment}</p>
              </div>
            )}
            {event.post_event_report.best_practices_lessons_actions && (
              <div>
                <p className="text-xs font-bold text-ink uppercase tracking-wide mb-0.5">
                  Key Learnings & Action Points
                </p>
                <p className="text-sm text-ink whitespace-pre-line">
                  {event.post_event_report.best_practices_lessons_actions}
                </p>
              </div>
            )}
            {event.post_event_report.challenges_faced && (
              <div>
                <p className="text-xs font-bold text-ink uppercase tracking-wide mb-0.5">Challenges & Issues</p>
                <p className="text-sm text-ink whitespace-pre-line">{event.post_event_report.challenges_faced}</p>
              </div>
            )}
            {event.post_event_report.recommendation_conclusion && (
              <div>
                <p className="text-xs font-bold text-ink uppercase tracking-wide mb-0.5">Partnership opportunities</p>
                <p className="text-sm text-ink whitespace-pre-line">
                  {event.post_event_report.recommendation_conclusion}
                </p>
              </div>
            )}
            {event.post_event_report.participants_total != null && (
              <div>
                <p className="text-xs font-bold text-ink uppercase tracking-wide mb-1">Participation</p>
                <p className="text-sm text-ink mb-2">
                  {event.post_event_report.participants_total} total
                  {" "}
                  ({event.post_event_report.participants_male ?? 0} Male, {event.post_event_report.participants_female ?? 0} Female)
                </p>
                {event.post_event_report.participants_by_organization?.length > 0 && (
                  <table className="w-full text-sm max-w-sm">
                    <tbody className="divide-y divide-line">
                      {event.post_event_report.participants_by_organization.map((row) => (
                        <tr key={row.label}>
                          <td className="py-1 text-ink-muted">{row.label}</td>
                          <td className="py-1 text-right text-ink">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            {event.post_event_report.follow_up_actions?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-ink uppercase tracking-wide mb-1">Follow-up Actions</p>
                <table className="w-full text-sm">
                  <thead className="text-ink-faint text-xs uppercase">
                    <tr>
                      <th className="text-left py-1">Action</th>
                      <th className="text-left py-1">Responsible</th>
                      <th className="text-left py-1">Deadline</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {event.post_event_report.follow_up_actions.map((a) => (
                      <tr key={a.id}>
                        <td className="py-1.5">{a.action}</td>
                        <td className="py-1.5">{a.responsible}</td>
                        <td className="py-1.5">{formatDate(a.deadline)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {event.post_event_report.photos?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-ink uppercase tracking-wide mb-2">Photos</p>
                <div className="flex flex-wrap gap-2">
                  {event.post_event_report.photos.map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setLightboxIndex(idx)}
                      className="block rounded border border-line overflow-hidden focus:outline-none focus:ring-2 focus:ring-ems-primary"
                    >
                      <img src={p.image} alt="" className="h-20 w-20 object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={event.post_event_report.photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}
