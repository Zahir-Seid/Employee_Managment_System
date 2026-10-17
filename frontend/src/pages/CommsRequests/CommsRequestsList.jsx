import { usePersistentState } from "../../utils/persistentFilters.js";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { communicationsApi } from "../../api/communications";
import EmptyState from "../../components/common/EmptyState.jsx";
import Pagination from "../../components/common/Pagination.jsx";
import { ColumnsMenu, FilterSelect, ListSearch, useColumnVisibility } from "../../components/common/ListControls.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import DaysUntilEventBadge from "../../components/common/DaysUntilEventBadge.jsx";
import { PageLoader } from "../../components/common/Spinner.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage, formatDateRange } from "../../utils/format";
import SortableTh from "../../components/common/SortableTh.jsx";
import { useSort } from "../../utils/useSort.js";

const PAGE_SIZE = 20;

// Columns offered in the toolbar "View" menu (event and View link always show).
const COLUMNS = [
  { key: "event", label: "Event", locked: true },
  { key: "owner", label: "Owner" },
  { key: "date", label: "Date" },
  { key: "days", label: "Days Until Event" },
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
  { key: "view", label: "View", locked: true },
];

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "unassigned", label: "Unassigned" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In Progress" },
  { value: "needs_clarification", label: "Needs Clarification" },
  { value: "clarification_provided", label: "Clarification Provided" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
];

