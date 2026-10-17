// EMS Reporting System spec §32: exports must reflect exactly what's
// on screen, same filters, same rows. This builds a CSV client-side
// from the exact rows/columns the report table is already showing
// (post-filter, post-search), so there's no separate export code path
// that could drift from what the person is actually looking at.
//
// PDF and Excel are NOT implemented here, those go through the
// dedicated docx/pdf/excel generation pipeline (see
// backend/apps/reports/services/{pdf,docx,excel}_generator.py), which
// isn't wired to this filtered Management Report yet. CSV is genuinely
// simple enough to do correctly client-side without that pipeline; PDF
// and Excel are not, so they stay honestly unavailable here rather than
// faked with a low-effort approximation.
export function exportRowsToCsv(filename, columns, rows) {
  const escape = (value) => {
    const str = value == null ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const header = columns.map((c) => escape(c.label)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => escape(c.csvValue ? c.csvValue(row) : c.render ? "" : row[c.key])).join(",")
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
