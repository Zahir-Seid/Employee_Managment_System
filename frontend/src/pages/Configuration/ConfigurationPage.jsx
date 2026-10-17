import { useEffect, useState } from "react";
import { configApi } from "../../api/configuration";
import ConfirmDialog from "../../components/common/ConfirmDialog.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage } from "../../utils/format";

// All 8 admin-managed lists (added on request, previously only the first
// 3 were exposed here even though the backend already supported all 8).
const LIST_TABS = [
  { key: "thematic_area", label: "Thematic Areas" },
  { key: "engagement_level", label: "Engagement Levels" },
  { key: "lead_organization", label: "Lead Organizations" },
  { key: "region", label: "Regions" },
  { key: "support_type", label: "Support Types" },
  // Category and Status are structurally different from the other 6 (see
  // FIXED_VALUE_LISTS below): rename-only, no add/deactivate.
  { key: "category", label: "Category" },
  { key: "event_status", label: "Status" },
  { key: "support_level", label: "Support Level" },
];

const SETTINGS_TAB = { key: "__settings__", label: "System Settings" };

// Category and Status drive real logic elsewhere in the app, the
// Postpone/Cancel/Reopen actions map to these exact 4 status values, and
// the Dashboard's category breakdown counts by these exact 4 category
// values. Add/Delete are now enabled for these too (staff request), but
// a new value here won't automatically get that special behavior wired
// up for it, and deleting one of the built-in defaults could affect
// features that expect it to exist. RISKY_LISTS only controls whether the
// caution banner below shows; it no longer disables any action.
const RISKY_LISTS = new Set(["category", "event_status"]);

function slugify(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function ConfigurationPage() {
  const [activeTab, setActiveTab] = useState(LIST_TABS[0].key);
  const { showToast } = useToast();

  const isSettingsTab = activeTab === SETTINGS_TAB.key;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Configuration</h1>
        <p className="text-sm text-ink-muted mt-1">Manage the dropdown lists and system options used across the app.</p>
      </div>

      <div className="inline-flex flex-wrap rounded-lg border border-[#E5E9F0] bg-white p-1 gap-1">
        {LIST_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors " +
              (activeTab === t.key ? "bg-ems-primary text-white" : "text-ink-muted hover:text-ink")
            }
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setActiveTab(SETTINGS_TAB.key)}
          className={
            "px-3 py-1.5 text-sm font-medium rounded-md transition-colors border-l border-line ml-1 pl-3 " +
            (isSettingsTab ? "bg-ems-primary text-white" : "text-ink-muted hover:text-ink")
          }
        >
          {SETTINGS_TAB.label}
        </button>
      </div>

      {isSettingsTab ? (
        <SystemSettingsPanel showToast={showToast} />
      ) : (
        <ListPanel key={activeTab} listType={activeTab} showToast={showToast} />
      )}
    </div>
  );
}

