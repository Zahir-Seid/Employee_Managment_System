// EMS Reporting System spec §23/24/25/38: proper loading (skeleton, not
// a blank page), empty (filters returned nothing, distinct from an
// actual zero), and error (retryable, no raw exception text) states,
// shared across every report page instead of each one inventing its own.

export function KpiSkeleton({ count = 6 }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="jm-card animate-pulse">
          <div className="h-3 w-2/3 bg-surface-muted rounded mb-3" />
          <div className="h-7 w-1/2 bg-surface-muted rounded" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="jm-card animate-pulse">
      <div className="h-3 w-1/3 bg-surface-muted rounded mb-4" />
      <div className="h-48 bg-surface-muted rounded" />
    </div>
  );
}

export function TableSkeleton({ rows = 6 }) {
  return (
    <div className="jm-card animate-pulse space-y-2">
      <div className="h-3 w-1/4 bg-surface-muted rounded mb-3" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 bg-surface-muted rounded" />
      ))}
    </div>
  );
}

export function ReportEmptyState({ title = "No data found", message = "There are no records matching the selected filters.", onClear }) {
  return (
    <div className="jm-card flex flex-col items-center justify-center text-center py-14">
      <p className="text-base font-semibold text-ink mb-1">{title}</p>
      <p className="text-sm text-ink-muted mb-4 max-w-sm">{message}</p>
      {onClear && (
        <button type="button" className="btn-secondary" onClick={onClear}>
          Clear Filters
        </button>
      )}
    </div>
  );
}

export function ReportErrorState({ onRetry }) {
  return (
    <div className="jm-card flex flex-col items-center justify-center text-center py-14">
      <p className="text-base font-semibold text-ink mb-1">Unable to load report data.</p>
      <p className="text-sm text-ink-muted mb-4 max-w-sm">Something went wrong while retrieving the report.</p>
      {onRetry && (
        <button type="button" className="jm-btn-primary" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
