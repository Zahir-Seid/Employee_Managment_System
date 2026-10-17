import { usePersistentState } from "../../utils/persistentFilters.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { communicationsApi } from "../../api/communications";
import { PageLoader } from "../../components/common/Spinner.jsx";
import LoadError from "../../components/common/LoadError.jsx";
import { FilterSelect } from "../../components/common/ListControls.jsx";
import { extractErrorMessage } from "../../utils/format";
import { useToast } from "../../context/ToastContext.jsx";
import { AddNotePopover, EventDetailsPopover } from "./CalendarPopovers.jsx";
import { DayView, MonthView, QuarterView, WeekView, YearView } from "./CalendarViews.jsx";
import {
  COLOR_STYLES,
  DAYS_UNTIL_FILTER_OPTIONS,
  LEGEND,
  STATUS_FILTER_OPTIONS,
  VIEW_OPTIONS,
  dateKey,
  eventPhase,
  matchesDaysUntilFilter,
  parseDate,
  periodLabel,
  prepareEvents,
  prepareNotes,
  shiftCursor,
  startOfDay,
} from "./calendarUtils.js";
import { CaretLeftIcon, CaretRightIcon } from "../../components/common/UiGlyphs.jsx";

const VIEW_VALUES = VIEW_OPTIONS.map((o) => o.value);
const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

// The EMS Calendar (Communications / Comms Lead / Leadership / Admin,
// inside the Support Requests page): Day / Week / Month / Quarter / Year
// views with Previous / Next / Today, an event-status filter
// (All / Upcoming / Ongoing / Held) and a Days Until Event filter (All /
// Today / Within 3 Days / Within 7 Days / Within 14 Days / More Than 14
// Days / Event Started / Event Passed - same buckets as the Events list's
// dropdown) that apply together, multi-day events drawn across their
// start date only (the details show the full range), and a details popup on click. Everything comes from
// the existing /calendar/ endpoint over the real EMS events - colors
// are the Days Until Event colors (green > 14 days, amber 8-14, orange
// 1-7, blue Today/Ongoing, light gray Held; no red).

