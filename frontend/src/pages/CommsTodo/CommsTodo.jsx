import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { communicationsApi } from "../../api/communications";
import EmptyState from "../../components/common/EmptyState.jsx";
import { PageLoader } from "../../components/common/Spinner.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage, formatDateRange } from "../../utils/format";

// Item #8: was a card per event with its full checklist all rendered at
// once, with many open requests, that meant scrolling past a wall of
// checklists to find one. Restructured into a two-level view, still on
// this one page/route (no navigation): first just the list of event
// names, then clicking one expands ONLY that event's to-do list inline
// (accordion, expanding one collapses any other that was open).
export default function CommsTodo() {
  const { showToast } = useToast();
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  // Distinguishes "nothing has ever loaded yet" (full-page loader) from "a
  // filter change is reloading" (keep the existing list visible instead of
  // blanking back to a spinner every time), same pattern used on
  // Dashboard/EventsList, so toggling "Show completed" doesn't flash.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  async function load() {
    setIsLoading(true);
    try {
      // Only the requests assigned to this user. Members are limited to these by
      // the server; the Lead could see all, but the To-Do list is their own.
      const params = { assigned_to_me: true, ...(showCompleted ? {} : { completed: "false" }) };
      const { data } = await communicationsApi.listSupportRequests(params);
      setRequests(data.results || data);
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsLoading(false);
      setHasLoadedOnce(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompleted]);

  async function toggleItem(item, requestId) {
    setTogglingId(item.id);
    try {
      const { data: updatedItem } = await communicationsApi.toggleTodoItem(item.id, {
        is_done: !item.is_done,
        notes: item.notes,
      });
      // Bug fix: this used to refetch the whole list through the same
      // completed:false filter as the initial load. Checking the *last*
      // pending item meant that request's is_fully_completed flipped to
      // true, so the very next fetch, through that same filter, no
      // longer matched it, and the entire card (title, all 3 now-checked
      // items) vanished instead of just staying open showing them all
      // checked. Updating the one changed item in local state instead
      // means "Show completed" is the only thing that ever removes a
      // fully-done request from view, never a background refetch nobody
      // asked for.
      setRequests((prev) =>
        prev.map((r) =>
          r.id !== requestId
            ? r
            : {
                ...r,
                todo_items: r.todo_items.map((i) => (i.id === item.id ? { ...i, ...updatedItem } : i)),
              }
        )
      );
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteItem(item) {
    if (!window.confirm(`Remove "${item.label}" from this checklist? This can't be undone.`)) return;
    setDeletingId(item.id);
    try {
      await communicationsApi.deleteTodoItem(item.id);
      showToast("To-do item removed.", "success");
      await load();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Communications To-Do</h1>
          <p className="text-sm text-ink-muted mt-1">Follow-up checklists for Communications support requests, to tick off as you go.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="rounded border-line"
          />
          Show completed
        </label>
        {isLoading && hasLoadedOnce && <span className="text-xs text-ems-primary">Updating...</span>}
      </div>
      {!hasLoadedOnce ? (
        <PageLoader />
      ) : requests.length === 0 ? (
        <EmptyState title="Nothing pending" message="All Communications Support Requests are up to date." />
      ) : (
        <div className="jm-card p-0 divide-y divide-[#E5E9F0]">
          {requests.map((req) => {
            const isExpanded = expandedId === req.id;
            // Bug fix: this used to filter out an item the moment it was
            // checked (when "Show completed" was off), so ticking a box
            // made the row vanish instead of just marking it done, jarring
            // compared to a normal to-do list. Items in an open checklist
            // now always stay visible and are marked with color/strikethrough
            // instead; "Show completed" only affects which *requests* the
            // outer list fetches (via the API param above).
            const visibleItems = req.todo_items;
            const pendingCount = req.todo_items.filter((item) => !item.is_done).length;
            return (
              <div key={req.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : req.id)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-3.5 text-left hover:bg-[#F1F4F9] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate">{req.event_title}</p>
                    <p className="text-xs text-ink-faint">
                      {[req.event_owner, formatDateRange(req.event_start_date, req.event_end_date)].filter(Boolean).join(", ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {pendingCount > 0 && (
                      <span className="jm-pill jm-pill-medium">{pendingCount} pending</span>
                    )}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      className={"text-ink-faint transition-transform " + (isExpanded ? "rotate-180" : "")}
                    >
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-4 bg-[#F1F4F9]">
                    <Link
                      to={`/support-requests/${req.id}`}
                      className="text-xs text-ems-primary hover:underline"
                    >
                      View full request details
                    </Link>
                    {visibleItems.length === 0 ? (
                      <p className="text-sm text-ink-faint mt-2">Nothing pending on this checklist.</p>
                    ) : (
                      <ul className="space-y-1.5 mt-2">
                        {visibleItems.map((item) => (
                          <li
                            key={item.id}
                            className={
                              "group flex items-center gap-3 rounded-md px-2.5 py-1.5 -mx-2.5 transition-colors " +
                              (item.is_done ? "bg-pill-successLight" : "hover:bg-white")
                            }
                          >
                            <input
                              type="checkbox"
                              checked={item.is_done}
                              disabled={togglingId === item.id || deletingId === item.id}
                              onChange={() => toggleItem(item, req.id)}
                              className="h-4 w-4 rounded border-line accent-success"
                            />
                            <span
                              className={
                                "flex-1 text-sm " +
                                (item.is_done ? "text-pill-successText line-through" : "text-ink")
                              }
                            >
                              {item.label}
                            </span>
                            {item.is_done && (
                              <span className="jm-pill jm-pill-success shrink-0">Done</span>
                            )}
                            <button
                              type="button"
                              onClick={() => deleteItem(item)}
                              disabled={deletingId === item.id || togglingId === item.id}
                              title="Delete this to-do item"
                              className="shrink-0 text-ink-faint hover:text-ems-primary disabled:opacity-40 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18" />
                                <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6M14 11v6" />
                              </svg>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
