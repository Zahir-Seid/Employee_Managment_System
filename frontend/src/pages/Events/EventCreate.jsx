import InternationalLocationFields from "../../components/events/InternationalLocationFields.jsx";
import EventTypeFields from "../../components/events/EventTypeFields.jsx";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { eventsApi } from "../../api/events";
import { communicationsApi } from "../../api/communications";
import { configApi } from "../../api/configuration";
import { useToast } from "../../context/ToastContext.jsx";
import { citiesForRegion, ETHIOPIA_REGIONS } from "../../utils/locations";
import StaffPicker from "../../components/events/StaffPicker.jsx";
import Spinner from "../../components/common/Spinner.jsx";
import { ENGAGEMENT_LEVEL_DESCRIPTIONS, SUPPORT_LEVEL_LABELS, SUPPORT_TYPE_LABELS, extractErrorMessage, isEE } from "../../utils/format";

const TOTAL_STEPS = 5;

const STEP_LABELS = ["Basic Info", "Location", "Organization", "Comms Decision", "Support Request"];

// International events are mostly held in Ethiopia, so Country starts there
// (and again whenever the category is switched to International); it can still
// be changed to any country.
const DEFAULT_COUNTRY = "Ethiopia";

const initialState = {
  category: "international",
  event_type: "training",
  review_meeting_type: "",
  event_type_other: "",
  mode_of_event: "in_person",
  title: "",
  description: "",
  start_date: "",
  end_date: "",
  country: DEFAULT_COUNTRY,
  countryOther: "",
  region: "",
  regionOther: "",
  city: "",
  cityOther: "",
  venue: "",
  organization_lead_agency: "",
  organizationLeadAgencyOther: "",
  thematic_area: "",
  thematicAreaOther: "",
  engagement_level: "organizer",
  engagementLevelOther: "",
  coOrganizerName: "",
  support_level: "financial",
  expected_participants: "",
  total_expected_participants: "",
  personal_objective: "",
  expected_outcome: "",
  needs_comms_support: null,
  support_types: [], // multi-select
  support_details: {}, // { [type]: description }
  notes: "",
  has_operational_request: null,
  operational_request_to: "",
  operational_request_to_name: "",
};

// A required-field marker, used consistently across every form label in
// this wizard so it's always clear at a glance what's mandatory.
function Req() {
  return <span className="text-warning">*</span>;
}

