import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { eventsApi } from "../../api/events";
import { reportsApi } from "../../api/reports";
import ConfirmDialog from "../../components/common/ConfirmDialog.jsx";
import { PageLoader } from "../../components/common/Spinner.jsx";
import LoadError from "../../components/common/LoadError.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage } from "../../utils/format";
import { XIcon } from "../../components/common/UiGlyphs.jsx";

const emptyAction = () => ({ action: "", responsible: "", deadline: "" });
// Every submitted report needs 4-5 photos, a hard requirement (Submit is
// disabled/rejected outside this range), matching the same range the
// backend enforces in PostEventReportSubmitView.
const MIN_PHOTOS = 4;
const MAX_PHOTOS = 5;

// Participation counts are plain whole numbers. They used to be
// a number input, which lets the mouse wheel / touchpad scroll and the
// spinner arrows change the value by accident (just scrolling the page over a
// focused box could alter a count). A text input with a numeric keypad hint
// and digits-only filtering behaves like a normal box: only typing changes it.
function onlyDigits(value) {
  return String(value).replace(/\D/g, "");
}

// Fixed per-organization participation rows, not admin-configurable, this
// is a closed list per the request, plus a free-text "Other" row below it.
const ORG_ROWS = [
  ["participants_ee_staff", "EE Staff"],
  ["participants_moh", "MOH"],
  ["participants_rhb", "RHB Participants"],
  ["participants_zhd", "ZHD Participants"],
  ["participants_university", "University Staff"],
  ["participants_partner", "Partner Participants"],
  ["participants_woho", "WoHO Participants"],
  ["participants_hospital", "Hospital Participants"],
  ["participants_health_center", "Health Center Participants"],
  ["participants_health_post", "Health Post Participants"],
];

