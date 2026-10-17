import { useState } from "react";
import { reportsApi } from "../../api/reports";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage } from "../../utils/format";

// Spec §4's global report layout puts [Save] in the toolbar next to
// Refresh/Export on every report; spec §19 is what that button actually
// does, persist the current report_type + filters as a SavedReport so
// the person can reopen this exact view later without re-selecting
// filters. Deliberately saves `filters` as-is (whatever the calling
// report's own filter state object looks like) rather than picking
// specific keys, so this one component works for every report_type
// without needing to know each report's individual field list.
export default function SaveReportButton({ reportType, filters }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await reportsApi.createSavedReport({ name: name.trim(), report_type: reportType, filters });
      showToast("Report saved.", "success");
      setOpen(false);
      setName("");
    } catch (e) {
      showToast(extractErrorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary text-sm" onClick={() => setOpen(true)}>
        Save
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 px-4">
          <div className="jm-card w-full max-w-sm p-6 space-y-4">
            <div>
              <h3 className="text-base font-bold text-ink">Save Report</h3>
              <p className="text-sm text-ink-muted mt-0.5">
                Saves the current filters so you can reopen this exact view later, from Saved Reports.
              </p>
            </div>
            <div>
              <label className="form-label">Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Q3 2026 - Oromia Events"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
