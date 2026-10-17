import { usePersistentState } from "../../utils/persistentFilters.js";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { reportsApi } from "../../api/reports";
import { configApi } from "../../api/configuration";
import { useToast } from "../../context/ToastContext.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import ReportFilterBar from "../../components/reports/ReportFilterBar.jsx";
import ReportKpiCard from "../../components/reports/ReportKpiCard.jsx";
import { AlertTriangleIcon, CalendarIcon, CheckCircleIcon, ClockIcon, PercentIcon, UsersIcon } from "../../components/common/DashboardIcons.jsx";
import ReportDataTable from "../../components/reports/ReportDataTable.jsx";
import { KpiSkeleton, ChartSkeleton, TableSkeleton, ReportEmptyState, ReportErrorState } from "../../components/reports/ReportStates.jsx";
import SaveReportButton from "../../components/reports/SaveReportButton.jsx";
import { exportRowsToCsv } from "../../utils/reportExport";
import {
  EVENT_STATUS_LABELS,
  EVENT_TYPE_OPTIONS,
  extractErrorMessage,
  formatDateRange,
  formatEventType,
} from "../../utils/format";

// Report 2 of the Reports Module spec (§14): "What events were
// conducted, where, when, by whom, and with what results?" Shares the
// same reusable ReportFilterBar/ReportKpiCard/ReportDataTable/loading-
// empty-error components as the Management Report (§28's shared engine
// instruction applies to the frontend too, not just the backend) rather
// than building bespoke versions of any of them.
const CHART_COLORS = ["#2563C4", "#1D9E75", "#E58A2E", "#7C5CD6", "#0E9AA8", "#D64550", "#8FB3E8", "#2B3A55"];
const STATUS_COLORS = {
  upcoming: "#0E9AA8",
  ongoing: "#2563C4",
  held: "#7C5CD6",
  completed: "#1D9E75",
  postponed: "#E58A2E",
  cancelled: "#94A3B8",
};

const EMPTY_FILTERS = { period: "", category: "", region: "", status: "", event_type: "", support_level: "", responsible_person: "", organization: "" };

