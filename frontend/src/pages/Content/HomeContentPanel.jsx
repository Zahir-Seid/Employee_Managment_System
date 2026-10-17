import { usePersistentState } from "../../utils/persistentFilters.js";
import { useEffect, useState } from "react";
import { contentApi } from "../../api/content";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage, formatDate, formatDateRange } from "../../utils/format";

// Home Page Dynamic Content Update, doc §5: Home Page -> Manage Content
// -> Add Content. One shared form backs all three content types (doc §6:
// "Common Content Controls"), only the fields relevant to the selected
// Content Type are shown, per type-by-type field lists in doc §8/§11/§12.
// Reachable at /admin/home-content (AdminPage tab) and directly at
// /manage-content, mirroring the existing TV Display settings precedent
// (admin tab + standalone route sharing one panel component).

const TYPE_LABELS = {
  major_event: "Major Event",
  announcement: "Announcement",
  news: "News",
  upcoming_event: "Upcoming Event",
};

const TYPES = ["major_event", "announcement", "news", "upcoming_event"];

const EMPTY_DRAFT = {
  content_type: "news",
  title: "",
  description: "",
  publish_date: "",
  start_date: "",
  end_date: "",
  location: "",
  linked_event: "",
  is_published: true,
  is_active: true,
  is_featured: false,
  imageFile: null,
  removeImage: false,
};

function draftFromItem(item) {
  return {
    content_type: item.content_type,
    title: item.title || "",
    description: item.description || "",
    publish_date: item.publish_date || "",
    start_date: item.start_date || "",
    end_date: item.end_date || "",
    location: item.location || "",
    linked_event: item.linked_event || "",
    is_published: item.is_published,
    is_active: item.is_active,
    is_featured: item.is_featured,
    imageFile: null,
    removeImage: false,
    existingImageUrl: item.image || null,
  };
}