function StepIndicator({ step, maxStep }) {
  return (
    <ol className="flex items-center w-full mb-8">
      {STEP_LABELS.slice(0, maxStep).map((label, idx) => {
        const num = idx + 1;
        const isActive = num === step;
        const isDone = num < step;
        const isLast = num === maxStep;
        return (
          <li key={label} className={"flex items-center" + (isLast ? "" : " flex-1")}>
            <div className="flex flex-col items-center gap-1 shrink-0">
              <span
                className={
                  "h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0 " +
                  (isActive
                    ? "bg-ems-primary text-white ring-4 ring-ems-primary/20"
                    : isDone
                    ? "bg-ems-primary text-white"
                    : "bg-surface-sunken text-ink-faint")
                }
              >
                {num}
              </span>
              <span
                className={
                  "text-[11px] text-center leading-tight w-20 " +
                  (isActive ? "text-ink font-medium" : "text-ink-faint")
                }
              >
                {label}
              </span>
            </div>
            {!isLast && (
              <div className={"flex-1 h-0.5 mx-1 mb-4 " + (isDone ? "bg-ems-primary" : "bg-line")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function EventCreate() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  // Pre-filled when arriving from the Calendar's "click an empty day"
  // quick-create bubble (?start_date=YYYY-MM-DD&title=...), the bubble
  // itself only ever collects a title, everything else is finished here.
  const [form, setForm] = useState(() => ({
    ...initialState,
    start_date: searchParams.get("start_date") || initialState.start_date,
    title: searchParams.get("title") || initialState.title,
  }));
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Thematic Area, Engagement Level, and Lead Organization are now
  // admin-managed (Configuration page) instead of hardcoded, fetched
  // once here rather than imported as static arrays.
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
        // Most likely cause if these dropdowns are ever empty: the backend
        // Configuration migrations haven't been run/seeded yet (new
        // feature, see README/setup notes), or the request genuinely
        // failed. Either way, surface it instead of failing silently so
        // it's diagnosable rather than just "the dropdown is empty".
        showToast(
          "Couldn't load Thematic Area / Engagement Level / Lead Organization options. " +
            extractErrorMessage(error),
          "error"
        );
      });
  }, []);

  // Communications Support is asked regardless of category (updated
  // requirement #1), so Step 4 always appears.
  // Step 5 always appears: it holds the Operational Request question, and
  // the Communications support types only when Comms support was requested.
  const maxStep = TOTAL_STEPS;
  // Item 5: EE leading in any capacity (Lead Org, Organizer, or
  // Co-organizer), drives which participant fields show and whether
  // Objective is the event's own or the staff member's personal purpose.
  const eeLeads =
    isEE(form.organization_lead_agency) ||
    form.engagement_level === "organizer" ||
    form.engagement_level === "co_organizer";

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Merge several fields at once (used by the worldwide location fields).
  function patch(fields) {
    setForm((f) => ({ ...f, ...fields }));
  }

  // International uses worldwide Country/Region/City lists, every other
  // category the Ethiopian ones, so switching between them clears the
  // location so an invalid combination can't be carried over.
  function changeCategory(next) {
    setForm((f) => {
      const crossing = (next === "international") !== (f.category === "international");
      return crossing
        ? {
            ...f,
            category: next,
            country: next === "international" ? DEFAULT_COUNTRY : "",
            countryOther: "",
            region: "",
            regionOther: "",
            city: "",
            cityOther: "",
          }
        : { ...f, category: next };
    });
  }

  function toggleSupportType(type) {
    setForm((f) => {
      const has = f.support_types.includes(type);
      const support_types = has ? f.support_types.filter((t) => t !== type) : [...f.support_types, type];
      const support_details = { ...f.support_details };
      if (has) delete support_details[type];
      return { ...f, support_types, support_details };
    });
  }

  function setSupportDetail(type, value) {
    setForm((f) => ({ ...f, support_details: { ...f.support_details, [type]: value } }));
  }

  function validateStep() {
    const e = {};
    if (step === 1) {
      if (form.event_type === "rm" && !form.review_meeting_type) {
        e.review_meeting_type = "Choose Annual or Mid-term for a Review Meeting.";
      }
      if (form.event_type === "other" && !form.event_type_other.trim()) {
        e.event_type_other = "Please write what kind of event this is.";
      }
      if (!form.title.trim()) e.title = "Title is required.";
      if (!form.personal_objective.trim()) e.personal_objective = "Personal objective relevant to EE is required.";
      if (!form.description.trim()) e.description = "Description is required.";
      if (!form.start_date) e.start_date = "Start date is required.";
      if (!form.end_date) e.end_date = "End date is required.";
      if (form.start_date && form.end_date && form.end_date < form.start_date) {
        e.end_date = "End date cannot be before the start date.";
      }
    }
    if (step === 2) {
      if (form.category === "international") {
        if (!form.country) e.country = "Country is required.";
        if (form.country === "Other" && !form.countryOther.trim()) e.country = "Please specify the country.";
      }
      if (!form.region) e.region = form.category === "international" ? "Region / state / province is required." : "Region is required.";
      if (form.region === "Other" && !form.regionOther.trim()) e.region = "Please specify the region.";
      if (!form.city) e.city = "City is required.";
      if (form.city === "Other" && !form.cityOther.trim()) e.city = "Please specify the city.";
      if (!form.venue.trim()) e.venue = "Venue is required.";
    }
    if (step === 3) {
      if (!form.organization_lead_agency) e.organization_lead_agency = "Lead organization is required.";
      if (form.organization_lead_agency === "Other" && !form.organizationLeadAgencyOther.trim()) {
        e.organization_lead_agency = "Please specify the organization.";
      }
      if (!form.thematic_area) e.thematic_area = "Thematic area is required.";
      if (form.thematic_area === "Other" && !form.thematicAreaOther.trim()) {
        e.thematic_area = "Please specify the thematic area.";
      }
      if (!form.engagement_level) e.engagement_level = "Engagement level is required.";
      if (form.engagement_level === "Other" && !form.engagementLevelOther.trim()) {
        e.engagement_level = "Please specify the engagement level.";
      }
      // Item 5: EE leading in any capacity (Lead Org, Organizer, or
      // Co-organizer) requires both participant fields; EE as a plain
      // participant requires only the "from EE" one.
      const eeLeads =
        isEE(form.organization_lead_agency) ||
        form.engagement_level === "organizer" ||
        form.engagement_level === "co_organizer";
      // EE leading (Lead Org/Organizer/Co-organizer): the overall "Total"
      // headcount AND EE's own headcount are both required. Otherwise
      // (EE is only a participant) there is no overall total to ask for;
      // only EE's own headcount ("from EE") is required.
      if (eeLeads) {
        if (!/^\d+$/.test((form.total_expected_participants || "").trim()) || Number(form.total_expected_participants) <= 0) {
          e.total_expected_participants = "Enter a valid total number of participants (numbers only).";
        }
      }
      if (!/^\d+$/.test((form.expected_participants || "").trim()) || Number(form.expected_participants) <= 0) {
        e.expected_participants = "Enter a valid number of participants from EE (numbers only).";
      }
      // Item 21: the EE headcount is a subset of the overall total, so the
      // overall figure can never be smaller than it, whichever field is
      // currently playing which role. Only checked once both fields are
      // otherwise individually valid, so this doesn't pile on top of the
      // "enter a valid number" errors above.
      if (eeLeads) {
        if (
          !e.total_expected_participants &&
          !e.expected_participants &&
          Number(form.total_expected_participants) < Number(form.expected_participants)
        ) {
          e.total_expected_participants = "Total participants must be equal to or greater than the number from EE.";
        }
      }
      // Item: not applicable when EE is the Lead Organization.
      if (!isEE(form.organization_lead_agency) && !form.support_level) {
        e.support_level = "Support level is required.";
      }
    }
    if (step === 4 && form.needs_comms_support === null) {
      e.needs_comms_support = "Please select Yes or No.";
    }
    if (step === 5) {
      if (form.has_operational_request === null) {
        e.has_operational_request = "Please select Yes or No for the operation request.";
      } else if (form.has_operational_request) {
        if (!form.operational_request_to) {
          e.operational_request_to = "Please choose a staff member from the list.";
        }
      }
    }
    if (step === 5 && form.needs_comms_support) {
      if (form.support_types.length === 0) e.support_types = "Select at least one support type.";
      if (form.support_types.includes("other") && !(form.support_details.other || "").trim()) {
        e.other = "Please describe what 'Other' support is needed.";
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function goNext() {
    if (!validateStep()) return;
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 1));
  }

  async function handleFinalSubmit() {
    if (step === 5 && !validateStep()) return;
    setIsSubmitting(true);
    try {
      const region = form.region === "Other" ? form.regionOther.trim() : form.region;
      const country = form.category === "international" ? (form.country === "Other" ? form.countryOther.trim() : form.country) : "";
      const city = form.city === "Other" ? form.cityOther.trim() : form.city;
      const organization_lead_agency =
        form.organization_lead_agency === "Other"
          ? form.organizationLeadAgencyOther.trim()
          : form.organization_lead_agency;
      const thematic_area = form.thematic_area === "Other" ? form.thematicAreaOther.trim() : form.thematic_area;
      const engagement_level =
        form.engagement_level === "Other" ? form.engagementLevelOther.trim() : form.engagement_level;

      const eventPayload = {
        category: form.category,
        event_type: form.event_type,
        review_meeting_type: form.event_type === "rm" ? form.review_meeting_type : "",
        event_type_other: form.event_type === "other" ? form.event_type_other.trim() : "",
        mode_of_event: form.mode_of_event,
        title: form.title,
        description: form.description,
        start_date: form.start_date,
        end_date: form.end_date,
        venue: form.venue,
        city,
        country,
        region,
        organization_lead_agency,
        thematic_area,
        engagement_level,
        co_organizer_name: form.engagement_level === "co_organizer" ? form.coOrganizerName.trim() : "",
        support_level: form.support_level,
        expected_participants: form.expected_participants ? Number(form.expected_participants) : null,
        total_expected_participants: eeLeads && form.total_expected_participants ? Number(form.total_expected_participants) : null,
        personal_objective: form.personal_objective,
        expected_outcome: form.expected_outcome,
        needs_comms_support: !!form.needs_comms_support,
        has_operational_request: !!form.has_operational_request,
        operational_request_to: form.has_operational_request ? form.operational_request_to : null,
      };
      const { data: createdEvent } = await eventsApi.create(eventPayload);

      if (form.needs_comms_support) {
        await communicationsApi.createSupportRequest(createdEvent.id, {
          support_types: form.support_types,
          support_details: form.support_details,
          notes: form.notes,
        });
      }

      showToast("Event logged successfully.", "success");
      navigate(`/events/${createdEvent.id}`);
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl mb-6">Create Event</h1>
      <StepIndicator step={step} maxStep={maxStep} />

      <div className="card p-5 space-y-4">
        {step === 1 && (
          <>
            <div>
              <label className="form-label">Category <Req /></label>
              <select className="form-input" value={form.category} onChange={(e) => changeCategory(e.target.value)}>
                <option value="international">International</option>
                <option value="national">National</option>
                <option value="sub_regional">Sub-national</option>
                <option value="internal">Internal</option>
              </select>
            </div>
            <EventTypeFields value={form} onChange={set} errors={errors} />
            <div>
              <label className="form-label">Mode of Event <Req /></label>
              <div className="inline-flex rounded-lg border border-[#E5E9F0] overflow-hidden">
                {[
                  ["in_person", "In-person"],
                  ["virtual", "Virtual"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set("mode_of_event", value)}
                    className={
                      "px-4 py-1.5 text-sm " +
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
            <div>
              <label className="form-label">Title <Req /></label>
              <input className="form-input" value={form.title} onChange={(e) => set("title", e.target.value)} />
              {errors.title && <p className="form-error">{errors.title}</p>}
            </div>
            <div>
              <label className="form-label">Event Objective</label>
              <textarea
                className="form-input"
                rows={3}
                value={form.expected_outcome}
                onChange={(e) => set("expected_outcome", e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Personal Objective relevant to EE <Req /></label>
              <textarea
                className="form-input"
                rows={3}
                placeholder="What is your personal objective relevant to EE?"
                value={form.personal_objective}
                onChange={(e) => set("personal_objective", e.target.value)}
              />
              {errors.personal_objective && <p className="form-error">{errors.personal_objective}</p>}
            </div>
            <div>
              <label className="form-label">Description <Req /></label>
              <textarea
                className="form-input"
                rows={4}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
              {errors.description && <p className="form-error">{errors.description}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Start Date <Req /></label>
                <input
                  type="date"
                  className="form-input"
                  value={form.start_date}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    set("start_date", newStart);
                    // If the current end date is now before the new start
                    // date, clear it rather than silently keeping an
                    // invalid range.
                    if (form.end_date && form.end_date < newStart) set("end_date", "");
                  }}
                />
                {errors.start_date && <p className="form-error">{errors.start_date}</p>}
              </div>
              <div>
                <label className="form-label">End Date <Req /></label>
                <input
                  type="date"
                  className="form-input"
                  min={form.start_date || undefined}
                  value={form.end_date}
                  onChange={(e) => set("end_date", e.target.value)}
                />
                {errors.end_date && <p className="form-error">{errors.end_date}</p>}
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            {form.category === "international" ? (
              <InternationalLocationFields value={form} onChange={patch} errors={errors} />
            ) : (
              <>
            <div>
              <label className="form-label">Region <Req /></label>
              <select
                className="form-input"
                value={form.region}
                onChange={(e) => {
                  set("region", e.target.value);
                  set("city", "");
                }}
              >
                <option value="">Select a region...</option>
                {ETHIOPIA_REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {form.region === "Other" && (
                <input
                  className="form-input mt-2"
                  placeholder="Specify region"
                  value={form.regionOther}
                  onChange={(e) => set("regionOther", e.target.value)}
                />
              )}
              {errors.region && <p className="form-error">{errors.region}</p>}
            </div>
            <div>
              <label className="form-label">City <Req /></label>
              <select
                className="form-input"
                value={form.city}
                disabled={!form.region}
                onChange={(e) => set("city", e.target.value)}
              >
                <option value="">{form.region ? "Select a city..." : "Select a region first"}</option>
                {citiesForRegion(form.region).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {form.city === "Other" && (
                <input
                  className="form-input mt-2"
                  placeholder="Specify city"
                  value={form.cityOther}
                  onChange={(e) => set("cityOther", e.target.value)}
                />
              )}
              {errors.city && <p className="form-error">{errors.city}</p>}
            </div>
              </>
            )}
            <div>
              <label className="form-label">Venue <Req /></label>
              <input className="form-input" value={form.venue} onChange={(e) => set("venue", e.target.value)} />
              {errors.venue && <p className="form-error">{errors.venue}</p>}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div>
              <label className="form-label">Lead Organization <Req /></label>
              <select
                className="form-input"
                value={form.organization_lead_agency}
                onChange={(e) => set("organization_lead_agency", e.target.value)}
              >
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
                  value={form.organizationLeadAgencyOther}
                  onChange={(e) => set("organizationLeadAgencyOther", e.target.value)}
                />
              )}
              {errors.organization_lead_agency && <p className="form-error">{errors.organization_lead_agency}</p>}
            </div>
            <div>
              <label className="form-label">Thematic Area <Req /></label>
              <select
                className="form-input"
                value={form.thematic_area}
                onChange={(e) => set("thematic_area", e.target.value)}
              >
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
                  value={form.thematicAreaOther}
                  onChange={(e) => set("thematicAreaOther", e.target.value)}
                />
              )}
              {errors.thematic_area && <p className="form-error">{errors.thematic_area}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Engagement Level <Req /></label>
                <select
                  className="form-input"
                  value={form.engagement_level}
                  onChange={(e) => set("engagement_level", e.target.value)}
                >
                  <option value="">Select an engagement level...</option>
                  {configOptions.engagement_level.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                  <option value="Other">Other</option>
                </select>
                {ENGAGEMENT_LEVEL_DESCRIPTIONS[form.engagement_level] && (
                  <p className="text-xs text-ink-muted mt-1.5">{ENGAGEMENT_LEVEL_DESCRIPTIONS[form.engagement_level]}</p>
                )}
                {form.engagement_level === "Other" && (
                  <input
                    className="form-input mt-2"
                    placeholder="Specify engagement level"
                    value={form.engagementLevelOther}
                    onChange={(e) => set("engagementLevelOther", e.target.value)}
                  />
                )}
                {/* Item 6: Co-organizer needs to name which org is
                    co-organizing alongside EE. */}
                {form.engagement_level === "co_organizer" && (
                  <input
                    className="form-input mt-2"
                    placeholder="Name of the co-organizing organization"
                    value={form.coOrganizerName}
                    onChange={(e) => set("coOrganizerName", e.target.value)}
                  />
                )}
                {errors.engagement_level && <p className="form-error">{errors.engagement_level}</p>}
              </div>
              {/* Item: not applicable when EE is the Lead Organization. */}
              {!isEE(form.organization_lead_agency) && (
                <div>
                  <label className="form-label">Support Level <Req /></label>
                  <select
                    className="form-input"
                    value={form.support_level}
                    onChange={(e) => set("support_level", e.target.value)}
                  >
                    {Object.entries(SUPPORT_LEVEL_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {errors.support_level && <p className="form-error">{errors.support_level}</p>}
                </div>
              )}
            </div>
            {/* EE leading (Lead Org/Organizer/Co-organizer) shows the overall
                total headcount (required) plus EE's own contingent. When
                EE is only a participant, the overall total is not asked
                at all: just EE's own headcount (below). */}
            {eeLeads && (
              <div>
                <label className="form-label">Total Expected Number of Participants <Req /></label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="form-input"
                  placeholder="e.g. 120"
                  value={form.total_expected_participants}
                  onChange={(e) => set("total_expected_participants", e.target.value)}
                />
                {errors.total_expected_participants && (
                  <p className="form-error">{errors.total_expected_participants}</p>
                )}
              </div>
            )}
            <div>
              {/* EE's own headcount: required whether or not EE leads. */}
              <label className="form-label">
                Expected Number of Participants from EE <Req />
              </label>
              <input
                type="text"
                inputMode="numeric"
                className="form-input"
                placeholder="e.g. 50"
                value={form.expected_participants}
                onChange={(e) => set("expected_participants", e.target.value)}
              />
              {errors.expected_participants && <p className="form-error">{errors.expected_participants}</p>}
            </div>
          </>
        )}

        {step === 4 && (
          <div>
            <p className="text-sm text-ink mb-3">Do you need Communications Support for this event? <Req /></p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => set("needs_comms_support", true)}
                className={form.needs_comms_support === true ? "btn-primary" : "btn-secondary"}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => set("needs_comms_support", false)}
                className={form.needs_comms_support === false ? "btn-primary" : "btn-secondary"}
              >
                No
              </button>
            </div>
            {errors.needs_comms_support && <p className="form-error">{errors.needs_comms_support}</p>}
          </div>
        )}

        {step === 5 && (
          <>
            {form.needs_comms_support && (
            <>
            <div>
              <label className="form-label">Support Types Needed <Req /> <span className="text-ink-faint font-normal">(select one or more)</span></label>
              <div className="space-y-3">
                {Object.entries(SUPPORT_TYPE_LABELS).map(([value, label]) => {
                  const checked = form.support_types.includes(value);
                  return (
                    <div key={value} className="border border-line rounded p-3">
                      <label className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSupportType(value)}
                          className="rounded border-line"
                        />
                        {label}
                      </label>
                      {checked && (
                        <input
                          className="form-input mt-2"
                          placeholder={
                            value === "other"
                              ? "Describe what support is needed (required)"
                              : "Optional description (e.g. size, deadline, format)"
                          }
                          value={form.support_details[value] || ""}
                          onChange={(e) => setSupportDetail(value, e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {errors.support_types && <p className="form-error">{errors.support_types}</p>}
              {errors.other && <p className="form-error">{errors.other}</p>}
            </div>
            <div>
              <label className="form-label">Additional Notes</label>
              <textarea
                className="form-input"
                rows={3}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>
            </>
            )}

            <div className={form.needs_comms_support ? "pt-4 border-t border-line" : ""}>
              <p className="text-sm font-medium text-ink mb-1">Operation Request <Req /></p>
              <p className="text-sm text-ink-muted mb-3">Please indicate whether there is an operation request.</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => set("has_operational_request", true)}
                  className={form.has_operational_request === true ? "btn-primary" : "btn-secondary"}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => set("has_operational_request", false)}
                  className={form.has_operational_request === false ? "btn-primary" : "btn-secondary"}
                >
                  No
                </button>
              </div>
              {errors.has_operational_request && <p className="form-error">{errors.has_operational_request}</p>}

              {form.has_operational_request === true && (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="form-label">To whom is the request made? <Req /></label>
                    <StaffPicker
                      value={form.operational_request_to}
                      valueName={form.operational_request_to_name}
                      invalid={!!errors.operational_request_to}
                      onChange={(id, name) => setForm((f) => ({ ...f, operational_request_to: id, operational_request_to_name: name }))}
                    />
                    {errors.operational_request_to && <p className="form-error">{errors.operational_request_to}</p>}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex justify-between pt-4 border-t border-line">
          {/* No Back button on the first page; the empty span keeps Next on the right. */}
          {step > 1 ? (
            <button type="button" className="jm-back-btn" onClick={goBack} disabled={isSubmitting}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
          ) : (
            <span />
          )}
          {step === maxStep ? (
            <button
              type="button"
              className="btn-primary disabled:!cursor-wait"
              onClick={handleFinalSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting && <Spinner size={14} className="!text-white" />}
              {isSubmitting ? "Submitting..." : "Submit"}
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={goNext}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
