import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { communicationsApi } from "../../api/communications";
import LoadError from "../../components/common/LoadError.jsx";
import { PageLoader } from "../../components/common/Spinner.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import ReportKpiCard from "../../components/reports/ReportKpiCard.jsx";
import {
  AlertTriangleIcon,
  BanIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  MailIcon,
} from "../../components/common/DashboardIcons.jsx";
import { extractErrorMessage, formatDateRange } from "../../utils/format";
import SortableTh from "../../components/common/SortableTh.jsx";
import { useSort } from "../../utils/useSort.js";

// Support Requests Enhancement, Overview tab. Matches the spec's
// wireframe exactly: 8 KPI cards, an Upcoming Events table, and a
// Requests Requiring Attention table, deliberately no Assignment
// column, no staff workload table, and no Communications Lead section
// here (per the spec's explicit note on what Overview does NOT show).
const KPI_CARDS = [
  { key: "total_requests", label: "Total Requests", caption: "All support requests", icon: MailIcon, tone: "blue" },
  { key: "unassigned", label: "Unassigned", caption: "Awaiting assignment", icon: ClockIcon, tone: "orange" },
  { key: "in_progress", label: "In Progress", caption: "Currently being worked on", icon: CalendarIcon, tone: "teal" },
  { key: "completed", label: "Completed", caption: "Delivered requests", icon: CheckCircleIcon, tone: "green" },
  { key: "due_soon", label: "Due Soon", caption: "Approaching deadline", icon: ClockIcon, tone: "purple" },
  { key: "overdue", label: "Overdue", caption: "Past deadline", icon: AlertTriangleIcon, tone: "orange" },
  { key: "urgent", label: "Urgent", caption: "High priority", icon: AlertTriangleIcon, tone: "blue" },
  { key: "declined", label: "Declined", caption: "Not taken forward", icon: BanIcon, tone: "navy" },
];

export default function CommsOverview() {
  const [overview, setOverview] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  async function load() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const { data } = await communicationsApi.getOverview();
      setOverview(data);
    } catch (error) {
      setLoadError(extractErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loadError) return <LoadError message={loadError} onRetry={load} />;
  if (isLoading || !overview) return <PageLoader />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Overview</h1>
        <p className="text-sm text-ink-muted mt-1">A snapshot of support request activity and what needs attention.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CARDS.map((kpi) => (
          <ReportKpiCard
            key={kpi.key}
            label={kpi.label}
            value={overview.summary[kpi.key] ?? 0}
            sub={kpi.caption}
            icon={kpi.icon}
            tone={kpi.tone}
          />
        ))}
      </div>

      <OverviewTable
        title="Upcoming Events"
        rows={overview.upcoming_events}
        emptyMessage="No upcoming events currently need Communications support."
      />

      <OverviewTable
        title="Requests Requiring Attention"
        rows={overview.requests_requiring_attention}
        emptyMessage="Nothing needs attention right now."
        showAction
      />
    </div>
  );
}

function OverviewTable({ title, rows, emptyMessage, showAction }) {
  const sort = useSort(rows, { status: (r) => r.status_display });
  return (
    <div className="card overflow-hidden">
      <h3 className="text-base font-semibold text-ink px-5 py-4 border-b border-line">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-faint">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2.5">Event</th>
                <th className="text-left px-4 py-2.5">Event Date</th>
                <th className="text-left px-4 py-2.5">Priority</th>
                <th className="text-left px-4 py-2.5">Support Needed</th>
                <SortableTh label="Status" sortKey="status" sort={sort} />
                {showAction && <th className="text-right px-4 py-2.5">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sort.rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-muted/60">
                  <td className="px-4 py-2.5 font-medium text-ink whitespace-nowrap">{row.event_title}</td>
                  <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">
                    {formatDateRange(row.event_start_date, row.event_end_date)}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge label={row.priority_label} />
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">
                    {row.support_needed_count} item{row.support_needed_count === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge label={row.status_display} />
                  </td>
                  {showAction && (
                    <td className="px-4 py-2.5 text-right">
                      <Link to={`/support-requests/${row.id}`} className="text-navy-600 hover:underline text-xs">
                        View
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