export default function PostEventReportForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [event, setEvent] = useState(null);
  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  // Photos already uploaded to a saved report (has a real id/URL from
  // the backend).
  const [photos, setPhotos] = useState([]);
  // Redesign: photos picked before a report exists yet, held as plain
  // File objects with a local preview URL, nothing sent to the server
  // until Save or Submit is clicked. This removes the old requirement
  // that a draft report already exist just to pick a photo (which is
  // what silently created an empty draft on page load, and broke when
  // the model required the narrative fields to be
  // non-blank). Now: pick photos any time, they upload together with
  // the rest of the form on Save/Submit.
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const [submitErrors, setSubmitErrors] = useState({});

  const [form, setForm] = useState({
    major_accomplishment: "",
    best_practices_lessons_actions: "",
    // Per a later request, this no longer defaults to "None", left
    // blank, it now just saves/submits blank, same as every other
    // optional field on this form (no auto-inserted text anywhere).
    challenges_faced: "",
    recommendation_conclusion: "",
    // Total Participants is asked first, as its own field, Male + Female
    // (entered normally below it) must add up to whatever's typed here.
    // Not sent to the backend on its own; PostEventReport.participants_total
    // is already a computed Male+Female property there, so this is purely
    // a front-of-form prompt + cross-check, not a duplicate stored value.
    participants_total: "",
    participants_male: "",
    participants_female: "",
    participants_ee_staff: "",
    participants_moh: "",
    participants_rhb: "",
    participants_zhd: "",
    participants_university: "",
    participants_partner: "",
    participants_woho: "",
    participants_hospital: "",
    participants_health_center: "",
    participants_health_post: "",
    participants_other_count: "",
    follow_up_actions: [emptyAction()],
    // Item #10: repeatable social media/post links for the event, same
    // add/remove-row pattern as follow_up_actions above, one URL per row.
    event_social_links: [""],
  });

  async function load() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const { data: eventData } = await eventsApi.retrieve(id);
      setEvent(eventData);

      try {
        const { data: reportData } = await reportsApi.getReportForEvent(id);
        setReport(reportData);
        setPhotos(reportData.photos || []);
        setForm({
          major_accomplishment: reportData.major_accomplishment || "",
          best_practices_lessons_actions: reportData.best_practices_lessons_actions || "",
          challenges_faced: reportData.challenges_faced || "",
          recommendation_conclusion: reportData.recommendation_conclusion || "",
          // Pre-filled from the saved Male+Female so re-opening a draft
          // shows a consistent total rather than starting blank again.
          participants_total:
            reportData.participants_male == null && reportData.participants_female == null
              ? ""
              : (reportData.participants_male || 0) + (reportData.participants_female || 0),
          participants_male: reportData.participants_male ?? "",
          participants_female: reportData.participants_female ?? "",
          participants_ee_staff: reportData.participants_ee_staff || "",
          participants_moh: reportData.participants_moh || "",
          participants_rhb: reportData.participants_rhb || "",
          participants_zhd: reportData.participants_zhd || "",
          participants_university: reportData.participants_university || "",
          participants_partner: reportData.participants_partner || "",
          participants_woho: reportData.participants_woho || "",
          participants_hospital: reportData.participants_hospital || "",
          participants_health_center: reportData.participants_health_center || "",
          participants_health_post: reportData.participants_health_post || "",
          participants_other_count: reportData.participants_other_count || "",
          follow_up_actions:
            reportData.follow_up_actions?.length > 0
              ? reportData.follow_up_actions.map((a) => ({ action: a.action, responsible: a.responsible, deadline: a.deadline }))
              : [emptyAction()],
          event_social_links:
            reportData.event_social_links?.length > 0 ? reportData.event_social_links : [""],
        });
      } catch {
        // No report yet, that's expected for an event that hasn't been
        // saved/submitted. Nothing to silently create here anymore; the
        // form works fine with report === null (see handleSave/handleSubmit,
        // which create the report at that point instead).
      }
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

  // Revoke local preview URLs when they're no longer needed, so we don't
  // leak object URLs as the user adds/removes pending photos.
  useEffect(() => {
    return () => {
      pendingPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function updateAction(idx, field, value) {
    setForm((f) => {
      const actions = [...f.follow_up_actions];
      actions[idx] = { ...actions[idx], [field]: value };
      return { ...f, follow_up_actions: actions };
    });
  }

  function addAction() {
    setForm((f) => ({ ...f, follow_up_actions: [...f.follow_up_actions, emptyAction()] }));
  }

  function removeAction(idx) {
    setForm((f) => ({ ...f, follow_up_actions: f.follow_up_actions.filter((_, i) => i !== idx) }));
  }

  function updateSocialLink(idx, value) {
    setForm((f) => {
      const links = [...f.event_social_links];
      links[idx] = value;
      return { ...f, event_social_links: links };
    });
  }

  function addSocialLink() {
    setForm((f) => ({ ...f, event_social_links: [...f.event_social_links, ""] }));
  }

  function removeSocialLink(idx) {
    setForm((f) => ({ ...f, event_social_links: f.event_social_links.filter((_, i) => i !== idx) }));
  }

  function buildPayload() {
    return {
      major_accomplishment: form.major_accomplishment,
      best_practices_lessons_actions: form.best_practices_lessons_actions,
      challenges_faced: form.challenges_faced,
      recommendation_conclusion: form.recommendation_conclusion,
      participants_male: form.participants_male === "" ? null : Number(form.participants_male),
      participants_female: form.participants_female === "" ? null : Number(form.participants_female),
      participants_ee_staff: Number(form.participants_ee_staff) || 0,
      participants_moh: Number(form.participants_moh) || 0,
      participants_rhb: Number(form.participants_rhb) || 0,
      participants_zhd: Number(form.participants_zhd) || 0,
      participants_university: Number(form.participants_university) || 0,
      participants_partner: Number(form.participants_partner) || 0,
      participants_woho: Number(form.participants_woho) || 0,
      participants_hospital: Number(form.participants_hospital) || 0,
      participants_health_center: Number(form.participants_health_center) || 0,
      participants_health_post: Number(form.participants_health_post) || 0,
      participants_other_count: Number(form.participants_other_count) || 0,
      follow_up_actions: form.follow_up_actions.filter((a) => a.action.trim()),
      event_social_links: form.event_social_links.map((l) => l.trim()).filter(Boolean),
    };
  }

  // Save (draft) intentionally allows incomplete data, only Submit
  // requires everything filled in, since Submit is the one-time final
  // action (FR33/FR34) and the person should get clear, specific errors
  // up front rather than a raw backend validation message.
  function validateForSubmit() {
    const errors = {};
    if (!form.major_accomplishment.trim()) errors.major_accomplishment = "Event Overview is required.";
    if (!form.best_practices_lessons_actions.trim()) {
      errors.best_practices_lessons_actions =
        "Key Learnings & Action Points is required.";
    }
    // Partnership opportunities (recommendation_conclusion) is
    // intentionally not required — not every event surfaces a future
    // partnership opportunity, same reasoning as Challenges & Issues below.
    // Challenges Faced is intentionally not required, it's blank by
    // default and stays valid as-is if the reporter has nothing to add.
    // Item #10: Participation is only asked for (and required) when EE
    // is leading this event, Lead Organization, Organizer, or
    // Co-organizer (event.ee_leads, computed backend-side), same rule
    // that already gates the section's fields off entirely, below.
    if (event.ee_leads) {
      if (form.participants_total === "") {
        errors.participants = "Total Participants is required.";
      } else if (form.participants_male === "" || form.participants_female === "") {
        errors.participants = "Male and Female are required.";
      } else if (Number(form.participants_male) + Number(form.participants_female) !== Number(form.participants_total)) {
        errors.participants = `Male + Female must add up to Total Participants (${form.participants_total}).`;
      }
      // Same "must add up to Total Participants" rule as Male/Female, applied
      // to the organization breakdown, as its own error slot (participants_org)
      // rather than reusing `errors.participants`, that field's error renders
      // right after Male/Female, before the org breakdown even starts, so a
      // shared message would show up in the wrong place for this check. Blank
      // org rows count as 0 (they're optional, same as how the submit payload
      // already treats them with `|| 0`); checked independently of the
      // Male/Female result above so both can be reported at once.
      if (form.participants_total !== "") {
        const orgSum =
          ORG_ROWS.reduce((sum, [field]) => sum + (Number(form[field]) || 0), 0) +
          (Number(form.participants_other_count) || 0);
        if (orgSum !== Number(form.participants_total)) {
          errors.participants_org = `Breakdown by organization must add up to Total Participants (${form.participants_total}). It currently adds up to ${orgSum}.`;
        }
      }
    }
    // A follow-up action row only counts once ANY field is filled in, but
    // if it does, all three fields must be present. Otherwise the backend
    // rejects a partial row (e.g. Action + Responsible but no Deadline)
    // with a nested validation error that's confusing to surface as-is.
    const incompleteActionIndex = form.follow_up_actions.findIndex((a) => {
      const touched = a.action.trim() || a.responsible.trim() || a.deadline;
      return touched && (!a.action.trim() || !a.responsible.trim() || !a.deadline);
    });
    if (incompleteActionIndex !== -1) {
      errors.follow_up_actions = `Follow-up action #${incompleteActionIndex + 1} is incomplete. Action, Responsible, and Deadline are all required for any row you start filling in.`;
    }
    const totalPhotos = photos.length + pendingPhotos.length;
    if (totalPhotos < MIN_PHOTOS || totalPhotos > MAX_PHOTOS) {
      errors.photos = `Attach between ${MIN_PHOTOS} and ${MAX_PHOTOS} photos before submitting (currently ${totalPhotos}).`;
    }
    setSubmitErrors(errors);
    return Object.keys(errors).length === 0;
  }

  // Uploads every pending (not-yet-uploaded) photo to the given report id,
  // one at a time (the upload endpoint takes a single file per call).
  // Stops and surfaces the first failure, e.g. hitting the admin-set
  // per-report photo limit partway through, rather than silently losing
  // photos with no explanation.
  async function uploadPendingPhotos(reportId) {
    if (pendingPhotos.length === 0) return;
    // Each photo leaves the pending list as soon as it is uploaded, so a
    // failure partway never re-uploads (duplicates) the ones already saved.
    for (const pending of pendingPhotos) {
      const { data } = await reportsApi.uploadPhoto(reportId, pending.file);
      URL.revokeObjectURL(pending.previewUrl);
      setPhotos((p) => [...p, data]);
      setPendingPhotos((p) => p.filter((ph) => ph.previewUrl !== pending.previewUrl));
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const payload = buildPayload();
      let currentReport = report;
      if (!currentReport) {
        const { data } = await reportsApi.createReport(id, payload);
        currentReport = data;
      } else {
        const { data } = await reportsApi.updateReport(currentReport.id, payload);
        currentReport = data;
      }
      setReport(currentReport);
      // Photos picked so far are saved with the draft too, so they are
      // still there when the draft is reopened.
      await uploadPendingPhotos(currentReport.id);
      showToast("Draft saved.", "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  function handleSubmitClick() {
    if (!validateForSubmit()) {
      showToast("Please fill in the required fields before submitting.", "error");
      return;
    }
    setShowSubmitConfirm(true);
  }

  async function handleSubmit() {
    setIsSaving(true);
    try {
      let currentReport = report;
      const payload = buildPayload();
      if (!currentReport) {
        const { data } = await reportsApi.createReport(id, payload);
        currentReport = data;
      } else {
        const { data } = await reportsApi.updateReport(currentReport.id, payload);
        currentReport = data;
      }
      setReport(currentReport);
      // Photos go up before the final Submit call, once submitted the
      // report is locked (EventPhotoUploadView rejects uploads to a
      // submitted report), so this is the last point they can attach.
      await uploadPendingPhotos(currentReport.id);
      await reportsApi.submitReport(currentReport.id);
      showToast("Event Status Report submitted.", "success");
      navigate(`/events/${id}`);
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
      setShowSubmitConfirm(false);
    }
  }

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (photos.length + pendingPhotos.length >= MAX_PHOTOS) {
      showToast(`Maximum of ${MAX_PHOTOS} photos per event.`, "error");
      return;
    }
    setPendingPhotos((p) => [...p, { file, previewUrl: URL.createObjectURL(file) }]);
  }

  function removePendingPhoto(previewUrl) {
    setPendingPhotos((p) => p.filter((ph) => ph.previewUrl !== previewUrl));
    URL.revokeObjectURL(previewUrl);
  }

  async function handlePhotoDelete(photoId) {
    try {
      await reportsApi.deletePhoto(photoId);
      setPhotos((p) => p.filter((ph) => ph.id !== photoId));
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  }

  if (loadError) return <LoadError message={loadError} onRetry={load} />;
  if (isLoading || !event) return <PageLoader />;

  const isLocked = report?.status === "submitted";
  const totalPhotoCount = photos.length + pendingPhotos.length;
  // Item #10: Participation is only asked for when EE is leading this
  // event, Lead Organization, Organizer, or Co-organizer, computed
  // backend-side (Event.ee_leads) and mirrored by validateForSubmit above,
  // so this one flag controls both whether the section shows and whether
  // it's required.
  const eeLeads = !!event.ee_leads;

  return (
    <div className="max-w-2xl space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="jm-back-btn"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </button>
      <div>
        <h1 className="text-2xl">Event Status Report</h1>
        <p className="text-sm text-ink-muted">{event.title}</p>
      </div>

      {isLocked && (
        <div className="rounded border border-success bg-success/5 text-success text-sm px-3 py-2">
          This report has been submitted and can no longer be edited.
        </div>
      )}

      <div className="card p-5 space-y-5">
        <div>
          <label className="form-label">Event Overview <span className="text-warning">*</span></label>
          <p className="text-xs text-ink-faint mb-1.5">
            The event at a glance: detail out how the event flowed, major happenings, opening remarks, group works,
            presentations, pre-test/post-test results, workshop evaluation, etc.
          </p>
          <textarea
            className="form-input"
            rows={6}
            disabled={isLocked}
            placeholder="Describe how the event unfolded from start to finish..."
            value={form.major_accomplishment}
            onChange={(e) => set("major_accomplishment", e.target.value)}
          />
          {submitErrors.major_accomplishment && <p className="form-error">{submitErrors.major_accomplishment}</p>}
        </div>

        <div>
          <label className="form-label">
            Key Learnings & Action Points <span className="text-warning">*</span>
          </label>
          <p className="text-xs text-ink-faint mb-1.5">
            Best practices, lessons learned, agreed actions, recommendations, and follow-up points.
          </p>
          <textarea
            className="form-input"
            rows={5}
            disabled={isLocked}
            placeholder="One per line, e.g. as bullet points."
            value={form.best_practices_lessons_actions}
            onChange={(e) => set("best_practices_lessons_actions", e.target.value)}
          />
          {submitErrors.best_practices_lessons_actions && (
            <p className="form-error">{submitErrors.best_practices_lessons_actions}</p>
          )}
        </div>

        <div>
          <label className="form-label">Challenges & Issues</label>
          <p className="text-xs text-ink-faint mb-1.5">
            Put any challenges encountered during the event or issues that need attention.
          </p>
          <textarea
            className="form-input"
            rows={3}
            disabled={isLocked}
            value={form.challenges_faced}
            onChange={(e) => set("challenges_faced", e.target.value)}
          />
        </div>

        <div>
          <label className="form-label">Partnership opportunities</label>
          <p className="text-xs text-ink-faint mb-1.5">
            Put any opportunities for future partnership with EE expressed in the event.
          </p>
          <textarea
            className="form-input"
            rows={4}
            disabled={isLocked}
            value={form.recommendation_conclusion}
            onChange={(e) => set("recommendation_conclusion", e.target.value)}
          />
          {submitErrors.recommendation_conclusion && <p className="form-error">{submitErrors.recommendation_conclusion}</p>}
        </div>

        {eeLeads && (
        <div>
          <label className="form-label">Participation <span className="text-warning">*</span></label>
          <div className="max-w-[200px] mb-3">
            <label className="text-xs text-ink-muted">Total Participants</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="form-input"
              disabled={isLocked}
              value={form.participants_total}
              onChange={(e) => set("participants_total", onlyDigits(e.target.value))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 max-w-xs mb-3">
            <div>
              <label className="text-xs text-ink-muted">Male</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className="form-input"
                disabled={isLocked}
                value={form.participants_male}
                onChange={(e) => set("participants_male", onlyDigits(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs text-ink-muted">Female</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className="form-input"
                disabled={isLocked}
                value={form.participants_female}
                onChange={(e) => set("participants_female", onlyDigits(e.target.value))}
              />
            </div>
          </div>
          {submitErrors.participants && <p className="form-error mb-2">{submitErrors.participants}</p>}

          <p className="text-xs text-ink-muted mb-2">Breakdown by organization</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {ORG_ROWS.map(([field, label]) => (
              <div key={field}>
                <label className="text-xs text-ink-muted">{label}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className="form-input"
                  disabled={isLocked}
                  value={form[field]}
                  onChange={(e) => set(field, onlyDigits(e.target.value))}
                />
              </div>
            ))}
            <div>
              <label className="text-xs text-ink-muted">Others Specify</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className="form-input"
                disabled={isLocked}
                value={form.participants_other_count}
                onChange={(e) => set("participants_other_count", onlyDigits(e.target.value))}
              />
            </div>
          </div>
          {/* Own error slot (participants_org), separate from
              submitErrors.participants above, reports whether the org
              breakdown adds up to Total Participants, same rule as
              Male/Female, checked independently so both can surface at
              once if they're both wrong. */}
          {submitErrors.participants_org && <p className="form-error mt-2">{submitErrors.participants_org}</p>}
        </div>
        )}

        <div>
          <label className="form-label">Follow-up Actions</label>
          <div className="space-y-2">
            {form.follow_up_actions.map((action, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                <input
                  className="form-input col-span-5"
                  placeholder="Action"
                  disabled={isLocked}
                  value={action.action}
                  onChange={(e) => updateAction(idx, "action", e.target.value)}
                />
                <input
                  className="form-input col-span-4"
                  placeholder="Responsible"
                  disabled={isLocked}
                  value={action.responsible}
                  onChange={(e) => updateAction(idx, "responsible", e.target.value)}
                />
                <input
                  type="date"
                  className="form-input col-span-2"
                  disabled={isLocked}
                  value={action.deadline}
                  onChange={(e) => updateAction(idx, "deadline", e.target.value)}
                />
                {!isLocked && form.follow_up_actions.length > 1 && (
                  <button
                    type="button"
                    className="col-span-1 text-warning text-sm"
                    onClick={() => removeAction(idx)}
                  >
                    <XIcon width={12} height={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!isLocked && (
            <button type="button" className="text-sm text-navy-600 hover:underline mt-2" onClick={addAction}>
              + Add another action
            </button>
          )}
          {submitErrors.follow_up_actions && <p className="form-error">{submitErrors.follow_up_actions}</p>}
        </div>

        <div>
          <label className="form-label">Event Social Links</label>
          <p className="text-xs text-ink-faint mb-1.5">
            Links to posts about the event (Facebook, LinkedIn, X, etc.), if any.
          </p>
          <div className="space-y-2">
            {form.event_social_links.map((link, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                <input
                  type="url"
                  className="form-input col-span-11"
                  placeholder="https://..."
                  disabled={isLocked}
                  value={link}
                  onChange={(e) => updateSocialLink(idx, e.target.value)}
                />
                {!isLocked && form.event_social_links.length > 1 && (
                  <button
                    type="button"
                    className="col-span-1 text-warning text-sm"
                    onClick={() => removeSocialLink(idx)}
                  >
                    <XIcon width={12} height={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!isLocked && (
            <button type="button" className="text-sm text-navy-600 hover:underline mt-2" onClick={addSocialLink}>
              + Add another link
            </button>
          )}
        </div>

        <div>
          <label className="form-label">
            Photos <span className="text-warning">*</span> ({MIN_PHOTOS}-{MAX_PHOTOS} required, JPG/PNG, 5MB each)
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {photos.map((p) => (
              <div key={p.id} className="relative">
                <img src={p.image} alt="" className="h-20 w-20 object-cover rounded border border-line" />
                {!isLocked && (
                  <button
                    type="button"
                    onClick={() => handlePhotoDelete(p.id)}
                    className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-warning text-white text-xs"
                  >
                    <XIcon width={12} height={12} />
                  </button>
                )}
              </div>
            ))}
            {/* Pending photos, picked but not uploaded yet; go up on Save/Submit. */}
            {pendingPhotos.map((p) => (
              <div key={p.previewUrl} className="relative">
                <img src={p.previewUrl} alt="" className="h-20 w-20 object-cover rounded border-2 border-dashed border-ems-primary opacity-80" />
                <button
                  type="button"
                  onClick={() => removePendingPhoto(p.previewUrl)}
                  className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-warning text-white text-xs"
                >
                  <XIcon width={12} height={12} />
                </button>
              </div>
            ))}
          </div>
          {!isLocked && totalPhotoCount < MAX_PHOTOS && (
            <input type="file" accept="image/jpeg,image/png" onChange={handlePhotoSelect} className="text-sm" />
          )}
          {pendingPhotos.length > 0 && (
            <p className="text-xs text-ink-faint mt-1">
              {pendingPhotos.length} photo{pendingPhotos.length === 1 ? "" : "s"} will upload when you Save Draft or Submit.
            </p>
          )}
          {!isLocked && (
            <p className="text-xs text-ink-faint mt-1">
              {totalPhotoCount} of {MIN_PHOTOS}-{MAX_PHOTOS} required.
            </p>
          )}
          {submitErrors.photos && <p className="form-error">{submitErrors.photos}</p>}
        </div>

        {!isLocked && (
          <div className="flex justify-end gap-3 pt-4 border-t border-line">
            <button className="btn-secondary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Draft"}
            </button>
            <button
              className="btn-primary"
              onClick={handleSubmitClick}
              disabled={isSaving || totalPhotoCount < MIN_PHOTOS || totalPhotoCount > MAX_PHOTOS}
              title={
                totalPhotoCount < MIN_PHOTOS || totalPhotoCount > MAX_PHOTOS
                  ? `Attach between ${MIN_PHOTOS} and ${MAX_PHOTOS} photos to submit`
                  : undefined
              }
            >
              Submit
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showSubmitConfirm}
        title="Submit Event Status Report?"
        message="Once submitted, this report cannot be edited and the event will be marked Completed."
        confirmLabel="Submit"
        isSubmitting={isSaving}
        onConfirm={handleSubmit}
        onCancel={() => setShowSubmitConfirm(false)}
      />
    </div>
  );
}
