import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { eventsApi } from "../../api/events";
import { useAuth } from "../../auth/AuthContext.jsx";
import CategoryBadge from "../../components/common/CategoryBadge.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import DaysUntilEventBadge, { DAYS_UNTIL_EVENT_OPTIONS } from "../../components/common/DaysUntilEventBadge.jsx";
import EmptyState from "../../components/common/EmptyState.jsx";
import Pagination from "../../components/common/Pagination.jsx";
import { ColumnsMenu, FilterSelect, ListSearch, useColumnVisibility } from "../../components/common/ListControls.jsx";
import Spinner, { PageLoader } from "../../components/common/Spinner.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage, formatDateRange } from "../../utils/format";
import SortableTh from "../../components/common/SortableTh.jsx";
import { useSort } from "../../utils/useSort.js";
import { usePersistentState } from "../../utils/persistentFilters.js";

const PAGE_SIZE = 20;

// Columns offered in the toolbar "View" menu (title and actions always show).
const COLUMNS = [
  { key: "title", label: "Event Title", locked: true },
  { key: "owner", label: "Staff Name" },
  { key: "category", label: "Category" },
  { key: "date", label: "Event Date" },
  { key: "days", label: "Days Until Event" },
  { key: "status", label: "Status" },
  { key: "comms", label: "Comms Support" },
  { key: "report", label: "Report Status" },
  { key: "actions", label: "Actions", locked: true },
];

// Report Status column: Pending/Draft/Completed, except "Overdue" once the
// event ended more than 5 days ago with no submitted Event Status Report
// (the backend's is_report_overdue, the same rule behind Overdue Alerts).
function reportStatusLabel(event) {
  return event.is_report_overdue ? "Overdue" : event.report_status;
}

