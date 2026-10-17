import { useState } from "react";

// Client-side column sorting shared by every table with a sortable heading.
// `getters` maps a sort key to a function returning the value to sort by,
// e.g. { status: (row) => row.status_display }.
// Clicking a heading cycles ascending -> descending -> original order.
export function useSort(rows, getters) {
  const [sort, setSort] = useState({ key: null, dir: "asc" });

  function toggle(key) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return { key: null, dir: "asc" };
    });
  }

  let sortedRows = rows;
  const get = sort.key && getters[sort.key];
  if (get) {
    const factor = sort.dir === "asc" ? 1 : -1;
    sortedRows = [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * factor;
    });
  }

  return { rows: sortedRows, sortKey: sort.key, sortDir: sort.dir, toggle };
}
