import { usePersistentState } from "../../utils/persistentFilters.js";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { reportsApi } from "../../api/reports";
import { useToast } from "../../context/ToastContext.jsx";
import ReportKpiCard from "../../components/reports/ReportKpiCard.jsx";
import { UsersIcon } from "../../components/common/DashboardIcons.jsx";
import PeriodSelector from "../../components/reports/PeriodSelector.jsx";
import { KpiSkeleton, ChartSkeleton, ReportEmptyState, ReportErrorState } from "../../components/reports/ReportStates.jsx";
import { extractErrorMessage, formatDate } from "../../utils/format";

// Management Report v2, simplified spec agreed with the person
// commissioning this feature: a plain-language, on-screen summary rather
// than the earlier data-table/drill-down/export-heavy version. This
// intentionally drops the Event Summary table, CSV/Excel/PDF export,
// Save Report, and cross-report drill-down links that the previous
// version of this page had, none of those are part of the agreed
// design, so they're removed here rather than kept alongside it.

function StatCard({ label, value, sub, tone }) {
  return <ReportKpiCard label={label} value={value} sub={sub} icon={UsersIcon} tone={tone} />;
}

// Small count card used for a single breakdown row (e.g. one thematic
// area and its event count). Used in place of a chart/bar so the
// section is a fast scan of "label, count" rather than a proportion
// visualization.
function CountCard({ label, count }) {
  return (
    <div className="rounded-lg border border-line bg-surface-muted/40 px-3 py-2.5 flex items-center justify-between gap-2">
      <span className="text-xs text-ink-muted truncate" title={label}>{label}</span>
      <span className="text-sm font-bold text-ink shrink-0">{count}</span>
    </div>
  );
}

// Shared count-card grid used by Thematic Area, Engagement Level, and
// Support Level, each row (label + count) rendered as its own small
// card rather than a bar chart, since the point of this page is fast
// scanning, not precision.
function BreakdownSection({ title, rows, totalCount }) {
  return (
    <div className="jm-card">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="text-xs text-ink-faint">{totalCount} total</p>
      </div>
      {!rows || rows.length === 0 ? (
        <p className="text-sm text-ink-faint">Nothing to show for the current period.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {rows.map((row) => (
            <CountCard key={row.code} label={row.label} count={row.count} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExecutiveManagementReport() {
  const { showToast } = useToast();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [period, setPeriod] = usePersistentState("reports.executive.period", "monthly");
  const today = new Date();
  const [selection, setSelection] = usePersistentState("reports.executive.selection", {
    week: Math.min(4, Math.ceil(today.getDate() / 7)),
    month: today.getMonth() + 1,
    quarter: (((today.getMonth() - 6 + 12) % 12) / 3 | 0) + 1,
    year: today.getFullYear(),
  });

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const params = { period, year: selection.year };
      if (period === "weekly") {
        params.week = selection.week;
        params.month = selection.month;
      } else if (period === "monthly") {
        params.month = selection.month;
      } else if (period === "quarterly") {
        params.quarter = selection.quarter;
      }
      const { data } = await reportsApi.getOrganizationalPerformanceReport(params);
      setReport(data);
    } catch (e) {
      setError(true);
      showToast(extractErrorMessage(e), "error");
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, selection.week, selection.month, selection.quarter, selection.year]);

  const noData = report && report.executive_summary.total_events === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Report</h1>
          <p className="text-sm text-ink-muted mt-0.5">Overall event and organizational performance.</p>
        </div>
      </div>

      <div className="jm-card">
        <PeriodSelector
          period={period}
          selection={selection}
          onPeriodChange={setPeriod}
          onSelectionChange={(patch) => setSelection((s) => ({ ...s, ...patch }))}
        />
      </div>

      {!hasLoadedOnce && loading ? (
        <div className="space-y-5">
          <KpiSkeleton />
          <ChartSkeleton />
        </div>
      ) : error ? (
        <ReportErrorState onRetry={load} />
      ) : noData ? (
        <ReportEmptyState message="There are no events matching the selected period." />
      ) : (
        <>
          {report.executive_summary.summary_text && (
            <div className="jm-card">
              <p className="text-sm font-bold text-ink mb-1">Overall Activity Summary</p>
              <p className="text-sm text-ink-muted leading-relaxed">{report.executive_summary.summary_text}</p>
            </div>
          )}

          <div>
            <p className="text-sm font-bold text-ink mb-2">Participant Overview</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard label="Total Participants" sub="In selected period" tone="blue" value={report.participant_overview.total_participants} />
              <StatCard label="Female" sub="Of total participants" tone="purple" value={report.participant_overview.female} />
              <StatCard label="Male" sub="Of total participants" tone="teal" value={report.participant_overview.male} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BreakdownSection
              title="Thematic Area"
              rows={report.thematic_area_breakdown}
              totalCount={report.executive_summary.total_events}
            />
            <BreakdownSection
              title="Engagement Level"
              rows={report.engagement_level_breakdown}
              totalCount={report.executive_summary.total_events}
            />
          </div>

          <BreakdownSection
            title="Support Level"
            rows={report.support_level_breakdown}
            totalCount={report.support_level_breakdown.reduce((sum, r) => sum + r.count, 0)}
          />

          <div className="jm-card">
            <p className="text-sm font-bold text-ink mb-2">Highlights</p>
            {report.highlights.length === 0 ? (
              <p className="text-sm text-ink-faint">No highlights for the current period.</p>
            ) : (
              <ul className="space-y-1.5">
                {report.highlights.map((h) => (
                  <li key={h.event_id} className="text-sm text-ink">
                    <Link to={`/events/${h.event_id}`} className="font-medium text-ems-primary hover:underline">
                      {h.title}
                    </Link>
                    <span className="text-ink-muted"> - {h.participant_count} participants ({h.engagement_level})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="jm-card">
            <p className="text-sm font-bold text-ink mb-2">Outcomes Achieved</p>
            {report.outcomes_achieved.length === 0 ? (
              <p className="text-sm text-ink-faint">No submitted outcomes for the current period.</p>
            ) : (
              <ul className="space-y-2">
                {report.outcomes_achieved.map((o) => (
                  <li key={o.event_id} className="text-sm border-l-2 border-line pl-3">
                    <Link to={`/events/${o.event_id}`} className="font-medium text-ems-primary hover:underline">
                      {o.event_title}
                    </Link>
                    <p className="text-ink-muted text-justify">{o.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(report.attention_items.postponed_cancelled.length > 0 || report.attention_items.missing_reports.length > 0) && (
            <div className="jm-card border-pill-warning/40 bg-pill-warningLight/40">
              <p className="text-sm font-bold text-pill-warning mb-2">Attention Items</p>
              <div className="space-y-1.5">
                {report.attention_items.postponed_cancelled.map((item) => (
                  <p key={item.event_id} className="text-sm text-ink">
                    <Link to={`/events/${item.event_id}`} className="font-medium hover:underline">{item.title}</Link>
                    {" "}was {item.status.toLowerCase()}{item.reason ? ` - ${item.reason}` : ""}.
                  </p>
                ))}
                {report.attention_items.missing_reports.map((item) => (
                  <p key={item.event_id} className="text-sm text-ink">
                    <Link to={`/events/${item.event_id}`} className="font-medium hover:underline">{item.title}</Link>
                    {" "}ended {formatDate(item.end_date)} and still has no submitted report.
                  </p>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