// `lockedType` (optional): when this panel is opened from a TV Display queue
// (News / Major Events / Announcements (Home Page)) it is locked to that
// queue's one content type. Without this the form defaulted to "News" no
// matter which queue it was opened from, so an item added under the Major
// Events or Announcements queue was quietly saved as News (or as an
// Upcoming Event, which no TV queue shows) and never appeared in the queue
// it was added from.
export default function HomeContentPanel({ lockedType = null, onChanged = null }) {
  const { showToast } = useToast();
  const [items, setItems] = useState(null);
  const [storedFilterType, setStoredFilterType] = usePersistentState("home-content.type", "all");
  // A TV queue's panel is fixed to its own type; only Manage Content remembers the tab.
  const filterType = lockedType || storedFilterType;
  const setFilterType = setStoredFilterType;
  // Content added from a TV queue is TV-only; content added from Home Page >
  // Manage Content is Home-Page-only. Adding in one place never adds it to
  // the other.
  const audience = lockedType ? "tv" : "home";
  const emptyDraft = lockedType ? { ...EMPTY_DRAFT, content_type: lockedType } : EMPTY_DRAFT;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [linkableEvents, setLinkableEvents] = useState([]);
  const [eventQuery, setEventQuery] = useState("");

  // The permanent "EE News & Success Stories" KM Resource card (doc §1) ,
  // its title/description/link are edited here rather than through Add
  // Content, since it isn't a repeatable HomeContent item.
  const [siteSettings, setSiteSettings] = useState(null);
  const [kmDraft, setKmDraft] = useState(null);
  const [kmEditing, setKmEditing] = useState(false);
  const [kmSaving, setKmSaving] = useState(false);

  function load() {
    contentApi
      .listContent({ audience })
      .then(({ data }) => setItems(Array.isArray(data) ? data : data.results))
      .catch((error) => showToast(extractErrorMessage(error), "error"));
  }

  function loadSiteSettings() {
    contentApi
      .getSiteSettings()
      .then(({ data }) => setSiteSettings(data))
      .catch((error) => showToast(extractErrorMessage(error), "error"));
  }

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(loadSiteSettings, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startKmEdit() {
    setKmDraft(siteSettings);
    setKmEditing(true);
  }

  async function saveKmSettings() {
    setKmSaving(true);
    try {
      const { data } = await contentApi.updateSiteSettings({
        km_resource_title: kmDraft.km_resource_title.trim(),
        km_resource_description: kmDraft.km_resource_description.trim(),
        km_resource_url: kmDraft.km_resource_url.trim(),
      });
      setSiteSettings(data);
      setKmEditing(false);
      showToast("KM Resource link updated.", "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setKmSaving(false);
    }
  }

  useEffect(() => {
    if (draft.content_type !== "major_event" || !(adding || editingId)) return;
    const handle = setTimeout(() => {
      contentApi
        .listLinkableEvents(eventQuery)
        .then(({ data }) => setLinkableEvents(data.results || data))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(handle);
  }, [eventQuery, draft.content_type, adding, editingId]);

  function startAdd() {
    setEditingId(null);
    setAdding(true);
    setDraft(emptyDraft);
    setEventQuery("");
  }

  function startEdit(item) {
    setAdding(false);
    setEditingId(item.id);
    setDraft(draftFromItem(item));
    setEventQuery("");
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setDraft(emptyDraft);
  }

  async function save() {
    if (!draft.title.trim() && !draft.linked_event) {
      showToast("Give this content a title first.", "error");
      return;
    }
    setSaving(true);
    const payload = {
      content_type: lockedType || draft.content_type,
      title: draft.title.trim(),
      description: draft.description.trim(),
      is_published: draft.is_published,
      is_active: draft.is_active,
      is_featured: draft.is_featured,
    };
    if (draft.content_type === "news") {
      payload.publish_date = draft.publish_date || null;
    } else if (draft.content_type === "major_event") {
      payload.start_date = draft.start_date || null;
      payload.end_date = draft.end_date || null;
    } else if (draft.content_type === "upcoming_event") {
      // Single-day events just leave End Date blank.
      payload.start_date = draft.start_date || null;
      payload.end_date = draft.end_date || null;
      payload.location = draft.location.trim();
    }
    // Announcement: no dates at all, shows immediately, like News.
    if (draft.content_type === "major_event") {
      payload.linked_event = draft.linked_event || null;
      if (!draft.linked_event) payload.location = draft.location.trim();
    }
    if (draft.imageFile) {
      payload.image = draft.imageFile;
    } else if (draft.removeImage) {
      payload.remove_image = true;
    }

    try {
      if (editingId) {
        await contentApi.updateContent(editingId, payload);
        showToast("Content updated.", "success");
      } else {
        await contentApi.createContent({ ...payload, audience });
        showToast(lockedType ? "Added - it will show on the TV within a minute." : "Added to the Home Page.", "success");
      }
      cancel();
      load();
      if (onChanged) onChanged();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item) {
    if (!window.confirm(`Remove "${item.effective_title || item.title}" from the Home Page?`)) return;
    try {
      await contentApi.deleteContent(item.id);
      showToast("Removed.", "success");
      load();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  }

  const showForm = adding || editingId;
  const isUpcoming = draft.content_type === "upcoming_event";
  const visibleItems = (items || []).filter((i) => filterType === "all" || i.content_type === filterType);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-ink">{lockedType ? `${TYPE_LABELS[lockedType]} items` : "Manage Home Page Content"}</h2>
          <p className="text-sm text-ink-muted mt-0.5">
            {lockedType
              ? `Everything added here is saved as a ${TYPE_LABELS[lockedType]} and shows on the TV only - it is not added to the Home Page.`
              : "Manage content displayed on the public Home Page."}
          </p>
        </div>
        {!showForm && (
          <button type="button" className="jm-btn-primary text-sm" onClick={startAdd}>
            {lockedType ? `+ Add ${TYPE_LABELS[lockedType]}` : "+ Add Content"}
          </button>
        )}
      </div>

      {!lockedType && !showForm && siteSettings && (
        <div className="jm-card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-ink">KM Resource Link</h3>
              <p className="text-xs text-ink-muted mt-0.5">
                The permanent "News &amp; Success Stories" card shown on the Home Page.
              </p>
            </div>
            {!kmEditing && (
              <button type="button" className="text-xs text-ems-primary hover:underline shrink-0" onClick={startKmEdit}>
                Edit
              </button>
            )}
          </div>

          {!kmEditing ? (
            <div className="text-sm">
              <p className="font-medium text-ink">{siteSettings.km_resource_title}</p>
              <p className="text-ink-muted mt-0.5">{siteSettings.km_resource_description}</p>
              <p className="text-ems-primary mt-1 break-all">{siteSettings.km_resource_url}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="form-label">Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={kmDraft.km_resource_title}
                  onChange={(e) => setKmDraft((d) => ({ ...d, km_resource_title: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label">Description</label>
                <input
                  type="text"
                  className="form-input"
                  value={kmDraft.km_resource_description}
                  onChange={(e) => setKmDraft((d) => ({ ...d, km_resource_description: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label">Link URL</label>
                <input
                  type="url"
                  className="form-input"
                  value={kmDraft.km_resource_url}
                  onChange={(e) => setKmDraft((d) => ({ ...d, km_resource_url: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="jm-btn-primary text-sm" onClick={saveKmSettings} disabled={kmSaving}>
                  {kmSaving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  className="jm-btn-secondary text-sm"
                  onClick={() => setKmEditing(false)}
                  disabled={kmSaving}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!lockedType && !showForm && (
        <div className="flex gap-1 border-b border-line">
          {["all", ...TYPES].map((t) => (
            <button
              key={t}
              type="button"
              className={
                "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
                (filterType === t ? "border-ems-primary text-ems-primary" : "border-transparent text-ink-muted hover:text-ink")
              }
              onClick={() => setFilterType(t)}
            >
              {t === "all" ? "All" : TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {showForm && (
        <div className="jm-card space-y-4">
          {lockedType ? (
            <p className="text-sm font-medium text-ink">
              Content type: <span className="text-ems-primary">{TYPE_LABELS[lockedType]}</span>
            </p>
          ) : (
          <div>
            <label className="form-label">Content Type</label>
            <select
              className="form-input"
              value={draft.content_type}
              disabled={!!editingId}
              onChange={(e) => setDraft((d) => ({ ...d, content_type: e.target.value }))}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {editingId && <p className="text-xs text-ink-faint mt-1">Content type can't be changed after creation.</p>}
          </div>
          )}

          {draft.content_type === "major_event" && (
            <div>
              <label className="form-label">Link an existing Event (optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Search events by title..."
                value={eventQuery}
                onChange={(e) => setEventQuery(e.target.value)}
              />
              <select
                className="form-input mt-2"
                value={draft.linked_event}
                onChange={(e) => setDraft((d) => ({ ...d, linked_event: e.target.value }))}
              >
                <option value="">Not linked - enter details manually below</option>
                {linkableEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title} ({formatDateRange(ev.start_date, ev.end_date)})
                  </option>
                ))}
              </select>
              {draft.linked_event && (
                <p className="text-xs text-ink-faint mt-1">
                  Title, date, and location will be pulled from the linked Event automatically.
                </p>
              )}
            </div>
          )}

          {!(draft.content_type === "major_event" && draft.linked_event) && (
            <div>
              <label className="form-label">{isUpcoming ? "Event name" : "Title"}</label>
              <input
                type="text"
                className="form-input"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                autoFocus
              />
            </div>
          )}

          {!isUpcoming && (
          <div>
            <label className="form-label">
              {draft.content_type === "news" ? "News text" : draft.content_type === "announcement" ? "Short description" : "Description"}
            </label>
            <textarea
              className="form-input"
              rows={4}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </div>
          )}

          {!isUpcoming && (
          <div>
            <label className="form-label">
              Photo{draft.content_type === "news" ? "" : " (optional)"}
            </label>
            {draft.existingImageUrl && !draft.imageFile && !draft.removeImage && (
              <div className="flex items-center gap-3 mb-2">
                <img src={draft.existingImageUrl} alt="" className="h-14 w-14 rounded-md object-cover border border-line" />
                <button
                  type="button"
                  className="text-xs text-danger hover:underline"
                  onClick={() => setDraft((d) => ({ ...d, removeImage: true }))}
                >
                  Remove photo
                </button>
              </div>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="text-sm"
              onChange={(e) => setDraft((d) => ({ ...d, imageFile: e.target.files[0] || null, removeImage: false }))}
            />
          </div>
          )}

          {draft.content_type === "news" ? (
            <div>
              <label className="form-label">Publish Date</label>
              <input
                type="date"
                className="form-input"
                value={draft.publish_date}
                onChange={(e) => setDraft((d) => ({ ...d, publish_date: e.target.value }))}
              />
            </div>
          ) : draft.content_type === "major_event" || isUpcoming ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">{isUpcoming ? "Date" : "Start Date"}</label>
                <input
                  type="date"
                  className="form-input"
                  value={draft.start_date}
                  onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label">{isUpcoming ? "End Date (optional, for multi-day)" : "End Date"}</label>
                <input
                  type="date"
                  className="form-input"
                  value={draft.end_date}
                  onChange={(e) => setDraft((d) => ({ ...d, end_date: e.target.value }))}
                />
              </div>
            </div>
          ) : null}

          {((draft.content_type === "major_event" && !draft.linked_event) || isUpcoming) && (
            <div>
              <label className="form-label">Location</label>
              <input
                type="text"
                className="form-input"
                value={draft.location}
                onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
              />
            </div>
          )}

          <div className="flex items-center gap-6 flex-wrap pt-1">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={draft.is_published}
                onChange={(e) => setDraft((d) => ({ ...d, is_published: e.target.checked }))}
              />
              Published
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))}
              />
              Active
            </label>
            {!isUpcoming && (
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={draft.is_featured}
                  onChange={(e) => setDraft((d) => ({ ...d, is_featured: e.target.checked }))}
                />
                Featured
              </label>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button type="button" className="jm-btn-primary text-sm" onClick={save} disabled={saving}>
              {saving ? "Saving..." : editingId ? "Save changes" : "Add Content"}
            </button>
            <button type="button" className="jm-btn-secondary text-sm" onClick={cancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <div className="space-y-2">
          {items === null && <p className="text-sm text-ink-faint">Loading...</p>}
          {items !== null && visibleItems.length === 0 && (
            <p className="text-sm text-ink-faint py-2">Nothing here yet.</p>
          )}
          {visibleItems.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 bg-white border border-line rounded-md px-4 py-3">
              <div className="flex items-start gap-3 min-w-0">
                {item.image && (
                  <img src={item.image} alt="" className="h-12 w-12 rounded-md object-cover shrink-0 border border-line" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink truncate">
                    {item.effective_title || item.title}
                    <span className="jm-eyebrow ml-2 text-ink-faint">{TYPE_LABELS[item.content_type]}</span>
                  </p>
                  <p className="text-xs text-ink-muted mt-0.5 line-clamp-1">{item.description}</p>
                  <p className="text-[11px] text-ink-faint mt-1 flex items-center gap-2 flex-wrap">
                    {item.content_type === "news" && item.publish_date && <span>{formatDate(item.publish_date)}</span>}
                    {item.content_type === "upcoming_event" && item.start_date && (
                      <span>
                        {formatDateRange(item.start_date, item.end_date || item.start_date)}
                        {item.location ? `, ${item.location}` : ""}
                      </span>
                    )}
                    {item.content_type === "major_event" && (item.effective_start_date || item.effective_end_date) && (
                      <span>{formatDateRange(item.effective_start_date, item.effective_end_date)}</span>
                    )}
                    {!item.is_published && <span className="text-warning">, Draft</span>}
                    {!item.is_active && <span className="text-ink-faint">, Inactive</span>}
                    {item.is_featured && <span className="text-ems-primary">, Featured</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" className="text-xs text-ems-primary hover:underline" onClick={() => startEdit(item)}>
                  Edit
                </button>
                <button type="button" className="text-xs text-danger hover:underline" onClick={() => remove(item)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
