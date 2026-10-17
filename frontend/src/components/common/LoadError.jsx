/**
 * Shown in place of a page's content when its initial data fetch fails.
 * Several pages previously only showed a toast on a failed load and then
 * stayed stuck on an infinite loading spinner forever (the toast
 * auto-dismisses after a few seconds, leaving no visible explanation or
 * way to retry). This makes the failure and a retry action permanent
 * parts of the page itself.
 */
export default function LoadError({ message, onRetry }) {
  return (
    <div className="max-w-lg mx-auto mt-16 text-center space-y-4">
      <h2 className="text-lg text-ink">Something went wrong</h2>
      <p className="text-sm text-ink-muted">{message}</p>
      {onRetry && (
        <button className="btn-primary" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
