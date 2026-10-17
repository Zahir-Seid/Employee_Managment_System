import { usePersistentState } from "../../utils/persistentFilters.js";
import { useEffect, useState } from "react";
import { reportsApi } from "../../api/reports";
import { useToast } from "../../context/ToastContext.jsx";
import ConfirmDialog from "../../components/common/ConfirmDialog.jsx";
import { ReportEmptyState, ReportErrorState, TableSkeleton } from "../../components/reports/ReportStates.jsx";
import { extractErrorMessage, formatDateTime } from "../../utils/format";

// Spec §19, reopen, re-run, or export a previously saved report
// configuration. Each row stores only report_type + filters (see
// backend models.SavedReport's docstring), so "Open" here just means
// handing those two things to ReportsHub, which switches to that
// report's own tab and lets that report's own permission-checked
// endpoint do the actual data fetch, there's no separate saved-report-
// specific data path to keep in sync with the live reports.
const REPORT_TYPE_LABELS = {
  management: "Management",
  event_activity: "Event Activity",
  communications: "Communications",
  partner_engagement: "Partner Engagement",
  annual: "Annual Event",
};

const EXPORTERS = {
  management: reportsApi.exportManagementReport,
  event_activity: reportsApi.exportEventActivityReport,
  communications: reportsApi.exportCommunicationsReport,
  partner_engagement: reportsApi.exportPartnerEngagementReport,
  annual: reportsApi.exportAnnualEventReport,
};

export default function SavedReports({ onOpenReport }) {
  const { showToast } = useToast();
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = usePersistentState("saved-reports.search", "");
  const [renaming, setRenaming] = useState(null); // {id, name}
  const [deleting, setDeleting] = useState(null); // {id, name}
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setError(false);
    try {
      const { data } = await reportsApi.listSavedReports();
      setItems(data.results ?? data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRenameSave() {
    if (!renaming || !renaming.name.trim()) return;
    setBusyId(renaming.id);
    try {
      await reportsApi.updateSavedReport(renaming.id, { name: renaming.name.trim() });
      showToast("Renamed.", "success");
      setRenaming(null);
      load();
    } catch (e) {
      showToast(extractErrorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDuplicate(item) {
    setBusyId(item.id);
    try {
      await reportsApi.duplicateSavedReport(item.id);
      showToast("Duplicated.", "success");
      load();
    } catch (e) {
      showToast(extractErrorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await reportsApi.deleteSavedReport(deleting.id);
      showToast("Deleted.", "success");
      setDeleting(null);
      load();
    } catch (e) {
      showToast(extractErrorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleExport(item, format) {
    const exporter = EXPORTERS[item.report_type];
    if (!exporter) return;
    setBusyId(item.id);
    try {
      await exporter({ format, ...(item.filters || {}) });
      showToast(`${format.toUpperCase()} exported.`, "success");
    } catch (e) {
      showToast(extractErrorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  const filtered = (items || []).filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Saved Reports</h1>
        <p className="text-sm text-ink-muted mt-0.5">
          Report configurations you've saved - private to you, always re-run against current data.
        </p>
      </div>

      <div className="jm-card space-y-3">
        <input
          type="text"
          className="form-input max-w-xs"
          placeholder="Search saved reports..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <ReportErrorState onRetry={load} />
        ) : filtered.length === 0 ? (
          <ReportEmptyState
            title="No saved reports"
            message={
              items && items.length === 0
                ? "Use the Save button on any report to save its current filters here."
                : "No saved reports match your search."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint uppercase tracking-wide">
                  <th className="pb-1.5 pr-3 w-12">No.</th>
                  <th className="pb-1.5 pr-3">Name</th>
                  <th className="pb-1.5 pr-3">Type</th>
                  <th className="pb-1.5 pr-3">Created By</th>
                  <th className="pb-1.5 pr-3">Created</th>
                  <th className="pb-1.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((item, rowIndex) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-3 text-ink-muted tabular-nums">{rowIndex + 1}</td>
                    <td className="py-2 pr-3 font-medium text-ink">
                      {renaming?.id === item.id ? (
                        <input
                          type="text"
                          autoFocus
                          className="form-input h-8 text-sm"
                          value={renaming.name}
                          onChange={(e) => setRenaming({ id: item.id, name: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && handleRenameSave()}
                        />
                      ) : (
                        item.name
                      )}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{REPORT_TYPE_LABELS[item.report_type] || item.report_type_label}</td>
                    <td className="py-2 pr-3 text-ink-muted">{item.created_by_name}</td>
                    <td className="py-2 pr-3 text-ink-muted">{formatDateTime(item.created_at)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        {renaming?.id === item.id ? (
                          <>
                            <button type="button" className="text-ems-primary hover:underline" onClick={handleRenameSave} disabled={busyId === item.id}>
                              Save
                            </button>
                            <button type="button" className="text-ink-faint hover:text-ink" onClick={() => setRenaming(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="text-ems-primary hover:underline"
                              onClick={() => onOpenReport(item.report_type, item.filters || {})}
                            >
                              Open
                            </button>
                            <button type="button" className="text-ink-muted hover:text-ink" onClick={() => setRenaming({ id: item.id, name: item.name })}>
                              Edit
                            </button>
                            <button type="button" className="text-ink-muted hover:text-ink" onClick={() => handleDuplicate(item)} disabled={busyId === item.id}>
                              Duplicate
                            </button>
                            <div className="relative group">
                              <button type="button" className="text-ink-muted hover:text-ink" disabled={busyId === item.id}>
                                Export
                              </button>
                              <div className="absolute z-20 top-full left-0 mt-1 w-32 bg-white border border-line rounded-lg shadow-lg py-1 hidden group-hover:block">
                                <button type="button" onClick={() => handleExport(item, "xlsx")} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-surface-muted">
                                  Excel
                                </button>
                                <button type="button" onClick={() => handleExport(item, "pdf")} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-surface-muted">
                                  PDF
                                </button>
                              </div>
                            </div>
                            <button type="button" className="text-pill-danger hover:underline" onClick={() => setDeleting(item)}>
                              Delete
                            </button>
                          </>
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

      <ConfirmDialog
        open={!!deleting}
        title="Delete saved report?"
        message={`"${deleting?.name}" will be permanently removed. This can't be undone.`}
        confirmLabel="Delete"
        danger
        isSubmitting={busyId === deleting?.id}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