export default function EventsList() {
  const { showToast } = useToast();
  const { user, isStaff, isAdminRole } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [events, setEvents] = useState([]);
  const sort = useSort(events, {
    status: (e) => e.status_display || e.status,
    report: (e) => reportStatusLabel(e),
  });
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  // Item 3: distinguishes "nothing has ever loaded yet" (show the full
  // blank-page spinner) from "a filter/page change is reloading" (keep the
  // existing table visible with a small inline indicator instead), the
  // previous behavior blanked the whole table to <PageLoader /> on every
  // filter click, which read as jarring/broken rather than a normal update.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Initialized from the URL so the TopNav global search (which navigates
  // to /events?search=...) actually lands on pre-filled, already-searched
  // results instead of an empty box the person has to retype into.
  // Filters are remembered (per page) until logout. A search coming in from
  // the URL (global search) still wins over the remembered search text.
  const [search, setSearch] = usePersistentState("events.search", searchParams.get("search") || "", {
    skipRestore: !!searchParams.get("search"),
  });
  const [category, setCategory] = usePersistentState("events.category", "");
  const [status, setStatus] = usePersistentState("events.status", "");
  const [commsSupport, setCommsSupport] = usePersistentState("events.commsSupport", "");
  const [dateFrom, setDateFrom] = usePersistentState("events.dateFrom", "");
  const [daysUntilEvent, setDaysUntilEvent] = usePersistentState("events.daysUntilEvent", "");
  const columnsView = useColumnVisibility("events");
  const show = columnsView.isVisible;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const params = { page, ordering: "-start_date" };
        if (search) params.search = search;
        if (category) params.category = category;
        if (status) params.status = status;
        if (commsSupport) params.needs_comms_support = commsSupport;
        if (dateFrom) params.date_from = dateFrom;
        if (daysUntilEvent) params.days_until_event = daysUntilEvent;
        const { data } = await eventsApi.list(params);
        if (!cancelled) {
          setEvents(data.results || data);
          setCount(data.count ?? (data.results || data).length);
        }
      } catch (error) {
        if (!cancelled) showToast(extractErrorMessage(error), "error");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setHasLoadedOnce(true);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, category, status, commsSupport, dateFrom, daysUntilEvent]);

  function updateSearch(value) {
    setPage(1);
    setSearch(value);
    if (value) setSearchParams({ search: value });
    else setSearchParams({});
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl">{isStaff && !isAdminRole ? "My Events" : "Events"}</h1>
            {hasLoadedOnce && isLoading && (
              <span className="flex items-center gap-1.5 text-xs text-ems-primary">
                <Spinner size={14} />
                Updating...
              </span>
            )}
          </div>
          <p className="text-sm text-ink-muted mt-1">
            {isStaff && !isAdminRole
              ? "Create, track and update the events you own."
              : "Browse and track every event across the organization."}
          </p>
        </div>
        {isStaff && (
          <Link to="/events/new" className="btn-primary">
            + Create Event
          </Link>
        )}
      </div>

      <div className="card border border-line p-4 flex flex-wrap items-center gap-2.5">
        <ListSearch placeholder="Search events..." value={search} onChange={(e) => updateSearch(e.target.value)} />
        <div className="ml-auto flex flex-1 flex-nowrap items-center justify-end gap-2.5">
        <FilterSelect
          className="max-w-[180px]"
          value={category}
          onChange={(e) => {
            setPage(1);
            setCategory(e.target.value);
          }}
        >
          <option value="">All Categories</option>
          <option value="international">International</option>
          <option value="national">National</option>
          <option value="sub_regional">Sub-national</option>
          <option value="internal">Internal</option>
        </FilterSelect>
        <FilterSelect
          className="max-w-[160px]"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">All Statuses</option>
          <option value="upcoming">Upcoming</option>
          <option value="ongoing">Ongoing</option>
          <option value="held">Held</option>
          <option value="completed">Completed</option>
          <option value="postponed">Postponed</option>
          <option value="cancelled">Cancelled</option>
        </FilterSelect>
        <FilterSelect
          className="max-w-[180px]"
          value={commsSupport}
          onChange={(e) => {
            setPage(1);
            setCommsSupport(e.target.value);
          }}
        >
          <option value="">All (Comms Support)</option>
          <option value="true">Needs Comms Support</option>
          <option value="false">No Comms Support</option>
        </FilterSelect>
        <input
          type="date"
          className="form-input min-w-[130px] max-w-[180px] flex-1 rounded-lg"
          value={dateFrom}
          onChange={(e) => {
            setPage(1);
            setDateFrom(e.target.value);
          }}
        />
        <FilterSelect
          className="max-w-[180px]"
          value={daysUntilEvent}
          onChange={(e) => {
            setPage(1);
            setDaysUntilEvent(e.target.value);
          }}
        >
          {DAYS_UNTIL_EVENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.value ? opt.label : "Days Until Event: All"}
            </option>
          ))}
        </FilterSelect>
        <ColumnsMenu
            columns={COLUMNS}
            hidden={columnsView.hidden}
            isVisible={columnsView.isVisible}
            onToggle={columnsView.toggle}
            onReset={columnsView.reset}
          />
        </div>
      </div>

      <div className="card border border-line overflow-hidden">
        {!hasLoadedOnce ? (
          <PageLoader />
        ) : events.length === 0 ? (
          <EmptyState
            title="No events found"
            message="Try adjusting your filters or search."
            action={
              isStaff ? (
                <Link to="/events/new" className="btn-primary">
                  + Create Event
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="jm-table w-full text-sm">
              <thead className="bg-surface-muted text-ink-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5 w-14">No.</th>
                  <th className="text-left px-4 py-2.5">Event Title</th>
                  {show("owner") && <th className="text-left px-4 py-2.5">Staff Name</th>}
                  {show("category") && <th className="text-left px-4 py-2.5">Category</th>}
                  {show("date") && <th className="text-left px-4 py-2.5">Event Date</th>}
                  {show("days") && <th className="text-left px-4 py-2.5">Days Until Event</th>}
                  {show("status") && <SortableTh label="Status" sortKey="status" sort={sort} />}
                  {show("comms") && <th className="text-left px-4 py-2.5">Comms Support</th>}
                  {show("report") && <SortableTh label="Report Status" sortKey="report" sort={sort} />}
                  <th className="text-right px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sort.rows.map((event, rowIndex) => {
                  const isOwner = isStaff && event.owner === user?.id;
                  // Bug fix: "Submit Report" used to show for any
                  // not-yet-Completed event, including ones still ongoing ,
                  // clicking it landed on the report form, which the
                  // backend then rejected since the event hadn't ended
                  // yet. Same eligibility check PostEventReportsList.jsx
                  // and EventDetail.jsx already use.
                  const eventHasEnded = event.end_date <= new Date().toISOString().slice(0, 10);
                  return (
                    <tr
                      key={event.id}
                      onClick={(e) => {
                        // The row is clickable like the existing "View" link
                        // it sits alongside, but a click on Edit/Submit
                        // Report (or any link/button added later) should
                        // still go to *that* action, not get overridden by
                        // the row's own "go to View" navigation.
                        if (e.target.closest("a, button")) return;
                        navigate(`/events/${event.id}`);
                      }}
                      className={`category-rail-${event.category} cursor-pointer hover:bg-surface-muted/60`}
                    >
                      <td className="px-4 py-2.5 text-ink-muted tabular-nums">{(page - 1) * PAGE_SIZE + rowIndex + 1}</td>
                      <td className="px-4 py-2.5 font-bold text-ink whitespace-nowrap">{event.title}</td>
                      {show("owner") && <td className="px-4 py-2.5 text-ink-muted">{event.owner_name}</td>}
                      {show("category") && (
                        <td className="px-4 py-2.5">
                        <CategoryBadge category={event.category} />
                        </td>
                      )}
                      {show("date") && (
                        <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">
                        {formatDateRange(event.start_date, event.end_date)}
                        </td>
                      )}
                      {show("days") && (
                        <td className="px-4 py-2.5">
                        <DaysUntilEventBadge value={event.days_until_event} />
                        </td>
                      )}
                      {show("status") && (
                        <td className="px-4 py-2.5">
                        <StatusBadge label={event.status_display || event.status} />
                        </td>
                      )}
                      {show("comms") && (
                        <td className="px-4 py-2.5">
                        <StatusBadge label={event.communications_support} />
                        </td>
                      )}
                      {show("report") && (
                        <td className="px-4 py-2.5">
                        <StatusBadge label={reportStatusLabel(event)} />
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <Link to={`/events/${event.id}`} className="text-navy-600 hover:underline mr-3">
                          View
                        </Link>
                        {isOwner && event.is_editable && (
                          <Link to={`/events/${event.id}?edit=1`} className="text-navy-600 hover:underline mr-3">
                            Edit
                          </Link>
                        )}
                        {isOwner && event.report_status !== "Completed" && eventHasEnded && (
                          <Link to={`/events/${event.id}/report`} className="text-navy-600 hover:underline">
                            Submit Report
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination count={count} pageSize={PAGE_SIZE} page={page} onPageChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}
