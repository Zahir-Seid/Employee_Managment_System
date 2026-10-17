import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { eventsApi } from "../../api/events";
import CategoryBadge from "../../components/common/CategoryBadge.jsx";
import EmptyState from "../../components/common/EmptyState.jsx";
import LoadError from "../../components/common/LoadError.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import { PageLoader } from "../../components/common/Spinner.jsx";
import { extractErrorMessage, formatDateRange } from "../../utils/format";

// Reports are due within 5 days after the event ends (Pending/Draft); after
// that they are Overdue. Keep in step with the backend's
// REPORT_SUBMISSION_WINDOW_DAYS.
const REPORT_WINDOW_DAYS = 5;
const DAY_MS = 86400000;

// The events list is paginated, so follow every page of each view.
async function fetchAllEvents(params) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const { data } = await eventsApi.list({ ...params, page });
    all.push(...(data.results || data));
    if (!data.next) return all;
  }
}

// Event Status Report views. Each one is served by the events API's
// `report_view` filter (the same rule the Sidebar counts use), so the list and
// its count can never disagree. The report's own state (not started / draft /
// submitted) is kept separate from the event's timing:
//   pending   reports awaiting action before their deadline: events that ended
//             with no report started (badge Pending) and saved drafts (badge
//             Draft, never relabelled Pending)
//   upcoming  event not ended yet, nothing started (drafts never appear here)
//   completed submitted reports (drafts never appear here)
//   overdue   deadline passed and not submitted. Drafts included; each row
//             shows its real status (Draft or Pending) plus an Overdue flag.
//   draft     every saved draft. No sidebar link; still reachable by
//             ?status=draft, and drafts are labelled Draft wherever they show.
const VIEW_ORDER = ["draft", "pending", "overdue", "upcoming", "completed"];
// Without a ?status= the page shows these groups; Draft is left out because
// drafts already appear under Pending or Overdue.
const DEFAULT_VIEWS = ["pending", "overdue", "upcoming", "completed"];
const VIEW_ORDERING = {
  draft: "-end_date",
  pending: "-end_date",
  overdue: "end_date",
  upcoming: "end_date",
  completed: "-end_date",
};
const SECTION_LABELS = {
  draft: "Draft",
  pending: "Pending",
  overdue: "Overdue",
  upcoming: "Upcoming",
  completed: "Completed",
};

export default function PostEventReportsList() {
  const [rowsByView, setRowsByView] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // The Sidebar's Event Status Reports sub-links (Draft, Pending, Upcoming,
  // Completed, Overdue) deep-link here with ?status=...; when present, only
  // that one group renders.
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("status");
  const statusFilter = VIEW_ORDER.includes(requested) ? requested : null;
  const views = statusFilter ? [statusFilter] : DEFAULT_VIEWS;

  function load() {
    let cancelled = false;
    setLoadError(null);
    (async () => {
      setIsLoading(true);
      try {
        // Same scope as the Sidebar counts: the events API already limits
        // Staff to their own events, while Admin sees the whole organization.
        const lists = await Promise.all(
          views.map((view) => fetchAllEvents({ report_view: view, ordering: VIEW_ORDERING[view] }))
        );
        if (!cancelled) setRowsByView(Object.fromEntries(views.map((view, i) => [view, lists[i]])));
      } catch (error) {
        if (!cancelled) setLoadError(extractErrorMessage(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    return load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  if (loadError) return <LoadError message={loadError} onRetry={load} />;
  if (isLoading) return <PageLoader />;

  const todayIso = new Date().toISOString().slice(0, 10);
  const daysOverdue = (e) => Math.floor((new Date(todayIso) - new Date(e.end_date)) / DAY_MS) - REPORT_WINDOW_DAYS;

  // A filtered view is already titled by PostEventReportsPage, so each
  // section label only renders when no status filter is applied.
  const showSectionLabel = !statusFilter;

  const emptyStates = {
    draft: { title: "No drafts", message: "You have no saved draft Event Status Reports." },
    pending: { title: "Nothing pending", message: "No Event Status Reports are waiting for action." },
    overdue: { title: "Nothing overdue", message: "No Event Status Reports are overdue." },
    upcoming: { title: "Nothing upcoming", message: "No upcoming events are waiting on their end date." },
    completed: { title: "Nothing completed yet", message: "No Event Status Reports have been submitted yet." },
  };

  // One row per event. The report's own status (Pending / Draft / Completed)
  // is the badge; the event's own status is shown as separate text.
  function renderRow(view, e) {
    const reportBadge = <StatusBadge label={e.report_status} />;
    const eventStatus = e.status_display ? <> · Event: {e.status_display}</> : null;
    if (view === "upcoming") {
      return (
        <div key={e.id} className="p-4 flex items-center justify-between gap-4 min-w-max">
          <div>
            <p className="font-medium text-ink whitespace-nowrap">{e.title}</p>
            <p className="text-xs text-ink-faint">
              {formatDateRange(e.start_date, e.end_date)}, <CategoryBadge category={e.category} />
              {eventStatus}
            </p>
          </div>
          <span className="text-xs text-ink-faint whitespace-nowrap">
            Available after {formatDateRange(e.end_date, e.end_date)}
          </span>
        </div>
      );
    }
    if (view === "completed") {
      return (
        <div key={e.id} className="p-4 flex items-center justify-between gap-4 min-w-max">
          <div>
            <p className="font-medium text-ink whitespace-nowrap">{e.title}</p>
            <p className="text-xs text-ink-faint">
              {formatDateRange(e.start_date, e.end_date)}
              {eventStatus}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {reportBadge}
            <Link to={`/events/${e.id}`} className="text-navy-600 hover:underline text-sm">
              View Report
            </Link>
          </div>
        </div>
      );
    }
    const overdue = view === "overdue";
    return (
      <div key={e.id} className="p-4 flex items-center justify-between gap-4 min-w-max">
        <div>
          <p className="font-medium text-ink whitespace-nowrap">{e.title}</p>
          <p className="text-xs text-ink-faint">
            {formatDateRange(e.start_date, e.end_date)}, <CategoryBadge category={e.category} />
            {eventStatus}
            {overdue && (
              <>
                {" "}
                · {daysOverdue(e)} day{daysOverdue(e) === 1 ? "" : "s"} overdue
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {reportBadge}
          {overdue && <StatusBadge label="Overdue" />}
          <Link to={`/events/${e.id}/report`} className="btn-primary">
            {e.report_status === "Draft" ? "Continue" : "Submit Report"}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {views.map((view) => {
        const rows = rowsByView[view] || [];
        return (
          <div key={view} className="space-y-3">
            {showSectionLabel ? (
              <h2 className="text-base text-ink-muted">
                {SECTION_LABELS[view]} ({rows.length})
              </h2>
            ) : (
              <p className="text-sm text-ink-muted">
                Total: <span className="font-semibold text-ink">{rows.length}</span>{" "}
                {rows.length === 1 ? "report" : "reports"}
              </p>
            )}
            {rows.length === 0 ? (
              statusFilter && <EmptyState title={emptyStates[view].title} message={emptyStates[view].message} />
            ) : (
              <div className="card divide-y divide-line overflow-x-auto">{rows.map((e) => renderRow(view, e))}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
