import { useEffect, useRef, useState } from "react";
import { tvDisplayApi } from "../../api/tvDisplay";
import { useAuth } from "../../auth/AuthContext.jsx";
import ConfirmDialog from "../../components/common/ConfirmDialog.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage } from "../../utils/format";
import HomeContentPanel from "../Content/HomeContentPanel.jsx";
import { EditorPanel, QueueActionsMenu, QueueBadge } from "./QueueManagementUi.jsx";
import { CaretUpIcon, CaretDownIcon } from "../../components/common/UiGlyphs.jsx";

// Mirrors backend apps.tv_display.models.SECTION_LABELS / AUTOMATIC_SECTION_KEYS
//, small and static enough to duplicate here rather than derive from the
// API's sections_display on every render (keeps reorder/toggle logic
// operating on the plain writable `sections` array only).
const TV_SECTION_LABELS = {
  staff_spotlight: "Staff Spotlight",
  todays_activities: "Today's Activities",
  upcoming_events: "Upcoming Events",
  celebrations: "Celebrations",
  announcements: "TV Announcements",
  home_news: "News",
  home_major_events: "Major Events",
  home_announcements: "Announcements",
  recognitions: "Recognitions",
  quick_information: "Quick Information",
  system_dashboards: "Event Analytics",
  system_dashboard_picks: "System Dashboards",
};
const TV_AUTOMATIC_KEYS = new Set(["upcoming_events", "system_dashboards"]);
// News (Home Page) / Major Events (Home Page) / Announcements (Home Page) -
// three separately orderable/toggleable queues (previously one combined
// "home_content" section) so each can sit wherever makes sense in the
// rotation on its own. Not automatic (nothing shows until someone adds
// content) but also not plain TVDisplaySlide queues: each "Add content"
// still opens the exact same shared Add Content form as Home Page > Manage
// Content (HomeContentPanel below, unchanged by the split - you still pick
// News/Major Event/Announcement inside that one form), reusing that same
// content pool rather than a second, TV-only copy of it.
const HOME_CONTENT_SECTION_KEYS = new Set(["home_news", "home_major_events", "home_announcements"]);
// Which Home content type each of the three TV queues shows (mirrors
// apps.tv_display.models.HOME_CONTENT_TYPE_BY_SECTION_KEY). Used to lock the
// "Add content" form to the queue it was opened from.
const HOME_CONTENT_TYPE_BY_SECTION_KEY = {
  home_news: "news",
  home_major_events: "major_event",
  home_announcements: "announcement",
};
// Phase 32: the one section that's neither automatic nor slide-based, a
// checklist of existing dashboards instead of an add/edit/remove slide
// list. Mirrors backend apps.tv_display.models.DASHBOARD_PICK_KEYS/LABELS.
const DASHBOARD_PICK_SECTION_KEYS = new Set(["system_dashboard_picks"]);
const DASHBOARD_PICK_LABELS = {
  org_summary: "Organization Summary",
  participant_overview: "Participant Overview",
  region_breakdown: "Events by Region",
  comms_support: "Communications Support Overview",
};

// Event Analytics period picker, deliberately the same vocabulary and
// date math as the main Dashboard's Weekly/Monthly/Quarterly/Yearly/All
// toggle (frontend Dashboard.jsx's computePeriodRange) so an Admin can
// point the TV's "Event Analytics" screen at the exact same window the
// Dashboard is showing, one click at a time, instead of it being stuck on
// a fixed period. "Custom" is deliberately left out here (unlike the
// Dashboard), a hand-picked date range would just go stale forever on an
// always-on TV with nobody to update it.
const ANALYTICS_PERIOD_OPTIONS = ["all", "weekly", "monthly", "quarterly", "yearly"];
const ANALYTICS_QUARTERS = [
  { value: 1, label: "Q1 (Jul-Sep)" },
  { value: 2, label: "Q2 (Oct-Dec)" },
  { value: 3, label: "Q3 (Jan-Mar)" },
  { value: 4, label: "Q4 (Apr-Jun)" },
];
// Same fiscal-year mapping as Dashboard.jsx's FISCAL_QUARTER_START_MONTH ,
// quarters start in July, so Q3/Q4 land in Jan-Jun of the selected year.
const ANALYTICS_FISCAL_QUARTER_START_MONTH = { 1: 6, 2: 9, 3: 0, 4: 3 };
const ANALYTICS_WEEKS_OF_MONTH = [
  { value: 1, label: "Week 1 (1-7)" },
  { value: 2, label: "Week 2 (8-14)" },
  { value: 3, label: "Week 3 (15-21)" },
  { value: 4, label: "Week 4 (22-end)" },
];
const ANALYTICS_MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" }, { value: 3, label: "March" },
  { value: 4, label: "April" }, { value: 5, label: "May" }, { value: 6, label: "June" },
  { value: 7, label: "July" }, { value: 8, label: "August" }, { value: 9, label: "September" },
  { value: 10, label: "October" }, { value: 11, label: "November" }, { value: 12, label: "December" },
];

// Mirrors Dashboard.jsx's computePeriodRange exactly (same "current unless
// a specific week/month/quarter/year was picked" fallback logic) so the
// preview shown here, and the range the live TV screen actually
// requests, always agrees with what the main Dashboard would show for
// the same period. Kept as its own small copy here (TV Display owns its
// own settings screen) rather than importing across pages.
function computeAnalyticsPeriodRange(period, periodSelection) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const sel = periodSelection || {};

  if (period === "all") return null;
  if (period === "weekly") {
    const year = sel.year ?? today.getFullYear();
    const month = sel.month ?? today.getMonth() + 1;
    const week = sel.week ?? Math.min(4, Math.ceil(today.getDate() / 7));
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDay = (week - 1) * 7 + 1;
    const endDay = week === 4 ? daysInMonth : Math.min(week * 7, daysInMonth);
    return { date_from: iso(new Date(year, month - 1, startDay)), date_to: iso(new Date(year, month - 1, endDay)) };
  }
  if (period === "quarterly") {
    const year = sel.year ?? today.getFullYear();
    const quarter = sel.quarter ?? (((today.getMonth() - 6 + 12) % 12) / 3 | 0) + 1;
    const startMonth = ANALYTICS_FISCAL_QUARTER_START_MONTH[quarter];
    return { date_from: iso(new Date(year, startMonth, 1)), date_to: iso(new Date(year, startMonth + 3, 0)) };
  }
  if (period === "yearly") {
    const year = sel.year ?? today.getFullYear();
    return { date_from: iso(new Date(year, 0, 1)), date_to: iso(new Date(year, 11, 31)) };
  }
  // monthly (default)
  const year = sel.year ?? today.getFullYear();
  const month = sel.month ?? today.getMonth() + 1;
  return { date_from: iso(new Date(year, month - 1, 1)), date_to: iso(new Date(year, month, 0)) };
}

const EMPTY_SLIDE_DRAFT = {
  title: "",
  subtitle: "",
  message: "",
  useCustomDuration: false,
  duration_seconds: 15,
  start_date: "",
  end_date: "",
  photoFile: null,
  existingPhotoUrl: null,
  removePhoto: false,
};

