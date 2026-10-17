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
import { useToast } from "../../context/ToastContext.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import EmptyState from "../../components/common/EmptyState.jsx";
import ReportKpiCard from "../../components/reports/ReportKpiCard.jsx";
import { AlertTriangleIcon, CalendarIcon, ClockIcon, MailIcon, UsersIcon } from "../../components/common/DashboardIcons.jsx";
import ReportDataTable from "../../components/reports/ReportDataTable.jsx";
import SaveReportButton from "../../components/reports/SaveReportButton.jsx";
import { KpiSkeleton, ChartSkeleton, TableSkeleton, ReportErrorState } from "../../components/reports/ReportStates.jsx";
import { exportRowsToCsv } from "../../utils/reportExport";
import { EVENT_TYPE_LABELS, extractErrorMessage, formatDateRange, formatEventType } from "../../utils/format";

// Report 5 of the Reports Module spec (§18), a full-year organizational
// summary, explicitly distinct from the Management Report's selected-
// period view. Access is Staff-excluded (see backend
// AnnualEventReportView), so this page is only ever reached from
// ReportsHub's full-suite tabs.
//
// Achievements/Challenges/Follow-up here use simpler, single-list
// renderings rather than importing ExecutiveManagementReport's own
// grouped/expandable versions of the same sections, reusing those
// would mean exporting several tightly-coupled internal components out
// of that file, which risks the already-tested Management Report for a
// cosmetic gain. The underlying *data* still comes from the exact same
// backend functions (see services/annual_event_report.py), so nothing
// here can disagree with the Management Report's own numbers, only the
// on-screen presentation differs.
const CHART_COLORS = ["#2563C4", "#1D9E75", "#E58A2E", "#7C5CD6", "#0E9AA8", "#D64550", "#8FB3E8", "#2B3A55"];

function currentYearOptions() {
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now + 1; y >= now - 4; y -= 1) years.push(y);
  return years;
}

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

