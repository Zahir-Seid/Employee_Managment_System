// The up/down "sort" arrows shown next to a sortable column heading.
// Neutral (both arrows faint) until sorted; then the active direction is
// highlighted.
export function SortIcon({ dir }) {
  const up = dir === "asc";
  const down = dir === "desc";
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 9l4-4 4 4" stroke="currentColor" opacity={up ? 1 : down ? 0.25 : 0.5} />
      <path d="M8 15l4 4 4-4" stroke="currentColor" opacity={down ? 1 : up ? 0.25 : 0.5} />
    </svg>
  );
}

// Table heading with click-to-sort. `sort` is the object returned by
// useSort(). `className` defaults to the same classes the plain headings use.
export default function SortableTh({ label, sortKey, sort, className = "text-left px-4 py-3" }) {
  const active = sort.sortKey === sortKey;
  return (
    <th className={className} aria-sort={active ? (sort.sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => sort.toggle(sortKey)}
        className={"inline-flex items-center gap-1 uppercase tracking-[inherit] font-[inherit] hover:text-ink " + (active ? "text-ink" : "")}
      >
        {label}
        <SortIcon dir={active ? sort.sortDir : null} />
      </button>
    </th>
  );
}
