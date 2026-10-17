// Calendar helpers: local-date math (no UTC shifting - the old grid built
// its day keys with toISOString(), which is UTC and can land an event on
// the wrong day for anyone east of Greenwich), fiscal quarters, the Days
// Until Event -> color/phase mapping, and the layout that lets a
// multi-day event run as one continuous bar across its dates.

export const VIEW_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

export const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "upcoming", label: "Upcoming" },
  { value: "ongoing", label: "Ongoing" },
  { value: "held", label: "Held" },
];

// Days Until Event: mirrors apps.events.days_until.DAYS_UNTIL_EVENT_CHOICES
// / filter_by_days_until_event exactly (same bucket boundaries, same
// cumulative 3/7/14-day lookahead windows) so the Calendar's Days Until
// Event filter always agrees with the same dropdown on the Events list /
// Admin Events list / Communications Support Requests list. Works
// alongside the Status filter (both apply together), not instead of it.
export const DAYS_UNTIL_FILTER_OPTIONS = [
  { value: "all", label: "Any Days Until Event" },
  { value: "today", label: "Today" },
  { value: "within_3", label: "Within 3 Days" },
  { value: "within_7", label: "Within 7 Days" },
  { value: "within_14", label: "Within 14 Days" },
  { value: "more_than_14", label: "More Than 14 Days" },
  { value: "event_started", label: "Event Started" },
  { value: "event_passed", label: "Event Passed" },
];

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86400000;