// Quick filters under the page title: "My Assignments" lists every request the
// current user is one of the assignees on (even when others are assigned too).
// The status shortcut buttons (Unassigned / Assigned / In Progress) were
// removed; filtering by status is still available in the Status dropdown.
// Members only ever see their own assigned requests, so only the Lead gets
// "My Assignments".
const PRIORITY_OPTIONS = [
  { value: "", label: "All Priorities" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
];

// hideHeading: Admin and Staff only ever have this one tab, so the page's own
// "Support Requests" title already names it; the repeated heading (and its
// description) is dropped for them. Nothing is left behind in its place, the
// search/filter bar simply moves up.
export default function CommsRequestsList({ hideHeading = false }) {
  const { showToast } = useToast();
  const { isCommunications, isCommunicationsLead } = useAuth();
  const [requests, setRequests] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  // Distinguishes "nothing has loaded yet" (full loader) from "a filter
  // change is reloading" (keep the current rows visible with a small
  // inline indicator instead), the old unconditional isLoading check
  // blanked this whole panel to a spinner on every keystroke/filter
  // change, which read as a flash/crack rather than a smooth update.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [search, setSearch] = usePersistentState("requested-supports.search", "");
  const columnsView = useColumnVisibility("support-requests");
  const show = columnsView.isVisible;
  const sort = useSort(requests, { status: (r) => r.status_display });
  const [statusFilter, setStatusFilter] = usePersistentState("requested-supports.status", "");
  const [priorityFilter, setPriorityFilter] = usePersistentState("requested-supports.priority", "");
  const [myAssignments, setMyAssignments] = useState(false);
  // Messages & Clarifications: only requests with unread messages for me.
  const [unreadOnly, setUnreadOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const params = { page };
        if (search) params.search = search;
        // "pending_review" was renamed to "unassigned"; ignore a stale saved value.
        if (statusFilter && statusFilter !== "pending_review") params.status = statusFilter;
        if (myAssignments && isCommunications) params.assigned_to_me = true;
        if (unreadOnly) params.unread = true;
        if (priorityFilter) params.priority = priorityFilter;
        const { data } = await communicationsApi.listSupportRequests(params);
        if (!cancelled) {
          setRequests(data.results || data);
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
  }, [page, search, statusFilter, priorityFilter, myAssignments, unreadOnly]);

  return (
    <div className="space-y-4">
      {!hideHeading && (
        <div>
          <h1 className="text-2xl">
            {isCommunications && !isCommunicationsLead ? "Assigned Requests" : "Requested Supports"}
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            {isCommunications && !isCommunicationsLead
              ? "Support requests assigned to you, and where each one stands."
              : "Support requests submitted for events, and where each one stands."}
          </p>
        </div>
      )}

      <PostponedCancelledEventsSection />

      {/* The "All" and "Unread" buttons were removed. Only the Communications
          Lead keeps "My Assignments" (click again to turn it off). */}
      {isCommunications && isCommunicationsLead && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPage(1);
              setMyAssignments((v) => !v);
              setStatusFilter("");
            }}
            className={
              "px-3 py-1.5 rounded-full text-sm border transition-colors " +
              (myAssignments
                ? "bg-ems-primary text-white border-ems-primary"
                : "border-line text-ink-muted hover:text-ink hover:border-ems-primary")
            }
          >
            My Assignments
          </button>
        </div>
      )}

      <div className="card border border-line p-4 flex flex-wrap items-center gap-2.5">
        <ListSearch
          placeholder="Search by event or owner..."
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <div className="ml-auto flex flex-1 flex-nowrap items-center justify-end gap-2.5">
        <FilterSelect
          className="max-w-[170px]"
          value={statusFilter}
          onChange={(e) => {
            setPage(1);
            setStatusFilter(e.target.value);
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          className="max-w-[160px]"
          value={priorityFilter}
          onChange={(e) => {
            setPage(1);
            setPriorityFilter(e.target.value);
          }}
        >
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
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
        ) : requests.length === 0 ? (
          <EmptyState title="No Communications Support Requests found" />
        ) : (
          <div className="overflow-x-auto">
            {isLoading && (
              <div className="px-4 py-1.5 text-xs text-ems-primary border-b border-line">Updating...</div>
            )}
            <table className="jm-table w-full text-sm">
              <thead className="bg-surface-muted text-ink-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5 w-14">No.</th>
                  <th className="text-left px-4 py-2.5">Event</th>
                  {show("owner") && <th className="text-left px-4 py-2.5">Owner</th>}
                  {show("date") && <th className="text-left px-4 py-2.5">Date</th>}
                  {show("days") && <th className="text-left px-4 py-2.5">Days Until Event</th>}
                  {show("priority") && <th className="text-left px-4 py-2.5">Priority</th>}
                  {show("status") && <SortableTh label="Status" sortKey="status" sort={sort} />}
                  <th className="text-left px-4 py-2.5">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sort.rows.map((req, rowIndex) => (
                  <tr key={req.id} className="hover:bg-surface-muted/60 cursor-pointer">
                    <td className="px-4 py-2.5 text-ink-muted tabular-nums">{(page - 1) * PAGE_SIZE + rowIndex + 1}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Link to={`/support-requests/${req.id}`} className="text-navy-700 font-bold hover:underline">
                        {req.event_title}
                      </Link>
                      {req.unread_count > 0 && (
                        <span
                          className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-ems-primary px-1.5 text-xs font-semibold text-white"
                          title={`${req.unread_count} unread ${req.unread_count === 1 ? "message" : "messages"}`}
                        >
                          {req.unread_count}
                        </span>
                      )}
                    </td>
                    {show("owner") && <td className="px-4 py-2.5 text-ink-muted">{req.event_owner}</td>}
                    {show("date") && (
                      <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">
                      {formatDateRange(req.event_start_date, req.event_end_date)}
                      </td>
                    )}
                    {show("days") && (
                      <td className="px-4 py-2.5">
                      <DaysUntilEventBadge value={req.days_until_event} />
                      </td>
                    )}
                    {show("priority") && (
                      <td className="px-4 py-2.5">
                      <StatusBadge label={req.priority_label} />
                      </td>
                    )}
                    {show("status") && (
                      <td className="px-4 py-2.5">
                      <StatusBadge label={req.status_display} />
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/support-requests/${req.id}`}
                        className="text-navy-700 font-medium hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination count={count} pageSize={PAGE_SIZE} page={page} onPageChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}

function PostponedCancelledEventsSection() {
  const { isCommunications, isLeadership, isAdminRole } = useAuth();
  const { showToast } = useToast();
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  // Bug fix: this used to check `isAdmin`, which includes an
  // `is_superuser` fallback (so a Django superuser isn't locked out of
  // the actual /admin panel just because their `role` field hasn't been
  // set to "admin" yet). The backend's IsCommunicationsOrLeadership
  // permission on this endpoint has no such fallback, it's strictly
  // role-based. So a Staff account that also happens to have
  // is_superuser=True (exactly what `createsuperuser` produces unless
  // role is set explicitly afterward) saw this section try to fetch,
  // pass the frontend's isAdmin check, and then get a real 403 from the
  // backend, "You do not have permission to perform this action" ,
  // right as the Support Requests page loaded. `isAdminRole` (role ===
  // "admin" only, no superuser fallback) matches the backend exactly.
  const canSee = isCommunications || isLeadership || isAdminRole;

  useEffect(() => {
    if (!canSee) return;
    let cancelled = false;
    communicationsApi
      .listPostponedCancelledEvents()
      .then(({ data }) => {
        if (!cancelled) setEvents(data.results || data);
      })
      .catch((error) => {
        if (!cancelled) showToast(extractErrorMessage(error), "error");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSee]);

  const sort = useSort(events, { status: (e) => e.status });
  if (!canSee || isLoading || events.length === 0) return null;

  return (
    <div className="card overflow-hidden border-l-4 border-l-warning">
      <button
        onClick={() => setIsCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-ink">
          Postponed &amp; Cancelled Events ({events.length})
        </span>
        <span className="text-xs text-ink-faint">{isCollapsed ? "Show" : "Hide"}</span>
      </button>
      {!isCollapsed && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2.5">Event</th>
                <th className="text-left px-4 py-2.5">Owner</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <SortableTh label="Status" sortKey="status" sort={sort} />
                <th className="text-left px-4 py-2.5">Reason</th>
                <th className="text-left px-4 py-2.5">Had Support Request?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sort.rows.map((ev) => (
                <tr key={ev.id} className="hover:bg-surface-muted/60">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <Link to={`/events/${ev.id}`} className="text-navy-700 font-medium hover:underline">
                      {ev.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{ev.owner_name}</td>
                  <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">
                    {formatDateRange(ev.start_date, ev.end_date)}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge label={ev.status === "postponed" ? "Postponed" : "Cancelled"} />
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted max-w-xs">{ev.status_reason || "No reason given."}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{ev.had_support_request ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
