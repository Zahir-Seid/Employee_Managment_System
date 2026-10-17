import { useMemo, useState } from "react";
import { ReportEmptyState } from "./ReportStates.jsx";
import { SortIcon } from "../common/SortableTh.jsx";

// EMS Reporting System spec §21: search, sort, pagination, column
// visibility, and clickable rows, one shared table instead of each
// report building its own. Search/sort/pagination run client-side here
// (the caller already has the full filtered row set in memory from the
// report API response), spec §30 asks for server-side pagination for
// "large datasets," which matters once a report fetches rows directly
// rather than as part of a broader report payload; noted as a follow-up
// rather than built speculatively now.
//
// `columns`: [{ key, label, render?(row), sortValue?(row), align?,
//   defaultVisible? }]. `getRowHref` / `onRowClick`: optional, makes a row
// open a record (spec's Table to Individual Record drill-down step).
export default function ReportDataTable({ columns, rows, getRowKey, onRowClick, pageSize = 10, searchPlaceholder = "Search..." }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [visibleCols, setVisibleCols] = useState(() =>
    Object.fromEntries(columns.map((c) => [c.key, c.defaultVisible !== false]))
  );
  const [colMenuOpen, setColMenuOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((row) =>
      columns.some((c) => {
        if (!visibleCols[c.key]) return false;
        const text = c.searchValue ? c.searchValue(row) : c.render ? undefined : row[c.key];
        return text != null && String(text).toLowerCase().includes(q);
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const getVal = col.sortValue || ((row) => row[sortKey]);
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    });
    if (sortDir === "desc") copy.reverse();
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
  const activeColumns = columns.filter((c) => visibleCols[c.key]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          type="text"
          className="form-input max-w-xs"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <div className="relative">
          <button type="button" className="btn-secondary text-sm" onClick={() => setColMenuOpen((v) => !v)}>
            Columns
          </button>
          {colMenuOpen && (
            <div className="absolute z-20 top-full mt-1 right-0 w-56 bg-white border border-line rounded-lg shadow-lg p-3 space-y-1.5">
              {columns.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!visibleCols[c.key]}
                    onChange={() => setVisibleCols((v) => ({ ...v, [c.key]: !v[c.key] }))}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <ReportEmptyState title="No records found." message="Try adjusting your search or filters." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint uppercase tracking-wide">
                  {activeColumns.map((c) => (
                    <th
                      key={c.key}
                      className={"pb-1.5 pr-3 select-none " + (c.align === "right" ? "text-right" : "") + (c.sortValue || !c.render ? " cursor-pointer hover:text-ink" : "")}
                      onClick={() => (c.sortValue || !c.render) && handleSort(c.key)}
                    >
                      {c.label}
                      {(c.sortValue || !c.render) && (
                        <span className="ml-1 inline-block align-middle">
                          <SortIcon dir={sortKey === c.key ? sortDir : null} />
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pageRows.map((row) => (
                  <tr
                    key={getRowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? "cursor-pointer hover:bg-surface-muted" : ""}
                  >
                    {activeColumns.map((c) => (
                      <td key={c.key} className={"py-1.5 pr-3 " + (c.align === "right" ? "text-right" : "")}>
                        {c.render ? c.render(row) : row[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1 text-sm text-ink-muted">
              <span>
                {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, sorted.length)} of {sorted.length}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-secondary text-xs px-2 py-1" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="btn-secondary text-xs px-2 py-1"
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
