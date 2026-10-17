import { useMemo } from "react";
import {
  COLOR_STYLES,
  WEEKDAYS,
  addDays,
  dateKey,
  eventColorKey,
  eventPhase,
  eventsOverlapping,
  fiscalQuarterOf,
  layoutWeek,
  monthWeeks,
  sameDay,
  startOfWeek,
} from "./calendarUtils.js";
import { formatDaysLabel } from "../../components/common/DaysUntilEventBadge.jsx";

// The five Calendar views. All of them are fed the same (already status-
// filtered) list of events and report clicks back up: an event click opens
// the details popup, a day click drills into that day.

const PHASE_LABEL = { upcoming: "Upcoming", ongoing: "Ongoing", held: "Held" };

function EventBar({ seg, compact, onSelect }) {
  const e = seg.event;
  const colors = COLOR_STYLES[eventColorKey(e)];
  const label = e.isNote
    ? `${e.title} - Note`
    : `${e.title} - ${PHASE_LABEL[eventPhase(e)]}${e.days_until_event?.label ? ` (${formatDaysLabel(e.days_until_event.label)})` : ""}${
        e.start_date !== e.end_date ? ` - ${rangeText(e)}` : ""
      }`;
  return (
    <button
      type="button"
      onClick={(domEvent) => onSelect(e, domEvent)}
      title={label}
      aria-label={label}
      style={{ gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`, gridRow: seg.lane + 1 }}
      className={
        "pointer-events-auto mx-px my-px min-w-0 truncate text-left transition-opacity hover:opacity-85 " +
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ems-primary/60 " +
        colors.bar +
        (compact ? " leading-none" : " text-xs font-medium leading-5 px-1.5") +
        (seg.continuesLeft ? "" : " rounded-l") +
        (seg.continuesRight ? "" : " rounded-r")
      }
    >
      {compact ? null : e.title}
    </button>
  );
}

// One Sun-Sat row: a background layer of day cells (borders, day numbers)
// under a foreground grid where each event is one bar spanning its columns
// - so a multi-day event is drawn once, across its whole date range,
// instead of a separate chip repeated in every day's cell.
function WeekRow({
  weekStart,
  events,
  today,
  maxLanes = 3,
  showNumbers = true,
  minHeight = 112,
  focusMonth = null,
  clip = null,
  compact = false,
  onSelectEvent,
  onSelectDay,
  onCreateDay,
}) {
  const days = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i)), [weekStart]);
  const { segments, laneCount } = useMemo(() => layoutWeek(events, weekStart, clip), [events, weekStart, clip]);

  const capped = laneCount > maxLanes;
  const visible = segments.filter((s) => s.lane < maxLanes);
  const hiddenPerDay = days.map((_, i) => segments.filter((s) => s.lane >= maxLanes && s.startCol <= i && s.endCol >= i).length);
  const laneHeight = compact ? 9 : 24;

  return (
    <div className="relative border-b border-line last:border-b-0" style={{ minHeight }}>
      <div className="absolute inset-0 grid grid-cols-7">
        {days.map((d) => {
          const outside = focusMonth !== null && d.getMonth() !== focusMonth;
          const clipped = clip && (d < clip.start || d > clip.end);
          const isToday = sameDay(d, today);
          // Past days are only greyed out to show they've passed; they stay
          // fully clickable (no restriction on logging for them).
          const isPast = !isToday && d < today;
          return (
            <div
              key={dateKey(d)}
              onClick={clipped ? undefined : (domEvent) => onCreateDay(d, domEvent)}
              title={clipped ? undefined : "Click to add a note"}
              className={
                "border-r border-line last:border-r-0 " +
                (clipped ? "" : "cursor-pointer ") +
                ((outside || isPast) && !clipped ? "bg-surface-muted/60" : "")
              }
            >
              {showNumbers && !clipped && (
                <button
                  type="button"
                  onClick={(domEvent) => {
                    domEvent.stopPropagation();
                    onSelectDay(d);
                  }}
                  title={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                  className={
                    "m-1 grid place-items-center rounded-full text-xs font-semibold leading-none transition-colors " +
                    (compact ? "h-5 min-w-5 px-1 " : "h-6 min-w-6 px-1.5 ") +
                    (isToday
                      ? "bg-ems-primary text-white"
                      : (outside || isPast ? "text-ink-faint " : "text-ink-muted ") + "hover:bg-surface-muted")
                  }
                >
                  {d.getDate()}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="relative pointer-events-none" style={{ paddingTop: showNumbers ? (compact ? 28 : 34) : 6, paddingBottom: 6 }}>
        <div className="grid grid-cols-7" style={{ gridAutoRows: laneHeight }}>
          {visible.map((seg) => (
            <EventBar key={`${seg.event.event_id}-${seg.startCol}`} seg={seg} compact={compact} onSelect={onSelectEvent} />
          ))}
          {capped &&
            hiddenPerDay.map(
              (n, i) =>
                n > 0 && (
                  <button
                    key={`more-${i}`}
                    type="button"
                    onClick={() => onSelectDay(days[i])}
                    style={{ gridColumn: i + 1, gridRow: maxLanes + 1 }}
                    className="pointer-events-auto px-1.5 text-left text-[11px] font-medium leading-5 text-ink-muted hover:text-ems-primary"
                  >
                    +{n} more
                  </button>
                )
            )}
        </div>
      </div>
    </div>
  );
}

function WeekdayHeader({ compact }) {
  return (
    <div className={"grid grid-cols-7 bg-surface-muted font-semibold uppercase tracking-wide text-ink-faint " + (compact ? "text-[10px]" : "text-xs")}>
      {WEEKDAYS.map((d) => (
        <div key={d} className={"text-center " + (compact ? "py-1" : "px-2 py-2")}>
          {compact ? d.slice(0, 1) : d}
        </div>
      ))}
    </div>
  );
}

function MonthGrid({ year, month, events, today, compact = false, clipToMonth = false, maxLanes = 3, onSelectEvent, onSelectDay, onCreateDay }) {
  const weeks = useMemo(() => monthWeeks(year, month), [year, month]);
  const clip = useMemo(
    () => (clipToMonth ? { start: new Date(year, month, 1), end: new Date(year, month + 1, 0) } : null),
    [clipToMonth, year, month]
  );
  return (
    <div>
      <WeekdayHeader compact={compact} />
      {weeks.map((w) => (
        <WeekRow
          key={dateKey(w)}
          weekStart={w}
          events={eventsOverlapping(events, w, addDays(w, 6))}
          today={today}
          maxLanes={maxLanes}
          minHeight={compact ? 48 : 112}
          focusMonth={month}
          clip={clip}
          compact={compact}
          onSelectEvent={onSelectEvent}
          onSelectDay={onSelectDay}
          onCreateDay={onCreateDay}
        />
      ))}
    </div>
  );
}

export function MonthView({ cursor, events, today, onSelectEvent, onSelectDay, onCreateDay }) {
  return (
    <div className="card !p-0 overflow-hidden">
      <MonthGrid
        year={cursor.getFullYear()}
        month={cursor.getMonth()}
        events={events}
        today={today}
        onSelectEvent={onSelectEvent}
        onSelectDay={onSelectDay}
        onCreateDay={onCreateDay}
      />
    </div>
  );
}

export function WeekView({ cursor, events, today, onSelectEvent, onSelectDay, onCreateDay }) {
  const weekStart = startOfWeek(cursor);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  const weekEvents = eventsOverlapping(events, weekStart, addDays(weekStart, 6));
  return (
    <div className="card !p-0 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line bg-surface-muted">
        {days.map((d) => {
          const isToday = sameDay(d, today);
          const isPast = !isToday && d < today; // greyed only, still clickable
          return (
            <button
              key={dateKey(d)}
              type="button"
              onClick={() => onSelectDay(d)}
              className={"border-r border-line px-2 py-2.5 text-center last:border-r-0 hover:bg-surface-sunken transition-colors" + (isPast ? " bg-surface-sunken/60" : "")}
            >
              <span className="block text-xs font-semibold uppercase tracking-wide text-ink-faint">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
              <span
                className={
                  "mx-auto mt-1 grid h-8 w-8 place-items-center rounded-full text-base font-semibold " +
                  (isToday ? "bg-ems-primary text-white" : isPast ? "text-ink-faint" : "text-ink")
                }
              >
                {d.getDate()}
              </span>
            </button>
          );
        })}
      </div>
      <WeekRow
        weekStart={weekStart}
        events={weekEvents}
        today={today}
        maxLanes={Infinity}
        showNumbers={false}
        minHeight={340}
        onSelectEvent={onSelectEvent}
        onSelectDay={onSelectDay}
        onCreateDay={onCreateDay}
      />
      {weekEvents.length === 0 && <p className="border-t border-line px-4 py-3 text-sm text-ink-faint">No events this week.</p>}
    </div>
  );
}

const rangeText = (e) => {
  const fmt = { month: "short", day: "numeric" };
  return e.start_date === e.end_date
    ? e._start.toLocaleDateString("en-US", fmt)
    : `${e._start.toLocaleDateString("en-US", fmt)} to ${e._end.toLocaleDateString("en-US", fmt)}`;
};

export function DayView({ cursor, events, onSelectEvent, onCreateDay }) {
  const list = eventsOverlapping(events, cursor, cursor).sort((a, b) => a._start - b._start || a.title.localeCompare(b.title));
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={(domEvent) => onCreateDay(cursor, domEvent)}
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          + Add note
        </button>
      </div>
      {list.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-base font-medium text-ink">Nothing scheduled</p>
          <p className="mt-1 text-sm text-ink-faint">There are no events on this day.</p>
        </div>
      ) : (
        list.map((e) => {
          const colors = COLOR_STYLES[eventColorKey(e)];
          return (
            <button
              key={e.event_id}
              type="button"
              onClick={(domEvent) => onSelectEvent(e, domEvent)}
              className="card !p-0 flex w-full items-stretch overflow-hidden text-left transition-shadow hover:shadow-popover focus:outline-none focus-visible:ring-2 focus-visible:ring-ems-primary/50"
            >
              <span className={"w-1.5 shrink-0 " + colors.swatch} />
              <span className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{e.title}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {e.isNote
                      ? e.created_by_name
                        ? `Added by ${e.created_by_name}`
                        : "Note"
                      : `${rangeText(e)}, ${e.category}${e.thematic_area ? `, ${e.thematic_area}` : ""}`}
                  </span>
                </span>
                <span className={"jm-status-pill shrink-0 " + colors.chip}>{e.isNote ? "Note" : PHASE_LABEL[eventPhase(e)]}</span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function MonthAgenda({ month, events, onSelectEvent, onOpenMonth }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const list = eventsOverlapping(events, first, last).sort((a, b) => a._start - b._start || a.title.localeCompare(b.title));
  const shown = list.slice(0, 5);
  return (
    <div className="border-t border-line px-3 py-2.5">
      {list.length === 0 && <p className="text-xs text-ink-faint">No events this month.</p>}
      <ul className="space-y-1">
        {shown.map((e) => (
          <li key={e.event_id}>
            <button
              type="button"
              onClick={(domEvent) => onSelectEvent(e, domEvent)}
              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-muted"
            >
              <span className={"h-2 w-2 shrink-0 rounded-full " + COLOR_STYLES[eventColorKey(e)].swatch} />
              <span className="min-w-0 flex-1 truncate text-ink">{e.title}</span>
              <span className="shrink-0 text-ink-faint">{rangeText(e)}</span>
            </button>
          </li>
        ))}
      </ul>
      {list.length > shown.length && (
        <button type="button" onClick={() => onOpenMonth(month)} className="mt-1 px-1 text-xs font-medium text-ems-primary hover:underline">
          +{list.length - shown.length} more
        </button>
      )}
    </div>
  );
}

export function QuarterView({ cursor, events, today, onSelectEvent, onSelectDay, onCreateDay, onOpenMonth }) {
  const { start } = fiscalQuarterOf(cursor);
  const months = [0, 1, 2].map((i) => new Date(start.getFullYear(), start.getMonth() + i, 1));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {months.map((m) => (
        <div key={dateKey(m)} className="card !p-0 flex flex-col overflow-hidden">
          <button
            type="button"
            onClick={() => onOpenMonth(m)}
            className="border-b border-line px-4 py-2.5 text-left text-sm font-semibold text-ink transition-colors hover:text-ems-primary"
          >
            {m.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </button>
          <MonthGrid
            year={m.getFullYear()}
            month={m.getMonth()}
            events={events}
            today={today}
            compact
            clipToMonth
            maxLanes={Infinity}
            onSelectEvent={onSelectEvent}
            onSelectDay={onSelectDay}
            onCreateDay={onCreateDay}
          />
          <MonthAgenda month={m} events={events} onSelectEvent={onSelectEvent} onOpenMonth={onOpenMonth} />
        </div>
      ))}
    </div>
  );
}

// Most urgent first, so a day with several events shows the colors that
// matter most.
const DOT_ORDER = ["blue", "orange", "yellow", "green", "gray", "note"];

function YearMonth({ month, dotsByDay, today, onSelectDay, onOpenMonth }) {
  const weeks = monthWeeks(month.getFullYear(), month.getMonth());
  return (
    <div className="card p-3">
      <button
        type="button"
        onClick={() => onOpenMonth(month)}
        className="mb-2 text-sm font-semibold text-ink transition-colors hover:text-ems-primary"
      >
        {month.toLocaleDateString("en-US", { month: "long" })}
      </button>
      <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-ink-faint">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-0.5">
            {d.slice(0, 1)}
          </span>
        ))}
      </div>
      {weeks.map((w) => (
        <div key={dateKey(w)} className="grid grid-cols-7">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const d = addDays(w, i);
            if (d.getMonth() !== month.getMonth()) return <span key={i} className="h-9" />;
            const dots = dotsByDay.get(dateKey(d)) || [];
            const isToday = sameDay(d, today);
            const isPast = !isToday && d < today; // greyed only, still clickable
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSelectDay(d)}
                title={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                className="flex h-9 flex-col items-center justify-start gap-0.5 rounded pt-0.5 transition-colors hover:bg-surface-muted"
              >
                <span
                  className={
                    "grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold leading-none " +
                    (isToday ? "bg-ems-primary text-white" : isPast ? "text-ink-faint" : "text-ink-muted")
                  }
                >
                  {d.getDate()}
                </span>
                <span className="flex h-1.5 items-center gap-0.5">
                  {dots.slice(0, 3).map((c) => (
                    <span key={c} className={"h-1.5 w-1.5 rounded-full " + COLOR_STYLES[c].swatch} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function YearView({ cursor, events, today, onSelectDay, onOpenMonth }) {
  const year = cursor.getFullYear();
  const dotsByDay = useMemo(() => {
    const map = new Map();
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);
    for (const e of eventsOverlapping(events, jan1, dec31)) {
      const color = eventColorKey(e);
      // Start date only (a multi-day event is not marked on every day).
      const key = dateKey(e._start);
      const list = map.get(key) || [];
      if (!list.includes(color)) list.push(color);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => DOT_ORDER.indexOf(a) - DOT_ORDER.indexOf(b));
    return map;
  }, [events, year]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => (
        <YearMonth key={m} month={new Date(year, m, 1)} dotsByDay={dotsByDay} today={today} onSelectDay={onSelectDay} onOpenMonth={onOpenMonth} />
      ))}
    </div>
  );
}