function BreakdownChart({ title, data }) {
  return (
    <ChartCard title={title} empty={data.length === 0}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E9F0" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
          <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="count" fill="#2563C4" radius={[0, 4, 4, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function TextList({ items, emptyMessage, renderMeta }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return <p className="text-sm text-ink-faint">{emptyMessage}</p>;
  const visible = expanded ? items : items.slice(0, 5);
  return (
    <div className="space-y-3">
      {visible.map((item, i) => (
        <div key={i} className="text-sm border-l-2 border-line pl-3">
          <p className="text-ink text-justify">{item.text}</p>
          {renderMeta && <p className="text-xs text-ink-faint mt-0.5">{renderMeta(item)}</p>}
        </div>
      ))}
      {items.length > 5 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="text-sm text-ems-primary hover:underline">
          {expanded ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

const TABLE_COLUMNS = [
  { key: "title", label: "Event", render: (row) => (
      <Link to={`/events/${row.event_id}`} className="text-ems-primary hover:underline font-medium">{row.title}</Link>
    ), csvValue: (row) => row.title },
  { key: "event_type", label: "Type", render: (row) => formatEventType(row), csvValue: (row) => formatEventType(row) },
  { key: "date", label: "Date", sortValue: (row) => row.start_date, render: (row) => formatDateRange(row.start_date, row.end_date), csvValue: (row) => formatDateRange(row.start_date, row.end_date) },
  { key: "region", label: "Region", render: (row) => row.region },
  { key: "category", label: "Program", render: (row) => row.category },
  { key: "status", label: "Status", sortValue: (row) => row.status, render: (row) => <StatusBadge label={row.status} />, csvValue: (row) => row.status },
  { key: "participant_count", label: "Participants", align: "right", render: (row) => row.participant_count ?? "-", csvValue: (row) => row.participant_count ?? "" },
];

export default function AnnualEventReport({ initialFilters, onFiltersConsumed }) {
  const { showToast } = useToast();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [year, setYear] = usePersistentState("reports.annual.year", initialFilters?.year || new Date().getFullYear(), {
    skipRestore: !!initialFilters?.year,
  });

  useEffect(() => {
    if (initialFilters && onFiltersConsumed) onFiltersConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(isRefresh) {
    if (isRefresh) setRefreshing(true);
    setError(false);
    try {
      const { data } = await reportsApi.getAnnualEventReport({ year });
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
  }, [year]);

  async function handleExportFile(format) {
    try {
      await reportsApi.exportAnnualEventReport({ format, year });
      showToast(`${format.toUpperCase()} exported.`, "success");
    } catch (e) {
      showToast(extractErrorMessage(e), "error");
    }
  }

  const rows = report?.event_rows || [];

  function handleExportCsv() {
    exportRowsToCsv(`Annual_Event_Report_${year}`, TABLE_COLUMNS, rows);
    showToast("CSV exported.", "success");
  }

  const monthTrend = useMemo(
    () =>
      (report?.events_by_month || []).map((m) => ({
        month: new Date(`${m.month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" }),
        value: m.count,
      })),
    [report]
  );
  const statusData = report?.events_by_status || [];
  // Unlike category/status, the backend's event_activity rows keep
  // event_type as its raw fixed-enum code (see organizational_report.
  // build_event_activity's docstring), the same reason EventActivityReport.jsx
  // maps it through EVENT_TYPE_LABELS for its own table, done here too so
  // this chart doesn't show raw codes like "workshop_series" as labels.
  const eventTypeData = useMemo(
    () => (report?.events_by_event_type || []).map((d) => ({ ...d, label: EVENT_TYPE_LABELS[d.label] || d.label })),
    [report]
  );

  const noData = report && report.summary.total_events === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Annual Event Report</h1>
          <p className="text-sm text-ink-muted mt-0.5">A full-year organizational summary.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-sm text-ink-muted" htmlFor="annual-report-year">Reporting Year</label>
          <select
            id="annual-report-year"
            className="form-input h-9 py-0 text-sm w-24"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {currentYearOptions().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <span className="text-xs text-ink-faint hidden sm:inline">
            {lastUpdated ? `Last updated: ${lastUpdated.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : ""}
          </span>
          <button type="button" className="btn-secondary text-sm" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <SaveReportButton reportType="annual" filters={{ year }} />
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
        <EmptyState title="No events in this year" message={`No events matched ${year}. Try a different reporting year.`} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ReportKpiCard label="Total Events" icon={CalendarIcon} tone="blue" value={report.summary.total_events} />
            <ReportKpiCard
              label="Participants" icon={UsersIcon} tone="teal"
              value={report.summary.total_participants}
              sub={`${report.summary.events_with_actual_participants} of ${report.summary.total_events} from submitted reports`}
            />
            <ReportKpiCard label="Partners" icon={UsersIcon} tone="purple" value={report.summary.total_partners} />
            <ReportKpiCard label="Communication Activities" icon={MailIcon} tone="orange" value={report.summary.communication_activities} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Events by Month" empty={monthTrend.length < 2}>
              <ResponsiveContainer>
                <LineChart data={monthTrend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E9F0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={28} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" name="Events" stroke="#2563C4" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Events by Status" empty={statusData.length === 0}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={statusData} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={80} label={(d) => `${d.label} (${d.count})`}>
                    {statusData.map((entry, i) => (
                      <Cell key={entry.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <BreakdownChart title="Events by Program" data={report.events_by_program} />
            <BreakdownChart title="Events by Region" data={report.events_by_region} />
            <BreakdownChart title="Events by Event Type" data={eventTypeData} />
          </div>

          <div className="jm-card">
            <h2 className="text-base font-bold text-ink mb-3">Organizational Summary</h2>
            <div className="space-y-6">
              <div>
                <p className="text-xs font-bold text-ink uppercase tracking-wide mb-2">
                  Major Achievements ({report.key_achievements.items.length})
                </p>
                <TextList
                  items={report.key_achievements.items}
                  emptyMessage="No submitted Event Status Reports match this year."
                  renderMeta={(item) => `${item.event_title} - ${item.type}`}
                />
              </div>
              <div className="pt-6 border-t border-line">
                <p className="text-xs font-bold text-ink uppercase tracking-wide mb-2">
                  Challenges ({report.challenges.recurring.length + report.challenges.event_specific.length})
                </p>
                <TextList
                  items={[
                    ...report.challenges.recurring.map((r) => ({ text: `${r.text} (x${r.frequency})` })),
                    ...report.challenges.event_specific,
                  ]}
                  emptyMessage="No challenges reported this year."
                  renderMeta={(item) => item.event_title}
                />
              </div>
              <div className="pt-6 border-t border-line">
                <p className="text-xs font-bold text-ink uppercase tracking-wide mb-2">Follow-up Activities</p>
                <div className="grid grid-cols-2 gap-2 mb-2 max-w-xs">
                  <ReportKpiCard label="Total Actions" icon={ClockIcon} tone="blue" value={report.follow_up_summary.total_actions} />
                  <ReportKpiCard label="Overdue" icon={AlertTriangleIcon} tone="orange" value={report.follow_up_summary.overdue_actions} />
                </div>
                <p className="text-xs text-ink-faint">{report.follow_up_summary.note}</p>
              </div>
            </div>
          </div>

          <div className="jm-card space-y-3">
            <div>
              <h2 className="text-base font-bold text-ink">{year} Events</h2>
              <p className="text-xs text-ink-muted mt-0.5">{rows.length} event(s) in {year}.</p>
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
