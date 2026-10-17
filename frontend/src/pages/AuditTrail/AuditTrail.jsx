import { usePersistentState, readPersistedFilter } from "../../utils/persistentFilters.js";
import { useEffect, useState } from "react";
import { auditApi } from "../../api/audit";
import EmptyState from "../../components/common/EmptyState.jsx";
import LoadError from "../../components/common/LoadError.jsx";
import Pagination from "../../components/common/Pagination.jsx";
import { ColumnsMenu, FilterSelect, ListSearch, useColumnVisibility } from "../../components/common/ListControls.jsx";
import { PageLoader } from "../../components/common/Spinner.jsx";
import ReportKpiCard from "../../components/reports/ReportKpiCard.jsx";
import {
  AlertTriangleIcon,
  CalendarIcon,
  ClockIcon,
  MailIcon,
  UsersIcon,
} from "../../components/common/DashboardIcons.jsx";
import { extractErrorMessage, formatDateTime } from "../../utils/format";

const PAGE_SIZE = 20;

// Columns offered in the toolbar "View" menu (When always shows).
const COLUMNS = [
  { key: "when", label: "When", locked: true },
  { key: "user", label: "User" },
  { key: "action", label: "Action" },
  { key: "object", label: "Record Type" },
  { key: "description", label: "Description" },
];

// Audit Trail improvement: action/object type dropdowns are hardcoded
// here (matching apps.audit.models.ActionType/ObjectType) rather than
// fetched, the same way other pages in this app hardcode status/category
// label sets, there's no existing "list choices" endpoint for these,
// and adding one just for two dropdowns would be more surface area than
// the improvement calls for. If a new ActionType/ObjectType is added on
// the backend, its entries still show up correctly everywhere else
// (summary buckets, list rows), only these two *filter* dropdowns
// wouldn't offer it as an explicit option until added here too.
const ACTION_TYPE_OPTIONS = [
  { value: "", label: "All Actions" },
  { value: "created", label: "Created" },
  { value: "updated", label: "Updated" },
  { value: "status_changed", label: "Status Changed" },
  { value: "submitted", label: "Submitted" },
  { value: "deleted", label: "Deleted" },
  { value: "login", label: "Login" },
  { value: "todo_completed", label: "To-Do Item Completed" },
  { value: "report_generated", label: "Report Generated" },
];

const OBJECT_TYPE_OPTIONS = [
  { value: "", label: "All Record Types" },
  { value: "event", label: "Event" },
  { value: "support_request", label: "Communications Support Request" },
  { value: "todo_item", label: "To-Do Item" },
  { value: "post_event_report", label: "Event Status Report" },
  { value: "user", label: "User" },
  { value: "report", label: "Generated Report" },
  { value: "config_option", label: "Configuration Option" },
  { value: "tv_display_settings", label: "TV Display Settings" },
  { value: "tv_display_slide", label: "TV Display Slide" },
  { value: "home_content", label: "Home Page Content" },
  { value: "site_settings", label: "Home Page Site Settings" },
];

const EMPTY_FILTERS = { action_type: "", object_type: "", date_from: "", date_to: "" };

// Same visual language as Support Requests > Overview's KPI cards
// (ReportKpiCard: icon chip + soft color wash + a one-line caption),
// keyed by apps.audit.categories.CATEGORY_ORDER so every category always
// gets a consistent icon/tone/caption no matter what order the backend
// returns them in.
const CATEGORY_STYLE = {
  communications: { icon: MailIcon, tone: "purple", caption: "Support request activity" },
  reports: { icon: MailIcon, tone: "navy", caption: "Generated report activity" },
  logins: { icon: UsersIcon, tone: "navy", caption: "Sign-ins and sign-outs" },
  events_created: { icon: CalendarIcon, tone: "teal", caption: "New events added" },
  events_postponed_cancelled: { icon: AlertTriangleIcon, tone: "orange", caption: "Postponed or cancelled events" },
};

// Period filter: same All/Weekly/Monthly/Quarterly/Yearly/Custom toggle as
// the Dashboard (see computePeriodRange there), reproduced here rather than
// imported since Dashboard.jsx doesn't export it, kept numerically
// identical (same fiscal-quarter start month, same Week-N-of-month
// definition) so "This Quarter" etc. mean the same date range on both pages.
const QUARTERS = [
  { value: 1, label: "Q1 (Jul-Sep)" },
  { value: 2, label: "Q2 (Oct-Dec)" },
  { value: 3, label: "Q3 (Jan-Mar)" },
  { value: 4, label: "Q4 (Apr-Jun)" },
];
const FISCAL_QUARTER_START_MONTH = { 1: 6, 2: 9, 3: 0, 4: 3 };
const WEEKS_OF_MONTH = [
  { value: 1, label: "Week 1 (1-7)" },
  { value: 2, label: "Week 2 (8-14)" },
  { value: 3, label: "Week 3 (15-21)" },
  { value: 4, label: "Week 4 (22-end)" },
];
const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" }, { value: 3, label: "March" },
  { value: 4, label: "April" }, { value: 5, label: "May" }, { value: 6, label: "June" },
  { value: 7, label: "July" }, { value: 8, label: "August" }, { value: 9, label: "September" },
  { value: 10, label: "October" }, { value: 11, label: "November" }, { value: 12, label: "December" },
];

