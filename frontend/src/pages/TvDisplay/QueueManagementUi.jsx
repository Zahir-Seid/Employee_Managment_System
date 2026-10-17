import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Small UI pieces for managing TV Display queues (rows in TV Display
// Settings > "Sections & order"): the ⋮ actions menu, the inline editor
// panel that opens under a row, and the "Automatic"/"Custom" badges.
// Presentation only, every action still runs through the same handlers in
// TVDisplaySettingsPanel.jsx.

const ICON_PATHS = {
  preview: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  timing: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  content: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  period: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  rename: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  delete: (
    <>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7Z" />,
};

export function MenuIcon({ name, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// "Automatic" = the system builds this queue from live EMS data (nothing
// for a person to add); "Custom" = an admin-created queue.
export function QueueBadge({ kind }) {
  if (kind === "automatic") {
    return (
      <span
        title="Generated automatically from live EMS data - there's nothing to add by hand."
        className="inline-flex items-center gap-1 rounded-full bg-ems-primaryLight text-ems-primaryLightText text-[11px] font-semibold px-2 py-0.5 shrink-0"
      >
        <MenuIcon name="bolt" size={11} />
        Automatic
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-surface-muted text-ink-muted text-[11px] font-semibold px-2 py-0.5 shrink-0">
      Custom
    </span>
  );
}

const itemBase =
  "w-full flex items-center gap-3 px-4 py-2 text-sm text-left text-ink transition-colors " +
  "hover:bg-surface-muted focus:outline-none focus-visible:bg-surface-muted disabled:opacity-40 disabled:cursor-not-allowed";

// The ⋮ menu for one queue row. Owns its own open/closed state, so it can
// never be left open by another row's state, and closes on EVERY way out:
// picking an item (including the Content source toggle, which used to leave
// it hanging open), clicking anywhere else, or pressing Escape. Keyboard:
// arrow keys/Home/End move between items, Tab leaves the menu (closing it),
// and focus goes back to the ⋮ button when it closes via Escape.
//
// `groups`: [{ title?, items: [...] }], each item one of:
//   { label, icon, hint?, onSelect, danger?, disabled? }   -> button
//   { label, icon, hint?, href }                           -> link (new tab)
//   { type: "segmented", label, value, options: [{value, label}], onChange }
//   { type: "info", label, value }                         -> read-only row
export function QueueActionsMenu({ label, badges, groups }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const close = useCallback((returnFocus) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onMouseDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Open upward when there isn't room below (e.g. the last rows on a short
  // screen) instead of running off the bottom of the page.
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !buttonRef.current) return;
    const menuHeight = menuRef.current.offsetHeight;
    const rect = buttonRef.current.getBoundingClientRect();
    const roomBelow = window.innerHeight - rect.bottom;
    setOpenUp(roomBelow < menuHeight + 16 && rect.top > menuHeight + 16);
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);

  function onMenuKeyDown(e) {
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]:not([disabled]), [role="menuitemradio"]')];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement);
    let next = current;
    if (e.key === "ArrowDown") next = (current + 1) % items.length;
    if (e.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = items.length - 1;
    items[next].focus();
  }

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Actions"
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          "h-8 w-8 grid place-items-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ems-primary/40 " +
          (open ? "bg-surface-muted text-ink" : "text-ink-faint hover:text-ink hover:bg-surface-muted")
        }
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${label}`}
          onKeyDown={onMenuKeyDown}
          className={
            "absolute right-0 z-30 w-72 rounded-xl border border-line bg-white shadow-popover py-1.5 animate-menu-pop " +
            (openUp ? "bottom-full mb-1.5 origin-bottom-right" : "top-full mt-1.5 origin-top-right")
          }
        >
          <div className="px-4 pt-1.5 pb-2.5 flex items-center gap-2 min-w-0">
            <p className="text-sm font-semibold text-ink truncate">{label}</p>
            {badges}
          </div>

          {groups
            .filter((g) => g.items.length > 0)
            .map((group, gi) => (
              <div key={group.title || gi} className="border-t border-line pt-1 mt-0.5">
                {group.title && (
                  <p className="px-4 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {group.title}
                  </p>
                )}
                {group.items.map((item) => {
                  if (item.type === "info") {
                    return (
                      <div key={item.label} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                        <span className="text-ink-muted">{item.label}</span>
                        <span className="text-xs text-ink-faint capitalize">{item.value}</span>
                      </div>
                    );
                  }
                  if (item.type === "segmented") {
                    return (
                      <div key={item.label} className="px-4 py-2">
                        <p className="text-xs font-medium text-ink-muted mb-1.5">{item.label}</p>
                        <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-muted p-1" role="group">
                          {item.options.map((o) => {
                            const selected = item.value === o.value;
                            return (
                              <button
                                key={o.value}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                title={o.title}
                                onClick={() => {
                                  item.onChange(o.value);
                                  close(true);
                                }}
                                className={
                                  "rounded-md py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ems-primary/40 " +
                                  (selected
                                    ? "bg-white text-ems-primary shadow-sm"
                                    : "text-ink-muted hover:text-ink")
                                }
                              >
                                {o.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  const content = (
                    <>
                      <span className={item.danger ? "text-ink" : "text-ink-muted"}>
                        <MenuIcon name={item.icon} />
                      </span>
                      <span className="flex-1 min-w-0 truncate">{item.label}</span>
                      {item.hint && <span className="text-xs text-ink-faint shrink-0">{item.hint}</span>}
                    </>
                  );
                  if (item.href) {
                    return (
                      <a
                        key={item.label}
                        role="menuitem"
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        title={item.title}
                        onClick={() => close(false)}
                        className={itemBase}
                      >
                        {content}
                      </a>
                    );
                  }
                  return (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      title={item.title}
                      disabled={item.disabled}
                      onClick={() => {
                        close(false);
                        item.onSelect();
                      }}
                      className={itemBase}
                    >
                      {content}
                    </button>
                  );
                })}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// The editor that opens under a queue row (Timing, Analytics period, Rename,
// Manage content). One shape for all of them: a titled card with an explicit
// close button, so there's always an obvious way to put it away. Escape also
// closes it, except for the content editor (`closeOnEscape={false}`), where
// it could throw away a half-written slide.
export function EditorPanel({ title, subtitle, onClose, closeLabel = "Done", closeOnEscape = true, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Move focus into the editor (unless a field inside already grabbed it
    // with autoFocus) - so keyboard users land in it and Escape works right
    // away, instead of focus being stranded on the menu item that opened it.
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  function onKeyDown(e) {
    if (closeOnEscape && e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div ref={ref} tabIndex={-1} onKeyDown={onKeyDown} className="px-3 pb-3 pt-1 bg-pagebg/60 animate-panel-in outline-none">
      <div className="bg-white border border-line rounded-lg shadow-card">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink truncate">{title}</p>
            {subtitle && <p className="text-xs text-ink-faint truncate">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="jm-btn-secondary text-xs !px-3 !py-1 shrink-0">
            {closeLabel}
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
