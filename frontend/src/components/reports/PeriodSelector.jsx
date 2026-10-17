// Shared period filter, same segmented-button look and sub-controls as
// the Dashboard's own Weekly/Monthly/Quarterly/Yearly toggle (see
// pages/Dashboard/Dashboard.jsx), factored out here so the Management
// Report can match it exactly without duplicating the markup. Unlike the
// Dashboard (which computes date_from/date_to client-side for its own
// endpoint), this hands period/week/month/quarter/year straight to the
// Management Report endpoint, which already resolves them itself via
// resolve_period_range on the backend, so there's no date math here at all.

const PERIODS = ["weekly", "monthly", "quarterly", "yearly"];

const QUARTERS = [
  { value: 1, label: "Q1 (Jul-Sep)" },
  { value: 2, label: "Q2 (Oct-Dec)" },
  { value: 3, label: "Q3 (Jan-Mar)" },
  { value: 4, label: "Q4 (Apr-Jun)" },
];

const WEEKS_OF_MONTH = [
  { value: 1, label: "Week 1 (1-7)" },
  { value: 2, label: "Week 2 (8-14)" },
  { value: 3, label: "Week 3 (15-21)" },
  { value: 4, label: "Week 4 (22-end)" },
];

const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" }, { value: 3, label: "March" },
  { value: 4, label: "April" }, { value: 5, label: "May" }, { value: 6, label: "June" },
  { value: 7, label: "July" }, { value: 8, label: "August" }, { value: 9, label: "September" },
  { value: 10, label: "October" }, { value: 11, label: "November" }, { value: 12, label: "December" },
];

export default function PeriodSelector({ period, selection, onPeriodChange, onSelectionChange }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-ink-muted">Period:</span>
      <div className="inline-flex rounded-lg border border-[#E5E9F0] overflow-hidden">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPeriodChange(p)}
            className={
              "px-3 py-1.5 text-sm capitalize " +
              (period === p ? "bg-ems-primary text-white" : "bg-white text-ink-muted hover:bg-[#F1F4F9]")
            }
          >
            {p}
          </button>
        ))}
      </div>

      <div className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E9F0] bg-white px-2 py-1">
        {period === "weekly" && (
          <select
            className="form-input max-w-[160px] py-1"
            value={selection.week}
            onChange={(e) => onSelectionChange({ week: Number(e.target.value) })}
          >
            {WEEKS_OF_MONTH.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </select>
        )}
        {(period === "weekly" || period === "monthly") && (
          <select
            className="form-input max-w-[140px] py-1"
            value={selection.month}
            onChange={(e) => onSelectionChange({ month: Number(e.target.value) })}
          >
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        )}
        {period === "quarterly" && (
          <select
            className="form-input max-w-[160px] py-1"
            value={selection.quarter}
            onChange={(e) => onSelectionChange({ quarter: Number(e.target.value) })}
          >
            {QUARTERS.map((q) => (
              <option key={q.value} value={q.value}>{q.label}</option>
            ))}
          </select>
        )}
        <input
          type="number"
          className="form-input max-w-[90px] py-1"
          value={selection.year}
          onChange={(e) => onSelectionChange({ year: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}