// Phases 26/27/29/30/31: each of the 5 manual sections wants different
// things out of the same shared title/subtitle/message/photo fields ,
// this is just presentation (labels/placeholders/which fields show), not
// a schema difference, so one TVDisplaySlide model still covers all 5
// (see backend models.py's comment on `subtitle`/`photo` for why).
const SECTION_FIELD_CONFIG = {
  staff_spotlight: {
    titleLabel: "Name",
    titlePlaceholder: "e.g. Abebe Bekele",
    showSubtitle: true,
    subtitleLabel: "Position",
    subtitlePlaceholder: "e.g. Program Officer, Digital Health",
    showPhoto: true,
    messageLabel: "Short description",
    messagePlaceholder: "One or two sentences - keep it brief (Phase 27: no full biography).",
  },
  celebrations: {
    titleLabel: "Person / Occasion",
    titlePlaceholder: "e.g. Selam Tesfaye",
    showSubtitle: true,
    subtitleLabel: "Occasion (optional)",
    subtitlePlaceholder: "e.g. 5th Work Anniversary",
    showPhoto: true,
    messageLabel: "Detail (optional)",
    messagePlaceholder: "",
  },
  announcements: {
    titleLabel: "Title",
    titlePlaceholder: "e.g. Quarterly Organizational Meeting",
    showSubtitle: false,
    showPhoto: true,
    messageLabel: "Message",
    messagePlaceholder: "Keep it short - readable from across a room.",
  },
  recognitions: {
    titleLabel: "Name",
    titlePlaceholder: "e.g. Selam Tesfaye",
    showSubtitle: true,
    subtitleLabel: "Role or Program (optional)",
    subtitlePlaceholder: "e.g. Digital Health Program",
    showPhoto: false,
    messageLabel: "Reason for recognition",
    messagePlaceholder: "e.g. For outstanding contribution to the Digital Health program.",
  },
  quick_information: {
    titleLabel: "Title",
    titlePlaceholder: "e.g. Office Hours",
    showSubtitle: false,
    showPhoto: false,
    messageLabel: "Details",
    messagePlaceholder: "e.g. Monday to Friday, 08:30 to 17:30",
  },
  // Default form shape for admin-created custom queues (see "+ Add
  // queue" below), full title + subtitle + photo + message, same shape
  // as Staff Spotlight, since a custom queue could be anything from a
  // live announcement to a second spotlight-style rotation.
  custom: {
    titleLabel: "Title",
    titlePlaceholder: "e.g. Friday Team Lunch",
    showSubtitle: true,
    subtitleLabel: "Subtitle (optional)",
    subtitlePlaceholder: "",
    showPhoto: true,
    messageLabel: "Message",
    messagePlaceholder: "Keep it short - readable from across a room.",
  },
};

// Phase 26/33: a quick, glanceable read on a slide's schedule without
// having to open its edit form, "Expired"/"Scheduled" for slides whose
// start/end window doesn't currently include today (even if is_active is
// still true; the backend's active_only filter already keeps these off
// the live TV, this badge just explains why to whoever's managing them).
function scheduleStatus(slide) {
  const today = new Date().toISOString().slice(0, 10);
  if (slide.end_date && slide.end_date < today) return { label: "Expired", tone: "text-danger" };
  if (slide.start_date && slide.start_date > today) return { label: `Starts ${slide.start_date}`, tone: "text-ems-primary" };
  return null;
}

// Manual content for one section (Staff Spotlight, Celebrations,
// Announcements, Recognitions, Quick Information), the 5 sections that
// used to just say "Content management coming soon". Communications/Admin
// can add, edit, and remove slides here; everyone else sees the same list
// read-only, so it's obvious what's actually going to show on the TV
// instead of a placeholder that never changes.
// Phase 32 ("System Dashboards" optional content): a simple checklist,
// not an add/edit/remove content editor, there's nothing to author, just
// which of the fixed DASHBOARD_PICK_LABELS options currently appear in
// the rotation. Saved as part of the same TVDisplaySettings PATCH as
// `sections` (see handleSave), gated the same way (Admin/Leadership),
// since picking which dashboards to expose is a display-configuration
// decision, not content Communications curates.
function DashboardPicksManager({ picks, canManage, onToggle }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-faint">
        Only checked dashboards appear on the TV. Each reuses data already on the main Dashboard - nothing new to
        configure beyond picking which ones are relevant for a shared screen.
      </p>
      {Object.entries(DASHBOARD_PICK_LABELS).map(([key, label]) => {
        const pick = picks.find((p) => p.key === key);
        return (
          <label key={key} className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(pick?.enabled)}
              disabled={!canManage}
              onChange={() => onToggle(key)}
            />
            <span className="text-sm text-ink">{label}</span>
          </label>
        );
      })}
    </div>
  );
}

