import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { COLOR_STYLES, eventColorKey, eventPhase } from "./calendarUtils.js";
import { XIcon } from "../../components/common/UiGlyphs.jsx";
import { formatDaysLabel } from "../../components/common/DaysUntilEventBadge.jsx";

// Google-style anchored bubble: positioned next to whatever was clicked
// (an event bar, an empty day cell, the "+ Add note" button) rather than
// a full-screen centered modal. Closes on outside click, Escape, or the
// page scrolling/resizing under it.
const PHASE_LABEL = { upcoming: "Upcoming", ongoing: "Ongoing", held: "Held" };
const POPOVER_WIDTH = 300;
const EST_HEIGHT = 280;
const MARGIN = 8;

function AnchoredPopover({ anchorRect, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    function handlePointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  if (!anchorRect) return null;

  let left = anchorRect.left;
  if (left + POPOVER_WIDTH > window.innerWidth - MARGIN) left = window.innerWidth - POPOVER_WIDTH - MARGIN;
  if (left < MARGIN) left = MARGIN;

  let top = anchorRect.bottom + 8;
  if (top + EST_HEIGHT > window.innerHeight - MARGIN) {
    top = anchorRect.top - EST_HEIGHT - 8;
    if (top < MARGIN) top = MARGIN;
  }

  return (
    <div
      ref={ref}
      role="dialog"
      style={{ position: "fixed", top, left, width: POPOVER_WIDTH, zIndex: 60 }}
      className="rounded-lg bg-white shadow-popover ring-1 ring-black/5 animate-panel-in overflow-hidden"
    >
      {children}
    </div>
  );
}

function formatDay(d) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

// The event-details bubble: same info and "View full event" link the old
// centered modal had, just anchored next to the event that was clicked.
export function EventDetailsPopover({ event, anchorRect, onClose, onDeleteNote }) {
  const [isDeleting, setIsDeleting] = useState(false);
  if (!event) return null;
  const colors = COLOR_STYLES[eventColorKey(event)];

  if (event.isNote) {
    async function handleDelete() {
      setIsDeleting(true);
      try {
        await onDeleteNote(event);
      } finally {
        setIsDeleting(false);
      }
    }
    return (
      <AnchoredPopover anchorRect={anchorRect} onClose={onClose}>
        <div className={"h-1.5 " + colors.swatch} />
        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold leading-snug text-ink break-words">{event.title}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded text-lg leading-none text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <XIcon width={14} height={14} />
            </button>
          </div>
          <span className={"jm-status-pill " + colors.chip}>Note</span>
          <dl className="space-y-1.5 text-xs">
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <dt className="text-ink-faint">Date</dt>
              <dd className="text-ink">{formatDay(event._start)}</dd>
            </div>
            {event.created_by_name && (
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <dt className="text-ink-faint">Added by</dt>
                <dd className="text-ink">{event.created_by_name}</dd>
              </div>
            )}
          </dl>
        </div>
        {event.can_delete && (
          <div className="flex justify-end border-t border-line bg-surface-muted/50 px-4 py-2.5">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="text-sm font-medium text-ink-muted hover:text-ink hover:underline disabled:opacity-60"
            >
              {isDeleting ? "Deleting..." : "Delete note"}
            </button>
          </div>
        )}
      </AnchoredPopover>
    );
  }

  const multiDay = event.start_date !== event.end_date;
  const rows = [
    ["Date", multiDay ? `${formatDay(event._start)} to ${formatDay(event._end)}` : formatDay(event._start)],
    ["Owner", event.owner_name],
    ["Thematic area", event.thematic_area],
    ["Location", event.location],
  ].filter(([, value]) => value);

  return (
    <AnchoredPopover anchorRect={anchorRect} onClose={onClose}>
      <div className={"h-1.5 " + colors.swatch} />
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold leading-snug text-ink">{event.title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded text-lg leading-none text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <XIcon width={14} height={14} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className={"jm-status-pill " + colors.chip}>{PHASE_LABEL[eventPhase(event)]}</span>
          {event.days_until_event?.label && (
            <span className={"jm-status-pill " + colors.chip}>{formatDaysLabel(event.days_until_event.label)}</span>
          )}
          {event.category && (
            <span className="jm-status-pill bg-surface-muted text-ink-muted">{event.category}</span>
          )}
        </div>

        <dl className="space-y-1.5 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[80px_1fr] gap-2">
              <dt className="text-ink-faint">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex justify-end border-t border-line bg-surface-muted/50 px-4 py-2.5">
        <Link to={`/events/${event.event_id}`} className="text-sm font-medium text-ems-primary hover:underline">
          View full event &rarr;
        </Link>
      </div>
    </AnchoredPopover>
  );
}

// The quick-add bubble for clicking an empty day (or "+ Add event" in the Day
// view): title only, like Google's quick-add. It saves a note on that date
// straight away, so it shows up on the calendar at once.
export function AddNotePopover({ date, anchorRect, onClose, onSave }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // A fresh, empty bubble every time a (new) day is clicked.
  useEffect(() => {
    setTitle("");
    setError("");
    setIsSaving(false);
  }, [date]);

  if (!date) return null;

  async function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Please type a title.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await onSave(trimmed, date);
    } catch (err) {
      setError(err?.message || "Could not save. Please try again.");
      setIsSaving(false);
    }
  }

  return (
    <AnchoredPopover anchorRect={anchorRect} onClose={onClose}>
      <div className="space-y-3 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
        <input
          autoFocus
          type="text"
          value={title}
          maxLength={255}
          onChange={(e) => {
            setTitle(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isSaving) save();
          }}
          placeholder="Add a title"
          className="form-input w-full"
        />
        {error && <p className="form-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={save} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </AnchoredPopover>
  );
}
