import { usePersistentState } from "../../utils/persistentFilters.js";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { reportsApi } from "../../api/reports";
import { configApi } from "../../api/configuration";
import { useToast } from "../../context/ToastContext.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import ReportFilterBar from "../../components/reports/ReportFilterBar.jsx";
import ReportKpiCard from "../../components/reports/ReportKpiCard.jsx";
import { AlertTriangleIcon, CalendarIcon, CheckCircleIcon, ClockIcon, MailIcon } from "../../components/common/DashboardIcons.jsx";
import ReportDataTable from "../../components/reports/ReportDataTable.jsx";
import { KpiSkeleton, ChartSkeleton, TableSkeleton, ReportEmptyState, ReportErrorState } from "../../components/reports/ReportStates.jsx";
import SaveReportButton from "../../components/reports/SaveReportButton.jsx";
import { exportRowsToCsv } from "../../utils/reportExport";
import { SUPPORT_TYPE_LABELS, extractErrorMessage, formatDate } from "../../utils/format";

// Report 3 of the Reports Module spec (§15/§16). Per §16, the UI must
// keep Support Type (what kind of communication work, Photography,
// Banner, ...) and Task Status (where the work stands) visibly distinct
//, never rendered as one combined string. Every row below shows both
// as separate columns/values rather than folding one into the other.
const STATUS_LABELS = { completed: "Completed", pending: "Pending", overdue: "Overdue" };

const EMPTY_FILTERS = {
  period: "", event: "", category: "", region: "", support_type: "", status: "", responsible_person: "",
};

const FILTER_FIELDS = [
  { key: "period", label: "Reporting Period", primary: true },
  { key: "status", label: "Status", primary: true, options: [
      { value: "pending", label: "Pending" },
      { value: "overdue", label: "Overdue" },
      { value: "completed", label: "Completed" },
    ] },
  { key: "support_type", label: "Support Type", primary: true },
  { key: "category", label: "Program", primary: false },
  { key: "region", label: "Region", primary: false },
  { key: "event", label: "Event", primary: false, type: "text" },
  { key: "responsible_person", label: "Responsible Person", primary: false, type: "text" },
];

function ChartCard({ title, children, empty }) {
  return (
    <div className="jm-card">
      <p className="text-sm font-bold text-ink mb-3">{title}</p>
      {empty ? (
        <p className="text-sm text-ink-faint py-8 text-center">Not enough data to chart yet.</p>
      ) : (
        <div style={{ width: "100%", height: 220 }}>{children}</div>
      )}
    </div>
  );
}

function countBy(rows, codeFn, labelFn) {
  const counts = new Map();
  for (const row of rows) {
    const code = codeFn(row);
    if (!code) continue;
    const entry = counts.get(code) || { key: code, name: labelFn(row), value: 0 };
    entry.value += 1;
    counts.set(code, entry);
  }
  return Array.from(counts.values()).sort((a, b) => b.value - a.value);
}

const TABLE_COLUMNS = [
  { key: "activity", label: "Activity", render: (row) => row.activity },
  { key: "event_title", label: "Event", render: (row) => (
      <Link to={`/events/${row.event_id}`} className="text-ems-primary hover:underline font-medium">{row.event_title}</Link>
    ), csvValue: (row) => row.event_title },
  { key: "support_type", label: "Type", render: (row) => SUPPORT_TYPE_LABELS[row.support_type] || row.support_type },
  { key: "completed_by", label: "Responsible", render: (row) => row.completed_by || row.requested_by || "-" },
  { key: "status", label: "Status", sortValue: (row) => STATUS_LABELS[row.status] || row.status, render: (row) => <StatusBadge label={STATUS_LABELS[row.status] || row.status} />, csvValue: (row) => row.status },
  { key: "due_date", label: "Due Date", sortValue: (row) => row.due_date, render: (row) => formatDate(row.due_date) },
  { key: "notes", label: "Notes", render: (row) => row.notes || "-", defaultVisible: false },
];

