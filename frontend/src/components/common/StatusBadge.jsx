const VARIANTS = {
  logged: "bg-navy-50 text-navy-700",
  upcoming: "bg-pill-tealLight text-pill-teal",
  ongoing: "bg-navy-50 text-navy-700",
  held: "bg-pill-purpleLight text-pill-purple",
  completed: "bg-success/10 text-success",
  postponed: "bg-pill-warningLight text-pill-warning",
  cancelled: "bg-pill-neutralBg text-pill-neutralText",
  pending: "bg-pill-warningLight text-pill-warning",
  overdue: "bg-pill-dangerLight text-pill-danger",
  draft: "bg-pill-purpleLight text-pill-purple",
  urgent: "bg-warning/10 text-warning",
  standard: "bg-surface-sunken text-ink-muted",
  requested: "bg-navy-50 text-navy-700",
  "not requested": "bg-surface-sunken text-ink-faint",
  "pending submission": "bg-pill-warningLight text-pill-warning",
  // Support Requests Enhancement: status + priority badges.
  high: "bg-pill-warningLight text-pill-warning",
  normal: "bg-surface-sunken text-ink-muted",
  unassigned: "bg-pill-warningLight text-pill-warning",
  assigned: "bg-pill-tealLight text-pill-teal",
  "in progress": "bg-navy-50 text-navy-700",
  "needs clarification": "bg-pill-purpleLight text-pill-purple",
  "clarification provided": "bg-pill-tealLight text-pill-teal",
  "on hold": "bg-pill-neutralBg text-pill-neutralText",
  declined: "bg-pill-dangerLight text-pill-danger",
};

export default function StatusBadge({ label }) {
  const key = (label || "").toLowerCase();
  const exact = VARIANTS[key];
  const partial = !exact && Object.keys(VARIANTS).find((k) => key.includes(k));
  const classes = exact || VARIANTS[partial] || "bg-surface-sunken text-ink-muted";
  return (
    <span className={`jm-status-pill ${classes}`}>
      {label}
    </span>
  );
}
