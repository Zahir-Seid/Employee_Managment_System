import { useCallback, useEffect, useRef, useState } from "react";

// Shared toolbar controls for the main list pages (Events, Requested
// Supports, Audit Trail, Reports event picker), styled after the RPDMS list
// screens: an icon search field, filter dropdowns with a funnel icon, and a
// "View" menu that shows/hides table columns. Native <select> elements are
// kept underneath so keyboard/mobile behavior and existing onChange handlers
// stay exactly as they were.

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function FunnelIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="15" cy="7" r="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="17" r="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ChevronDown({ className = "" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ListSearch({ value, onChange, placeholder, className = "" }) {
  return (
    <div
      className={
        "relative w-full flex-1 min-w-[200px] " + (/(^|\s)max-w-/.test(className) ? "" : "max-w-[420px] ") + className
      }
    >
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
        <SearchIcon />
      </span>
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-line bg-surface pl-9 pr-3 py-2 text-sm text-ink placeholder-ink-faint outline-none transition-colors focus:border-ems-primary/50 focus:ring-1 focus:ring-ems-primary/30"
      />
    </div>
  );
}

export function FilterSelect({ className = "", children, ...selectProps }) {
  return (
    <div
      className={
        "relative inline-block flex-1 " +
        (/(^|\s)min-w-/.test(className) ? "" : "min-w-[120px] ") +
        (/(^|\s)max-w-/.test(className) ? "" : "max-w-[200px] ") +
        className
      }
    >
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
        <FunnelIcon />
      </span>
      <select
        {...selectProps}
        className="w-full appearance-none rounded-lg border border-line bg-surface pl-9 pr-8 py-2 text-sm font-medium text-ink outline-none transition-colors hover:bg-surface-muted focus:border-ems-primary/50 focus:ring-1 focus:ring-ems-primary/30"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted">
        <ChevronDown />
      </span>
    </div>
  );
}

// Column show/hide state, remembered per list in localStorage.
export function useColumnVisibility(storageKey) {
  const key = "ems.columns." + storageKey;
  const [hidden, setHidden] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  });

  const persist = useCallback(
    (next) => {
      try {
        window.localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        /* Non-critical: the choice just won't persist. */
      }
    },
    [key]
  );

  const toggle = useCallback(
    (col) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(col)) next.delete(col);
        else next.add(col);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const reset = useCallback(() => {
    const next = new Set();
    setHidden(next);
    persist(next);
  }, [persist]);

  const isVisible = useCallback((col) => !hidden.has(col), [hidden]);
  return { hidden, isVisible, toggle, reset };
}

// "View" dropdown. `columns` = [{ key, label, locked? }]; locked columns
// (e.g. the title and the actions column) are always shown.
export function ColumnsMenu({ columns, isVisible, onToggle, onReset, hidden }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
      >
        <SlidersIcon />
        View
        <ChevronDown className="text-ink-muted" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-line bg-surface p-2 shadow-popover">
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-wider text-ink-faint">Columns</p>
          {columns.map((col) => (
            <label
              key={col.key}
              className={
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink " +
                (col.locked ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-surface-muted")
              }
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line accent-[rgb(var(--ems-primary))]"
                checked={col.locked ? true : isVisible(col.key)}
                disabled={col.locked}
                onChange={() => onToggle(col.key)}
              />
              {col.label}
            </label>
          ))}
          {hidden.size > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-ems-primary hover:bg-surface-muted"
            >
              Show all columns
            </button>
          )}
        </div>
      )}
    </div>
  );
}