export default function CommunicationsReport({ initialFilters, onFiltersConsumed }) {
  const { showToast } = useToast();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [configOptions, setConfigOptions] = useState({});
  const [filters, setFilters] = usePersistentState("reports.communications.filters", { ...EMPTY_FILTERS, ...(initialFilters || {}) }, {
    // A Saved Report opens with its own filters; otherwise the last-used ones are kept.
    skipRestore: !!initialFilters,
  });

  useEffect(() => {
    configApi.active().then(({ data }) => setConfigOptions(data)).catch(() => {});
    if (initialFilters && onFiltersConsumed) onFiltersConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(isRefresh) {
    if (isRefresh) setRefreshing(true);
    setError(false);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const { data } = await reportsApi.getCommunicationsReport(params);
      setReport(data);
      setLastUpdated(new Date());
    } catch (e) {
      setError(true);
      if (isRefresh) showToast(extractErrorMessage(e), "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const filterFieldsWithOptions = useMemo(
    () =>
      FILTER_FIELDS.map((f) => {
        if (f.options || f.type === "text" || f.key === "period") return f;
        if (f.key === "category") return { ...f, options: configOptions.category || [] };
        if (f.key === "region") return { ...f, options: configOptions.region || [] };
        if (f.key === "support_type") return { ...f, options: configOptions.support_type || Object.entries(SUPPORT_TYPE_LABELS).map(([value, label]) => ({ value, label })) };
        return f;
      }),
    [configOptions]
  );

  const rows = report?.rows || [];
  const typeChartData = useMemo(() => countBy(rows, (r) => r.support_type, (r) => SUPPORT_TYPE_LABELS[r.support_type] || r.support_type), [rows]);

  function handleExportCsv() {
    exportRowsToCsv(`Communications_Report_${new Date().toISOString().slice(0, 10)}`, TABLE_COLUMNS, rows);
    showToast("CSV exported.", "success");
  }

  async function handleExportFile(format) {
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      await reportsApi.exportCommunicationsReport({ format, ...params });
      showToast(`${format.toUpperCase()} exported.`, "success");
    } catch (e) {
      showToast(extractErrorMessage(e), "error");
    }
  }

  const noData = report && report.summary.total_activities === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Communications Report</h1>
          <p className="text-sm text-ink-muted mt-0.5">Communication requests, support activity, status, and outputs.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-ink-faint hidden sm:inline">
            {lastUpdated ? `Last updated: ${lastUpdated.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : ""}
          </span>
          <button type="button" className="btn-secondary text-sm" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <SaveReportButton reportType="communications" filters={filters} />
          <div className="relative group">
            <button type="button" className="btn-secondary text-sm">Export</button>
            <div className="absolute z-20 top-full right-0 mt-1 w-44 bg-white border border-line rounded-lg shadow-lg py-1 hidden group-hover:block">
              <button type="button" onClick={handleExportCsv} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-surface-muted">
                CSV
              </button>
              <button type="button" onClick={() => handleExportFile("xlsx")} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-surface-muted">
                Excel
              </button>
              <button type="button" onClick={() => handleExportFile("pdf")} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-surface-muted">
                PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="jm-card">
        <ReportFilterBar
          fields={filterFieldsWithOptions}
          values={filters}
          onChange={(key, value) => setFilters((f) => ({ ...f, [key]: value }))}
          onReset={() => setFilters(EMPTY_FILTERS)}
        />
      </div>

      {loading ? (
        <div className="space-y-5">
          <KpiSkeleton />
          <ChartSkeleton />
          <TableSkeleton />
        </div>
      ) : error ? (
        <ReportErrorState onRetry={() => load(false)} />
      ) : noData ? (
        <ReportEmptyState onClear={() => setFilters(EMPTY_FILTERS)} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <ReportKpiCard label="Total Activities" icon={MailIcon} tone="blue" value={report.summary.total_activities} />
            <ReportKpiCard label="Completed" icon={CheckCircleIcon} tone="green" value={report.summary.completed} />
            <ReportKpiCard label="In Progress" icon={ClockIcon} tone="teal" value={report.summary.in_progress ?? "-"} />
            <ReportKpiCard label="To-Do" icon={CalendarIcon} tone="purple" value={report.summary.to_do ?? "-"} />
            <ReportKpiCard label="Overdue" icon={AlertTriangleIcon} tone="orange" value={report.summary.overdue} />
            <ReportKpiCard label="Outputs Produced" icon={CheckCircleIcon} tone="purple" value={report.summary.outputs_produced ?? "-"} />
          </div>
          <p className="text-xs text-ink-faint -mt-2">{report.summary.note}</p>

          <ChartCard title="Activity by Support Type" empty={typeChartData.length === 0}>
            <ResponsiveContainer>
              <BarChart data={typeChartData} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E9F0" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#7C5CD6" radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="jm-card space-y-3">
            <div>
              <h2 className="text-base font-bold text-ink">Communication Activities</h2>
              <p className="text-xs text-ink-muted mt-0.5">{rows.length} activity(ies) match the current filters.</p>
            </div>
            <ReportDataTable
              columns={TABLE_COLUMNS}
              rows={rows}
              getRowKey={(row) => row.todo_id}
              onRowClick={(row) => window.open(`/events/${row.event_id}`, "_self")}
              searchPlaceholder="Search activities..."
            />
          </div>
        </>
      )}
    </div>
  );
}
