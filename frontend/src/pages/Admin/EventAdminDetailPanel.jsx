import { useEffect, useState } from "react";
import { communicationsApi } from "../../api/communications";
import { configApi } from "../../api/configuration";
import { eventsApi } from "../../api/events";
import { staffApi } from "../../api/staff";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage } from "../../utils/format";

const TABS = [
  { key: "staff", label: "Staff" },
  { key: "communications", label: "Communications" },
  { key: "lead", label: "Lead" },
  { key: "photo", label: "Big Event Photo" },
];

/** Item 7.5: opened from the Events admin table. Shows/manages Staff
 * (full directory + reassign owner), Communications (this event's
 * Support Request), and Lead (organizer/engagement details) for one
 * event, without leaving the Admin page. */
export default function EventAdminDetailPanel({ eventId, onClose, onOwnerChanged }) {
  const { showToast } = useToast();
  const [event, setEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("staff");

  async function loadEvent() {
    setIsLoading(true);
    try {
      const { data } = await eventsApi.adminRetrieve(eventId);
      setEvent(data);
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadEvent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="jm-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {isLoading || !event ? (
          <p className="text-sm text-ink-faint py-10 text-center">Loading...</p>
        ) : (
          <>
            <div className="flex items-start justify-between mb-1">
              <div>
                <h2 className="text-lg font-semibold text-ink">{event.title}</h2>
                <p className="text-xs text-ink-faint">Owned by {event.owner_name}</p>
              </div>
              <button type="button" className="text-ink-faint hover:text-ink text-sm" onClick={onClose}>
                Close
              </button>
            </div>

            <nav className="flex gap-1 border-b border-line mt-3 mb-4">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={
                    "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
                    (activeTab === t.key
                      ? "border-ems-primary text-ems-primary"
                      : "border-transparent text-ink-muted hover:text-ink")
                  }
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {activeTab === "staff" && (
              <StaffTab
                event={event}
                onReassigned={(updated) => {
                  setEvent(updated);
                  onOwnerChanged?.(updated);
                }}
              />
            )}
            {activeTab === "communications" && (
              <CommunicationsTab event={event} onChanged={loadEvent} />
            )}
            {activeTab === "lead" && <LeadTab event={event} />}
            {activeTab === "photo" && <PhotoTab event={event} onChanged={loadEvent} />}
          </>
        )}
      </div>
    </div>
  );
}

