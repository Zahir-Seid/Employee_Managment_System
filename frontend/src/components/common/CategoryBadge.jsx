import { CATEGORY_DOT_CLASS, CATEGORY_LABELS } from "../../utils/format";

export default function CategoryBadge({ category }) {
  if (!category) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink">
      <span className={`h-2 w-2 rounded-full ${CATEGORY_DOT_CLASS[category] || "bg-ink-faint"}`} />
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}
