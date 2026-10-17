// Table footer in the RPDMS list style: "Showing 1 – 20 of 57 results" on the
// left, first / previous / numbered pages / next / last on the right. Same
// props as before, so every existing call site keeps working. Unlike the old
// footer it also shows on a single page (as long as there are results).

function Glyph({ d, double }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {double && (
        <path d={double} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function pageItems(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const items = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) items.push("gap-start");
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < totalPages - 1) items.push("gap-end");
  items.push(totalPages);
  return items;
}

const BTN =
  "inline-flex h-8 min-w-[2rem] items-center justify-center rounded-lg border px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const BTN_IDLE = "border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink";

export default function Pagination({ count, pageSize = 20, page, onPageChange }) {
  if (!count) return null;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const first = (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, count);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
      <span className="text-ink-muted">
        Showing <span className="font-semibold text-ink">{first}</span> –{" "}
        <span className="font-semibold text-ink">{last}</span> of{" "}
        <span className="font-semibold text-ink">{count}</span> {count === 1 ? "result" : "results"}
      </span>
      <nav className="flex items-center gap-1.5" aria-label="Pagination">
        <button
          type="button"
          className={`${BTN} ${BTN_IDLE}`}
          disabled={current <= 1}
          onClick={() => onPageChange(1)}
          aria-label="First page"
        >
          <Glyph d="M11 7l-5 5 5 5" double="M18 7l-5 5 5 5" />
        </button>
        <button
          type="button"
          className={`${BTN} ${BTN_IDLE}`}
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
          aria-label="Previous page"
        >
          <Glyph d="M15 6l-6 6 6 6" />
        </button>
        {pageItems(current, totalPages).map((item) =>
          typeof item === "string" ? (
            <span key={item} className="px-1 text-ink-faint" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-label={`Page ${item}`}
              aria-current={item === current ? "page" : undefined}
              className={
                BTN +
                " " +
                (item === current ? "border-ems-primary bg-ems-primary text-white" : BTN_IDLE)
              }
            >
              {item}
            </button>
          )
        )}
        <button
          type="button"
          className={`${BTN} ${BTN_IDLE}`}
          disabled={current >= totalPages}
          onClick={() => onPageChange(current + 1)}
          aria-label="Next page"
        >
          <Glyph d="M9 6l6 6-6 6" />
        </button>
        <button
          type="button"
          className={`${BTN} ${BTN_IDLE}`}
          disabled={current >= totalPages}
          onClick={() => onPageChange(totalPages)}
          aria-label="Last page"
        >
          <Glyph d="M13 7l5 5-5 5" double="M6 7l5 5-5 5" />
        </button>
      </nav>
    </div>
  );
}
