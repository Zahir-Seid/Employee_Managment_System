import { usePersistentState, readPersistedFilter, hasPersistedFilter } from "../../utils/persistentFilters.js";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { auditApi } from "../../api/audit";
import { dashboardApi } from "../../api/dashboard";
import UpcomingEventsCard from "./UpcomingEventsCard.jsx";
import BigEventsSection from "./BigEventsSection.jsx";
import {
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  MailIcon,
  PercentIcon,
  UsersIcon,
} from "../../components/common/DashboardIcons.jsx";
import { KPI_TONES, kpiWash } from "../../components/common/kpiTones.js";
import EmptyState from "../../components/common/EmptyState.jsx";
import SectionHeader from "../../components/common/SectionHeader.jsx";
import { FilterSelect } from "../../components/common/ListControls.jsx";
import LoadError from "../../components/common/LoadError.jsx";
import Spinner, { PageLoader } from "../../components/common/Spinner.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage, formatDate, formatDateTime } from "../../utils/format";
import { configApi } from "../../api/configuration";
import { CaretUpIcon, CaretDownIcon } from "../../components/common/UiGlyphs.jsx";
import SortableTh from "../../components/common/SortableTh.jsx";
import { useSort } from "../../utils/useSort.js";

// Chart palette + the Event Analytics charts themselves live in ONE shared
// module that the TV Display also renders, so the two can never drift apart.
import {
  CHART_FILL,
  DonutCategoryChart,
  EventTrendAreaChart,
  RankedBarChart,
  niceAxisTicks,
} from "../../components/charts/AnalyticsCharts.jsx";
// Mirrors the backend's resolve_period_range (apps/reports/services/report_data.py)
// so the Dashboard's Weekly/Monthly/Quarterly/Yearly toggle produces the same
// date ranges Reports uses, computed client-side since the Dashboard endpoint
// filters by explicit date_from/date_to rather than a period keyword.
//
// Item (specific week/month selection): Weekly and Monthly now default to
// "this week"/"this month" exactly as before (no picker interaction
// required), but periodSelection also lets the user pick a specific
// week-of-month or month/year, same pattern Quarterly/Yearly already use.
// "Week" is defined as a Week-N-of-month block (days 1-7, 8-14, 15-21,
// 22-end) rather than a Mon-Sun calendar week, so the default view and an
// explicitly-picked week use the same definition instead of two different
// ones that could disagree about what "this week" means.
function computePeriodRange(period, periodSelection) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);

  if (period === "all") {
    // No date restriction, backend already skips any filter key whose
    // value is falsy (see the params-building loop below), so an empty
    // string here means "don't filter by date at all."
    return { date_from: "", date_to: "" };
  }
  if (period === "weekly") {
    const year = periodSelection?.year ?? today.getFullYear();
    const month = periodSelection?.month ?? today.getMonth() + 1;
    const week = periodSelection?.week ?? Math.min(4, Math.ceil(today.getDate() / 7));
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDay = (week - 1) * 7 + 1;
    const endDay = week === 4 ? daysInMonth : Math.min(week * 7, daysInMonth);
    const start = new Date(year, month - 1, startDay);
    const end = new Date(year, month - 1, endDay);
    return { date_from: iso(start), date_to: iso(end) };
  }
  if (period === "quarterly") {
    // Item (4 quarters + yearly): quarter/year are now user-selectable
    // (defaulting to the current quarter) instead of always locking to
    // whatever quarter "today" falls in.
    // Item 12: fiscal quarters start in July (Q1 Jul-Sep ... Q4 Apr-Jun).
    const year = periodSelection?.year ?? today.getFullYear();
    const quarter = periodSelection?.quarter ?? (((today.getMonth() - 6 + 12) % 12) / 3 | 0) + 1;
    const startMonth = FISCAL_QUARTER_START_MONTH[quarter];
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 0);
    return { date_from: iso(start), date_to: iso(end) };
  }
  if (period === "yearly") {
    const year = periodSelection?.year ?? today.getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    return { date_from: iso(start), date_to: iso(end) };
  }
  // monthly (default), also user-selectable now (specific month/year),
  // defaulting to the current month.
  const year = periodSelection?.year ?? today.getFullYear();
  const month = periodSelection?.month ?? today.getMonth() + 1;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { date_from: iso(start), date_to: iso(end) };
}

const QUARTERS = [
  { value: 1, label: "Q1 (Jul-Sep)" },
  { value: 2, label: "Q2 (Oct-Dec)" },
  { value: 3, label: "Q3 (Jan-Mar)" },
  { value: 4, label: "Q4 (Apr-Jun)" },
];

// Item 12: fiscal quarters start in July, maps quarter number to the
// 0-indexed calendar month it starts in (Q3/Q4 fall in Jan-Jun of the
// selected year, not the following year, no separate "fiscal year"
// concept, just which calendar year's Jan-Jun/Jul-Dec the quarter is in).
const FISCAL_QUARTER_START_MONTH = { 1: 6, 2: 9, 3: 0, 4: 3 };

const WEEKS_OF_MONTH = [
  { value: 1, label: "Week 1 (1-7)" },
  { value: 2, label: "Week 2 (8-14)" },
  { value: 3, label: "Week 3 (15-21)" },
  { value: 4, label: "Week 4 (22-end)" },
];

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

const EMPTY_FILTERS = { category: "", region: "", thematic_area: "", status: "" };

