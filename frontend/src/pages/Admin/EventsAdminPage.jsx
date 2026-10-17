import EventTypeFields from "../../components/events/EventTypeFields.jsx";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { eventsApi } from "../../api/events";
import { configApi } from "../../api/configuration";
import { staffApi } from "../../api/staff";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import { FilterSelect, ListSearch } from "../../components/common/ListControls.jsx";
import DaysUntilEventBadge, { DAYS_UNTIL_EVENT_OPTIONS } from "../../components/common/DaysUntilEventBadge.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage, formatDateRange } from "../../utils/format";
import SortableTh from "../../components/common/SortableTh.jsx";
import { useSort } from "../../utils/useSort.js";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "upcoming", label: "Upcoming" },
  { value: "ongoing", label: "Ongoing" },
  { value: "held", label: "Held" },
  { value: "completed", label: "Completed" },
  { value: "postponed", label: "Postponed" },
  { value: "cancelled", label: "Cancelled" },
];

const EMPTY_FORM = {
  owner: null,
  category: "international",
  event_type: "training",
  review_meeting_type: "",
  event_type_other: "",
  mode_of_event: "in_person",
  title: "",
  description: "",
  start_date: "",
  end_date: "",
  venue: "",
  city: "",
  region: "",
  organization_lead_agency: "",
  thematic_area: "",
  engagement_level: "",
  co_organizer_name: "",
  support_level: "",
  total_expected_participants: "",
  expected_participants: "",
  personal_objective: "",
  expected_outcome: "",
  needs_comms_support: null,
};

