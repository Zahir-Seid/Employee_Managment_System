// Shared tone table for KPI cards (Dashboard KpiCard + reports ReportKpiCard):
// `chip`/`icon` classes for the rounded-square icon chip, and `hex` for the
// soft color wash across the card. Reuses EMS's existing blue/teal/purple/
// green/orange tone system.
export const KPI_TONES = {
  blue: { chip: "bg-ems-primaryLight", icon: "text-ems-primary", hex: "#2563C4" },
  orange: { chip: "bg-pill-warningLight", icon: "text-pill-warning", hex: "#E58A2E" },
  green: { chip: "bg-pill-successLight", icon: "text-pill-success", hex: "#1D9E75" },
  purple: { chip: "bg-pill-purpleLight", icon: "text-pill-purple", hex: "#7C5CD6" },
  teal: { chip: "bg-pill-tealLight", icon: "text-pill-teal", hex: "#0E9AA8" },
  navy: { chip: "bg-pill-neutralBg", icon: "text-pill-neutralText", hex: "#2B3A55" },
};

// Soft wash across the whole card: strongest at the top-right, fading to
// transparent toward the bottom-left. Alpha-based so it works on light and
// dark surfaces alike.
export function kpiWash(hex) {
  return `linear-gradient(225deg, ${hex}26 0%, ${hex}14 40%, ${hex}00 78%)`;
}