function StaffTab({ event, onReassigned }) {
  const { showToast } = useToast();
  const [staff, setStaff] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [reassigning, setReassigning] = useState(null);

  useEffect(() => {
    staffApi
      .list()
      .then(({ data }) => setStaff(data.results || data))
      .catch((error) => showToast(extractErrorMessage(error), "error"))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reassignOwner(person) {
    if (person.id === event.owner) return;
    if (!window.confirm(`Make ${person.full_name} the owner of "${event.title}"?`)) return;
    setReassigning(person.id);
    try {
      const { data } = await eventsApi.adminUpdate(event.id, { owner: person.id });
      onReassigned(data);
      showToast(`Owner changed to ${person.full_name}.`, "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setReassigning(null);
    }
  }

  const filtered = staff.filter((p) =>
    !search.trim() || (p.full_name + p.email).toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Every staff account in the system, not just those already on this event. Pick one to make them the
        event owner.
      </p>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search staff..."
        className="form-input"
      />
      {isLoading ? (
        <p className="text-sm text-ink-faint py-4 text-center">Loading...</p>
      ) : (
        <ul className="divide-y divide-line border border-line rounded-md max-h-72 overflow-y-auto">
          {filtered.map((person) => {
            const isOwner = person.id === event.owner;
            return (
              <li key={person.id} className="flex items-center justify-between px-3 py-2">
                <div>
                  <p className="text-sm text-ink">{person.full_name}</p>
                  <p className="text-xs text-ink-faint">
                    {person.email} &middot; {person.role_display}
                  </p>
                </div>
                {isOwner ? (
                  <span className="text-xs text-ems-primary font-medium">Current owner</span>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary text-xs py-1"
                    disabled={reassigning === person.id || !person.is_active}
                    title={!person.is_active ? "This account is deactivated" : "Make owner"}
                    onClick={() => reassignOwner(person)}
                  >
                    {reassigning === person.id ? "Saving..." : "Make Owner"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const SUPPORT_TYPE_OPTIONS_CACHE = { current: null };

function CommunicationsTab({ event, onChanged }) {
  const { showToast } = useToast();
  const [supportTypeOptions, setSupportTypeOptions] = useState(SUPPORT_TYPE_OPTIONS_CACHE.current || []);
  const [isCreating, setIsCreating] = useState(false);
  const [newTypes, setNewTypes] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [editingNotes, setEditingNotes] = useState(event.support_request?.notes || "");

  useEffect(() => {
    if (SUPPORT_TYPE_OPTIONS_CACHE.current) return;
    configApi.active().then(({ data }) => {
      SUPPORT_TYPE_OPTIONS_CACHE.current = data.support_type || [];
      setSupportTypeOptions(SUPPORT_TYPE_OPTIONS_CACHE.current);
    });
  }, []);

  function toggleType(value) {
    setNewTypes((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  async function handleCreate() {
    setIsSaving(true);
    try {
      await communicationsApi.adminCreate({ event: event.id, support_types: newTypes });
      showToast("Support Request added.", "success");
      setIsCreating(false);
      onChanged();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveEdit() {
    setIsSaving(true);
    try {
      await communicationsApi.adminUpdate(event.support_request.id, {
        notes: editingNotes,
      });
      showToast("Support Request updated.", "success");
      onChanged();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this Support Request? This can't be undone.")) return;
    try {
      await communicationsApi.adminDelete(event.support_request.id);
      showToast("Support Request deleted.", "success");
      onChanged();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  }

  if (!event.needs_comms_support && !event.support_request) {
    return <p className="text-sm text-ink-muted py-4">This event wasn't marked as needing Communications support.</p>;
  }

  if (!event.support_request && !isCreating) {
    return (
      <div className="py-4 space-y-3">
        <p className="text-sm text-ink-muted">
          Communications support was requested, but no Support Request has been submitted yet.
        </p>
        <button className="jm-btn-primary" onClick={() => setIsCreating(true)}>
          Add Support Request
        </button>
      </div>
    );
  }

  if (isCreating) {
    return (
      <div className="space-y-3">
        <div>
          <label className="form-label">Support Types</label>
          <div className="flex flex-wrap gap-2">
            {supportTypeOptions.map((opt) => (
              <label
                key={opt.value}
                className={
                  "flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full border cursor-pointer " +
                  (newTypes.includes(opt.value)
                    ? "bg-ems-primaryLight text-ems-primaryLightText border-ems-primary"
                    : "border-line text-ink-muted")
                }
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={newTypes.includes(opt.value)}
                  onChange={() => toggleType(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setIsCreating(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="jm-btn-primary"
            disabled={isSaving || newTypes.length === 0}
            onClick={handleCreate}
          >
            {isSaving ? "Saving..." : "Add"}
          </button>
        </div>
      </div>
    );
  }

  const sr = event.support_request;
  return (
    <div className="space-y-4">
      <div>
        <p className="form-label mb-1">Support Types</p>
        <p className="text-sm text-ink">{sr.support_types.map((t) => t.replace(/_/g, " ")).join(", ")}</p>
      </div>
      <div>
        <label className="form-label">Notes</label>
        <textarea
          className="form-input"
          rows={3}
          value={editingNotes}
          onChange={(e) => setEditingNotes(e.target.value)}
        />
      </div>
      <div>
        <p className="form-label mb-1">Checklist</p>
        <ul className="space-y-1">
          {sr.todo_items.map((item) => (
            <li key={item.id} className="text-sm flex items-center gap-2">
              <StatusBadge label={item.is_done ? "Done" : "Pending"} />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-between pt-2 border-t border-line">
        <button type="button" className="text-ems-primary text-sm hover:underline" onClick={handleDelete}>
          Delete Support Request
        </button>
        <button type="button" className="jm-btn-primary" disabled={isSaving} onClick={handleSaveEdit}>
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// Big Events (Dashboard): lets an admin attach/replace/remove the cover
// photo shown on the Dashboard's Big Events cards for International/
// National events. Available regardless of this event's own category ,
// so a photo can be set ahead of a category change, but the hint text
// below is explicit about where it's actually used.
function PhotoTab({ event, onChanged }) {
  const { showToast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [preview, setPreview] = useState(null);

  function handleFilePick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    upload(file);
  }

  async function upload(file) {
    setIsSaving(true);
    try {
      await eventsApi.adminUploadBigEventPhoto(event.id, file);
      showToast("Big Event photo updated.", "success");
      onChanged();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
      setPreview(null);
    }
  }

  async function handleRemove() {
    if (!window.confirm("Remove this event's Big Event photo?")) return;
    setIsSaving(true);
    try {
      await eventsApi.adminClearBigEventPhoto(event.id);
      showToast("Big Event photo removed.", "success");
      onChanged();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  const photoUrl = preview || event.big_event_photo;

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Shown on the Dashboard's Big Events cards for International and National events. Optional, events
        without a photo still display, without an image area.
      </p>
      <div className="rounded-md border border-line overflow-hidden bg-surface-sunken h-40 flex items-center justify-center">
        {photoUrl ? (
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-ink-faint">No photo set</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="btn-secondary text-sm cursor-pointer">
          {isSaving ? "Saving..." : event.big_event_photo ? "Replace Photo" : "Upload Photo"}
          <input type="file" accept="image/*" className="hidden" disabled={isSaving} onChange={handleFilePick} />
        </label>
        {event.big_event_photo && !isSaving && (
          <button type="button" className="text-ems-primary text-sm hover:underline" onClick={handleRemove}>
            Remove Photo
          </button>
        )}
      </div>
    </div>
  );
}

function LeadTab({ event }) {
  const rows = [
    ["Lead Organization", event.organization_lead_agency],
    ["Engagement Level", event.engagement_level?.replace(/_/g, " ")],
    ["Co-organizer", event.co_organizer_name || "N/A"],
    ["Support Level", event.support_level || "N/A"],
    ["Thematic Area", event.thematic_area],
    ["Category", event.category],
    ["Total Expected Participants", event.total_expected_participants ?? "N/A"],
    ["Expected Participants from EE", event.expected_participants ?? "N/A"],
  ];
  return (
    <dl className="divide-y divide-line">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between py-2 text-sm">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="text-ink font-medium capitalize">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
