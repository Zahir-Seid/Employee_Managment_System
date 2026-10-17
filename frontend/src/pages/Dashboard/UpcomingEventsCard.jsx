import { usePersistentState } from "../../utils/persistentFilters.js";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dashboardApi } from "../../api/dashboard";
import EmptyState from "../../components/common/EmptyState.jsx";
import Spinner from "../../components/common/Spinner.jsx";
import {
  buildUpcomingEventsParams,
  EMPTY_UPCOMING_EVENT_FILTERS,
  hasNoUpcomingEvents,
  UpcomingEventsFilterBar,
  UpcomingEventsTable,
  useUpcomingEventFilterOptions,
} from "./UpcomingEventsShared.jsx";

// Dashboard Upcoming Events Enhancement §2/§3/§5: a large functional
// card (not a small stat card), title, total count, View All, filters,
// (list view only). Deliberately self-contained: its own
// filters/view state and its own data fetches, independent of the rest
// of the Dashboard's period/category/etc. filters above it, matching the
// spec's own wireframes (this card's filters are separate controls, not
// wired to the page's global filter bar).
const CARD_FIELDS = ["category", "thematic_area", "owner", "date_from", "date_to"];

export default function UpcomingEventsCard({ refreshKey = 0 }) {
  const [filters, setFilters] = usePersistentState("dashboard-upcoming-card.filters", { ...EMPTY_UPCOMING_EVENT_FILTERS });
  const [total, setTotal] = useState(0);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  // null until the first load; the card isn't drawn while there is nothing
  // upcoming at all, or before we know.
  const [nothingUpcoming, setNothingUpcoming] = useState(null);
  const options = useUpcomingEventFilterOptions();

  // Debounced on `search` so every keystroke doesn't fire a request; every
  // other filter changes immediately since those are discrete selects/dates.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timeoutId = setTimeout(
      () => {
        const params = buildUpcomingEventsParams(filters, { page_size: 5 });
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
          .finally(() => !cancelled && setLoading(false));
      },
      filters.search !== EMPTY_UPCOMING_EVENT_FILTERS.search ? 300 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, refreshKey]);

  if (nothingUpcoming !== false) return null;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h3 className="text-lg font-bold text-ink">Upcoming Events</h3>
          <p className="text-sm text-ink-faint mt-0.5">
            {total} Total Upcoming Event{total === 1 ? "" : "s"}
          </p>
        </div>
        <Link to="/dashboard/upcoming-events" className="text-sm font-semibold text-ems-primary hover:underline">
          View All
        </Link>
      </div>

      <div className="mt-4 mb-4">
        <UpcomingEventsFilterBar
          filters={filters}
          onChange={setFilters}
          options={options}
          fields={CARD_FIELDS}
          showSearch
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner size={24} />
        </div>
      ) : events.length === 0 ? (
        <EmptyState title="No upcoming events" message="Nothing matches these filters right now." />
      ) : (
        <UpcomingEventsTable events={events} />
      )}
    </div>
  );
}
