import { KPI_TONES } from "./kpiTones.js";

/**
 * Section title + one-line description that sits above a block of content
 * (usually a row of KPI cards). Matches the RPDMS dashboard reference:
 * a soft tinted icon chip on the left, a bold uppercase title, and a
 * muted description underneath.
 *
 * Props:
 *   title       - short section name (rendered uppercase via CSS)
 *   description - one line explaining what the section shows
 *   icon        - optional icon component (16px outline icons from DashboardIcons)
 *   tone        - key of KPI_TONES; defaults to "blue"
 *   action      - optional node aligned to the right (a link or button)
 */
export default function SectionHeader({ title, description, icon: Icon, tone = "blue", action, className = "" }) {
  const toneStyle = KPI_TONES[tone] || KPI_TONES.blue;
  return (
    <div className={"flex items-center justify-between gap-4 " + className}>
      <div className="flex items-center gap-4 min-w-0">
        {Icon && (
          <span
            aria-hidden="true"
            className={`h-12 w-12 shrink-0 rounded-xl flex items-center justify-center ${toneStyle.chip} ${toneStyle.icon}`}
          >
            <Icon width={22} height={22} />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-extrabold uppercase tracking-wide text-ink leading-tight">{title}</h2>
          {description && <p className="text-[15px] text-ink-muted mt-0.5 leading-snug">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