function computePeriodRange(period, periodSelection) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);

  if (period === "all") return { date_from: "", date_to: "" };
  if (period === "weekly") {
    const year = periodSelection?.year ?? today.getFullYear();
    const month = periodSelection?.month ?? today.getMonth() + 1;
    const week = periodSelection?.week ?? Math.min(4, Math.ceil(today.getDate() / 7));
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDay = (week - 1) * 7 + 1;
    const endDay = week === 4 ? daysInMonth : Math.min(week * 7, daysInMonth);
    return { date_from: iso(new Date(year, month - 1, startDay)), date_to: iso(new Date(year, month - 1, endDay)) };
  }
  if (period === "quarterly") {
    const year = periodSelection?.year ?? today.getFullYear();
    const quarter = periodSelection?.quarter ?? (((today.getMonth() - 6 + 12) % 12) / 3 | 0) + 1;
    const startMonth = FISCAL_QUARTER_START_MONTH[quarter];
    return { date_from: iso(new Date(year, startMonth, 1)), date_to: iso(new Date(year, startMonth + 3, 0)) };
  }
  if (period === "yearly") {
    const year = periodSelection?.year ?? today.getFullYear();
    return { date_from: iso(new Date(year, 0, 1)), date_to: iso(new Date(year, 11, 31)) };
  }
  // monthly
  const year = periodSelection?.year ?? today.getFullYear();
  const month = periodSelection?.month ?? today.getMonth() + 1;
  return { date_from: iso(new Date(year, month - 1, 1)), date_to: iso(new Date(year, month, 0)) };
}

