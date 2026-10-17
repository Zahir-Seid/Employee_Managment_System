import { KPI_TONES, kpiWash } from "../common/kpiTones.js";

// EMS Reporting System spec §22: KPI cards communicate current value +
// context, and drill down where available, not just a bare number.
// `onClick` is optional; when present the whole card becomes a button
// (used for in-page drill-down: e.g. clicking "Completed Events" filters
// the Event Summary table below to Completed, per spec §20's
// Summary to Detail to Record chain, the specialized Event Activity Report
// this would ordinarily jump to doesn't exist as a separate page yet, so
// this filters in place instead of navigating away).
//
// Same look as the Dashboard KPI cards: rounded-square icon chip (top-right)
// plus a soft color wash across the whole card. `icon` and `tone`
// (blue/teal/purple/green/orange/navy) are optional; without an icon the
// card shows just the wash. ("primary"/"default" kept as aliases.)
export default function ReportKpiCard({ label, value, sub, onClick, tone = "blue", icon: Icon }) {
  const toneKey = tone === "primary" || tone === "default" ? "blue" : tone;
  const toneStyle = KPI_TONES[toneKey] || KPI_TONES.blue;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={
        "jm-card relative overflow-hidden text-left w-full border border-line transition-all " +
        "hover:border-ems-primary hover:ring-1 hover:ring-ems-primary " +
        (onClick ? "cursor-pointer" : "")
      }
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: kpiWash(toneStyle.hex) }} />
      <div className="relative">
        <p className="text-[13px] font-semibold text-ink leading-snug mb-2">{label}</p>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xl font-bold tracking-tight text-ink leading-tight">{value ?? "-"}</p>
            {sub && <p className="text-xs text-ink-muted mt-0.5">{sub}</p>}
          </div>
          {Icon && (
            <span className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${toneStyle.chip} ${toneStyle.icon}`}>
              <Icon />
            </span>
          )}
        </div>
        {onClick && <p className="text-xs text-ems-primary font-medium mt-2">View details</p>}
      </div>
    </Wrapper>
  );
}