// Design spec §1/§5: stat card label = uppercase eyebrow, value = 32-40px
// extra-bold, icon in a tinted rounded-square chip top-right with a soft
// color wash across the whole card (RPDMS-style), both matching the card's
// tone. `caption` covers spec's "vs last quarter" / "5 overdue" sub-line;
// `trend` is an optional "+12%"/"-4%" string, shown as a green ↑ or red ↓
// with "since last period", only passed where the app has real
// period-over-period data to back it (see `thisMonthTrend` below).
function KpiCard({ label, value, accent, to, caption, trend, icon: Icon, tone = "blue" }) {
  const trendUp = typeof trend === "string" && trend.trim().startsWith("+");
  const toneStyle = KPI_TONES[tone] || KPI_TONES.blue;
  const content = (
    <div className="jm-card h-full min-h-[150px] p-5 relative overflow-hidden group transition-shadow duration-200 ease-out hover:shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: kpiWash(toneStyle.hex) }}
      />
      <div className="relative flex h-full min-h-[110px] flex-col justify-between">
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-[12px] font-bold uppercase tracking-[0.08em] leading-snug text-ink pt-1">{label}</p>
          {Icon && (
            <span
              className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${toneStyle.chip} ${toneStyle.icon}`}
            >
              <Icon width={20} height={20} />
            </span>
          )}
        </div>
        <div>
          <p className={`text-[32px] leading-none font-black tracking-tight ${accent || "text-ink"}`}>{value}</p>
        {trend ? (
          <p
            className={
              "mt-1.5 text-xs font-medium flex items-center gap-1 " + (trendUp ? "text-pill-success" : "text-red-600")
            }
          >
            <span aria-hidden="true">{trendUp ? <CaretUpIcon width={10} height={10} /> : <CaretDownIcon width={10} height={10} />}</span>
            <span>{trend}</span>
            <span className="text-ink-faint font-normal">since last period</span>
          </p>
        ) : (
          caption && <p className="text-sm text-ink-muted mt-2">{caption}</p>
        )}
        </div>
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block hover:ring-2 hover:ring-ems-primary/20 rounded-card transition-shadow">
      {content}
    </Link>
  ) : (
    content
  );
}

function ChartCard({ title, children, subtitle, action, bare = false }) {
  return (
    <div className="jm-card">
      <div className="flex items-start justify-between mb-4">
        <div className={"flex-1 " + (action ? "" : "text-center")}>
          <h3 className="text-base font-bold text-ink">{title}</h3>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="h-64">
        {bare ? (
          children
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    Completed: "jm-pill-completed",
    Pending: "jm-pill-planned",
    Overdue: "jm-pill-overdue",
  };
  return <span className={`jm-pill ${map[status] || "jm-pill-neutral"}`}>{status}</span>;
}

// Fixed categorical palette (staff spec: "blue, green, amber, purple,
// teal"), same array index used for both the donut segment and its
// legend entry, so color-to-category mapping never drifts between them.

/**
 * Donut chart (staff spec): title centered on top, donut on the left,
 * legend stacked vertically to the right. No card chrome, sits directly
 * on the dashboard background. Accepts `data` as `{ category, percentage }`
 * exactly as given (not re-sorted, spec allows either sort-by-size or
 * the data's own order, so the given order is preserved rather than
 * silently reordering categories the caller may have deliberately ordered).
 */
function DonutCategoryCard({ title, data }) {
  return (
    <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5">
      <h3 className="text-center text-base font-bold" style={{ color: "#0F1F3D" }}>
        {title}
      </h3>
      <DonutCategoryChart data={data} scale="dashboard" />
      {data.length === 0 && <p className="text-sm text-ink-faint text-center mt-2">No data for this period.</p>}
    </div>
  );
}

// --- Ranked horizontal/vertical bar charts (Thematic Area, Engagement) ---
// The chart itself is the shared RankedBarChart (components/charts), which
// the TV Display renders too.

/**
 * Horizontal ranked bar chart card (e.g. "Events by Thematic Area").
 * Accepts `data` as a plain, unsorted list, sorting descending by
 * `countKey` and rank-coloring both happen here, so callers never
 * pre-sort or pre-color their data themselves.
 */
function RankedBarChartCard({
  title,
  data,
  labelKey = "area",
  countKey = "eventCount",
  countSuffix = "events",
  className = "",
  // "vertical" bars (rising up the Y-axis, categories along the X-axis)
  // for Engagement by Level, vs. the horizontal bars (the default, and
  // what Events by Thematic Area still uses) everywhere else on this
  // component.
  orientation = "horizontal",
}) {
  // Sorted here only to size the card; the shared chart sorts/colors itself.
  const rowCount = data.length;
  const isVertical = orientation === "vertical";

  return (
    <div className={"bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5 " + className}>
      <h3 className="text-center text-base font-bold" style={{ color: "#0F1F3D" }}>
        {title}
      </h3>
      <div className="mt-5" style={{ height: isVertical ? 280 : Math.max(200, rowCount * 44 + 40) }}>
        <RankedBarChart
          data={data}
          labelKey={labelKey}
          countKey={countKey}
          countSuffix={countSuffix}
          orientation={orientation}
          scale="dashboard"
        />
      </div>
      {rowCount === 0 && <p className="text-sm text-ink-faint">No data for this period.</p>}
    </div>
  );
}

const REPORT_STATUS_COLORS = { submitted: "#1D3E7A", pending: "#8FB3E8", overdue: "#F0A79A" };
const REPORT_STATUS_LABELS = { submitted: "Submitted", pending: "Pending", overdue: "Overdue" };

function ReportStatusTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.15)] px-3.5 py-3 border border-line/60">
      <p className="text-sm font-bold text-ink mb-1.5">{label}</p>
      {["submitted", "pending", "overdue"].map((key) => (
        <p key={key} className="text-xs text-ink flex items-center gap-1.5 leading-relaxed">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: REPORT_STATUS_COLORS[key] }}
          />
          {REPORT_STATUS_LABELS[key]}: <span className="font-semibold">{payload[0]?.payload?.[key] ?? 0}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * "Post-Event Report Status" grouped horizontal bar chart (staff spec):
 * Submitted/Pending/Overdue counts per thematic area, three thin parallel
 * bars per row (grouped, not stacked). No card chrome, sits directly on
 * the dashboard background per spec. Accepts a plain `data` list shaped
 * `{ area, submitted, pending, overdue }` and renders it as-is (already
 * sorted server-side by total volume, see get_report_status_by_thematic_area).
 */
function PostEventReportStatusChart({ data }) {
  const maxValue = Math.max(1, ...data.map((row) => row.submitted + row.pending + row.overdue));
  const ticks = niceAxisTicks(maxValue);
  const axisMax = ticks[ticks.length - 1];

  return (
    <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5">
      <h3 className="text-center text-base font-bold text-ink">Post-Event Report Status</h3>
      <p className="text-center text-[13px] text-ink-faint mt-0.5">Submitted, Pending, Overdue by thematic area.</p>

      {/* One stacked bar per area (Submitted/Pending/Overdue as colored
          segments end-to-end in a single bar), not three separate parallel
          bars, needs far less vertical room per row than before, which is
          also what was pushing the chart's height past its allotted space
          on the dashboard. */}
      <div className="mt-4" style={{ height: Math.max(180, data.length * 44 + 60) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid horizontal={false} stroke="#E5E9F0" />
            <XAxis
              type="number"
              domain={[0, axisMax]}
              ticks={ticks}
              tick={{ fontSize: 12, fill: "#8A93A6" }}
              axisLine={{ stroke: "#E5E9F0" }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="area"
              width={140}
              tick={{ fontSize: 13, fill: "#8A93A6" }}
              axisLine={{ stroke: "#E5E9F0" }}
              tickLine={false}
            />
            <Tooltip content={<ReportStatusTooltip />} cursor={{ fill: "#F1F4F9" }} />
            <Legend
              verticalAlign="bottom"
              align="center"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 13, color: "#3A3A3A", paddingTop: 12 }}
              formatter={(value) => REPORT_STATUS_LABELS[value] || value}
            />
            <Bar dataKey="submitted" stackId="status" fill={REPORT_STATUS_COLORS.submitted} barSize={26} />
            <Bar dataKey="pending" stackId="status" fill={REPORT_STATUS_COLORS.pending} barSize={26} />
            <Bar dataKey="overdue" stackId="status" fill={REPORT_STATUS_COLORS.overdue} barSize={26} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {data.length === 0 && <p className="text-sm text-ink-faint">No data for this period.</p>}
    </div>
  );
}

// Item 7: Engagement Level as a vertical bar chart (bars rise on the
// Y-axis, categories along the X-axis) rather than the horizontal
// orientation used elsewhere on this page.
/**
 * Vertical bar chart (staff spec): title centered on top, no card chrome.
 * Rank-based navy shading (reuses rankedBarColor, same ramp/logic as
 * RankedBarChartCard's horizontal bars, just applied to vertical bars
 * here). Sorted descending by count, unlike DonutCategoryCard, the spec
 * here is explicit about left-to-right highest-to-lowest ordering, not
 * "or the data's own order".
 */
// Recent Activity redesign (visual only, the underlying text is untouched):
// every description this feeds on (see apps/dashboard/services.py
// get_recent_activity, and the log_action() calls in events/communications/
// reports views.py) wraps the event/report/request title in single quotes,
// e.g. "Event Status Report submitted for 'Digital Skills Bootcamp'." This
// splits on that quoted span to color just the title portion, without
// rephrasing or dropping a single word of the original sentence.
function ActivityDescription({ description }) {
  const match = description.match(/^(.*?)['‘]([^'’]+)['’](.*)$/);
  if (!match) return <span className="font-semibold text-ink">{description}</span>;
  const [, before, quoted, after] = match;
  return (
    <>
      <span className="font-semibold text-ink">{before}</span>
      <span className="font-semibold" style={{ color: CHART_FILL }}>
        {quoted}
      </span>
      <span className="font-semibold text-ink">{after}</span>
    </>
  );
}

// Activity Stream (Communications + Admin dashboards): a scrollable
// timeline of the latest Audit Trail entries. Uses the same /audit-logs/
// endpoint as the Audit Trail page, which Communications, Comms Lead and
// Admin can already access. Login rows read "Name Login"; every other
// row reads "Name <Action> <Record Type>", e.g. "Helina Created Event".
function timeAgo(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function ActivityStreamCard({ refreshKey = 0 }) {
  const [logs, setLogs] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    auditApi
      .list({ page: 1 })
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data.results || data)
          .slice()
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 20);
        setLogs(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 bg-surface-muted border-b border-line">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-navy-700"
          aria-hidden="true"
        >
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        <h3 className="text-base font-bold uppercase tracking-wide text-ink">Activity Stream</h3>
      </div>
      <div className="p-6">
        {failed ? (
          <EmptyState title="Couldn't load activity" />
        ) : logs === null ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : logs.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ul className="relative max-h-[420px] overflow-y-auto pr-2">
            <span className="absolute left-[5px] top-2 bottom-2 w-px bg-[#DCE8F8]" aria-hidden="true" />
            {logs.map((log) => (
              <li key={log.id} className="relative pl-8 pb-5 last:pb-0">
                <span className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full bg-[#3B82F6]" />
                <p className="text-[15px] leading-snug">
                  <span className="font-bold text-ink">{log.user_name}</span>{" "}
                  <span className="text-ink-muted">
                    {log.action_type === "login"
                      ? log.action_type_display
                      : `${log.action_type_display} ${log.object_type_display}`}
                  </span>
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-faint">
                  <ClockIcon width={13} height={13} />
                  {timeAgo(log.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Event Status Report table (Dashboard). Its own component so the
// sortable Status heading can hold state without touching the Dashboard's
// early-return hook order.
function PostEventReportStatusTable({ rows }) {
  const sort = useSort(rows, { status: (r) => r.status });
  return (
    <div className="overflow-x-auto -mx-4">
      <table className="w-full text-sm">
        <thead className="text-ink-faint text-xs uppercase">
          <tr>
            <th className="text-left px-4 py-1.5">Event</th>
            <th className="text-left px-4 py-1.5">Owner</th>
            <th className="text-left px-4 py-1.5">Date</th>
            <SortableTh label="Status" sortKey="status" sort={sort} className="text-left px-4 py-1.5" />
            <th className="text-left px-4 py-1.5">Overdue</th>
            <th className="text-right px-4 py-1.5">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sort.rows.map((row) => (
            <tr key={row.event_id}>
              <td className="px-4 py-2 font-medium text-ink whitespace-nowrap">{row.title}</td>
              <td className="px-4 py-2 text-ink-muted whitespace-nowrap">{row.owner_name}</td>
              <td className="px-4 py-2 text-ink-muted whitespace-nowrap">{formatDate(row.end_date)}</td>
              <td className="px-4 py-2"><StatusPill status={row.status} /></td>
              <td className="px-4 py-2 text-ink-muted">{row.days_overdue > 0 ? `${row.days_overdue}d` : "N/A"}</td>
              <td className="px-4 py-2 text-right">
                <Link to={`/events/${row.event_id}`} className="text-navy-600 hover:underline text-xs">
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


export default function Dashboard() {
  const { user, isCommunications, isLeadership, isAdminRole, isStaffOnly } = useAuth();
  // Activity Stream shows for Communications (replacing the old To-Do
  // widget) and Admin, next to Recent Activity.
  const showActivityStream = isCommunications || isAdminRole;
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  // Item #7: Region is free-text on the Event model (not a fixed enum) and
  // events span multiple countries per the reference screenshots (Nairobi,
  // Kampala, Kigali alongside Addis Ababa), a hardcoded "Ethiopia regions"
  // list would misrepresent real data. Pulled dynamically from real event
  // data instead (see the dedicated one-time fetch below).
  const [regionOptions, setRegionOptions] = useState([]);
  const [thematicAreaOptions, setThematicAreaOptions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // Bumped by the Refresh button (and the error screen's Retry). Every
  // self-loading block on this page (main numbers/charts, Big Events,
  // Upcoming Events, Activity Stream) re-fetches when it changes - before,
  // Refresh only re-ran the main summary request, so the other blocks never
  // updated, and nothing on screen showed that anything had happened.
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  // Toggle removed per request, Dashboard now always shows the Generic
  // scope. Kept as a named constant (not state) so the fetch effect/params
  // below didn't need touching, and the Thematic Area code path stays
  // intact rather than deleted, in case it's ever wanted back.
  const scope = "generic";
  // Period + filters are remembered (per page) until logout, instead of
  // resetting to "this month" every time the Dashboard is reopened.
  const [period, setPeriod, setPeriodDefault] = usePersistentState("dashboard.period", "monthly");
  const [filters, setFilters, setFiltersDefault] = usePersistentState(
    "dashboard.filters",
    { ...computePeriodRange("monthly"), ...EMPTY_FILTERS },
    {
      // Rolling periods ("this month" etc.) are recomputed on restore so a
      // remembered selection never shows last visit's stale date range.
      restore: (stored) => {
        const p = readPersistedFilter("dashboard.period");
        if (["weekly", "monthly", "quarterly", "yearly"].includes(p)) {
          return { ...stored, ...computePeriodRange(p, readPersistedFilter("dashboard.periodSelection") || undefined) };
        }
        return stored;
      },
    }
  );
  // Admin-configured default (Configuration > System Settings). Runs once
  // on mount, before the user has touched the period selector, "monthly"
  // above stays the fallback while this is in flight (or if it fails), so
  // there's never a broken/blank state waiting on this request.
  useEffect(() => {
    let cancelled = false;
    configApi
      .getSystemSettings()
      .then(({ data }) => {
        const defaultPeriod = data?.default_dashboard_period;
        // A period the user already chose (remembered) wins over the admin default.
        if (!cancelled && defaultPeriod && defaultPeriod !== "monthly" && !hasPersistedFilter("dashboard.period")) {
          setPeriodDefault(defaultPeriod);
          setFiltersDefault((f) => ({ ...f, ...computePeriodRange(defaultPeriod) }));
        }
      })
      .catch(() => {
        // Silent: this is a nice-to-have default, not a hard requirement ,
        // "monthly" (already set above) is a perfectly good fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Item #5: count only the discretionary filters (Category/Region/
  // Thematic Area/Status), date_from/date_to always have a value because
  // they're driven by the Weekly/Monthly/Quarterly period selector, not a
  // deliberate "filter" choice, so including them would make the count
  // never show "No filters applied" even when nothing meaningful was set.
  const activeFilterCount = ["category", "region", "thematic_area", "status"].filter((k) => filters[k]).length;

  // Item #14 fix: this used to be derived from charts.by_region on every
  // filtered fetch, but that breakdown reflects the CURRENTLY APPLIED
  // filters, region included. Picking a region filtered the chart data
  // down to just that one region, which then overwrote this dropdown's
  // own option list down to a single entry, permanently, since every
  // subsequent fetch kept re-deriving from an already-narrowed result.
  // Fetching the full list once, unfiltered, on mount avoids that
  // self-collapsing loop entirely.
  useEffect(() => {
    let cancelled = false;
    dashboardApi
      .get({ scope: "generic" })
      .then(({ data: payload }) => {
        if (cancelled || !payload.charts?.by_region) return;
        const regions = [...new Set(payload.charts.by_region.map((r) => r.region).filter(Boolean))].sort();
        setRegionOptions(regions);
      })
      .catch(() => {
        /* Non-critical, the filter just won't have options if this fails. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Thematic Area is now admin-managed (Configuration page) instead of a
  // hardcoded array, fetched once here, same as everywhere else it's used.
  useEffect(() => {
    configApi
      .active()
      .then(({ data }) => setThematicAreaOptions(data.thematic_area || []))
      .catch(() => {});
  }, []);

  // Item (specific week/month/quarter/year selection): which sub-period
  // Weekly/Monthly/Quarterly/Yearly resolve to, defaults to the current
  // one so the auto "this week"/"this month" behavior is unchanged, but
  // user-adjustable via the pickers shown for the selected period type.
  const nowForPeriod = new Date();
  const [periodSelection, setPeriodSelection] = usePersistentState("dashboard.periodSelection", {
    week: Math.min(4, Math.ceil(nowForPeriod.getDate() / 7)),
    month: nowForPeriod.getMonth() + 1,
    quarter: (((nowForPeriod.getMonth() - 6 + 12) % 12) / 3 | 0) + 1,
    year: nowForPeriod.getFullYear(),
  });

  // Selecting Weekly/Monthly/Quarterly/Yearly computes and locks the date
  // range; "Custom" hands date_from/date_to back to the manual inputs below.
  function selectPeriod(p) {
    setPeriod(p);
    if (p === "custom") return;
    setFilters((f) => ({ ...f, ...computePeriodRange(p, periodSelection) }));
  }

  function updatePeriodSelection(next) {
    const merged = { ...periodSelection, ...next };
    setPeriodSelection(merged);
    if (period !== "custom" && period !== "all") {
      setFilters((f) => ({ ...f, ...computePeriodRange(period, merged) }));
    }
  }

  // Clearing filters (manually via "Clear Filters", or automatically, e.g.
  // after a scope/page reset) always lands back on "monthly", matching the
  // app-wide default, rather than "all", so the user isn't dropped into an
  // unfiltered, unbounded view.
  function clearFilters() {
    setPeriod("monthly");
    setFilters({ ...computePeriodRange("monthly"), ...EMPTY_FILTERS });
  }

  // Item (empty-state fix): the zero-events empty state's action button
  // needs to actually broaden the view, switching to "All" (no date
  // restriction) rather than re-applying the same "monthly" default that
  // produced zero results in the first place.
  function showAllEvents() {
    setPeriod("all");
    setFilters({ ...computePeriodRange("all"), ...EMPTY_FILTERS });
  }

  // Item #13 fix: the previous approach called setData(null) on every
  // scope change to avoid rendering mismatched data/scope shapes (see the
  // crash this was originally guarding against). That worked, but it also
  // meant every Generic <-> Thematic switch blanked the whole page to
  // <PageLoader /> and reloaded from scratch, visible flicker/disappear/
  // reload. displayScope decouples "which scope's UI is currently shown"
  // from "which scope the user just clicked": the old view (old data)
  // keeps rendering, with a small inline indicator, until the new scope's
  // data actually arrives, then both swap together in one atomic update,
  // so there's never a frame with mismatched data+shape and never a blank
  // frame either.
  const [displayScope, setDisplayScope] = useState(scope);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    async function load() {
      setIsLoading(true);
      try {
        const params = { scope };
        Object.entries(filters).forEach(([k, v]) => {
          if (v) params[k] = v;
        });
        // Item (trend graph drill-down): the backend buckets one level
        // below whichever period this is, Weekly -> daily, Monthly ->
        // week-of-month, Quarterly/Yearly -> monthly.
        params.period = period;
        const { data: payload } = await dashboardApi.get(params);
        if (!cancelled) {
          setData(payload);
          setDisplayScope(payload.scope);
          setLastRefreshed(new Date());
        }
      } catch (error) {
        // Previously this only showed a toast (which auto-dismisses after a
        // few seconds) and left `data` as null forever, meaning a failed
        // request left the page stuck on an infinite loading spinner with
        // no way to tell what happened or retry. Now the failure is shown
        // permanently on the page itself, with a Retry button.
        if (!cancelled) {
          const message = extractErrorMessage(error);
          setLoadError(message);
          showToast(message, "error");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, filters, refreshTick]);

  if (loadError) {
    return <LoadError message={loadError} onRetry={() => setRefreshTick((t) => t + 1)} />;
  }

  // Bug fix (#8): switching scope re-renders this component immediately with
  // the NEW `scope` but the OLD `data` (the fetch that updates `data` only
  // resolves after this render, in the effect below). On that one render,
  // `data` was truthy but shaped for the wrong scope (e.g. thematic_area's
  // payload has no top-level `charts` key), so `charts.by_category` etc.
  // below threw an uncaught exception. With no ErrorBoundary in the app,
  // that crash unmounted the whole React tree, a blank screen that looked
  // exactly like being logged out, even though the session/token was never
  // touched. Checking the payload's own `scope` field (not just truthiness)
  // closes that gap.
  if (!data) return <PageLoader />;

  const {
    summary,
    charts,
    thematic_areas,
    upcoming_count_30d,
    recent_activity,
    comms_support_overview,
    post_event_report_status,
  } = data;

  // DonutCategoryCard's spec'd data shape is { category, percentage } ,
  // charts.by_category (like every other chart here) is raw counts, so
  // this is the one conversion point rather than inlining the total/round
  // math at the JSX call site below. Guarded with `charts?.`, same as
  // the bug-fix note above, `charts` is undefined on a thematic_area
  // payload, and this now runs unconditionally (not lazily inside the
  // "generic"-only JSX branch like the rest of charts.* access does).
  const categoryTotal = (charts?.by_category || []).reduce((sum, d) => sum + (d.count || 0), 0);
  const categoryPercentageData = (charts?.by_category || []).map((d) => ({
    category: d.category,
    percentage: categoryTotal ? Math.round((d.count / categoryTotal) * 100) : 0,
  }));

  // Design spec §4 Row 1 card 2, "This Month": derived from the same
  // monthly_trend series already fetched for the hero chart (real backend
  // data, grouped by TruncMonth) rather than a dedicated endpoint, which
  // doesn't exist yet.
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const thisMonthCount = charts?.monthly_trend?.find((m) => m.month === currentMonthKey)?.count ?? 0;

  // Real period-over-period comparison, derived from the same monthly_trend
  // series (not fabricated), the month immediately before the current one
  // in that array. Only rendered as a trend badge when both months are
  // actually present in the series.
  const monthlyTrendSeries = charts?.monthly_trend || [];
  const currentMonthIdx = monthlyTrendSeries.findIndex((m) => m.month === currentMonthKey);
  const prevMonthEntry = currentMonthIdx > 0 ? monthlyTrendSeries[currentMonthIdx - 1] : null;
  const thisMonthTrend =
    prevMonthEntry && prevMonthEntry.count > 0
      ? `${thisMonthCount >= prevMonthEntry.count ? "+" : ""}${Math.round(
          ((thisMonthCount - prevMonthEntry.count) / prevMonthEntry.count) * 100
        )}%`
      : null;

  // Design spec §4 Row 1 card 7, "Reports Completed %": submitted ÷ due,
  // computed from the same post_event_report_status table rendered lower on
  // this page. NOTE: that table is capped at 15 rows server-side (soonest/
  // most-overdue first), so on a workspace with more than ~15 events past
  // their end date this percentage is computed from that sample, not the
  // full population, flagging rather than presenting false precision.
  const reportsDueCount = post_event_report_status?.length || 0;
  const reportsCompletedCount = post_event_report_status?.filter((r) => r.status === "Completed").length || 0;
  const reportsCompletedPct = reportsDueCount ? Math.round((reportsCompletedCount / reportsDueCount) * 100) : 0;

  // Item (empty-state consistency): the period toggle AND the full filter
  // panel (Category / Region / Thematic Area / Event Status) must stay
  // visible and interactive no matter what the current result set is ,
  // including the zero-results case below. Hoisting this block out of the
  // "has data" branch means both branches render the exact same filter UI
  // instead of two independently-maintained copies (one of which used to
  // only show the period toggle and drop the rest of the panel entirely
  // whenever there were zero matching events). The empty-state message
  // itself is only ever shown in the results area beneath this panel, never
  // in place of it.
  const filterBar = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-muted">Period:</span>
        <div className="inline-flex rounded-lg border border-[#E5E9F0] overflow-hidden">
          {["all", "weekly", "monthly", "quarterly", "yearly", "custom"].map((p) => (
            <button
              key={p}
              onClick={() => selectPeriod(p)}
              className={
                "px-3 py-1.5 text-sm capitalize " +
                (period === p ? "bg-ems-primary text-white" : "bg-white text-ink-muted hover:bg-[#F1F4F9]")
              }
            >
              {p}
            </button>
          ))}
        </div>

        {/* Sub-controls for the selected period type, only the controls
            that actually apply are mounted (no more always-rendered-but-
            `invisible` siblings), and they sit together in their own tight
            group so Weekly/Monthly/Quarterly/Yearly read as one grouped
            "Period + its qualifier" section instead of controls scattered
            across large empty gaps. */}
        {(period === "weekly" || period === "monthly" || period === "quarterly" || period === "yearly") && (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E9F0] bg-white px-2 py-1">
            {period === "weekly" && (
              <select
                className="form-input max-w-[160px] py-1"
                value={periodSelection.week}
                onChange={(e) => updatePeriodSelection({ week: Number(e.target.value) })}
              >
                {WEEKS_OF_MONTH.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            )}
            {(period === "weekly" || period === "monthly") && (
              <select
                className="form-input max-w-[140px] py-1"
                value={periodSelection.month}
                onChange={(e) => updatePeriodSelection({ month: Number(e.target.value) })}
              >
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            {period === "quarterly" && (
              <select
                className="form-input max-w-[160px] py-1"
                value={periodSelection.quarter}
                onChange={(e) => updatePeriodSelection({ quarter: Number(e.target.value) })}
              >
                {QUARTERS.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            )}
            <input
              type="number"
              className="form-input max-w-[90px] py-1"
              value={periodSelection.year}
              onChange={(e) => updatePeriodSelection({ year: Number(e.target.value) })}
            />
          </div>
        )}

        {period !== "custom" && period !== "all" && (
          <span className="text-xs text-ink-faint">
            {filters.date_from} to {filters.date_to}
          </span>
        )}
      </div>

      {/* Global Filters, FR39 */}
      {(activeFilterCount > 0 || isLoading) && (
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink-muted">
          {activeFilterCount > 0 && `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied`}
        </span>
        {/* Item #5 fix: filter changes no longer blank the whole page (see
            the scopeChanged guard above), this small inline indicator is
            the only visible sign of a filtered reload in flight, instead of
            the previous jarring blank-then-reappear. */}
        {isLoading && (
          <span className="flex items-center gap-1.5 text-ems-primary">
            <Spinner size={14} />
            Updating...
          </span>
        )}
      </div>
      )}
      <div className="card p-4 flex flex-wrap lg:flex-nowrap items-center gap-2.5">
        {period === "custom" && (
          <>
            <span className="flex items-center gap-1.5 text-sm text-ink-faint">
              From
              <input
                type="date"
                className="form-input py-1.5"
                value={filters.date_from}
                onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
              />
            </span>
            <span className="flex items-center gap-1.5 text-sm text-ink-faint">
              To
              <input
                type="date"
                className="form-input py-1.5"
                value={filters.date_to}
                onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
              />
            </span>
          </>
        )}
        <FilterSelect
          className="flex-1 max-w-[200px]"
          value={filters.category}
          onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
        >
          <option value="">All Categories</option>
          <option value="international">International</option>
          <option value="national">National</option>
          <option value="sub_regional">Sub-national</option>
          <option value="internal">Internal</option>
        </FilterSelect>
        <FilterSelect
          className="flex-1 max-w-[200px]"
          value={filters.region}
          onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))}
        >
          <option value="">All Regions</option>
          {regionOptions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          className="flex-1 max-w-[220px]"
          value={filters.thematic_area}
          onChange={(e) => setFilters((f) => ({ ...f, thematic_area: e.target.value }))}
        >
          <option value="">All Thematic Areas</option>
          {thematicAreaOptions.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          className="flex-1 max-w-[200px]"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">All Statuses</option>
          <option value="upcoming">Upcoming</option>
          <option value="ongoing">Ongoing</option>
          <option value="held">Held</option>
          <option value="completed">Completed</option>
          <option value="postponed">Postponed</option>
          <option value="cancelled">Cancelled</option>
        </FilterSelect>
        <button className="btn-secondary ml-auto shrink-0 whitespace-nowrap" onClick={clearFilters}>
          Clear Filters
        </button>
      </div>
    </div>
  );

  if (summary.total_events === 0) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink">Dashboard</h1>
          <p className="text-sm text-ink-muted mt-1">A live summary of events, support requests and reports.</p>
        </div>

        {/* Filter panel stays visible and usable here too, never hidden or
            removed just because the current selection returned zero
            events. Only the results area below switches to the empty
            state. */}
        {filterBar}

        <EmptyState
          title="No events to show"
          message={
            activeFilterCount > 0 || period !== "monthly"
              ? "No events match the current period or filters. Try widening the date range or clearing filters."
              : "No events found for this period."
          }
          action={
            <button className="jm-btn-primary text-sm" onClick={showAllEvents}>
              Show All Events
            </button>
          }
        />

        {/* Org-wide cards, so a user with no events of their own still sees
            everyone's Big and Upcoming Events. */}
        <BigEventsSection refreshKey={refreshTick} />
        <UpcomingEventsCard refreshKey={refreshTick} />
      </div>
    );
  }

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? "Good morning" : greetingHour < 17 ? "Good afternoon" : "Good evening";
  const firstName = user?.first_name || user?.full_name || user?.email;

  const isStaffRole = isStaffOnly;
  const renderTrendChart = () => (
    <ChartCard
      bare
      title={
        "Events Logged Over Time" +
        (period === "weekly"
          ? " (by Day)"
          : period === "monthly"
          ? " (by Week)"
          : period === "quarterly" || period === "yearly"
          ? " (by Month)"
          : "")
      }
    >
      <EventTrendAreaChart series={charts.trend} period={period} scale="dashboard" />
    </ChartCard>
  );

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="text-sm text-ink-muted mt-1">A live summary of events, support requests and reports.</p>
        </div>
        {/* Not `disabled` while loading: the app's disabled buttons show the
            red "not allowed" cursor, which read as "Refresh is broken".
            Instead it stays a normal button that shows it's busy (spinning
            icon + "Refreshing...") and ignores extra clicks until done. */}
        <button
          type="button"
          className={"btn-secondary inline-flex shrink-0 items-center gap-2" + (isLoading ? " opacity-70 cursor-wait" : "")}
          aria-busy={isLoading}
          title={lastRefreshed ? `Last updated ${lastRefreshed.toLocaleTimeString()}` : "Reload the dashboard"}
          onClick={() => {
            if (!isLoading) setRefreshTick((t) => t + 1);
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={isLoading ? "animate-spin" : ""}
          >
            <path
              d="M20 11a8 8 0 0 0-14.3-4.5M4 13a8 8 0 0 0 14.3 4.5M5 3v4h4M19 21v-4h-4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Filter bar sits right under the header, at a fixed position, on
          every render. (Item 24: Overdue Alerts used to render here too ,
          it's been removed from the Dashboard entirely; see the "Overdue"
          counters on Sidebar's Admin badge, Admin > TV Display, and Staff's
          own Event Status Reports page instead.) */}
      {filterBar}

      {/* KPI cards, design spec §4 Row 1, exactly as specified: Row A
          (activity/volume) then Row B (compliance/support, Overdue in red
          per FR37). "This Month" and "Reports Completed %" are computed
          client-side from real data already in this payload (see notes
          above) since neither has a dedicated backend field. */}
      <section className="space-y-5">
      <SectionHeader
        title="Event Overview"
        description="An overview of your logged, upcoming, and completed events."
        icon={CalendarIcon}
        tone="blue"
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <KpiCard label="Total Events" value={summary.total_events} icon={CalendarIcon} tone="blue" />
        <KpiCard
          label="This Month"
          value={thisMonthCount}
          caption="Events logged this month"
          trend={thisMonthTrend}
          icon={ClockIcon}
          tone="teal"
        />
        <KpiCard label="Upcoming" value={upcoming_count_30d} caption="Next 30 days" icon={ClockIcon} tone="purple" />
        <KpiCard
          label="Completed Events"
          value={summary.completed_events}
          accent="text-pill-success"
          icon={CheckCircleIcon}
          tone="green"
        />
      </div>
      </section>

      <section className="space-y-5">
      <SectionHeader
        title="Support and Reporting"
        description="Communications support requests and event status report progress."
        icon={MailIcon}
        tone="purple"
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Support Requests card: previously hidden entirely for Leadership
            (`!isLeadership`), which is also what made this row only 2
            cards for them vs. 3 for everyone else, never proportional on
            desktop's 4-col grid either way. Now shown to every role, with
            the label switched for Leadership: they don't work support
            requests day-to-day the way Staff/Communications do, so "Open"
            (an operational to-do framing) becomes "Total" (an org-wide
            volume framing), same underlying count, no new data. */}
        <KpiCard
          label={isLeadership ? "Total Support Requests" : "Open Support Requests"}
          value={summary.communications_requests}
          icon={MailIcon}
          tone="orange"
        />
        {/* Pending Reports, summary.pending_reports was already coming
            back from the API but wasn't shown anywhere on the Dashboard;
            added here (not fabricated) so Row B has 4 cards for every
            role, matching Row A's 4, instead of 3 (or 2 for Leadership). */}
        <KpiCard
          label="Pending Reports"
          value={summary.pending_reports}
          accent="text-warning"
          icon={ClockIcon}
          tone="orange"
        />
        <KpiCard
          label="Reports Completed %"
          value={`${reportsCompletedPct}%`}
          caption={`${reportsCompletedCount} of ${reportsDueCount} submitted`}
          icon={PercentIcon}
          tone="green"
        />
      </div>
      </section>

      {/* Big Events: International/National events (Upcoming/Ongoing
          only), placed prominently right after the KPI rows and before
          the trend graph, a large featured-card section, distinct from
          the smaller Upcoming Events card further down. Renders nothing
          at all when there's nothing to show, so it never leaves a gap. */}
      <BigEventsSection refreshKey={refreshTick} />

      {displayScope === "generic" ? (
        <>
          <SectionHeader
            title="Event Insights"
            description="Trends and breakdowns for the selected period."
            icon={PercentIcon}
            tone="teal"
            className="-mb-3"
          />
          {/* Row 2, Hero chart (design spec §4). Spec calls for two lines:
              red = Events logged (real data, charts.monthly_trend), dark
              navy = Reports submitted. The backend has no equivalent
              monthly "reports submitted" aggregate yet (get_monthly_trend
              only counts Events by start_date), rather than draw a fake
              flat/zero navy line, this ships with the real red line only
              until that backend aggregate exists. */}
          {!isStaffRole && renderTrendChart()}

          {/* Row 3, Supporting charts (design spec §4). Order: Category
              next to Thematic Area, then Engagement Level next to
              Post-Event Report Status underneath, all in matching cards. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Staff layout: Trend left + Thematic Area right on the first
                row, Category left + Engagement Level right underneath. */}
            {isStaffRole && renderTrendChart()}
            {isStaffRole ? (
              <RankedBarChartCard
                title="Events by Thematic Area"
                data={charts.by_thematic_area.map((d) => ({ area: d.thematic_area, eventCount: d.count }))}
              />
            ) : null}
            <DonutCategoryCard title="Events by Category" data={categoryPercentageData} />

            {!isStaffRole && (
              <RankedBarChartCard
                title="Events by Thematic Area"
                data={charts.by_thematic_area.map((d) => ({ area: d.thematic_area, eventCount: d.count }))}
              />
            )}

            {/* Item 19: Event Status Report chart on the left, Engagement by
                Level on the right (was reversed before). Hidden for the
                Staff role specifically, Admin still sees it, since the
                app's isStaff flag bundles Staff+Admin together and isn't
                precise enough here. */}
            {!isStaffOnly && (
              <PostEventReportStatusChart data={charts.report_status_by_thematic_area} />
            )}

            <RankedBarChartCard
              title="Engagement by Level"
              data={charts.by_engagement_level.map((d) => ({ level: d.engagement_level, count: d.count }))}
              labelKey="level"
              countKey="count"
              countSuffix="events"
              orientation="vertical"
            />
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {Object.entries(thematic_areas || {}).map(([area, stats]) => (
            <div key={area} className="card p-5">
              <h3 className="text-base mb-3">{area} <span className="text-ink-faint text-sm font-normal">({stats.summary.total_events} events)</span></h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="Total" value={stats.summary.total_events} icon={CalendarIcon} tone="blue" />
                <KpiCard
                  label="Completed"
                  value={stats.summary.completed_events}
                  accent="text-success"
                  icon={CheckCircleIcon}
                  tone="green"
                />
                <KpiCard
                  label="Pending Reports"
                  value={stats.summary.pending_reports}
                  accent="text-warning"
                  icon={ClockIcon}
                  tone="orange"
                />
                <KpiCard
                  label="Avg. Participants"
                  value={stats.participant_stats.average_participants}
                  icon={UsersIcon}
                  tone="purple"
                />
              </div>
            </div>
          ))}
          {Object.keys(thematic_areas || {}).length === 0 && (
            <EmptyState title="No events match these filters" />
          )}
        </div>
      )}

      {/* Dashboard Upcoming Events Enhancement, a large functional
          card/section (not a small stat card) with its own filters and
          List/Aggregate toggle, pulled out of the 2-col grid the old
          small widget used to share with Event Status Report above so it
          has the full width the spec asks for. Self-contained: it fetches
          its own data (org-wide for every role, including Staff, see
          apps/dashboard/upcoming_events.py) rather than reading
          `upcoming_events` off this page's own dashboard payload.
          Placed right after the charts, per the requested page order:
          Upcoming Events -> Event Status Report -> Recent Activity ->
          Communications Support Overview. */}
      <UpcomingEventsCard refreshKey={refreshTick} />

      {/* Staff role: Event Status Report and Recent Activity sit side by
          side on desktop; every other role keeps them stacked. */}
      <div className={isStaffRole ? "grid grid-cols-1 lg:grid-cols-2 gap-6 items-start" : "space-y-6"}>
      {/* Post-Event Report Status */}
      <div className="card p-5 overflow-hidden min-w-0">
        <h3 className="text-lg font-bold text-ink mb-4">Event Status Report</h3>
        {post_event_report_status.length === 0 ? (
          <EmptyState title="No events match these filters" />
        ) : (
          <PostEventReportStatusTable rows={post_event_report_status} />
        )}
      </div>

      {/* Recent Activity is left out entirely when there is none. */}
      {(recent_activity.length > 0 || showActivityStream) && (
      <div className={"grid grid-cols-1 gap-4 " + (recent_activity.length > 0 && showActivityStream ? "lg:grid-cols-2" : "")}>
        {recent_activity.length > 0 && (
        <div className="card p-5">
          <h3 className="text-lg font-bold text-ink">Recent Activity</h3>
          <p className="text-sm text-ink-faint mt-0.5 mb-5">Latest system events</p>
          <ul className="divide-y divide-line">
              {recent_activity.map((a) => (
                <li key={a.id} className="py-4 flex items-start gap-3">
                  <span
                    className="mt-1.5 h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: a.action_type === "submitted" ? "#1D9E75" : CHART_FILL }}
                  />
                  <div>
                    <p className="text-[15px] leading-snug">
                      <ActivityDescription description={a.description || `${a.action_type} ${a.object_type}`} />
                    </p>
                    <p className="text-xs text-ink-faint mt-1">
                      {[a.user, formatDateTime(a.created_at)].filter(Boolean).join(", ")}
                    </p>
                  </div>
                </li>
              ))}
          </ul>
        </div>
        )}

        {/* Activity Stream, Communications and Admin. */}
        {showActivityStream && <ActivityStreamCard refreshKey={refreshTick} />}
      </div>
      )}
      </div>

      {/* Communications Support Overview, item #17: not shown to Leadership. */}
      {!isLeadership && (
        <section className="space-y-5">
          <SectionHeader
            title="Communications Support Overview"
            description="Support requests received, by type of support."
            icon={MailIcon}
            tone="orange"
          />
          {/* "Total Requests" + by_support_type cards = 6 total; grid-cols-4
              split them 4/2. Switched to 3 columns so 6 lands evenly as
              3 top / 3 bottom instead. */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
            <KpiCard label="Total Requests" value={comms_support_overview.total_requests} icon={MailIcon} tone="blue" />
            {comms_support_overview.by_support_type.map((t, idx) => (
              <KpiCard
                key={t.support_type}
                label={t.support_type}
                value={t.count}
                icon={MailIcon}
                tone={["teal", "purple", "orange", "navy"][idx % 4]}
              />
            ))}
          </div>
        </section>
      )}

      <footer className="text-xs text-ink-faint text-center pt-6 pb-2 border-t border-line">
        EMS v1.0.0, Last data refresh: {(lastRefreshed || new Date()).toLocaleTimeString()}, Copyright {new Date().getFullYear()}
      </footer>
    </div>
  );
}