export default function AuditTrail() {
  const [logs, setLogs] = useState(null);
  const [summary, setSummary] = useState(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = usePersistentState("audit.search", "");
  const columnsView = useColumnVisibility("audit-trail");
  const show = columnsView.isVisible;
  // Rolling periods ("this month" etc.) are recomputed on restore so a
  // remembered selection never shows a stale date range from last visit.
  const [filters, setFilters] = usePersistentState("audit.filters", EMPTY_FILTERS, {
    restore: (stored) => {
      const p = readPersistedFilter("audit.period");
      if (["weekly", "monthly", "quarterly", "yearly"].includes(p)) {
        return { ...stored, ...computePeriodRange(p, readPersistedFilter("audit.periodSelection") || undefined) };
      }
      return stored;
    },
  });
  const [loadError, setLoadError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  // Audit Trail default is "all" (unlike the Dashboard's "monthly"), since
  // the existing behavior before this filter was added showed every log
  // entry on load, adding the period filter shouldn't narrow that default.
  const [period, setPeriod] = usePersistentState("audit.period", "all");
  const nowForPeriod = new Date();
  const [periodSelection, setPeriodSelection] = usePersistentState("audit.periodSelection", {
    week: Math.min(4, Math.ceil(nowForPeriod.getDate() / 7)),
    month: nowForPeriod.getMonth() + 1,
    quarter: (((nowForPeriod.getMonth() - 6 + 12) % 12) / 3 | 0) + 1,
    year: nowForPeriod.getFullYear(),
  });

  function selectPeriod(p) {
    setPage(1);
    setPeriod(p);
    if (p === "custom") return;
    setFilters((f) => ({ ...f, ...computePeriodRange(p, periodSelection) }));
  }

  function updatePeriodSelection(next) {
    const merged = { ...periodSelection, ...next };
    setPeriodSelection(merged);
    if (period !== "custom" && period !== "all") {
      setPage(1);
      setFilters((f) => ({ ...f, ...computePeriodRange(period, merged) }));
    }
  }

  const hasActiveFilters = search || period !== "all" || Object.values(filters).some(Boolean);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setIsLoading(true);
    async function load() {
      try {
        const params = { page };
        if (search) params.search = search;
        Object.entries(filters).forEach(([key, value]) => {
          if (value) params[key] = value;
        });
        const { data } = await auditApi.list(params);
        if (!cancelled) {
          setLogs(data.results || data);
          setCount(data.count ?? (data.results || data).length);
          setSummary(data.summary || null);
        }
      } catch (error) {
        if (!cancelled) setLoadError(extractErrorMessage(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, filters]);

  function updateFilter(key, value) {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearFilters() {
    setPage(1);
    setSearch("");
    setPeriod("all");
    setFilters(EMPTY_FILTERS);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Audit Trail</h1>
        <p className="text-sm text-ink-muted mt-1">
          Who did what, and when, across the workspace. The summary follows the filters below.
        </p>
      </div>

      {/* Summary counts. Dynamic: recomputed on every load from the same
          filtered set the table below shows, not a fixed all-time total. */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <ReportKpiCard label="Total Activities" value={summary.total} sub="All logged activity" icon={ClockIcon} tone="blue" />
          {summary.categories.map((cat) => {
            const style = CATEGORY_STYLE[cat.code] || {};
            return (
              <ReportKpiCard
                key={cat.code}
                label={cat.label}
                value={cat.count}
                sub={style.caption}
                icon={style.icon}
                tone={style.tone}
              />
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <ListSearch
          placeholder="Search description or object ID..."
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <FilterSelect
          className="max-w-[200px]"
          value={filters.action_type}
          onChange={(e) => updateFilter("action_type", e.target.value)}
        >
          {ACTION_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          className="max-w-[220px]"
          value={filters.object_type}
          onChange={(e) => updateFilter("object_type", e.target.value)}
        >
          {OBJECT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </FilterSelect>
        <span className="text-sm text-ink-muted">Period:</span>
        <div className="inline-flex rounded-lg border border-[#E5E9F0] overflow-hidden">
          {["all", "weekly", "monthly", "quarterly", "yearly", "custom"].map((p) => (
            <button
              key={p}
              type="button"
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

        {(period === "weekly" || period === "monthly" || period === "quarterly" || period === "yearly") && (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E9F0] bg-white px-2 py-1">
            {period === "weekly" && (
              <select
                className="form-input max-w-[160px] py-1"
                value={periodSelection.week}
                onChange={(e) => updatePeriodSelection({ week: Number(e.target.value) })}
              >
                {WEEKS_OF_MONTH.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
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
                  <option key={m.value} value={m.value}>{m.label}</option>
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
                  <option key={q.value} value={q.value}>{q.label}</option>
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

        {period === "custom" && (
          <>
            <input
              type="date"
              className="form-input min-w-[130px] max-w-[160px] flex-1"
              value={filters.date_from}
              onChange={(e) => updateFilter("date_from", e.target.value)}
              title="From date"
            />
            <input
              type="date"
              className="form-input min-w-[130px] max-w-[160px] flex-1"
              value={filters.date_to}
              onChange={(e) => updateFilter("date_to", e.target.value)}
              title="To date"
            />
          </>
        )}

        {period !== "custom" && period !== "all" && (
          <span className="text-xs text-ink-faint">{filters.date_from} to {filters.date_to}</span>
        )}

        {hasActiveFilters && (
          <button type="button" className="text-sm text-ems-primary hover:underline" onClick={clearFilters}>
            Clear filters
          </button>
        )}
        <div className="ml-auto">
          <ColumnsMenu
            columns={COLUMNS}
            hidden={columnsView.hidden}
            isVisible={columnsView.isVisible}
            onToggle={columnsView.toggle}
            onReset={columnsView.reset}
          />
        </div>
      </div>

      {loadError ? (
        <LoadError message={loadError} onRetry={() => setLoadError(null)} />
      ) : logs === null ? (
        <PageLoader />
      ) : logs.length === 0 ? (
        <EmptyState title="No audit log entries" message="Nothing matches these filters." />
      ) : (
        <div className="jm-card border border-line p-0 overflow-hidden">
          {isLoading && (
            <div className="px-5 py-1.5 text-xs text-ems-primary border-b border-line">Updating...</div>
          )}
          <div className="overflow-x-auto">
            <table className="jm-table w-full text-sm">
              <thead className="text-ink-muted text-xs uppercase bg-[#F1F4F9]">
                <tr>
                  <th className="text-left px-5 py-2.5 w-14">No.</th>
                  <th className="text-left px-5 py-2.5">When</th>
                  {show("user") && <th className="text-left px-5 py-2.5">User</th>}
                  {show("action") && <th className="text-left px-5 py-2.5">Action</th>}
                  {show("object") && <th className="text-left px-5 py-2.5">Record Type</th>}
                  {show("description") && <th className="text-left px-5 py-2.5">Description</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E9F0]">
                {logs.map((log, rowIndex) => (
                  <tr key={log.id}>
                    <td className="px-5 py-2.5 text-ink-muted tabular-nums">{(page - 1) * PAGE_SIZE + rowIndex + 1}</td>
                    <td className="px-5 py-2.5 text-ink-muted whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                    {show("user") && <td className="px-5 py-2.5 text-ink font-medium whitespace-nowrap">{log.user_name}</td>}
                    {show("action") && <td className="px-5 py-2.5 text-ink-muted whitespace-nowrap">{log.action_type_display}</td>}
                    {show("object") && <td className="px-5 py-2.5 text-ink-muted whitespace-nowrap">{log.object_type_display}</td>}
                    {show("description") && <td className="px-5 py-2.5 text-ink">{log.description}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} count={count} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