export default function CalendarPage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [statusFilter, setStatusFilter] = usePersistentState("calendar.status", "all");
  const [daysUntilFilter, setDaysUntilFilter] = usePersistentState("calendar.daysUntil", "all");
  const [eventPopover, setEventPopover] = useState(null); // { event, anchorRect }
  const [createPopover, setCreatePopover] = useState(null); // { date, anchorRect }

  // Where you are (view + period) lives in the URL (?view=month&date=2026-09-01),
  // updated in place. Opening an event and pressing Back therefore returns to the
  // exact same view and month instead of resetting to this month.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlView = searchParams.get("view");
  const urlDate = searchParams.get("date");
  const view = VIEW_VALUES.includes(urlView) ? urlView : "month";
  const cursor = useMemo(() => (urlDate && DATE_PARAM.test(urlDate) ? parseDate(urlDate) : startOfDay(new Date())), [urlDate]);
  const goTo = useCallback(
    (nextView, nextCursor) =>
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set("view", nextView);
          params.set("date", dateKey(nextCursor));
          return params;
        },
        { replace: true }
      ),
    [setSearchParams]
  );
  const setView = (nextView) => {
    setDrillStack([]);
    goTo(nextView, cursor);
  };
  const setCursor = (next) => goTo(view, typeof next === "function" ? next(cursor) : next);

  // Calendar's own Back: drilling in (a month -> a day, a quarter/year -> a
  // month) remembers where you came from; Back returns there.
  const [drillStack, setDrillStack] = useState([]);
  const goBack = () => {
    const last = drillStack[drillStack.length - 1];
    if (!last) return;
    setDrillStack((stack) => stack.slice(0, -1));
    setEventPopover(null);
    setCreatePopover(null);
    goTo(last.view, last.cursor);
  };

  function load() {
    let cancelled = false;
    setLoadError(null);
    (async () => {
      setIsLoading(true);
      try {
        const [{ data }, notesResponse] = await Promise.all([
          communicationsApi.getCalendar(),
          // Notes failing to load must never take the whole calendar down.
          communicationsApi.listCalendarNotes().catch(() => ({ data: [] })),
        ]);
        if (!cancelled) {
          setRows(data.results || data);
          setNotes(notesResponse.data.results || notesResponse.data);
        }
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
  }, []);

  const today = useMemo(() => startOfDay(new Date()), []);
  const events = useMemo(() => prepareEvents(rows), [rows]);
  const noteItems = useMemo(() => prepareNotes(notes), [notes]);
  // The status / days-until filters are about events, so they only narrow the
  // events; notes (anything to remember) always stay on the calendar.
  const visibleEvents = useMemo(
    () => [
      ...events.filter(
        (e) =>
          (statusFilter === "all" || eventPhase(e) === statusFilter) &&
          matchesDaysUntilFilter(e, daysUntilFilter, today)
      ),
      ...noteItems,
    ],
    [events, noteItems, statusFilter, daysUntilFilter, today]
  );

  const closeEventPopover = useCallback(() => setEventPopover(null), []);
  const closeCreatePopover = useCallback(() => setCreatePopover(null), []);
  const openEventPopover = (event, domEvent) => {
    setCreatePopover(null);
    setEventPopover({ event, anchorRect: domEvent.currentTarget.getBoundingClientRect() });
  };
  const openCreatePopover = (date, domEvent) => {
    setEventPopover(null);
    setCreatePopover({ date, anchorRect: domEvent.currentTarget.getBoundingClientRect() });
  };
  const openDay = (date) => {
    setDrillStack((stack) => [...stack, { view, cursor }]);
    goTo("day", startOfDay(date));
  };
  const openMonth = (date) => {
    setDrillStack((stack) => [...stack, { view, cursor }]);
    goTo("month", new Date(date.getFullYear(), date.getMonth(), 1));
  };

  async function saveNote(title, date) {
    try {
      const { data } = await communicationsApi.createCalendarNote({ title, date: dateKey(date) });
      // Straight into the calendar: it shows on its date immediately.
      setNotes((list) => [...list, data]);
      setCreatePopover(null);
      showToast("Added to the calendar.", "success");
    } catch (error) {
      throw new Error(extractErrorMessage(error));
    }
  }

  async function deleteNote(note) {
    try {
      await communicationsApi.deleteCalendarNote(note.noteId);
      setNotes((list) => list.filter((n) => n.id !== note.noteId));
      setEventPopover(null);
      showToast("Note deleted.", "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  }

  if (loadError) return <LoadError message={loadError} onRetry={load} />;
  if (isLoading) return <PageLoader />;

  const shared = {
    cursor,
    events: visibleEvents,
    today,
    onSelectEvent: openEventPopover,
    onSelectDay: openDay,
    onCreateDay: openCreatePopover,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl">Calendar</h1>
        <p className="text-sm text-ink-muted mt-1">Events across the organization by day, week, month or year.</p>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {drillStack.length > 0 && (
            <button type="button" className="btn-secondary px-3 py-1.5" onClick={goBack}>
              &larr; Back
            </button>
          )}
          <button type="button" className="btn-secondary px-3 py-1.5" onClick={() => setCursor(startOfDay(new Date()))}>
            Today
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5"
            aria-label={`Previous ${view}`}
            onClick={() => setCursor((c) => shiftCursor(c, view, -1))}
          >
            <CaretLeftIcon width={14} height={14} />
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5"
            aria-label={`Next ${view}`}
            onClick={() => setCursor((c) => shiftCursor(c, view, 1))}
          >
            <CaretRightIcon width={14} height={14} />
          </button>
          <span className="ml-1 text-base font-semibold text-ink" aria-live="polite">
            {periodLabel(cursor, view)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <FilterSelect className="max-w-[140px]" aria-label="View" value={view} onChange={(e) => setView(e.target.value)}>
            {VIEW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            className="max-w-[160px]"
            aria-label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            className="max-w-[190px]"
            aria-label="Days Until Event"
            value={daysUntilFilter}
            onChange={(e) => setDaysUntilFilter(e.target.value)}
          >
            {DAYS_UNTIL_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-ink-muted">
        {LEGEND.map((item) => (
          <span key={item.color} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${COLOR_STYLES[item.color].swatch}`} /> {item.label}
          </span>
        ))}
      </div>

      {view === "day" && <DayView {...shared} />}
      {view === "week" && <WeekView {...shared} />}
      {view === "month" && <MonthView {...shared} />}
      {view === "quarter" && <QuarterView {...shared} onOpenMonth={openMonth} />}
      {view === "year" && <YearView {...shared} onOpenMonth={openMonth} />}

      <EventDetailsPopover
        event={eventPopover?.event}
        anchorRect={eventPopover?.anchorRect}
        onClose={closeEventPopover}
        onDeleteNote={deleteNote}
      />
      <AddNotePopover
        date={createPopover?.date}
        anchorRect={createPopover?.anchorRect}
        onClose={closeCreatePopover}
        onSave={saveNote}
      />
    </div>
  );
}
