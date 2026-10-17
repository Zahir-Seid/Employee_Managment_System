import { useEffect, useMemo, useRef, useState } from "react";
import { MANUAL_LABEL, MANUAL_OPTION } from "../../utils/worldLocations.js";

// A dropdown you can TYPE in to search, for long lists (countries, cities).
// Click or focus it and start typing; arrow keys + Enter pick, Esc closes.
// With allowManual, the last choice is "Other / Enter manually" (value "Other"),
// which the parent answers by showing a plain text box.
// A value that isn't in `options` (e.g. an older saved location) is still shown.

const MAX_SHOWN = 100;

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
  allowManual = true,
  id,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapperRef = useRef(null);

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    const found = q ? options.filter((o) => normalize(o).includes(q)) : options;
    return found;
  }, [options, query]);
  const shown = matches.slice(0, MAX_SHOWN);
  const choices = allowManual ? [...shown, MANUAL_OPTION] : shown;

  useEffect(() => {
    function onDocumentMouseDown(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, []);

  function pick(choice) {
    onChange(choice);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, choices.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && choices[active] !== undefined) {
      e.preventDefault();
      pick(choices[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  const shownValue = value === MANUAL_OPTION ? MANUAL_LABEL : value || "";

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        className="form-input pr-8"
        disabled={disabled}
        placeholder={open ? "Type to search..." : placeholder}
        value={open ? query : shownValue}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint text-xs" aria-hidden="true">
        &#9662;
      </span>
      {open && !disabled && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-white py-1 shadow-lg"
        >
          {choices.map((choice, i) => (
            <li
              key={choice}
              role="option"
              aria-selected={choice === value}
              className={
                "cursor-pointer px-3 py-2 text-sm " +
                (i === active ? "bg-ems-primaryLight text-ink " : "text-ink hover:bg-surface-muted ") +
                (choice === MANUAL_OPTION ? "border-t border-line font-medium" : "")
              }
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(choice);
              }}
            >
              {choice === MANUAL_OPTION ? MANUAL_LABEL : choice}
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-3 py-2 text-xs text-ink-faint">No match - choose "{MANUAL_LABEL}" below to type it in.</li>
          )}
          {matches.length > MAX_SHOWN && (
            <li className="px-3 py-2 text-xs text-ink-faint">
              Showing {MAX_SHOWN} of {matches.length}. Keep typing to narrow the list.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