const FILTER_FIELDS = [
  { key: "period", label: "Reporting Period", primary: true },
  { key: "category", label: "Program", primary: true },
  { key: "region", label: "Region", primary: true },
  { key: "status", label: "Status", primary: true },
  { key: "event_type", label: "Event Type", primary: false },
  { key: "support_level", label: "Support Level", primary: false },
  { key: "responsible_person", label: "Responsible Person", primary: false, type: "text" },
  // Not one of spec §14's own filters, added as a visible, clearable
  // field (rather than a hidden query param) so a drill-down from the
  // Partner Engagement Report's "Events" count (spec §17) shows up as
  // an active filter chip per spec §8, instead of silently narrowing
  // the table with no visible explanation of why.
  { key: "organization", label: "Partner", primary: false, type: "text" },
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

// Spec §12 applies here too: only chart values that actually occur in the
// data, never a fixed axis padded with zero-value bars for options
// nobody used this period.
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

function monthlyTrend(rows) {
  const counts = new Map();
  for (const row of rows) {
    if (!row.start_date) continue;
    const month = row.start_date.slice(0, 7);
    counts.set(month, (counts.get(month) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({
      month: new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      value,
    }));
}

const TABLE_COLUMNS = [
  { key: "title", label: "Event", render: (row) => (
      <Link to={`/events/${row.event_id}`} className="text-ems-primary hover:underline font-medium">{row.title}</Link>
    ), csvValue: (row) => row.title },
  { key: "event_type", label: "Event Type", render: (row) => formatEventType(row), csvValue: (row) => formatEventType(row) },
  { key: "date", label: "Date", sortValue: (row) => row.start_date, render: (row) => formatDateRange(row.start_date, row.end_date), csvValue: (row) => formatDateRange(row.start_date, row.end_date) },
  { key: "region", label: "Location", render: (row) => row.location || row.region },
  { key: "category", label: "Program", render: (row) => row.category },
  { key: "lead_organization", label: "Lead", render: (row) => row.lead_organization || "-" },
  { key: "status", label: "Status", sortValue: (row) => row.status, render: (row) => <StatusBadge label={row.status} />, csvValue: (row) => row.status },
  { key: "participant_count", label: "Participants", align: "right", render: (row) => (
      <>
        {row.participant_count ?? "-"}
        {!row.participant_count_is_actual && row.participant_count != null && (
          <span className="text-[10px] text-ink-faint"> (expected)</span>
        )}
      </>
    ), csvValue: (row) => row.participant_count ?? "" },
  { key: "partner", label: "Partners", render: (row) => row.partner || "-", defaultVisible: false },
  { key: "post_event_report_status", label: "Communication Support", render: (row) => <span className="capitalize">{row.post_event_report_status}</span>, defaultVisible: false },
];

// `initialFilters` / `onFiltersConsumed`: support filter carry-over
// (spec §9) when arriving here via a drill-down link from the
// Management Report, the caller (ReportsHub) hands over the filters
// that were active there so the person never re-selects them.
export default function EventActivityReport({ initialFilters, onFiltersConsumed }) {
  const { showToast } = useToast();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [configOptions, setConfigOptions] = useState({});
  const [filters, setFilters] = usePersistentState("reports.event-activity.filters", { ...EMPTY_FILTERS, ...(initialFilters || {}) }, {
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
      const { data } = await reportsApi.getEventActivityReport(params);
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
        if (f.key === "status") return { ...f, options: configOptions.event_status || Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => ({ value, label })) };
        if (f.key === "event_type") return { ...f, options: EVENT_TYPE_OPTIONS };
        if (f.key === "support_level") return { ...f, options: configOptions.support_level || [] };
        return f;
      }),
    [configOptions]
  );

  const rows = report?.rows || [];
  const statusChartData = useMemo(() => countBy(rows, (r) => r.status_code, (r) => r.status), [rows]);
  const categoryChartData = useMemo(() => countBy(rows, (r) => r.category_code, (r) => r.category), [rows]);
  const trendData = useMemo(() => monthlyTrend(rows), [rows]);

  function handleExportCsv() {
    exportRowsToCsv(`Event_Activity_Report_${new Date().toISOString().slice(0, 10)}`, TABLE_COLUMNS, rows);
    showToast("CSV exported.", "success");
  }

  async function handleExportFile(format) {
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      await reportsApi.exportEventActivityReport({ format, ...params });
      showToast(`${format.toUpperCase()} exported.`, "success");
    } catch (e) {
      showToast(extractErrorMessage(e), "error");
    }
  }

  const noData = report && report.summary.total_events === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Event Activity Report</h1>
          <p className="text-sm text-ink-muted mt-0.5">Detailed analysis of event implementation and activity.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-ink-faint hidden sm:inline">
            {lastUpdated ? `Last updated: ${lastUpdated.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : ""}
          </span>
          <button type="button" className="btn-secondary text-sm" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <SaveReportButton reportType="event_activity" filters={filters} />
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
          <TableSkeleton />
        </div>
      ) : error ? (
        <ReportErrorState onRetry={() => load(false)} />
      ) : noData ? (
        <ReportEmptyState onClear={() => setFilters(EMPTY_FILTERS)} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <ReportKpiCard label="Total Events" icon={CalendarIcon} tone="blue" value={report.summary.total_events} />
            <ReportKpiCard label="Completed Events" icon={CheckCircleIcon} tone="green" value={report.summary.completed_events} />
            <ReportKpiCard label="Upcoming Events" icon={ClockIcon} tone="purple" value={report.summary.upcoming_events} />
            <ReportKpiCard label="Cancelled / Postponed" icon={AlertTriangleIcon} tone="orange" value={report.summary.cancelled_postponed_events} />
            <ReportKpiCard
              label="Participants" icon={UsersIcon} tone="teal"
              value={report.summary.total_participants}
              sub={`${report.summary.events_with_actual_participants} of ${report.summary.total_events} from submitted reports`}
            />
            <ReportKpiCard label="Avg. Participants / Event" icon={PercentIcon} tone="teal" value={report.summary.average_participants_per_event ?? "-"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Event Trend" empty={trendData.length < 2}>
              <ResponsiveContainer>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E9F0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={28} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" name="Events" stroke="#2563C4" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Events by Status" empty={statusChartData.length === 0}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={statusChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(d) => `${d.name} (${d.value})`}>
                    {statusChartData.map((entry) => (
                      <Cell key={entry.key} fill={STATUS_COLORS[entry.key] || CHART_COLORS[0]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Events by Program" empty={categoryChartData.length === 0}>
              <ResponsiveContainer>
                <BarChart data={categoryChartData} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E9F0" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#2563C4" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="jm-card space-y-3">
            <div>
              <h2 className="text-base font-bold text-ink">Event List</h2>
              <p className="text-xs text-ink-muted mt-0.5">{rows.length} event(s) match the current filters.</p>
            </div>
            <ReportDataTable
              columns={TABLE_COLUMNS}
              rows={rows}
              getRowKey={(row) => row.event_id}
              onRowClick={(row) => window.open(`/events/${row.event_id}`, "_self")}
              searchPlaceholder="Search events..."
            />
          </div>
        </>
      )}
    </div>
  );
}
