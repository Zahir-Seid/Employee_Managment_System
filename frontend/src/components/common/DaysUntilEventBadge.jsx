// Days Until Event: a small colored badge showing how many days remain
// until an event's start date (or "Today"/"Event Started"/"Event
// Passed"), used across every event/support-request list this feature
// touches. Reads `item.days_until_event`, the {code, label, color}
// object EventListSerializer/SupportRequestSerializer both expose ,
// rather than recomputing the date math client-side, so the badge can
// never drift from the backend's calculation.
const COLOR_CLASSES = {
  green: "bg-[#E1F5EE] text-[#1D9E75]",
  yellow: "bg-[#FDF6DD] text-[#B8860B]",
  orange: "bg-[#FDF1E3] text-[#E58A2E]",
  // Today / Event Started: blue (no red anywhere in this scheme).
  blue: "bg-[#E8F0FC] text-[#2563C4]",
  gray: "bg-surface-sunken text-ink-faint",
};

// "1 days" -> "1 day". The backend already sends the singular form; this
// keeps every display correct even if a stale/cached label slips through.
export function formatDaysLabel(label) {
  return typeof label === "string" ? label.replace(/^1 days$/i, "1 day") : label;
}

export default function DaysUntilEventBadge({ value }) {
  if (!value) return null;
  const className = COLOR_CLASSES[value.color] || COLOR_CLASSES.gray;
  return (
    <span className={`jm-status-pill ${className}`}>
      {formatDaysLabel(value.label)}
    </span>
  );
}

// The filter dropdown's options, in display order, shared so every
// list offers the exact same set/order/wording. "All" is the default,
// no-op choice and isn't sent as a query param at all.
export const DAYS_UNTIL_EVENT_OPTIONS = [
  { value: "", label: "All" },
  { value: "today", label: "Today" },
  { value: "within_3", label: "Within 3 Days" },
  { value: "within_7", label: "Within 7 Days" },
  { value: "within_14", label: "Within 14 Days" },
  { value: "more_than_14", label: "More Than 14 Days" },
  { value: "event_started", label: "Event Started" },
  { value: "event_passed", label: "Event Passed" },
];
