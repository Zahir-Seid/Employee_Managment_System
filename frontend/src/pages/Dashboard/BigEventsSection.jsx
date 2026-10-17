import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { dashboardApi } from "../../api/dashboard";
import DaysUntilEventBadge from "../../components/common/DaysUntilEventBadge.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import { ChevronLeftIcon, ChevronRightIcon, MapPinIcon } from "../../components/common/DashboardIcons.jsx";
import { formatDateRange } from "../../utils/format";

// Same International/National taxonomy colors used everywhere else in the
// app (tailwind.config.js `category.*`, Home.jsx's module glows), Big
// Events only ever shows these two, so Sub-national/Internal aren't mapped.
const CATEGORY_STYLES = {
  international: { color: "#0E9AA8", bg: "#E1F6F8", label: "International" },
  national: { color: "#2B3A55", bg: "#EEF1F5", label: "National" },
};

const CARD_WIDTH = 300; // px, kept in one place so the scroll-by amount matches the card width exactly

/** Dashboard: a large, prominent featured-card section for International/
 * National events (Upcoming or Ongoing only), separate from and more
 * visually prominent than the small Upcoming Events card below it. Hides
 * itself entirely when there's nothing to show, per spec ("no empty
 * section", no placeholder box, no "No Big Events" message). */
export default function BigEventsSection({ refreshKey = 0 }) {
  const [events, setEvents] = useState(null); // null = still loading
  const scrollerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    dashboardApi
      .getBigEvents()
      .then(({ data }) => {
        if (!cancelled) setEvents(data.results || []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Still loading, or nothing to show (no big events, or the request
  // failed): render nothing at all (no skeleton, no empty card, no "No big
  // events" message) so the Dashboard's layout never leaves a gap or a
  // placeholder in this section's place.
  if (!events || events.length === 0) return null;

  function scrollByCards(direction) {
    scrollerRef.current?.scrollBy({ left: direction * (CARD_WIDTH + 16), behavior: "smooth" });
  }

  const isSingle = events.length === 1;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h3 className="text-lg font-extrabold text-ink tracking-tight">Big Events</h3>
          <p className="text-sm text-ink-faint mt-0.5">Important upcoming events</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!isSingle && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Previous"
                className="h-7 w-7 rounded-full border border-line flex items-center justify-center text-ink-muted hover:text-ink hover:border-ems-primary/40 transition-colors"
                onClick={() => scrollByCards(-1)}
              >
                <ChevronLeftIcon width={14} height={14} />
              </button>
              <button
                type="button"
                aria-label="Next"
                className="h-7 w-7 rounded-full border border-line flex items-center justify-center text-ink-muted hover:text-ink hover:border-ems-primary/40 transition-colors"
                onClick={() => scrollByCards(1)}
              >
                <ChevronRightIcon width={14} height={14} />
              </button>
            </div>
          )}
          <Link
            to="/dashboard/upcoming-events?category=international,national"
            className="text-sm font-semibold text-ems-primary hover:underline whitespace-nowrap"
          >
            View All
          </Link>
        </div>
      </div>

      {isSingle ? (
        <div className="mt-4">
          <BigEventCard event={events[0]} className="max-w-md" />
        </div>
      ) : (
        <div
          ref={scrollerRef}
          className="mt-4 flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory -mx-1 px-1 pb-1"
          style={{ scrollbarWidth: "none" }}
        >
          {events.map((event) => (
            <BigEventCard key={event.id} event={event} className="shrink-0 snap-start" style={{ width: CARD_WIDTH }} />
          ))}
        </div>
      )}
    </div>
  );
}

function BigEventCard({ event, className = "", style }) {
  const categoryStyle = CATEGORY_STYLES[event.category] || {
    color: "#6B7280",
    bg: "#EEF1F5",
    label: event.category_label,
  };

  return (
    <Link
      to={`/events/${event.id}`}
      className={`group block rounded-lg border border-line overflow-hidden bg-white hover:shadow-[0_4px_16px_rgba(18,49,74,0.1)] hover:border-ems-primary/30 transition-all ${className}`}
      style={style}
    >
      {event.photo ? (
        <div className="h-36 w-full overflow-hidden bg-surface-sunken">
          <img
            src={event.photo}
            alt=""
            className="h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
          />
        </div>
      ) : (
        // No photo on file: a solid category-color header strip instead of
        // an empty image box, so the card still reads as "designed" rather
        // than missing something.
        <div className="h-2.5 w-full" style={{ backgroundColor: categoryStyle.color }} />
      )}

      <div className="p-4 space-y-2">
        <span
          className="jm-status-pill"
          style={{ backgroundColor: categoryStyle.bg, color: categoryStyle.color }}
        >
          {categoryStyle.label || event.category_label}
        </span>

        <h4 className="text-base font-bold uppercase text-ink leading-snug line-clamp-2">{event.title}</h4>

        <p className="text-sm text-ink-muted">{formatDateRange(event.start_date, event.end_date)}</p>

        {event.location && (
          <p className="flex items-center gap-1 text-sm text-ink-muted">
            <MapPinIcon width={14} height={14} className="text-ink-faint shrink-0" />
            <span className="truncate">{event.location}</span>
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <DaysUntilEventBadge value={event.days_until_event} />
          <StatusBadge label={event.status_display} />
        </div>
      </div>
    </Link>
  );
}