export default function EventsAdminPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const sort = useSort(events, { status: (e) => e.status_display || e.status });
  const [isLoading, setIsLoading] = useState(true);
  // Same smooth-update pattern as EventsList/CommsRequestsList.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [daysUntilEvent, setDaysUntilEvent] = useState("");
  const [configOptions, setConfigOptions] = useState({});
  const [modalOpen, setModalOpen] = useState(null); // null | "create" | eventObject
  const [cancelTarget, setCancelTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (status) params.status = status;
      if (daysUntilEvent) params.days_until_event = daysUntilEvent;
      const { data } = await eventsApi.adminList(params);
      setEvents(data.results || data);
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsLoading(false);
      setHasLoadedOnce(true);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, daysUntilEvent]);

  useEffect(() => {
    configApi.active().then(({ data }) => setConfigOptions(data));
  }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setErrors({});
    setModalOpen("create");
  }

  async function openEdit(ev) {
    try {
      const { data } = await eventsApi.adminRetrieve(ev.id);
      setForm({
        owner: null,
        category: data.category,
        event_type: data.event_type,
        review_meeting_type: data.review_meeting_type || "",
        event_type_other: data.event_type_other || "",
        mode_of_event: data.mode_of_event,
        title: data.title,
        description: data.description,
        start_date: data.start_date,
        end_date: data.end_date,
        venue: data.venue,
        city: data.city,
        region: data.region,
        organization_lead_agency: data.organization_lead_agency,
        thematic_area: data.thematic_area,
        engagement_level: data.engagement_level,
        co_organizer_name: data.co_organizer_name || "",
        support_level: data.support_level || "",
        total_expected_participants: data.total_expected_participants ?? "",
        expected_participants: data.expected_participants ?? "",
        personal_objective: data.personal_objective || "",
        expected_outcome: data.expected_outcome || "",
        needs_comms_support: data.needs_comms_support,
      });
      setErrors({});
      setModalOpen({ ...ev, is_editable: data.is_editable });
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  }

  const eeLeads =
    (form.organization_lead_agency || "").trim().toUpperCase() === "EE" ||
    ["organizer", "co_organizer"].includes(form.engagement_level);
  const eeIsLeadOrg = (form.organization_lead_agency || "").trim().toUpperCase() === "EE";

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setIsSaving(true);
    setErrors({});
    const isCreate = modalOpen === "create";
    const payload = {
      category: form.category,
      event_type: form.event_type,
      review_meeting_type: form.event_type === "rm" ? form.review_meeting_type : "",
      event_type_other: form.event_type === "other" ? (form.event_type_other || "").trim() : "",
      mode_of_event: form.mode_of_event,
      title: form.title,
      description: form.description,
      start_date: form.start_date,
      end_date: form.end_date,
      venue: form.venue,
      city: form.city,
      region: form.region,
      organization_lead_agency: form.organization_lead_agency,
      thematic_area: form.thematic_area,
      engagement_level: form.engagement_level,
      co_organizer_name: form.engagement_level === "co_organizer" ? form.co_organizer_name : "",
      support_level: eeIsLeadOrg ? "" : form.support_level,
      total_expected_participants: eeLeads && form.total_expected_participants !== "" ? Number(form.total_expected_participants) : null,
      expected_participants: form.expected_participants !== "" ? Number(form.expected_participants) : null,
      personal_objective: form.personal_objective,
      expected_outcome: form.expected_outcome,
      needs_comms_support: form.needs_comms_support,
    };
    if (isCreate) payload.owner = form.owner?.id;

    try {
      if (isCreate) {
        await eventsApi.adminCreate(payload);
        showToast(`"${form.title}" added for ${form.owner.full_name}.`, "success");
      } else {
        await eventsApi.adminUpdate(modalOpen.id, payload);
        showToast(`"${form.title}" updated.`, "success");
      }
      setModalOpen(null);
      load();
    } catch (error) {
      const data = error?.response?.data?.errors || error?.response?.data;
      if (data && typeof data === "object") setErrors(data);
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCancelEvent(reason) {
    setIsSaving(true);
    try {
      await eventsApi.adminStatusAction(cancelTarget.id, "cancel", reason);
      showToast(`"${cancelTarget.title}" cancelled.`, "success");
      setCancelTarget(null);
      load();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Events</h1>
          <p className="text-sm text-ink-muted mt-1">
            Every event in the system. Add one on any staff member's behalf, edit details, or cancel. There's
            no hard delete here either: events carry Support Requests, Event Status Reports, photos, and an audit
            trail, and Cancelled is already a real, well-defined state for "this isn't happening" that doesn't lose
            any of that.
          </p>
        </div>
        <button className="jm-btn-primary shrink-0" onClick={openCreate}>
          Add Event
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <ListSearch
          placeholder="Search by title, venue, city, or owner..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FilterSelect className="max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          className="max-w-[180px]"
          value={daysUntilEvent}
          onChange={(e) => setDaysUntilEvent(e.target.value)}
        >
          {DAYS_UNTIL_EVENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.value ? opt.label : "Days Until Event: All"}
            </option>
          ))}
        </FilterSelect>
      </div>

      <div className="jm-card overflow-hidden p-0">
        {!hasLoadedOnce ? (
          <p className="text-sm text-ink-faint py-6 text-center">Loading...</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-ink-faint py-6 text-center">No events found.</p>
        ) : (
          <div className="overflow-x-auto">
            {isLoading && (
              <div className="px-4 py-1.5 text-xs text-ems-primary border-b border-line">Updating...</div>
            )}
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-ink-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5">Event</th>
                  <th className="text-left px-4 py-2.5">Owner</th>
                  <th className="text-left px-4 py-2.5">Category</th>
                  <th className="text-left px-4 py-2.5">Date</th>
                  <th className="text-left px-4 py-2.5">Days Until Event</th>
                  <SortableTh label="Status" sortKey="status" sort={sort} />
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sort.rows.map((ev) => (
                  <tr
                    key={ev.id}
                    onClick={(e) => {
                      if (e.target.closest("a, button")) return;
                      navigate(`/events/${ev.id}`);
                    }}
                    className="cursor-pointer hover:bg-surface-muted/60"
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Link to={`/events/${ev.id}`} className="font-medium text-navy-700 hover:underline">
                        {ev.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{ev.owner_name}</td>
                    <td className="px-4 py-2.5 text-ink-muted capitalize">{ev.category}</td>
                    <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">
                      {formatDateRange(ev.start_date, ev.end_date)}
                    </td>
                    <td className="px-4 py-2.5">
                      <DaysUntilEventBadge value={ev.days_until_event} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge label={ev.status_display || ev.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => openEdit(ev)}
                          title="Edit"
                          aria-label="Edit"
                          className="p-1.5 rounded text-ink-faint hover:text-ink hover:bg-surface-muted"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                        </button>
                        {ev.status !== "cancelled" && (
                          <button
                            onClick={() => setCancelTarget(ev)}
                            title="Cancel Event"
                            aria-label="Cancel Event"
                            className="p-1.5 rounded text-ink-faint hover:text-ems-primary hover:bg-surface-muted"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <circle cx="12" cy="12" r="9" />
                              <path d="m15 9-6 6M9 9l6 6" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="jm-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-ink mb-4">
              {modalOpen === "create" ? "Add Event" : `Edit: ${modalOpen.title}`}
            </h2>

            {modalOpen !== "create" && modalOpen.is_editable === false && (
              <p className="text-xs text-warning bg-surface-muted rounded-md px-3 py-2 mb-4">
                This event's Event Status Report has been submitted, so it can no longer be edited.
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {modalOpen === "create" && (
                <OwnerPicker selected={form.owner} onSelect={(owner) => set("owner", owner)} error={errors.owner} />
              )}

              <div>
                <label className="form-label">Title</label>
                <input className="form-input" required value={form.title} onChange={(e) => set("title", e.target.value)} />
                {errors.title && <p className="form-error">{errors.title}</p>}
              </div>

              <div>
                <label className="form-label">Event Objective</label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={form.expected_outcome}
                  onChange={(e) => set("expected_outcome", e.target.value)}
                />
              </div>

              <div>
                <label className="form-label">Personal Objective relevant to EE <span className="text-warning">*</span></label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={form.personal_objective}
                  onChange={(e) => set("personal_objective", e.target.value)}
                />
                {errors.personal_objective && <p className="form-error">{errors.personal_objective}</p>}
              </div>

              <div>
                <label className="form-label">Description</label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Start Date</label>
                  <input
                    type="date"
                    className="form-input"
                    required
                    value={form.start_date}
                    onChange={(e) => set("start_date", e.target.value)}
                  />
                  {errors.start_date && <p className="form-error">{errors.start_date}</p>}
                </div>
                <div>
                  <label className="form-label">End Date</label>
                  <input
                    type="date"
                    className="form-input"
                    required
                    value={form.end_date}
                    onChange={(e) => set("end_date", e.target.value)}
                  />
                  {errors.end_date && <p className="form-error">{errors.end_date}</p>}
                </div>
              </div>

              <div>
                <label className="form-label">Category</label>
                <select className="form-input" value={form.category} onChange={(e) => set("category", e.target.value)}>
                  {(configOptions.category || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <EventTypeFields value={form} onChange={set} errors={errors} required={false} />
                <div>
                  <label className="form-label">Mode of Event</label>
                  <div className="inline-flex rounded-lg border border-[#E5E9F0] overflow-hidden w-full">
                    {[
                      ["in_person", "In-person"],
                      ["virtual", "Virtual"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => set("mode_of_event", value)}
                        className={
                          "flex-1 px-3 py-2 text-sm " +
                          (form.mode_of_event === value
                            ? "bg-ems-primary text-white"
                            : "bg-white text-ink-muted hover:bg-[#F1F4F9]")
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Venue</label>
                  <input className="form-input" required value={form.venue} onChange={(e) => set("venue", e.target.value)} />
                </div>
                <div>
                  <label className="form-label">City</label>
                  <input className="form-input" required value={form.city} onChange={(e) => set("city", e.target.value)} />
                </div>
              </div>

              <div>
                <label className="form-label">Region</label>
                <select className="form-input" required value={form.region} onChange={(e) => set("region", e.target.value)}>
                  <option value="">Select a region...</option>
                  {(configOptions.region || []).map((opt) => (
                    <option key={opt.value} value={opt.label}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Organization Lead Agency</label>
                <input
                  className="form-input"
                  required
                  placeholder="e.g. EE, MOH, EPHI..."
                  value={form.organization_lead_agency}
                  onChange={(e) => set("organization_lead_agency", e.target.value)}
                />
                {errors.organization_lead_agency && <p className="form-error">{errors.organization_lead_agency}</p>}
              </div>

              <div>
                <label className="form-label">Thematic Area</label>
                <input
                  className="form-input"
                  required
                  list="thematic-area-options"
                  value={form.thematic_area}
                  onChange={(e) => set("thematic_area", e.target.value)}
                />
                <datalist id="thematic-area-options">
                  {(configOptions.thematic_area || []).map((opt) => (
                    <option key={opt.value} value={opt.label} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="form-label">Engagement Level</label>
                <select
                  className="form-input"
                  required
                  value={form.engagement_level}
                  onChange={(e) => set("engagement_level", e.target.value)}
                >
                  <option value="">Select...</option>
                  {(configOptions.engagement_level || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {form.engagement_level === "co_organizer" && (
                <div>
                  <label className="form-label">Co-organizer Name</label>
                  <input
                    className="form-input"
                    value={form.co_organizer_name}
                    onChange={(e) => set("co_organizer_name", e.target.value)}
                  />
                </div>
              )}

              {!eeIsLeadOrg && (
                <div>
                  <label className="form-label">Support Level</label>
                  <select
                    className="form-input"
                    required
                    value={form.support_level}
                    onChange={(e) => set("support_level", e.target.value)}
                  >
                    <option value="">Select...</option>
                    {(configOptions.support_level || []).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {errors.support_level && <p className="form-error">{errors.support_level}</p>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {eeLeads && (
                  <div>
                    <label className="form-label">Total Expected Participants</label>
                    <input
                      type="number"
                      min={0}
                      className="form-input"
                      value={form.total_expected_participants}
                      onChange={(e) => set("total_expected_participants", e.target.value)}
                    />
                    {errors.total_expected_participants && (
                      <p className="form-error">{errors.total_expected_participants}</p>
                    )}
                  </div>
                )}
                <div>
                  {/* Bug fix: this used to always say "...from EE"
                      regardless of eeLeads, wrong when EE is just a
                      plain participant, not the org actually running the
                      event. Same field either way, label reflects which
                      one it actually means (matches EventCreate.jsx/
                      EventDetail.jsx's identical fix). */}
                  <label className="form-label">
                    Expected Participants from EE
                  </label>
                  <input
                    type="number"
                    min={0}
                    className="form-input"
                    value={form.expected_participants}
                    onChange={(e) => set("expected_participants", e.target.value)}
                  />
                  {errors.expected_participants && <p className="form-error">{errors.expected_participants}</p>}
                </div>
              </div>

              <div>
                <label className="form-label">Needs Communications Support?</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      checked={form.needs_comms_support === true}
                      onChange={() => set("needs_comms_support", true)}
                    />
                    Yes
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      checked={form.needs_comms_support === false}
                      onChange={() => set("needs_comms_support", false)}
                    />
                    No
                  </label>
                </div>
                {errors.needs_comms_support && <p className="form-error">{errors.needs_comms_support}</p>}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" className="btn-secondary" onClick={() => setModalOpen(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="jm-btn-primary"
                  disabled={isSaving || (modalOpen === "create" && !form.owner) || (modalOpen !== "create" && modalOpen.is_editable === false)}
                >
                  {isSaving ? "Saving..." : modalOpen === "create" ? "Add Event" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {cancelTarget && (
        <CancelEventModal
          event={cancelTarget}
          isSaving={isSaving}
          onCancel={() => setCancelTarget(null)}
          onConfirm={handleCancelEvent}
        />
      )}
    </div>
  );
}

function CancelEventModal({ event, isSaving, onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="jm-card w-full max-w-md">
        <h2 className="text-lg font-semibold text-ink mb-2">Cancel "{event.title}"?</h2>
        <p className="text-sm text-ink-muted mb-4">
          This sets the event's status to Cancelled. Nothing is deleted: reports, photos, and history stay
          intact.
        </p>
        <label className="form-label">Reason</label>
        <textarea className="form-input mb-4" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Never mind
          </button>
          <button
            type="button"
            className="jm-btn-primary"
            disabled={isSaving || !reason.trim()}
            onClick={() => onConfirm(reason)}
          >
            {isSaving ? "Cancelling..." : "Cancel Event"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OwnerPicker({ selected, onSelect, error }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const timeout = setTimeout(() => {
      staffApi
        .list({ search: query })
        .then(({ data }) => {
          if (!cancelled) setResults((data.results || data).filter((p) => p.is_active));
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  if (selected) {
    return (
      <div>
        <label className="form-label">Event Owner</label>
        <div className="flex items-center justify-between form-input">
          <span>
            {selected.full_name} <span className="text-ink-faint">({selected.email})</span>
          </span>
          <button type="button" className="text-ink-faint hover:text-ink text-xs" onClick={() => onSelect(null)}>
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="form-label">Event Owner</label>
      <input
        type="text"
        className="form-input"
        placeholder="Search staff by name or email..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="form-error">{error}</p>}
      {isSearching && <p className="text-xs text-ink-faint mt-1">Searching...</p>}
      {results.length > 0 && (
        <ul className="border border-line rounded-md mt-1 max-h-40 overflow-y-auto divide-y divide-line">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-muted"
              >
                {p.full_name} <span className="text-ink-faint">({p.email})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