function SectionSlideManager({ sectionKey, sectionLabel, slides, canManage, onChanged, sharedDuration, sectionEnabled }) {
  const { showToast } = useToast();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY_SLIDE_DRAFT);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removing, setRemoving] = useState(false);
  // Falls back to the generic "custom" shape (full title/subtitle/photo/
  // message) for any section not in the fixed config above, i.e. an
  // admin-created queue, which isn't known ahead of time.
  const fieldConfig = SECTION_FIELD_CONFIG[sectionKey] || SECTION_FIELD_CONFIG.custom;

  function startEdit(slide) {
    setEditingId(slide.id);
    setAdding(false);
    setDraft({
      title: slide.title,
      subtitle: slide.subtitle || "",
      message: slide.message || "",
      useCustomDuration: slide.duration_seconds !== null && slide.duration_seconds !== undefined,
      duration_seconds: slide.duration_seconds ?? sharedDuration,
      start_date: slide.start_date || "",
      end_date: slide.end_date || "",
      photoFile: null,
      existingPhotoUrl: slide.photo || null,
      removePhoto: false,
    });
  }

  function startAdd() {
    setEditingId(null);
    setAdding(true);
    setDraft(EMPTY_SLIDE_DRAFT);
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setDraft(EMPTY_SLIDE_DRAFT);
  }

  async function save() {
    if (!draft.title.trim()) {
      showToast("Give the slide a title first.", "error");
      return;
    }
    setSaving(true);
    const payload = {
      section_key: sectionKey,
      title: draft.title.trim(),
      subtitle: draft.subtitle.trim(),
      message: draft.message.trim(),
      duration_seconds: draft.useCustomDuration ? Number(draft.duration_seconds) : null,
      start_date: draft.start_date || null,
      end_date: draft.end_date || null,
    };
    // Only include `photo` at all when a new file was actually chosen ,
    // sending it as null/absent on an edit would either fail validation
    // or (worse) silently clear an existing photo nobody meant to remove.
    // tvDisplayApi builds multipart automatically whenever a File is
    // present in the payload (see api/tvDisplay.js). Explicit removal
    // goes through `remove_photo` instead (see backend serializer) so
    // "leave it alone" and "take it away" can't be confused with each
    // other, this only sends remove_photo when there's no new file,
    // since a replacement should always win over a stale removal intent.
    if (draft.photoFile) {
      payload.photo = draft.photoFile;
    } else if (draft.removePhoto) {
      payload.remove_photo = true;
    }
    try {
      if (editingId) {
        await tvDisplayApi.updateSlide(editingId, payload);
        showToast("Slide updated.", "success");
      } else {
        await tvDisplayApi.createSlide(payload);
        showToast("Slide added - it'll show the next time this section comes up.", "success");
      }
      cancel();
      onChanged();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  }

  // Step 1: ask (the dialog at the bottom of this component). Step 2: remove.
  async function confirmRemoveSlide() {
    const slide = confirmRemove;
    if (!slide) return;
    setRemoving(true);
    try {
      await tvDisplayApi.deleteSlide(slide.id);
      showToast("Slide removed.", "success");
      setConfirmRemove(null);
      onChanged();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setRemoving(false);
    }
  }

  const showForm = adding || editingId;

  return (
    <div className="space-y-2">
      {/* This section's own on/off checkbox lives up in the row above,
          separate from this content editor - so it's entirely possible
          to add slides here while the section itself is still off. That
          silently produces "I added content but nothing shows on the
          TV," so call it out here instead of leaving it a mystery. */}
      {!sectionEnabled && (
        <div className="rounded-md bg-warning/10 border border-warning/30 px-3 py-2 text-xs text-warning">
          This section is currently turned off, so none of this content will appear on the TV. Check the box above
          (or toggle it in the list) to turn it on.
        </div>
      )}

      {slides.length === 0 && !showForm && (
        <p className="text-xs text-ink-faint py-1">
          {canManage ? "No slides yet - add one below." : "Nothing added here yet."}
        </p>
      )}

      {slides.map((slide) => {
        const schedule = scheduleStatus(slide);
        return (
          <div key={slide.id} className="flex items-start justify-between gap-3 bg-white border border-line rounded-md px-3 py-2">
            <div className="flex items-start gap-3 min-w-0">
              {slide.photo && (
                <img src={slide.photo} alt="" className="h-10 w-10 rounded-full object-cover shrink-0 border border-line" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink truncate">{slide.title}</p>
                {slide.subtitle && <p className="text-xs text-ink-muted truncate">{slide.subtitle}</p>}
                {slide.message && <p className="text-xs text-ink-muted line-clamp-2 mt-0.5">{slide.message}</p>}
                <p className="text-[11px] text-ink-faint mt-1 flex items-center gap-2 flex-wrap">
                  <span>{slide.duration_seconds ? `${slide.duration_seconds}s (custom)` : `${sharedDuration}s (shared)`}</span>
                  {!slide.is_active && <span className="text-ink-faint">, Turned off</span>}
                  {schedule && <span className={schedule.tone}>, {schedule.label}</span>}
                </p>
              </div>
            </div>
            {canManage && (
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" className="text-xs text-ems-primary hover:underline" onClick={() => startEdit(slide)}>
                  Edit
                </button>
                <button type="button" className="text-xs text-danger hover:underline" onClick={() => setConfirmRemove(slide)}>
                  Remove
                </button>
              </div>
            )}
          </div>
        );
      })}

      {canManage && !showForm && (
        <button type="button" className="text-xs font-medium text-ems-primary hover:underline" onClick={startAdd}>
          + Add slide
        </button>
      )}

      {canManage && showForm && (
        <div className="bg-white border border-line rounded-md p-3 space-y-2.5">
          <div>
            <label className="form-label">{fieldConfig.titleLabel}</label>
            <input
              type="text"
              className="form-input"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder={fieldConfig.titlePlaceholder}
              autoFocus
            />
          </div>
          {fieldConfig.showSubtitle && (
            <div>
              <label className="form-label">{fieldConfig.subtitleLabel}</label>
              <input
                type="text"
                className="form-input"
                value={draft.subtitle}
                onChange={(e) => setDraft((d) => ({ ...d, subtitle: e.target.value }))}
                placeholder={fieldConfig.subtitlePlaceholder}
              />
            </div>
          )}
          {fieldConfig.showPhoto && (
            <div>
              <label className="form-label">Photo (optional)</label>
              {draft.existingPhotoUrl && !draft.photoFile && !draft.removePhoto && (
                <div className="flex items-center gap-2 mb-2">
                  <img src={draft.existingPhotoUrl} alt="" className="h-10 w-10 rounded-full object-cover border border-line" />
                  <button
                    type="button"
                    className="text-xs text-danger hover:underline"
                    onClick={() => setDraft((d) => ({ ...d, removePhoto: true }))}
                  >
                    Remove current photo
                  </button>
                </div>
              )}
              {draft.removePhoto && (
                <div className="flex items-center gap-2 mb-2 text-xs text-ink-muted">
                  <span>Current photo will be removed when you save.</span>
                  <button
                    type="button"
                    className="text-ems-primary hover:underline"
                    onClick={() => setDraft((d) => ({ ...d, removePhoto: false }))}
                  >
                    Undo
                  </button>
                </div>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="form-input"
                onChange={(e) => setDraft((d) => ({ ...d, photoFile: e.target.files?.[0] || null, removePhoto: false }))}
              />
              {editingId && !draft.photoFile && !draft.removePhoto && (
                <p className="text-[11px] text-ink-faint mt-1">Choose a file to replace the current photo, or leave blank to keep it.</p>
              )}
            </div>
          )}
          <div>
            <label className="form-label">{fieldConfig.messageLabel}{!fieldConfig.messageLabel.includes("(optional)") ? " (optional)" : ""}</label>
            <textarea
              className="form-input"
              rows={2}
              value={draft.message}
              onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
              placeholder={fieldConfig.messagePlaceholder}
            />
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.useCustomDuration}
                onChange={(e) => setDraft((d) => ({ ...d, useCustomDuration: e.target.checked }))}
              />
              <span className="text-xs text-ink">
                Use a custom duration for this slide (otherwise it uses the shared {sharedDuration}s)
              </span>
            </label>
            {draft.useCustomDuration && (
              <input
                type="number"
                min={3}
                className="form-input max-w-[120px]"
                value={draft.duration_seconds}
                onChange={(e) => setDraft((d) => ({ ...d, duration_seconds: e.target.value }))}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Start date (optional)</label>
              <input
                type="date"
                className="form-input"
                value={draft.start_date}
                onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">End date (optional)</label>
              <input
                type="date"
                className="form-input"
                value={draft.end_date}
                onChange={(e) => setDraft((d) => ({ ...d, end_date: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-[11px] text-ink-faint -mt-1">
            Leave both blank to show as soon as it's active with no end date. Outside this window, it's automatically
            skipped on the TV - no need to remember to turn it off.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary text-sm" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="jm-btn-primary text-sm" onClick={save} disabled={saving}>
              {saving ? "Saving..." : editingId ? "Save changes" : "Add slide"}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmRemove)}
        title="Remove this slide?"
        message={`"${confirmRemove?.title || ""}" will be removed from ${sectionLabel}.`}
        confirmLabel="Remove slide"
        danger
        isSubmitting={removing}
        onConfirm={confirmRemoveSlide}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

// One shared component instead of an editable copy in Admin and a
// separate read-only copy for Staff, matches the backend's own
// permission split (GET: any authenticated user; PATCH: Admin/Leadership/
// Communications) rather than hardcoding "admin-only" in the UI.
export default function TVDisplaySettingsPanel() {
  const { isAdmin, isLeadership, isCommunications } = useAuth();
  // Communications was widened to have the same full access as Admin
  // (reordering, timing, dashboard picks), matches
  // IsAdminOrLeadershipOrCommunications server-side.
  const canEdit = isAdmin || isLeadership || isCommunications;
  // Slide authoring (the manual content for the 5 non-automatic
  // sections) is Communications/Admin, not Leadership, matches
  // IsCommunicationsOrAdmin server-side. Now a subset of canEdit for
  // Admin/Communications, but Leadership still can't manage slides.
  const canManageSlides = isAdmin || isCommunications;
  const { showToast } = useToast();
  const [settings, setSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [slides, setSlides] = useState([]);
  // Which inline editor is open under a queue row, if any - ONE at a time
  // across the whole list: { key: <section key>, kind: "timing" | "rename" |
  // "content" | "analytics" }. Opening another one (or finishing/closing
  // this one) replaces it, so editors can no longer pile up open at once
  // and there's always exactly one obvious thing to close. (Timing,
  // Analytics period and Manage content used to be three separate
  // independent flags that never closed themselves.)
  const [activeEditor, setActiveEditor] = useState(null);
  const isEditorOpen = (key, kind) => activeEditor?.key === key && activeEditor?.kind === kind;
  const closeEditor = () => setActiveEditor(null);
  function toggleEditor(key, kind) {
    setActiveEditor(isEditorOpen(key, kind) ? null : { key, kind });
  }
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  // "+ Add queue" (admin-created custom sections, e.g. "Live
  // Announcement"), a separate immediate-action form, same pattern as
  // "+ Add slide" inside SectionSlideManager, not staged behind Save
  // Settings.
  const [addingQueue, setAddingQueue] = useState(false);
  const [newQueueLabel, setNewQueueLabel] = useState("");
  const [savingQueue, setSavingQueue] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  // Delete-queue confirmation (a proper dialog instead of the browser's
  // native confirm box): the section awaiting confirmation, if any.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deletingQueue, setDeletingQueue] = useState(false);

  // Whether the shared "Screen duration" field is following the 15s
  // automatic default or has been switched to a manual, custom number.
  // Derived once when settings first load (so re-opening this page after
  // someone set a manual value doesn't silently snap back to
  // "Automatic") rather than recomputed from the current value on every
  // render, which would flip back to "Automatic" the moment someone
  // typed exactly 15 into the manual field.
  // (The old hidden "Default (15 seconds)" mode is gone: the shared duration
  // is always a visible, editable number, and a saved value is never changed
  // back to 15 unless the person presses "Reset to 15" themselves.)
  // Snapshot of `settings` exactly as last loaded/saved from the server,
  // so we can tell the person there's something to save. Typing into a
  // duration box (or toggling/reordering a section) only updates local
  // state, nothing reaches the server until "Save Settings" is clicked
  //, and without this, that box gave no sign that a save was still
  // needed, which read as "changing it doesn't do anything."
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const hasUnsavedChanges = canEdit && settings && savedSnapshot !== null && JSON.stringify(settings) !== savedSnapshot;

  useEffect(() => {
    tvDisplayApi
      .getSettings()
      .then(({ data }) => {
        // Defensive defaults only, the backend already defaults these
        // (analytics_period="monthly", analytics_period_selection={}) on
        // every row, this just keeps the UI from choking if either is
        // ever missing (e.g. an old cached response).
        const withDefaults = {
          ...data,
          analytics_period: data.analytics_period || "monthly",
          analytics_period_selection: data.analytics_period_selection || {},
        };
        setSettings(withDefaults);
        setSavedSnapshot(JSON.stringify(withDefaults));
      })
      .catch((error) => showToast(extractErrorMessage(error), "error"))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Typing into a duration box keeps whatever is typed (including an empty
  // box while retyping) as a number or "" - it never flips a mode or snaps
  // back to 15 mid-edit. Validation (at least 3 seconds) happens on Save.
  const MIN_DURATION = 3;
  const DEFAULT_DURATION = 15;
  function parseDurationInput(raw) {
    return raw === "" ? "" : Math.max(0, Math.floor(Number(raw)) || 0);
  }
  function setSharedDuration(value) {
    setSettings((s) => ({ ...s, screen_duration_seconds: value }));
  }
  function stepSharedDuration(delta) {
    setSettings((s) => ({
      ...s,
      screen_duration_seconds: Math.max(MIN_DURATION, (Number(s.screen_duration_seconds) || DEFAULT_DURATION) + delta),
    }));
  }

  // A queue "has its own time" only when the person picks Custom; its value
  // is remembered while they flip back and forth so nothing they typed is lost.
  const lastCustomDuration = useRef({});
  const isCustomDuration = (sec) => sec.duration_seconds !== null && sec.duration_seconds !== undefined;
  function setSectionDurationMode(key, useShared) {
    setSettings((s) => ({
      ...s,
      sections: s.sections.map((sec) => {
        if (sec.key !== key) return sec;
        if (useShared) {
          if (isCustomDuration(sec) && sec.duration_seconds !== "") lastCustomDuration.current[key] = sec.duration_seconds;
          return { ...sec, duration_seconds: null };
        }
        return {
          ...sec,
          duration_seconds: lastCustomDuration.current[key] || Number(s.screen_duration_seconds) || DEFAULT_DURATION,
        };
      }),
    }));
  }

  function setSectionDurationValue(key, value) {
    setSettings((s) => ({
      ...s,
      sections: s.sections.map((sec) => (sec.key === key ? { ...sec, duration_seconds: value } : sec)),
    }));
  }
  function stepSectionDuration(key, delta) {
    setSettings((s) => ({
      ...s,
      sections: s.sections.map((sec) =>
        sec.key === key
          ? { ...sec, duration_seconds: Math.max(MIN_DURATION, (Number(sec.duration_seconds) || DEFAULT_DURATION) + delta) }
          : sec
      ),
    }));
  }

  // Content mode (Automatic vs Manual) now applies to every section, not
  // just the 4 TV_AUTOMATIC_KEYS, matches AUTOMATIC_SECTION_KEYS/
  // content_mode server-side. Missing content_mode on an older/unsaved
  // row defaults to "automatic" for the 4 automatic sections and
  // "manual" for everything else, same as the server does (see
  // defaultContentMode below).
  function defaultContentMode(key) {
    return TV_AUTOMATIC_KEYS.has(key) ? "automatic" : "manual";
  }

  function setSectionContentMode(key, mode) {
    setSettings((s) => ({
      ...s,
      sections: s.sections.map((sec) => (sec.key === key ? { ...sec, content_mode: mode } : sec)),
    }));
  }

  function loadSlides() {
    // Every non-automatic section's slides fetched together (one call,
    // filtered client-side per section below) rather than one request per
    // section, there are only 5 sections and this page isn't paginated
    // for the person, so keeping it to a single request is simpler and
    // plenty fast.
    tvDisplayApi
      .listSlides({ page_size: 500 })
      .then(({ data }) => setSlides(data.results || data))
      .catch((error) => showToast(extractErrorMessage(error), "error"));
  }

  useEffect(() => {
    loadSlides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function moveSection(index, direction) {
    setSettings((s) => {
      const sections = [...s.sections];
      const target = index + direction;
      if (target < 0 || target >= sections.length) return s;
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...s, sections };
    });
  }

  function reorderSection(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex == null || toIndex == null) return;
    setSettings((s) => {
      const sections = [...s.sections];
      const [moved] = sections.splice(fromIndex, 1);
      sections.splice(toIndex, 0, moved);
      return { ...s, sections };
    });
  }

  function toggleSection(key) {
    setSettings((s) => ({
      ...s,
      sections: s.sections.map((sec) => (sec.key === key ? { ...sec, enabled: !sec.enabled } : sec)),
    }));
  }

  function setAnalyticsPeriod(period) {
    setSettings((s) => ({ ...s, analytics_period: period }));
  }

  function updateAnalyticsPeriodSelection(next) {
    setSettings((s) => ({
      ...s,
      analytics_period_selection: { ...(s.analytics_period_selection || {}), ...next },
    }));
  }

  function toggleDashboardPick(key) {
    setSettings((s) => ({
      ...s,
      dashboard_picks: s.dashboard_picks.map((p) => (p.key === key ? { ...p, enabled: !p.enabled } : p)),
    }));
  }

  // Custom queues (e.g. "Live Announcement") take effect immediately via
  // their own endpoints rather than being staged behind "Save Settings" -
  // same pattern as adding/editing/removing a slide. Each call returns
  // the full, freshly-saved settings payload, so the local state and the
  // "saved" snapshot both just get replaced with it directly.
  // Custom-queue changes are saved by the server immediately, but the rest
  // of this page (toggles, order, timing...) is only local until "Save
  // Settings". So apply the server's queue list WITHOUT throwing away those
  // unsaved local edits: keep local entries the server still has (taking
  // the server's label), append queues the server added, drop ones it
  // removed, and move the "saved" snapshot to the server's version of the
  // queue list so the unsaved-changes notice stays accurate.
  function applyQueueResponse(data) {
    const serverSections = data.sections || [];
    const serverByKey = Object.fromEntries(serverSections.map((sec) => [sec.key, sec]));
    setSettings((cur) => {
      const localKeys = new Set(cur.sections.map((sec) => sec.key));
      const kept = cur.sections
        .filter((sec) => serverByKey[sec.key])
        .map((sec) => (sec.custom ? { ...sec, label: serverByKey[sec.key].label } : sec));
      const added = serverSections.filter((sec) => !localKeys.has(sec.key));
      return { ...cur, sections: [...kept, ...added], sections_display: data.sections_display };
    });
    setSavedSnapshot((prev) =>
      JSON.stringify({ ...(prev ? JSON.parse(prev) : {}), sections: serverSections, sections_display: data.sections_display })
    );
  }

  async function handleAddQueue() {
    const label = newQueueLabel.trim();
    if (!label) {
      showToast("Give the queue a name first.", "error");
      return;
    }
    setSavingQueue(true);
    try {
      const { data } = await tvDisplayApi.createCustomSection(label);
      applyQueueResponse(data);
      setAddingQueue(false);
      setNewQueueLabel("");
      // Straight into adding its first slide: a queue with no slides has
      // nothing to show, so it stays off the TV until it has some.
      const created = [...(data.sections || [])].reverse().find((sec) => sec.custom);
      if (created) setActiveEditor({ key: created.key, kind: "content" });
      showToast(`"${label}" added - add its first slide below so it shows on the TV.`, "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setSavingQueue(false);
    }
  }

  async function handleRenameQueue(key) {
    const label = renameValue.trim();
    if (!label) {
      showToast("Give the queue a name first.", "error");
      return;
    }
    try {
      const { data } = await tvDisplayApi.renameCustomSection(key, label);
      applyQueueResponse(data);
      closeEditor();
      showToast("Queue renamed.", "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  }

  // Step 1: ask (the dialog below). Step 2: actually delete.
  function handleDeleteQueue(section) {
    setConfirmDelete(section);
  }

  async function confirmDeleteQueue() {
    const section = confirmDelete;
    if (!section) return;
    setDeletingQueue(true);
    try {
      const { data } = await tvDisplayApi.deleteCustomSection(section.key);
      applyQueueResponse(data);
      loadSlides();
      setConfirmDelete(null);
      // Don't leave an editor open on a queue that no longer exists.
      setActiveEditor((cur) => (cur?.key === section.key ? null : cur));
      showToast("Queue deleted.", "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setDeletingQueue(false);
    }
  }

  async function handleSave() {
    // Check the times first, with a message that says exactly which one,
    // instead of letting a blank/too-small box fail (or get replaced).
    const sharedNumber = Number(settings.screen_duration_seconds);
    if (settings.screen_duration_seconds === "" || !Number.isFinite(sharedNumber) || sharedNumber < MIN_DURATION) {
      showToast(`The shared screen duration must be at least ${MIN_DURATION} seconds.`, "error");
      return;
    }
    const badSection = settings.sections.find(
      (sec) => isCustomDuration(sec) && (sec.duration_seconds === "" || Number(sec.duration_seconds) < MIN_DURATION)
    );
    if (badSection) {
      showToast(
        `"${TV_SECTION_LABELS[badSection.key] || badSection.label || badSection.key}": the custom duration must be at least ${MIN_DURATION} seconds (or switch it back to the shared time).`,
        "error"
      );
      return;
    }
    setIsSaving(true);
    try {
      const { data } = await tvDisplayApi.updateSettings({
        is_active: settings.is_active,
        screen_duration_seconds: sharedNumber,
        sections: settings.sections.map(({ key, enabled, duration_seconds, content_mode, custom, label }) => ({
          key,
          enabled,
          duration_seconds: isCustomDuration({ duration_seconds }) ? Number(duration_seconds) : null,
          content_mode: content_mode || defaultContentMode(key),
          // Custom queues carry their `custom`/`label` markers through
          // every save (e.g. a plain reorder) - dropping them here would
          // fail this same entry's validation next time, since an
          // unmarked, non-fixed key isn't a recognized section.
          ...(custom ? { custom: true, label } : {}),
        })),
        dashboard_picks: (settings.dashboard_picks || []).map(({ key, enabled }) => ({ key, enabled })),
        analytics_period: settings.analytics_period || "monthly",
        analytics_period_selection: settings.analytics_period_selection || {},
      });
      const withDefaults = {
        ...data,
        analytics_period: data.analytics_period || "monthly",
        analytics_period_selection: data.analytics_period_selection || {},
      };
      setSettings(withDefaults);
      setSavedSnapshot(JSON.stringify(withDefaults));
      showToast("TV Display settings saved.", "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <p className="text-sm text-ink-faint py-6 text-center">Loading...</p>;
  if (!settings) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">TV Display</h1>
          <p className="text-sm text-ink-muted mt-1">
            {canEdit
              ? "Choose what shows on the office TV and in what order."
              : "What's currently showing on the office TV, and in what order."}
          </p>
        </div>
        <a href="/tv-display" target="_blank" rel="noreferrer" className="btn-secondary shrink-0">
          Open TV Display
        </a>
      </div>

      <div className="jm-card space-y-6">
        {canEdit ? (
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.is_active}
              onChange={(e) => setSettings((s) => ({ ...s, is_active: e.target.checked }))}
            />
            <span className="text-sm font-medium text-ink">TV Display active</span>
          </label>
        ) : (
          <div className="flex items-center gap-2.5">
            <span
              className={
                "h-2 w-2 rounded-full shrink-0 " + (settings.is_active ? "bg-pill-success" : "bg-ink-faint")
              }
            />
            <span className="text-sm font-medium text-ink">
              TV Display is currently {settings.is_active ? "active" : "turned off"}
            </span>
          </div>
        )}

        {canEdit ? (
          <div>
            <label className="form-label" htmlFor="tv-shared-duration">
              Screen duration (seconds per section)
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-stretch rounded-lg border border-line bg-white shadow-sm focus-within:ring-2 focus-within:ring-ems-primary/30">
                <button
                  type="button"
                  aria-label="Decrease screen duration"
                  className="px-3 text-lg text-ink-muted hover:bg-surface-muted rounded-l-lg"
                  onClick={() => stepSharedDuration(-1)}
                >
                  -
                </button>
                <input
                  id="tv-shared-duration"
                  type="text"
                  inputMode="numeric"
                  className="w-16 text-center py-2 text-base font-semibold text-ink bg-transparent outline-none border-x border-line"
                  value={settings.screen_duration_seconds}
                  onChange={(e) => setSharedDuration(parseDurationInput(e.target.value.replace(/\D/g, "")))}
                />
                <button
                  type="button"
                  aria-label="Increase screen duration"
                  className="px-3 text-lg text-ink-muted hover:bg-surface-muted rounded-r-lg"
                  onClick={() => stepSharedDuration(1)}
                >
                  +
                </button>
              </div>
              <span className="text-sm text-ink-muted">seconds</span>
              {Number(settings.screen_duration_seconds) !== DEFAULT_DURATION && (
                <button
                  type="button"
                  className="text-xs font-medium text-ems-primary hover:underline"
                  onClick={() => setSharedDuration(DEFAULT_DURATION)}
                >
                  Reset to {DEFAULT_DURATION}
                </button>
              )}
              {/* Mini save button right next to the field so changing this
                  one value doesn't require scrolling to the Save bar -
                  saves the same full settings PATCH (this form has always
                  been a single save, not per-field). */}
              {hasUnsavedChanges && (
                <button
                  type="button"
                  className="jm-btn-primary text-xs px-2.5 py-1"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              )}
            </div>
            <p className="text-[11px] text-ink-faint mt-1">
              Every section (and any slide without its own custom duration) shows for{" "}
              {settings.screen_duration_seconds === "" ? "..." : settings.screen_duration_seconds} seconds before
              rotating. Minimum {MIN_DURATION}. Your saved number is kept until you change it here.
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            Each section stays on screen for <span className="font-semibold text-ink">{settings.screen_duration_seconds}</span> seconds
            before rotating to the next.
          </p>
        )}

        <div>
          <label className="form-label mb-0.5">
            {canEdit ? "Sections & order" : "What's shown, in rotation order"}
          </label>
          <p className="text-xs text-ink-faint mb-2 flex items-center gap-1.5 flex-wrap">
            <QueueBadge kind="automatic" />
            queues are generated by the system from live EMS data. The others are filled in by hand.
          </p>
          <ul className="divide-y divide-line border border-line rounded-md">
            {settings.sections.map((section, index) => {
              // hasAutoSource: this section CAN run on live app data.
              // modeNow: what it is set to run on. isAutomatic: it is
              // running on live data right now. A section with no live
              // data source is always manual, and a section set to Manual
              // is never automatic (and vice versa).
              const hasAutoSource = TV_AUTOMATIC_KEYS.has(section.key);
              const modeNow = hasAutoSource ? section.content_mode || defaultContentMode(section.key) : "manual";
              const isAutomatic = hasAutoSource && modeNow === "automatic";
              const isDashboardPicks = DASHBOARD_PICK_SECTION_KEYS.has(section.key);
              const isHomeContent = HOME_CONTENT_SECTION_KEYS.has(section.key);
              const sectionSlides =
                isAutomatic || isDashboardPicks || isHomeContent ? [] : slides.filter((s) => s.section_key === section.key);
              const isManualSlides = !isAutomatic && !isDashboardPicks && !isHomeContent;
              const contentOpen = isEditorOpen(section.key, "content");
              const showAutoBadge = isAutomatic;
              const enabledPickCount = (settings.dashboard_picks || []).filter((p) => p.enabled).length;
              const periodLabel = ((settings.analytics_period || "monthly").charAt(0).toUpperCase() +
                (settings.analytics_period || "monthly").slice(1));
              // Everything the ⋮ menu offers for this queue, in groups (see
              // QueueManagementUi.jsx). Read-only viewers only get Preview
              // plus read-only info rows and (where there is content) a
              // way to look at it.
              const menuGroups = [
                {
                  title: "View",
                  items: [
                    {
                      label: "Preview",
                      icon: "preview",
                      href: `/tv-display?preview=${section.key}`,
                      title: "Preview this section on the live TV Display component, without affecting the office TV's rotation",
                    },
                  ],
                },
                {
                  title: "Configure",
                  items: [
                    ...(canEdit
                      ? [
                          {
                            label: "Timing",
                            icon: "timing",
                            hint: isCustomDuration(section) ? `${section.duration_seconds === "" ? "?" : section.duration_seconds}s` : "Shared",
                            title: "Set how long this section stays on screen",
                            onSelect: () => toggleEditor(section.key, "timing"),
                          },
                          hasAutoSource
                            ? {
                                type: "segmented",
                                label: "Content mode",
                                value: modeNow,
                                options: [
                                  {
                                    value: "automatic",
                                    label: "Automatic",
                                    title: "Pull content automatically from existing app data",
                                  },
                                  { value: "manual", label: "Manual", title: "Author this section's content by hand" },
                                ],
                                onChange: (mode) => setSectionContentMode(section.key, mode),
                              }
                            : { type: "info", label: "Content mode", value: "manual" },
                        ]
                      : [{ type: "info", label: "Content mode", value: modeNow }]),
                    ...(section.key === "system_dashboards" && isAutomatic
                      ? [
                          canEdit
                            ? {
                                label: "Analytics period",
                                icon: "period",
                                hint: periodLabel,
                                title: "Which period Event Analytics is scoped to",
                                onSelect: () => toggleEditor(section.key, "analytics"),
                              }
                            : { type: "info", label: "Analytics period", value: periodLabel },
                        ]
                      : []),
                  ],
                },
                {
                  title: "Content",
                  items: isDashboardPicks
                    ? [
                        {
                          label: "Manage content",
                          icon: "content",
                          hint: enabledPickCount > 0 ? `${enabledPickCount} selected` : "None selected",
                          onSelect: () => toggleEditor(section.key, "content"),
                        },
                      ]
                    : isHomeContent
                    ? canManageSlides
                      ? [
                          {
                            label: "Add content",
                            icon: "content",
                            title: "Add a News, Major Event, or Announcement item - the same form as Home Page > Manage Content",
                            onSelect: () => toggleEditor(section.key, "content"),
                          },
                        ]
                      : []
                    : isManualSlides
                    ? [
                        {
                          label: "Manage content",
                          icon: "content",
                          hint:
                            sectionSlides.length > 0
                              ? `${sectionSlides.length} slide${sectionSlides.length === 1 ? "" : "s"}`
                              : canManageSlides
                              ? "Add content"
                              : "No content yet",
                          onSelect: () => toggleEditor(section.key, "content"),
                        },
                      ]
                    : [],
                },
                {
                  title: "Queue",
                  items:
                    section.custom && canManageSlides
                      ? [
                          {
                            label: "Rename",
                            icon: "rename",
                            title: "Rename this queue",
                            onSelect: () => {
                              setRenameValue(section.label || "");
                              setActiveEditor({ key: section.key, kind: "rename" });
                            },
                          },
                          {
                            label: "Delete queue",
                            icon: "delete",
                            danger: true,
                            title: "Delete this queue and its content",
                            onSelect: () => handleDeleteQueue(section),
                          },
                        ]
                      : [],
                },
              ];
              // A custom queue's own `label` (set at creation/rename) is
              // the source of truth for it - it's never in the static
              // TV_SECTION_LABELS map, which only covers the fixed keys.
              const label = TV_SECTION_LABELS[section.key] || section.label || section.key;
              return (
                <li key={section.key}>
                  <div
                    className={
                      "flex items-center gap-3 px-3 py-2.5" +
                      (dragOverIndex === index && dragIndex !== index ? " bg-ems-primaryLight" : "")
                    }
                    draggable={canEdit}
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => {
                      if (!canEdit) return;
                      e.preventDefault();
                      setDragOverIndex(index);
                    }}
                    onDragLeave={() => setDragOverIndex((i) => (i === index ? null : i))}
                    onDrop={(e) => {
                      e.preventDefault();
                      reorderSection(dragIndex, index);
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                  >
                    {canEdit && (
                      <span
                        className="text-ink-faint cursor-grab active:cursor-grabbing select-none shrink-0 px-1"
                        title="Drag to reorder"
                        aria-hidden="true"
                      >
                        <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
                          <circle cx="3" cy="3" r="1.4" />
                          <circle cx="9" cy="3" r="1.4" />
                          <circle cx="3" cy="8" r="1.4" />
                          <circle cx="9" cy="8" r="1.4" />
                          <circle cx="3" cy="13" r="1.4" />
                          <circle cx="9" cy="13" r="1.4" />
                        </svg>
                      </span>
                    )}
                    {canEdit && (
                      <div className="flex flex-col -my-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveSection(index, -1)}
                          disabled={index === 0}
                          title="Move up"
                          aria-label={`Move ${label} up`}
                          className="text-ink-faint hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed leading-none px-1"
                        >
                          <CaretUpIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSection(index, 1)}
                          disabled={index === settings.sections.length - 1}
                          title="Move down"
                          aria-label={`Move ${label} down`}
                          className="text-ink-faint hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed leading-none px-1"
                        >
                          <CaretDownIcon />
                        </button>
                      </div>
                    )}
                    {canEdit ? (
                      <label className="flex items-center gap-2.5 flex-1 cursor-pointer">
                        <input type="checkbox" checked={section.enabled} onChange={() => toggleSection(section.key)} />
                        <span className="text-sm text-ink">{label}</span>
                        {showAutoBadge && <QueueBadge kind="automatic" />}
                        {section.custom && <QueueBadge kind="custom" />}
                      </label>
                    ) : (
                      <div className="flex items-center gap-2.5 flex-1">
                        <span
                          className={"h-1.5 w-1.5 rounded-full shrink-0 " + (section.enabled ? "bg-pill-success" : "bg-ink-faint")}
                        />
                        <span className={"text-sm " + (section.enabled ? "text-ink" : "text-ink-faint")}>
                          {label}
                        </span>
                        <span className="text-xs text-ink-faint">{section.enabled ? "On" : "Off"}</span>
                        {showAutoBadge && <QueueBadge kind="automatic" />}
                        {section.custom && <QueueBadge kind="custom" />}
                      </div>
                    )}
                    {isManualSlides && (
                      <span
                        className={
                          "hidden sm:inline text-xs shrink-0 " +
                          (sectionSlides.length === 0 && section.enabled ? "text-warning" : "text-ink-faint")
                        }
                      >
                        {sectionSlides.length > 0
                          ? `${sectionSlides.length} slide${sectionSlides.length === 1 ? "" : "s"}`
                          : section.enabled
                          ? "No slides yet - not on the TV"
                          : "No slides yet"}
                      </span>
                    )}
                    <QueueActionsMenu
                      label={label}
                      badges={
                        <>
                          {showAutoBadge && <QueueBadge kind="automatic" />}
                          {section.custom && <QueueBadge kind="custom" />}
                        </>
                      }
                      groups={menuGroups}
                    />
                  </div>
                  {section.key === "system_dashboards" && canEdit && isEditorOpen(section.key, "analytics") && (
                    <EditorPanel
                      title="Analytics period"
                      subtitle="Matches the main Dashboard's period toggle - applied when you Save Settings"
                      onClose={closeEditor}
                    >
                      <div className="space-y-3">
                        <div className="inline-flex rounded-lg border border-line overflow-hidden">
                          {ANALYTICS_PERIOD_OPTIONS.map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setAnalyticsPeriod(p)}
                              className={
                                "px-3 py-1.5 text-sm capitalize transition-colors " +
                                ((settings.analytics_period || "monthly") === p
                                  ? "bg-ems-primary text-white"
                                  : "bg-white text-ink-muted hover:bg-[#F1F4F9]")
                              }
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                        {["weekly", "monthly", "quarterly", "yearly"].includes(settings.analytics_period) && (
                          <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5">
                            {settings.analytics_period === "weekly" && (
                              <select
                                className="form-input max-w-[160px] py-1"
                                value={(settings.analytics_period_selection || {}).week ?? Math.min(4, Math.ceil(new Date().getDate() / 7))}
                                onChange={(e) => updateAnalyticsPeriodSelection({ week: Number(e.target.value) })}
                              >
                                {ANALYTICS_WEEKS_OF_MONTH.map((w) => (
                                  <option key={w.value} value={w.value}>{w.label}</option>
                                ))}
                              </select>
                            )}
                            {(settings.analytics_period === "weekly" || settings.analytics_period === "monthly") && (
                              <select
                                className="form-input max-w-[140px] py-1"
                                value={(settings.analytics_period_selection || {}).month ?? new Date().getMonth() + 1}
                                onChange={(e) => updateAnalyticsPeriodSelection({ month: Number(e.target.value) })}
                              >
                                {ANALYTICS_MONTHS.map((m) => (
                                  <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                              </select>
                            )}
                            {settings.analytics_period === "quarterly" && (
                              <select
                                className="form-input max-w-[160px] py-1"
                                value={(settings.analytics_period_selection || {}).quarter ?? (((new Date().getMonth() - 6 + 12) % 12) / 3 | 0) + 1}
                                onChange={(e) => updateAnalyticsPeriodSelection({ quarter: Number(e.target.value) })}
                              >
                                {ANALYTICS_QUARTERS.map((q) => (
                                  <option key={q.value} value={q.value}>{q.label}</option>
                                ))}
                              </select>
                            )}
                            <input
                              type="number"
                              className="form-input max-w-[90px] py-1"
                              value={(settings.analytics_period_selection || {}).year ?? new Date().getFullYear()}
                              onChange={(e) => updateAnalyticsPeriodSelection({ year: Number(e.target.value) })}
                            />
                          </div>
                        )}
                        {(() => {
                          const range = computeAnalyticsPeriodRange(
                            settings.analytics_period || "monthly",
                            settings.analytics_period_selection
                          );
                          return (
                            <p className="text-xs text-ink-faint">
                              {range
                                ? `Currently showing ${range.date_from} to ${range.date_to} on the TV.`
                                : "No date restriction - showing all-time totals on the TV."}
                            </p>
                          );
                        })()}
                        <p className="text-[11px] text-ink-faint">
                          Applies to all four Event Analytics charts (Event Trend, Events by Category, Engagement
                          Level, Thematic Areas), so they always agree with each other and with this same period on
                          the main Dashboard.
                        </p>
                      </div>
                    </EditorPanel>
                  )}
                  {canEdit && isEditorOpen(section.key, "timing") && (
                    <EditorPanel
                      title={`Timing - ${label}`}
                      subtitle="How long this section stays on screen - applied when you Save Settings"
                      onClose={closeEditor}
                    >
                      <div className="space-y-3">
                        {/* Two plainly-labelled choices instead of a hidden
                            checkbox: you can always see whether this queue
                            follows the shared time or has its own, and the
                            number box is always on screen (greyed out, not
                            hidden, until "Custom" is chosen). */}
                        <div className="inline-flex rounded-lg border border-line p-0.5 bg-surface-muted" role="group" aria-label="Timing mode">
                          <button
                            type="button"
                            className={
                              "px-3 py-1.5 text-xs font-medium rounded-md " +
                              (!isCustomDuration(section) ? "bg-white shadow-sm text-ink" : "text-ink-muted hover:text-ink")
                            }
                            onClick={() => setSectionDurationMode(section.key, true)}
                          >
                            Same as all queues ({Number(settings.screen_duration_seconds) || DEFAULT_DURATION}s)
                          </button>
                          <button
                            type="button"
                            className={
                              "px-3 py-1.5 text-xs font-medium rounded-md " +
                              (isCustomDuration(section) ? "bg-white shadow-sm text-ink" : "text-ink-muted hover:text-ink")
                            }
                            onClick={() => setSectionDurationMode(section.key, false)}
                          >
                            Custom time
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div
                            className={
                              "inline-flex items-stretch rounded-lg border bg-white " +
                              (isCustomDuration(section)
                                ? "border-line shadow-sm focus-within:ring-2 focus-within:ring-ems-primary/30"
                                : "border-line/60 opacity-60")
                            }
                          >
                            <button
                              type="button"
                              aria-label="Decrease custom duration"
                              disabled={!isCustomDuration(section)}
                              className="px-3 text-lg text-ink-muted hover:bg-surface-muted rounded-l-lg disabled:cursor-not-allowed"
                              onClick={() => stepSectionDuration(section.key, -1)}
                            >
                              -
                            </button>
                            <input
                              type="text"
                              inputMode="numeric"
                              aria-label="Custom duration in seconds"
                              disabled={!isCustomDuration(section)}
                              className="w-16 text-center py-2 text-base font-semibold text-ink bg-transparent outline-none border-x border-line disabled:cursor-not-allowed"
                              value={isCustomDuration(section) ? section.duration_seconds : Number(settings.screen_duration_seconds) || DEFAULT_DURATION}
                              onChange={(e) => setSectionDurationValue(section.key, parseDurationInput(e.target.value.replace(/\D/g, "")))}
                            />
                            <button
                              type="button"
                              aria-label="Increase custom duration"
                              disabled={!isCustomDuration(section)}
                              className="px-3 text-lg text-ink-muted hover:bg-surface-muted rounded-r-lg disabled:cursor-not-allowed"
                              onClick={() => stepSectionDuration(section.key, 1)}
                            >
                              +
                            </button>
                          </div>
                          <span className="text-sm text-ink-muted">seconds</span>
                        </div>
                        <p className="text-[11px] text-ink-faint">
                          {isCustomDuration(section)
                            ? "This queue uses its own time. Minimum 3 seconds."
                            : "This queue follows the shared time. Choose Custom time to give it its own."}
                        </p>
                      </div>
                    </EditorPanel>
                  )}
                  {canManageSlides && section.custom && isEditorOpen(section.key, "rename") && (
                    <EditorPanel title="Rename queue" subtitle="Slides in it are kept" onClose={closeEditor} closeLabel="Cancel">
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleRenameQueue(section.key);
                        }}
                      >
                        <input
                          type="text"
                          className="form-input flex-1"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          maxLength={60}
                          aria-label="Queue name"
                          autoFocus
                        />
                        <button type="submit" className="jm-btn-primary text-sm">
                          Save name
                        </button>
                      </form>
                    </EditorPanel>
                  )}
                  {!isAutomatic && !isDashboardPicks && !section.enabled && sectionSlides.length > 0 && (
                    <p className="px-3 pb-2 text-xs text-warning">
                      {sectionSlides.length} slide{sectionSlides.length === 1 ? "" : "s"} added, but this section is
                      turned off so none of it shows on the TV yet.
                    </p>
                  )}
                  {isDashboardPicks && contentOpen && (
                    <EditorPanel
                      title={`Content - ${label}`}
                      subtitle="Choose which dashboards appear - applied when you Save Settings"
                      onClose={closeEditor}
                    >
                      <DashboardPicksManager picks={settings.dashboard_picks || []} canManage={canEdit} onToggle={toggleDashboardPick} />
                    </EditorPanel>
                  )}
                  {isHomeContent && contentOpen && (
                    <EditorPanel
                      title={`Content - ${label}`}
                      subtitle="Shown on the TV only - adding it here does not add it to the Home Page"
                      onClose={closeEditor}
                    >
                      {canManageSlides ? (
                        <HomeContentPanel key={section.key} lockedType={HOME_CONTENT_TYPE_BY_SECTION_KEY[section.key]} />
                      ) : (
                        <p className="text-xs text-ink-faint">
                          Only Communications or Admin can add or edit this content. You can see what's currently
                          live on the TV.
                        </p>
                      )}
                    </EditorPanel>
                  )}
                  {isManualSlides && contentOpen && (
                    <EditorPanel
                      title={`Content - ${label}`}
                      subtitle={
                        sectionSlides.length > 0
                          ? `${sectionSlides.length} slide${sectionSlides.length === 1 ? "" : "s"} - changes save as you make them`
                          : "Changes save as you make them"
                      }
                      onClose={closeEditor}
                      closeOnEscape={false}
                    >
                      <SectionSlideManager
                        sectionKey={section.key}
                        sectionLabel={label}
                        slides={sectionSlides}
                        canManage={canManageSlides}
                        onChanged={loadSlides}
                        sharedDuration={settings.screen_duration_seconds}
                        sectionEnabled={section.enabled}
                      />
                    </EditorPanel>
                  )}
                </li>
              );
            })}
          </ul>

          {/* "+ Add queue": a brand-new content queue beyond the fixed
              sections above (e.g. "Live Announcement"), takes effect
              immediately, same as adding a slide, and lands at the
              bottom of the rotation order (reorderable afterwards like
              any other section). Communications/Admin only, same gate
              as slide authoring. */}
          {canManageSlides && (
            <div className="pt-2">
              {!addingQueue ? (
                <button
                  type="button"
                  className="text-xs font-medium text-ems-primary hover:underline"
                  onClick={() => setAddingQueue(true)}
                >
                  + Add queue
                </button>
              ) : (
                <div className="bg-white border border-line rounded-md p-3 flex items-center gap-2">
                  <input
                    type="text"
                    className="form-input flex-1"
                    placeholder="e.g. Live Announcement, Staff Spotlight"
                    value={newQueueLabel}
                    onChange={(e) => setNewQueueLabel(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    onClick={() => {
                      setAddingQueue(false);
                      setNewQueueLabel("");
                    }}
                  >
                    Cancel
                  </button>
                  <button type="button" className="jm-btn-primary text-sm" onClick={handleAddQueue} disabled={savingQueue}>
                    {savingQueue ? "Adding..." : "Add"}
                  </button>
                </div>
              )}
              <p className="text-[11px] text-ink-faint mt-1">
                Adds a new content queue to the rotation - its own add/edit/remove slides, just like Announcements or
                Staff Spotlight - for anything the fixed sections above don't cover.
              </p>
            </div>
          )}
        </div>

        <ConfirmDialog
          open={Boolean(confirmDelete)}
          title={`Delete the "${confirmDelete?.label || confirmDelete?.key || ""}" queue?`}
          message={(() => {
            const count = confirmDelete ? slides.filter((sl) => sl.section_key === confirmDelete.key).length : 0;
            return count > 0
              ? `This also removes its ${count} slide${count === 1 ? "" : "s"}, and it can't be undone.`
              : "It will be taken out of the rotation. This can't be undone.";
          })()}
          confirmLabel="Delete queue"
          danger
          isSubmitting={deletingQueue}
          onConfirm={confirmDeleteQueue}
          onCancel={() => setConfirmDelete(null)}
        />

        {/* Save bar: stays pinned to the bottom of the screen while you scroll
            through the queues, so Save is always in view - no scrolling to
            the end or remembering where it is. Shows "Unsaved changes" in
            warning colour until saved. */}
        {canEdit && (
          <div
            className={
              "sticky bottom-0 z-20 -mx-1 flex items-center justify-between gap-3 flex-wrap rounded-xl border px-4 py-3 shadow-[0_-6px_18px_rgba(15,23,42,0.08)] backdrop-blur " +
              (hasUnsavedChanges ? "border-warning/40 bg-white/95" : "border-line bg-white/95")
            }
          >
            <span
              className={"text-sm flex items-center gap-2 " + (hasUnsavedChanges && !isSaving ? "font-medium text-warning" : "text-ink-muted")}
              role="status"
            >
              <span
                className={"h-2 w-2 rounded-full " + (hasUnsavedChanges && !isSaving ? "bg-warning" : "bg-success")}
                aria-hidden="true"
              />
              {isSaving
                ? "Saving..."
                : hasUnsavedChanges
                  ? "You have unsaved changes - click Save Settings to apply them"
                  : "All changes saved"}
            </span>
            <button
              className={"jm-btn-primary" + (hasUnsavedChanges && !isSaving ? " ring-2 ring-offset-1 ring-warning" : "")}
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
