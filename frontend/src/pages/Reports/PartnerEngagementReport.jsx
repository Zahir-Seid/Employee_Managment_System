import { usePersistentState } from "../../utils/persistentFilters.js";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { reportsApi } from "../../api/reports";
import { configApi } from "../../api/configuration";
import { useToast } from "../../context/ToastContext.jsx";
import ReportFilterBar from "../../components/reports/ReportFilterBar.jsx";
import ReportKpiCard from "../../components/reports/ReportKpiCard.jsx";
import { CalendarIcon, CheckCircleIcon, UsersIcon } from "../../components/common/DashboardIcons.jsx";
import ReportDataTable from "../../components/reports/ReportDataTable.jsx";
import SaveReportButton from "../../components/reports/SaveReportButton.jsx";
import { KpiSkeleton, ChartSkeleton, TableSkeleton, ReportEmptyState, ReportErrorState } from "../../components/reports/ReportStates.jsx";
import { exportRowsToCsv } from "../../utils/reportExport";
import { extractErrorMessage } from "../../utils/format";

// Report 4 of the Reports Module spec (§17). Access is Staff-excluded
// (see backend PartnerEngagementReportView), so this page is only ever
// reached from ReportsHub's full-suite tabs, same as the Management
// Report. "Clicking a partner should provide drill-down to related
// events" (§17), implemented as an "organization" filter carried into
// the Event Activity Report, the same carry-over mechanism the
// Management Report already uses for its own drill-down links.
const EMPTY_FILTERS = { period: "", category: "", region: "", organization: "" };

const FILTER_FIELDS = [
  { key: "period", label: "Reporting Period", primary: true },
  { key: "category", label: "Program", primary: true },
  { key: "region", label: "Region", primary: true },
  { key: "organization", label: "Partner", primary: true, type: "text" },
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

const TABLE_COLUMNS = [
  { key: "partner", label: "Partner", render: (row) => row.partner },
  { key: "event_count", label: "Events", align: "right", render: (row) => row.event_count },
  { key: "participation", label: "Participation", align: "right", render: (row) => row.participation },
  { key: "programs", label: "Programs", render: (row) => row.programs.join(", ") || "-", csvValue: (row) => row.programs.join("; ") },
  { key: "locations", label: "Locations", render: (row) => row.locations.join(", ") || "-", csvValue: (row) => row.locations.join("; ") },
];

export default function PartnerEngagementReport({ onOpenEventActivity, initialFilters, onFiltersConsumed }) {
  const { showToast } = useToast();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [configOptions, setConfigOptions] = useState({});
  const [filters, setFilters] = usePersistentState("reports.partner-engagement.filters", { ...EMPTY_FILTERS, ...(initialFilters || {}) }, {
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
      const { data } = await reportsApi.getPartnerEngagementReport(params);
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
        if (f.type === "text" || f.key === "period") return f;
        if (f.key === "category") return { ...f, options: configOptions.category || [] };
        if (f.key === "region") return { ...f, options: configOptions.region || [] };
        return f;
      }),
    [configOptions]
  );

  const rows = report?.rows || [];
  const trendData = useMemo(
    () =>
      (report?.monthly_trend || []).map((m) => ({
        month: new Date(`${m.month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        value: m.partner_count,
      })),
    [report]
  );
  const topPartnersData = useMemo(() => rows.slice(0, 8).map((r) => ({ name: r.partner, value: r.event_count })), [rows]);

  function handleExportCsv() {
    exportRowsToCsv(`Partner_Engagement_Report_${new Date().toISOString().slice(0, 10)}`, TABLE_COLUMNS, rows);
    showToast("CSV exported.", "success");
  }

  async function handleExportFile(format) {
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      await reportsApi.exportPartnerEngagementReport({ format, ...params });
      showToast(`${format.toUpperCase()} exported.`, "success");
    } catch (e) {
      showToast(extractErrorMessage(e), "error");
    }
  }

  const noData = report && report.summary.total_partners === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Partner Engagement Report</h1>
          <p className="text-sm text-ink-muted mt-0.5">Which organizations and partners are engaged, and how often.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-ink-faint hidden sm:inline">
            {lastUpdated ? `Last updated: ${lastUpdated.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : ""}
          </span>
          <button type="button" className="btn-secondary text-sm" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <SaveReportButton reportType="partner_engagement" filters={filters} />
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ReportKpiCard label="Total Partners" icon={UsersIcon} tone="blue" value={report.summary.total_partners} />
            <ReportKpiCard label="Active Partners" icon={CheckCircleIcon} tone="green" value={report.summary.active_partners} />
            <ReportKpiCard label="Events w/ Partner Participation" icon={CalendarIcon} tone="purple" value={report.summary.events_with_partner_participation} />
            <ReportKpiCard label="Participation Count" icon={UsersIcon} tone="teal" value={report.summary.participation_count} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Partner Engagement by Period" empty={trendData.length < 2}>
              <ResponsiveContainer>
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E9F0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={28} />
                  <Tooltip />
                  <Bar dataKey="value" name="Distinct Partners" fill="#2563C4" radius={[4, 4, 0, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top Partners by Events" empty={topPartnersData.length === 0}>
              <ResponsiveContainer>
                <BarChart data={topPartnersData} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E9F0" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#1D9E75" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="jm-card space-y-3">
            <div>
              <h2 className="text-base font-bold text-ink">Partners</h2>
              <p className="text-xs text-ink-muted mt-0.5">{rows.length} partner(s) match the current filters.</p>
            </div>
            <ReportDataTable
              columns={TABLE_COLUMNS}
              rows={rows}
              getRowKey={(row) => row.partner}
              onRowClick={
                onOpenEventActivity ? (row) => onOpenEventActivity({ organization: row.partner }) : undefined
              }
              searchPlaceholder="Search partners..."
            />
          </div>
        </>
      )}
    </div>
  );
}
