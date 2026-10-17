export default function EmptyState({ title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4">
      <h3 className="text-base text-ink mb-1">{title}</h3>
      {message && <p className="text-sm text-ink-muted max-w-sm mb-4">{message}</p>}
      {action}
    </div>
  );
}