function ListPanel({ listType, showToast }) {
  const [options, setOptions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingLabel, setEditingLabel] = useState("");
  // Confirm-before-delete: this is a permanent, irreversible action (unlike
  // Deactivate), so it gets a confirmation step rather than firing on a
  // single click. Holds the option pending confirmation, or null.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const isRisky = RISKY_LISTS.has(listType);
  const tabLabel = LIST_TABS.find((t) => t.key === listType)?.label || listType;

  async function load() {
    setIsLoading(true);
    try {
      const { data } = await configApi.list(listType);
      setOptions(data.results || data);
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
    setNewLabel("");
    setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listType]);

  async function handleAdd(e) {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    setIsSaving(true);
    try {
      await configApi.create({
        list_type: listType,
        label,
        value: slugify(label),
        order: options.length,
      });
      showToast(`"${label}" added.`, "success");
      setNewLabel("");
      await load();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleActive(option) {
    try {
      await configApi.update(option.id, { is_active: !option.is_active });
      setOptions((prev) => prev.map((o) => (o.id === option.id ? { ...o, is_active: !o.is_active } : o)));
      if (option.is_active && option.usage_count > 0) {
        // Going active -> inactive, and it's actually in use somewhere.
        showToast(
          `"${option.label}" deactivated. It's used by ${option.usage_count} existing record${option.usage_count === 1 ? "" : "s"}; those are unaffected, it just won't show up as an option for new ones.`,
          "success"
        );
      } else {
        showToast(`"${option.label}" ${option.is_active ? "deactivated" : "activated"}.`, "success");
      }
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  }

  function startEdit(option) {
    setEditingId(option.id);
    setEditingLabel(option.label);
  }

  async function saveEdit(option) {
    const label = editingLabel.trim();
    if (!label || label === option.label) {
      setEditingId(null);
      return;
    }
    try {
      await configApi.update(option.id, { label });
      setOptions((prev) => prev.map((o) => (o.id === option.id ? { ...o, label } : o)));
      setEditingId(null);
      showToast(
        option.usage_count > 0
          ? `Renamed to "${label}". This also updates the label on ${option.usage_count} existing record${option.usage_count === 1 ? "" : "s"} that already use it.`
          : `Renamed to "${label}".`,
        "success"
      );
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  }

  async function confirmDelete() {
    const option = pendingDelete;
    if (!option) return;
    setIsDeleting(true);
    try {
      await configApi.remove(option.id);
      setOptions((prev) => prev.filter((o) => o.id !== option.id));
      setPendingDelete(null);
      showToast(`"${option.label}" deleted.`, "success");
    } catch (error) {
      // The backend blocks deletion of an in-use option with a clear,
      // specific 400 error ("used by N existing records..."), surfaced
      // here exactly as returned rather than a generic failure message,
      // so the admin knows precisely why and what to do instead
      // (deactivate). The dialog stays open so they can read it and
      // choose Cancel or try Deactivate instead.
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="jm-card">
      {isRisky && (
        <p className="text-xs text-warning bg-warning/5 border border-warning/20 rounded-md px-3 py-2 mb-5">
          Heads up: {tabLabel} drives fixed behavior elsewhere in the app (status/category color-coding, the event
          lifecycle actions, Dashboard breakdowns). Adding a value here won't automatically wire up that behavior
          for it, and deleting one of the built-in defaults could affect features that expect it to exist  - 
          double-check it's really unused first.
        </p>
      )}

      <form onSubmit={handleAdd} className="flex gap-2 mb-5">
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder={`Add a new ${tabLabel.toLowerCase().replace(/s$/, "")}...`}
          className="form-input flex-1"
        />
        <button type="submit" className="jm-btn-primary shrink-0" disabled={isSaving || !newLabel.trim()}>
          Add
        </button>
      </form>

      {isLoading ? (
        <p className="text-sm text-ink-faint py-6 text-center">Loading...</p>
      ) : options.length === 0 ? (
        <p className="text-sm text-ink-faint py-6 text-center">No options yet. Add the first one above.</p>
      ) : (
        <ul className="divide-y divide-line">
          {options.map((option) => (
            <li key={option.id} className="flex items-center gap-3 py-3">
              {editingId === option.id ? (
                <input
                  type="text"
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onBlur={() => saveEdit(option)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit(option);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  autoFocus
                  className="form-input flex-1 py-1"
                />
              ) : (
                <span
                  className={
                    "flex-1 text-sm flex items-center gap-2 " +
                    (option.is_active ? "text-ink" : "text-ink-faint line-through")
                  }
                >
                  {option.label}
                  {option.usage_count > 0 && (
                    <span
                      title={`Used by ${option.usage_count} existing record${option.usage_count === 1 ? "" : "s"}`}
                      className="no-underline text-xs font-normal px-1.5 py-0.5 rounded-full bg-surface-muted text-ink-faint"
                    >
                      {option.usage_count} in use
                    </span>
                  )}
                </span>
              )}

              {editingId !== option.id && (
                <button
                  onClick={() => startEdit(option)}
                  className="shrink-0 text-xs font-medium px-2 py-1 rounded text-ink-muted hover:text-ink hover:bg-surface-muted"
                >
                  Edit
                </button>
              )}

              <button
                onClick={() => toggleActive(option)}
                title={option.is_active ? "Deactivate - hide from new events, keep on existing ones" : "Activate"}
                aria-pressed={option.is_active}
                className="shrink-0 flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded text-ink-muted hover:text-ink hover:bg-surface-muted"
              >
                <span
                  className={
                    "h-5 w-9 rounded-full relative transition-colors border shrink-0 " +
                    (option.is_active ? "bg-ems-primary border-ems-primary" : "bg-surface-sunken border-line")
                  }
                >
                  <span
                    className={
                      "absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform " +
                      (option.is_active ? "translate-x-4" : "translate-x-0")
                    }
                  />
                </span>
                {option.is_active ? "Deactivate" : "Activate"}
              </button>

              <button
                onClick={() => setPendingDelete(option)}
                title="Permanently delete"
                className="shrink-0 text-xs font-medium px-2 py-1 rounded text-warning hover:bg-warning/10"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete "${pendingDelete?.label}"?`}
        message={
          pendingDelete?.usage_count > 0
            ? `This can't be deleted - it's used by ${pendingDelete.usage_count} existing record${pendingDelete.usage_count === 1 ? "" : "s"}. Deactivate it instead to hide it from new events without affecting the ones that already use it.`
            : "This permanently removes the option. This can't be undone."
        }
        confirmLabel={pendingDelete?.usage_count > 0 ? "Deactivate Instead" : "Delete"}
        danger={!(pendingDelete?.usage_count > 0)}
        isSubmitting={isDeleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete?.usage_count > 0) {
            const option = pendingDelete;
            setPendingDelete(null);
            toggleActive(option);
          } else {
            confirmDelete();
          }
        }}
      />
    </div>
  );
}

const PERIOD_OPTIONS = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

function SystemSettingsPanel({ showToast }) {
  const [form, setForm] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    configApi
      .getSystemSettings()
      .then(({ data }) => setForm(data))
      .catch((error) => showToast(extractErrorMessage(error), "error"))
      .finally(() => setIsLoading(false));
  }, [showToast]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setIsSaving(true);
    setErrors({});
    try {
      const { data } = await configApi.updateSystemSettings({
        notification_from_email: form.notification_from_email,
        notification_copy_to_email: form.notification_copy_to_email,
        max_photos_per_report: Number(form.max_photos_per_report),
        max_photo_size_mb: Number(form.max_photo_size_mb),
        default_dashboard_period: form.default_dashboard_period,
        registration_allowed_domains: form.registration_allowed_domains,
      });
      setForm(data);
      showToast("System Settings saved.", "success");
    } catch (error) {
      const data = error?.response?.data;
      if (data && typeof data === "object") setErrors(data);
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <div className="jm-card text-sm text-ink-faint py-6 text-center">Loading...</div>;
  if (!form) return null;

  return (
    <form onSubmit={handleSave} className="jm-card space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-ink mb-1">Notification Email</h3>
        <p className="text-xs text-ink-muted mb-3">
          Both optional: leave blank to use the server's built-in defaults.
        </p>
        <div className="space-y-3">
          <div>
            <label className="form-label">"From" address on outgoing notification emails</label>
            <input
              type="email"
              className="form-input"
              placeholder="ems@ee.org"
              value={form.notification_from_email || ""}
              onChange={(e) => set("notification_from_email", e.target.value)}
            />
            {errors.notification_from_email && (
              <p className="form-error">{errors.notification_from_email}</p>
            )}
          </div>
          <div>
            <label className="form-label">Also send a copy of every notification to</label>
            <input
              type="email"
              className="form-input"
              placeholder="admin-inbox@ee.org"
              value={form.notification_copy_to_email || ""}
              onChange={(e) => set("notification_copy_to_email", e.target.value)}
            />
            {errors.notification_copy_to_email && (
              <p className="form-error">{errors.notification_copy_to_email}</p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-line pt-5">
        <h3 className="text-sm font-semibold text-ink mb-1">Event Status Report Photos</h3>
        <p className="text-xs text-ink-muted mb-3">Takes effect immediately, no restart needed.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Max photos per report</label>
            <input
              type="number"
              min={1}
              className="form-input"
              value={form.max_photos_per_report}
              onChange={(e) => set("max_photos_per_report", e.target.value)}
            />
            {errors.max_photos_per_report && <p className="form-error">{errors.max_photos_per_report}</p>}
          </div>
          <div>
            <label className="form-label">Max size per photo (MB)</label>
            <input
              type="number"
              min={1}
              className="form-input"
              value={form.max_photo_size_mb}
              onChange={(e) => set("max_photo_size_mb", e.target.value)}
            />
            {errors.max_photo_size_mb && <p className="form-error">{errors.max_photo_size_mb}</p>}
          </div>
        </div>
      </div>

      <div className="border-t border-line pt-5">
        <h3 className="text-sm font-semibold text-ink mb-1">Dashboard</h3>
        <p className="text-xs text-ink-muted mb-3">Which period the Dashboard opens to by default for everyone.</p>
        <select
          className="form-input max-w-xs"
          value={form.default_dashboard_period}
          onChange={(e) => set("default_dashboard_period", e.target.value)}
        >
          {PERIOD_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="border-t border-line pt-5">
        <h3 className="text-sm font-semibold text-ink mb-1">Registration</h3>
        <p className="text-xs text-ink-muted mb-3">
          Email domains allowed to self-register via the Register page (comma-separated, e.g. "ee.org,
          ee.org.et"). A domain not on this list can't request a verification code.
        </p>
        <input
          className="form-input"
          placeholder="ee.org"
          value={form.registration_allowed_domains || ""}
          onChange={(e) => set("registration_allowed_domains", e.target.value)}
        />
        {errors.registration_allowed_domains && (
          <p className="form-error">{errors.registration_allowed_domains}</p>
        )}
      </div>

      <div className="border-t border-line pt-5 flex items-center justify-between">
        {form.updated_by_name && (
          <p className="text-xs text-ink-faint">
            Last updated by {form.updated_by_name}
            {form.updated_at ? ` on ${new Date(form.updated_at).toLocaleString()}` : ""}
          </p>
        )}
        <button type="submit" className="jm-btn-primary ml-auto" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </form>
  );
}