export function parseDate(str) {
  const [y, m, d] = String(str).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function dateKey(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function diffDays(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / DAY_MS);
}

export function startOfWeek(d) {
  return addDays(d, -d.getDay());
}

export function sameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

// --- Quarters: EMS uses July-start fiscal quarters (Q1 = Jul-Sep, Q2 =
// Oct-Dec, Q3 = Jan-Mar, Q4 = Apr-Jun) - the same ones the Dashboard's
// Quarterly period uses. Each of them sits inside one calendar year. ---
const QUARTER_START_MONTH = { 1: 6, 2: 9, 3: 0, 4: 3 };

export function fiscalQuarterOf(d) {
  const q = ((((d.getMonth() - 6 + 12) % 12) / 3) | 0) + 1;
  return { quarter: q, start: new Date(d.getFullYear(), QUARTER_START_MONTH[q], 1) };
}

const monthName = (d, style = "long") => d.toLocaleDateString("en-US", { month: style });

// --- Navigation --------------------------------------------------------
export function shiftCursor(cursor, view, direction) {
  switch (view) {
    case "day":
      return addDays(cursor, direction);
    case "week":
      return addDays(cursor, 7 * direction);
    case "month":
      return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
    case "quarter":
      return new Date(fiscalQuarterOf(cursor).start.getFullYear(), fiscalQuarterOf(cursor).start.getMonth() + 3 * direction, 1);
    default:
      return new Date(cursor.getFullYear() + direction, 0, 1);
  }
}

export function periodLabel(cursor, view) {
  if (view === "day") {
    return cursor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  if (view === "week") {
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    const short = { month: "short", day: "numeric" };
    if (start.getFullYear() === end.getFullYear()) {
      return `${start.toLocaleDateString("en-US", short)} to ${end.toLocaleDateString("en-US", short)}, ${end.getFullYear()}`;
    }
    return `${start.toLocaleDateString("en-US", { ...short, year: "numeric" })} to ${end.toLocaleDateString("en-US", { ...short, year: "numeric" })}`;
  }
  if (view === "month") return cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (view === "quarter") {
    const { quarter, start } = fiscalQuarterOf(cursor);
    const end = new Date(start.getFullYear(), start.getMonth() + 2, 1);
    return `Q${quarter}, ${monthName(start, "short")} to ${monthName(end, "short")} ${start.getFullYear()}`;
  }
  return String(cursor.getFullYear());
}

// --- Days Until Event -> phase + color ---------------------------------
// The backend's Event.days_until_event_display ({code, label, color}) is
// the single source of truth (it's also what the event-list badge shows),
// so the Calendar always agrees with it. The date fallback only covers a
// row that somehow arrives without it.
export function eventPhase(e) {
  const code = e.days_until_event?.code;
  if (code === "today" || code === "event_started") return "ongoing";
  if (code === "event_passed") return "held";
  if (code) return "upcoming";
  const today = startOfDay(new Date());
  if (today < e._start) return "upcoming";
  return today <= e._end ? "ongoing" : "held";
}

export function eventColorKey(e) {
  if (e.isNote) return "note";
  const c = e.days_until_event?.color;
  if (c) return c === "red" ? "blue" : c; // never red
  const phase = eventPhase(e);
  if (phase === "ongoing") return "blue";
  if (phase === "held") return "gray";
  const days = diffDays(e._start, new Date());
  if (days > 14) return "green";
  return days >= 8 ? "yellow" : "orange";
}

// Mirrors apps.events.days_until.filter_by_days_until_event's boundaries
// exactly, evaluated against each event's already-parsed `_start`/`_end`
// (see prepareEvents) instead of hitting the database, this only ever
// runs over the one page of events the Calendar already has loaded.
export function matchesDaysUntilFilter(e, value, today) {
  if (!value || value === "all") return true;
  const start = e._start;
  const end = e._end;
  if (value === "today") return sameDay(start, today);
  if (value === "within_3") return start > today && diffDays(start, today) <= 3;
  if (value === "within_7") return start > today && diffDays(start, today) <= 7;
  if (value === "within_14") return start > today && diffDays(start, today) <= 14;
  if (value === "more_than_14") return start > today && diffDays(start, today) > 14;
  if (value === "event_started") return start < today && end >= today;
  if (value === "event_passed") return end < today;
  return true;
}

// Solid bar colors for the grid + a soft chip for the details popup.
// (Yellow/amber and orange are deliberately far enough apart to tell at a
// glance; gray is the light "Held" gray.)
export const COLOR_STYLES = {
  green: { bar: "bg-pill-success text-white", swatch: "bg-pill-success", chip: "bg-[#E1F5EE] text-[#1D9E75]" },
  yellow: { bar: "bg-[#F2C230] text-[#3D2F00]", swatch: "bg-[#F2C230]", chip: "bg-[#FDF6DD] text-[#8A6A00]" },
  orange: { bar: "bg-[#E58A2E] text-white", swatch: "bg-[#E58A2E]", chip: "bg-[#FDF1E3] text-[#C56D12]" },
  blue: { bar: "bg-ems-primary text-white", swatch: "bg-ems-primary", chip: "bg-[#E8F0FC] text-[#1D4E9E]" },
  gray: { bar: "bg-[#DDE2EA] text-[#4B5563]", swatch: "bg-[#DDE2EA]", chip: "bg-surface-sunken text-ink-muted" },
  // Calendar quick-add notes (a title on a date): not an event, so it gets its own color.
  note: { bar: "bg-[#7C5CD6] text-white", swatch: "bg-[#7C5CD6]", chip: "bg-[#EFEAFB] text-[#5B3FB8]" },
};

export const LEGEND = [
  { color: "green", label: "More than 14 days" },
  { color: "yellow", label: "8-14 days" },
  { color: "orange", label: "1-7 days" },
  { color: "blue", label: "Today / Ongoing" },
  { color: "gray", label: "Held" },
  { color: "note", label: "Note" },
];

export function prepareEvents(rows) {
  return rows.map((e) => ({ ...e, _start: parseDate(e.start_date), _end: parseDate(e.end_date) }));
}

// Calendar quick-add notes become single-day pseudo-events so every view can
// draw them with the same code as an event (see `isNote` for the differences).
export function prepareNotes(notes) {
  return notes.map((n) => ({
    event_id: `note-${n.id}`,
    noteId: n.id,
    isNote: true,
    title: n.title,
    start_date: n.date,
    end_date: n.date,
    created_by_name: n.created_by_name,
    can_delete: n.can_delete,
    _start: parseDate(n.date),
    _end: parseDate(n.date),
  }));
}

// A multi-day event appears on the calendar ONLY on its start date (never
// repeated across its range); its full range is shown on its card/details.
// So "events on this period" means events that START in this period.
export function eventsOverlapping(events, from, to) {
  return events.filter((e) => e._start >= from && e._start <= to);
}

// --- Week layout ------------------------------------------------------
// One week (Sun-Sat) at a time: each event STARTING in it becomes a one-day
// segment in its start column, and segments are packed into lanes (rows) so
// events on the same day stack instead of covering each other.
// `clip` (optional {start, end}) trims segments to a date window - used
// so a compact month in the Quarter view doesn't repeat the neighbouring
// month's events in its leading/trailing days.
export function layoutWeek(events, weekStart, clip) {
  const weekEnd = addDays(weekStart, 6);
  const segments = [];
  for (const e of events) {
    // Only the start date: a multi-day event is not drawn across its range.
    if (e._start < weekStart || e._start > weekEnd) continue;
    if (clip && (e._start < clip.start || e._start > clip.end)) continue;
    const col = diffDays(e._start, weekStart);
    segments.push({ event: e, startCol: col, endCol: col, continuesLeft: false, continuesRight: false });
  }
  segments.sort(
    (a, b) =>
      a.startCol - b.startCol ||
      b.endCol - a.endCol ||
      a.event.title.localeCompare(b.event.title)
  );
  const laneEnds = [];
  for (const seg of segments) {
    let lane = laneEnds.findIndex((end) => end < seg.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(seg.endCol);
    } else {
      laneEnds[lane] = seg.endCol;
    }
    seg.lane = lane;
  }
  return { segments, laneCount: laneEnds.length };
}

export function monthWeeks(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const weeks = [];
  for (let w = startOfWeek(first); w <= last; w = addDays(w, 7)) weeks.push(w);
  return weeks;
}
