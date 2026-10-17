import { usePersistentState } from "../../utils/persistentFilters.js";
import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { dashboardApi } from "../../api/dashboard";
import EmptyState from "../../components/common/EmptyState.jsx";
import Pagination from "../../components/common/Pagination.jsx";
import Spinner, { PageLoader } from "../../components/common/Spinner.jsx";
import {
  buildUpcomingEventsParams,
  EMPTY_UPCOMING_EVENT_FILTERS,
  hasNoUpcomingEvents,
  UpcomingEventsFilterBar,
  UpcomingEventsTable,
  useUpcomingEventFilterOptions,
} from "./UpcomingEventsShared.jsx";

// Dashboard Upcoming Events Enhancement §3/§4/§5, the "View All" page
// the card's link opens: the complete list (all filters from the spec,
// paginated), same ordering (nearest event first) as the card, so the
// two never disagree on what
// "upcoming" means or how the data is filtered/sorted.
const PAGE_FIELDS = ["category", "thematic_area", "region", "owner", "status", "date_from", "date_to"];
const PAGE_SIZE = 20;

export default function UpcomingEventsPage() {
  // Deep-link support: the Dashboard's Big Events "View All" link opens
  // this page pre-filtered (e.g. ?category=international,national, see
  // apply_upcoming_event_filters' comma-separated category support).
  // Read once on mount only, the filter bar itself is the source of
  // truth after that, same as every other filter here.
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = usePersistentState(
    "upcoming-events.filters",
    () => {
      const initial = { ...EMPTY_UPCOMING_EVENT_FILTERS };
      const category = searchParams.get("category");
      if (category) initial.category = category;
      return initial;
    },
    // A ?category= deep link (from the Dashboard) wins over remembered filters.
    { skipRestore: !!searchParams.get("category") }
  );
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [nothingUpcoming, setNothingUpcoming] = useState(false);
  const options = useUpcomingEventFilterOptions();

  // Any filter change resets back to page 1, an active page 3
  // could otherwise land past the end of a newly-narrowed result set.
  useEffect(() => {
    setPage(1);
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const timeoutId = setTimeout(
      () => {
        const params = buildUpcomingEventsParams(filters, { page, page_size: PAGE_SIZE });
        dashboardApi
          .getUpcomingEvents(params)
          .then(async ({ data }) => {
            const results = data.results || [];
            const none = await hasNoUpcomingEvents(filters, results);
            if (cancelled) return;
            setEvents(results);
            setTotal(data.count ?? 0);
            setNothingUpcoming(none);
          })
          .catch(() => {
            if (!cancelled) setEvents([]);
          })
          .finally(() => {
            if (!cancelled) {
              setIsLoading(false);
              setHasLoadedOnce(true);
            }
          });
      },
      filters.search !== EMPTY_UPCOMING_EVENT_FILTERS.search ? 300 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page]);

  if (!hasLoadedOnce) return <PageLoader />;
  // Nothing upcoming at all: the Dashboard card is hidden, so this page is too.
  if (nothingUpcoming) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl">Upcoming Events</h1>
            {isLoading && (
              <span className="flex items-center gap-1.5 text-xs text-ems-primary">
                <Spinner size={14} />
                Updating...
              </span>
            )}
          </div>
          <p className="text-sm text-ink-faint mt-0.5">
            {total} Total Upcoming Event{total === 1 ? "" : "s"}
          </p>
        </div>
        <Link to="/dashboard" className="jm-back-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
          Back to Dashboard
        </Link>
      </div>

      <div className="card p-5">
        <UpcomingEventsFilterBar
          filters={filters}
          onChange={setFilters}
          options={options}
          fields={PAGE_FIELDS}
          showSearch
        />
      </div>

      <div className="card p-5">
        {events.length === 0 ? (
          <EmptyState title="No upcoming events" message="Nothing matches these filters right now." />
        ) : (
          <>
            <UpcomingEventsTable events={events} />
            <Pagination count={total} pageSize={PAGE_SIZE} page={page} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
