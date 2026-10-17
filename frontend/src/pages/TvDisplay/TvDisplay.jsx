import { Component, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
// The Event Analytics charts are the SAME components the Dashboard renders
// (components/charts/AnalyticsCharts.jsx); only `scale="tv"` (physical size)
// differs. Never re-create a chart here - change the shared one instead.
import { DonutCategoryChart, EventTrendAreaChart, RankedBarChart } from "../../components/charts/AnalyticsCharts.jsx";
import { contentApi } from "../../api/content";
import { dashboardApi } from "../../api/dashboard";
import { tvDisplayApi } from "../../api/tvDisplay";
import { formatDate, formatDateRange } from "../../utils/format";

// TV Display: meant to be opened on a shared office screen (not used
// interactively), so every design choice here optimizes for "readable
// from across a room, at a glance, without scrolling or clicking anything."
// That's a genuinely different brief from the rest of the app: bigger
// type than would ever make sense on a laptop, fewer simultaneous data
// points, high color-contrast for status at a glance, and content that
// stays useful even if nobody looks at it for an hour (hence the visible
// clock and "last updated", a static screenshot-like screen reads as
// broken/frozen after a while).
//
// Bug fix: this screen used to completely ignore TV Display Settings
// (Admin/Staff > TV Display), it always rendered the same fixed layout
// regardless of is_active, which sections were enabled, their order, or
// the configured screen duration. It now fetches those settings, honors
// the on/off switch, and rotates through only the enabled sections (in
// the saved order).
//
// The 5 sections without automatic data (Staff Spotlight, Celebrations,
// Announcements, Recognitions, Quick Information) now pull their content
// from TVDisplaySlide, manually added by Communications/Admin from TV
// Display Settings. A section with active slides gets one rotation turn
// per slide (each using its own duration if it set one, otherwise the
// shared/section duration); a section with no active slides yet is left
// out of the live rotation entirely (rather than taking a turn to show
// an empty placeholder) so the TV only ever cycles through the automatic
// sections and whatever manually-authored content actually exists. The
// "Preview" link on TV Display Settings still shows a section's current
// state (including "nothing added yet") even when it's empty, since
// that's the one place seeing the empty state is actually useful.

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes, frequent enough to
// feel "live" for a lobby screen, infrequent enough not to hammer the API
// all day from an always-on browser tab.
const SETTINGS_REFRESH_INTERVAL_MS = 60 * 1000; // check for settings changes
// (e.g. someone just re-ordered sections) far more often than the heavier
// dashboard data refresh, since this call is cheap and settings changes
// should show up on the shared screen quickly.

const CATEGORY_DOT = {
  international: "#0E9AA8",
  national: "#2B3A55",
  sub_regional: "#7C5CD6",
  internal: "#E58A2E",
};

const PROGRESS_COLORS = ["#2563C4", "#E58A2E", "#1D9E75", "#7C5CD6", "#0E9AA8", "#2B3A55"];

// Today's Activities is a manual slide queue now (not listed here).
const AUTOMATIC_SECTION_KEYS = new Set(["upcoming_events", "system_dashboards"]);
// Phase 32: a third category alongside automatic and manual-slide
// sections, one queue entry per DASHBOARD_PICK enabled in
// settings.dashboard_picks, same "expand into one entry per item"
// treatment as the other multi-item sections (see rotationQueue below), just with a
// fixed, pre-built set of items instead of live event data.
const DASHBOARD_PICK_SECTION_KEYS = new Set(["system_dashboard_picks"]);
// "News, Major Events & Announcements" - not automatic, but also not a
// TVDisplaySlide queue: it reuses the same content pool the public Home
// Page reads via contentApi.getHomeFeed() (see loadHomeContent below), so
// whatever's currently showable there (added from either place) also
// shows here.
const HOME_CONTENT_SECTION_KEYS = new Set(["home_news", "home_major_events", "home_announcements"]);
// Mirrors apps.tv_display.models.HOME_CONTENT_TYPE_BY_SECTION_KEY exactly -
// which of contentApi.getHomeFeed()'s three lists each split-out queue
// pulls its rotation entries from.
const HOME_CONTENT_TYPE_BY_SECTION_KEY = {
  home_news: "news",
  home_major_events: "major_event",
  home_announcements: "announcement",
};
const DASHBOARD_PICK_LABELS = {
  org_summary: "Organization Summary",
  participant_overview: "Participant Overview",
  region_breakdown: "Events by Region",
  comms_support: "Communications Support Overview",
};

const SECTION_LABELS = {
  staff_spotlight: "Staff Spotlight",
  todays_activities: "Today's Activities",
  upcoming_events: "Upcoming Events",
  celebrations: "Celebrations",
  announcements: "TV Announcements",
  home_news: "News",
  home_major_events: "Major Events",
  home_announcements: "Announcements",
  recognitions: "Recognitions",
  quick_information: "Quick Information",
  system_dashboards: "Event Analytics",
  system_dashboard_picks: "System Dashboards",
};

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}



function BarRow({ label, count, max, color }) {
  const pct = max ? Math.round((count / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xl font-medium text-ink truncate pr-3">{label}</span>
        <span className="text-2xl font-bold text-ink shrink-0">{count}</span>
      </div>
      <div className="h-3.5 rounded-full bg-[#F1F4F9] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function formatEventDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Shared TV look (reference design): one large, softly-shadowed white card
// per screen, opening with a small tracked blue eyebrow, a large LIGHT
// title, a quiet gray subtitle and (optionally) a period pill with its date
// range on the right. Every screen type below uses this card/eyebrow style
// so the whole rotation reads as one design, not just Event Analytics.
function TvCard({ eyebrow, title, subtitle, badge, badgeRange, children, className = "", compact = false }) {
  // `compact` (Event Analytics): tighter padding and a tighter title block so
  // the chart gets as much of the card's height as possible.
  return (
    <div className={`flex-1 min-h-0 rounded-[2rem] bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.14),0_1px_3px_rgba(15,23,42,0.05)] ${compact ? "px-10 pt-8 pb-8" : "p-12"} flex flex-col ${className}`}>
      {(eyebrow || title) && (
        <div className={`flex items-start justify-between gap-10 shrink-0 ${compact ? "mb-3" : "mb-8"}`}>
          <div className="min-w-0">
            {eyebrow && <p className={`text-sm font-semibold text-ems-primary tracking-[0.28em] uppercase ${compact ? "mb-1.5" : "mb-3"}`}>{eyebrow}</p>}
            {title && <h2 className={`${compact ? "text-[2.75rem] leading-[1.1]" : "text-5xl leading-tight"} font-light text-ink`}>{title}</h2>}
            {subtitle && <p className={`text-xl text-ink-faint ${compact ? "mt-1" : "mt-2"}`}>{subtitle}</p>}
          </div>
          {badge && (
            <div className="shrink-0 flex flex-col items-end">
              <span className="inline-flex items-center gap-2.5 rounded-full bg-ems-primaryLight text-ems-primaryLightText px-5 py-2 text-lg font-semibold">
                <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
                {badge}
              </span>
              {badgeRange && <p className={`text-sm tracking-[0.18em] uppercase text-ink-faint ${compact ? "mt-2" : "mt-3"}`}>{badgeRange}</p>}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function EventRow({ e }) {
  return (
    <div className="flex items-center gap-4 py-3.5 border-b border-line last:border-0">
      <div className="w-36 shrink-0">
        <p className="text-lg font-semibold text-ink-muted">{formatEventDate(e.start_date)}</p>
      </div>
      <span
        className="h-3 w-3 rounded-full shrink-0"
        style={{ backgroundColor: CATEGORY_DOT[e.category?.toLowerCase()] || "#9CA3AF" }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xl font-medium text-ink truncate">{e.title}</p>
        <p className="text-base text-ink-muted truncate">
          {e.thematic_area}, {e.owner_name}
        </p>
      </div>
      {e.needs_comms_support && (
        <span className="shrink-0 rounded-full bg-[#E8F0FC] text-ems-primary text-sm font-semibold px-3 py-1">
          Comms
        </span>
      )}
    </div>
  );
}

// Each of the "automatic" sections gets its own full-screen panel now
// (rotated one at a time) instead of all three being permanently crammed
// onto a single screen with no relationship to the configured order/timing.

function UpcomingEventsScreen({ data }) {
  const upcoming = data.upcoming_events || [];
  return (
    <TvCard eyebrow="Events" title="Upcoming Events" subtitle="What's coming up next">
      <div className="flex-1 min-h-0 flex flex-col gap-1 overflow-hidden">
        {upcoming.length === 0 && <p className="text-2xl text-ink-faint">Nothing scheduled.</p>}
        {upcoming.map((e) => (
          <EventRow key={e.id} e={e} />
        ))}
      </div>
    </TvCard>
  );
}

// "Event Analytics" (Phases 17-22, revised): the four required charts
// (Event Trend, Events by Category, Engagement Level, Thematic Areas)
// each get their own full rotation turn instead of sharing one 2x2 grid
// screen - one queue entry per chart (see rotationQueue below, same
// "expand into one entry per item" treatment as dashboard_picks), each
// using the section's shared duration. All four still come straight from
// the existing Dashboard payload (apps.dashboard.services), so there's
// no separate TV analytics endpoint or duplicated aggregation logic;
// TvDisplay scopes the request to the current calendar month (see the
// fetch effect below) so Event Trend and the other three charts match
// the main Dashboard's default "this month" view instead of drifting to
// a full-year (or all-time) total that no longer lines up with it.
const ANALYTICS_CHART_KEYS = ["trend", "category", "engagement", "thematic"];
const ANALYTICS_CHART_BASE_LABELS = {
  trend: "Event Trend",
  category: "Events by Category",
  engagement: "Engagement Level",
  thematic: "Thematic Areas",
};

// Short, human label for whichever analytics_period is configured
// (TV Display Settings > Event Analytics > Period), shown next to "Event
// Trend" the same way the Dashboard implies its own current period (e.g.
// its "This Month" KPI card) - so the TV screen never claims a period it
// isn't actually showing.
const ANALYTICS_PERIOD_QUALIFIERS = {
  all: "All Time",
  weekly: "This Week",
  monthly: "This Month",
  quarterly: "This Quarter",
  yearly: "This Year",
};

// Mirrors Dashboard.jsx's computePeriodRange exactly (including the
// July-start fiscal quarters) so whichever period an Admin configures in
// TV Display Settings > Event Analytics produces the identical date range
// the main Dashboard would show for that same period - "literally the
// same" data, not just the same label. Kept as its own copy here (rather
// than importing from the Dashboard page) since this is TV Display's own
// screen and shouldn't need touching Dashboard.jsx to stay in sync.
const TV_FISCAL_QUARTER_START_MONTH = { 1: 6, 2: 9, 3: 0, 4: 3 };
function computeAnalyticsPeriodRange(period, periodSelection) {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sel = periodSelection || {};

  if (period === "all") return { date_from: "", date_to: "" };
  if (period === "weekly") {
    const year = sel.year ?? today.getFullYear();
    const month = sel.month ?? today.getMonth() + 1;
    const week = sel.week ?? Math.min(4, Math.ceil(today.getDate() / 7));
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDay = (week - 1) * 7 + 1;
    const endDay = week === 4 ? daysInMonth : Math.min(week * 7, daysInMonth);
    return { date_from: iso(new Date(year, month - 1, startDay)), date_to: iso(new Date(year, month - 1, endDay)) };
  }
  if (period === "quarterly") {
    const year = sel.year ?? today.getFullYear();
    const quarter = sel.quarter ?? (((today.getMonth() - 6 + 12) % 12) / 3 | 0) + 1;
    const startMonth = TV_FISCAL_QUARTER_START_MONTH[quarter];
    return { date_from: iso(new Date(year, startMonth, 1)), date_to: iso(new Date(year, startMonth + 3, 0)) };
  }
  if (period === "yearly") {
    const year = sel.year ?? today.getFullYear();
    return { date_from: iso(new Date(year, 0, 1)), date_to: iso(new Date(year, 11, 31)) };
  }
  // monthly (default)
  const year = sel.year ?? today.getFullYear();
  const month = sel.month ?? today.getMonth() + 1;
  return { date_from: iso(new Date(year, month - 1, 1)), date_to: iso(new Date(year, month, 0)) };
}

// --- Event Analytics screens ---
// All four chart screens (Event Trend, Events by Category, Thematic Area,
// Engagement Level) now share ONE full-height panel (AnalyticsPanel) built
// from the same pieces as every other TV screen, the same rounded-3xl white
// card on the page background, the same small uppercase blue eyebrow line,
// the same big black title. They used to be small Dashboard-style cards
// floating in the middle of the screen (a different card radius, shadow,
// title size and font sizes from the rest of the TV) with the period as a
// bracketed "(This Month)" stranded above them. The period now lives in the
// panel header as a pill, with the exact date range under it.
//
// Chart data is unchanged (same Dashboard payload, same palette, same
// rank-based color ramp), only sizing/typography was scaled up for reading
// from across a room.
// What one point on the Event Trend chart means for each period, mirrors
// the bucket size the Dashboard's own trend chart picks (see
// apps.dashboard.services.get_trend_chart).
const ANALYTICS_TREND_UNITS = {
  weekly: "Events per day",
  monthly: "Events per week",
  quarterly: "Events per month",
  yearly: "Events per month",
  all: "Events per month",
};

// "Sep 1 to Sep 30, 2026" for the date range behind the period pill; empty
// for "All time" (no date restriction).
function formatAnalyticsRange(range) {
  if (!range || !range.date_from || !range.date_to) return "";
  const from = new Date(`${range.date_from}T00:00:00`);
  const to = new Date(`${range.date_to}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "";
  const short = { month: "short", day: "numeric" };
  if (from.getFullYear() === to.getFullYear()) {
    return `${from.toLocaleDateString("en-US", short)} to ${to.toLocaleDateString("en-US", short)}, ${to.getFullYear()}`;
  }
  const full = { ...short, year: "numeric" };
  return `${from.toLocaleDateString("en-US", full)} to ${to.toLocaleDateString("en-US", full)}`;
}

function AnalyticsPanel({ title, subtitle, periodQualifier, rangeLabel, children }) {
  return (
    <TvCard compact eyebrow="Event Analytics" title={title} subtitle={subtitle} badge={periodQualifier} badgeRange={rangeLabel}>
      {/* Dedicated chart space: the chart takes ALL the height left under the
          title block (about 70% of the card on a 1080p TV) and is never
          allowed below 55% of the card, however the screen is sized. The
          title/badge stay at the top and the page footer stays at the
          bottom. `relative` + the charts' own `absolute inset-0` gives
          recharts' ResponsiveContainer a definite size to measure inside a
          flex column. */}
      <div className="relative flex-1 min-h-0" style={{ minHeight: "55%" }}>
        {children}
      </div>
    </TvCard>
  );
}

function AnalyticsEmpty() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className="text-3xl text-ink-faint">No events in this period.</p>
    </div>
  );
}

// Thin wrappers that only give the shared charts a definite-size box inside
// the TV card (`relative flex-1` + `absolute inset-0` so recharts'
// ResponsiveContainer can measure inside a flex column).
function TvDonut({ data }) {
  return (
    <div className="absolute inset-0">
      <DonutCategoryChart data={data} scale="tv" />
    </div>
  );
}

function TvRankedBars({ data, labelKey, countKey, orientation }) {
  return (
    <div className="absolute inset-0">
      <RankedBarChart data={data} labelKey={labelKey} countKey={countKey} orientation={orientation} scale="tv" />
    </div>
  );
}

function TvTrend({ series, period }) {
  return (
    <div className="absolute inset-0">
      <EventTrendAreaChart series={series} period={period} scale="tv" />
    </div>
  );
}

function AnalyticsChartScreen({ chartKey, data, period, periodQualifier, periodRange }) {
  // Prefer the Dashboard's own drill-down trend (weekly buckets for a
  // monthly period, etc., `charts.trend`). `monthly_trend` is always one
  // bucket per month, which for the default "This Month" period is a single
  // lonely dot; it's only the fallback for an older payload without `trend`.
  const trendSeries = data.charts?.trend || data.charts?.monthly_trend || [];
  const rangeLabel = formatAnalyticsRange(periodRange);
  const panel = { periodQualifier, rangeLabel };

  if (chartKey === "category") {
    const rows = data.charts?.by_category || [];
    const total = rows.reduce((sum, d) => sum + (d.count || 0), 0);
    const chartData = rows.map((d) => ({
      category: d.category,
      count: d.count || 0,
      percentage: total ? Math.round((d.count / total) * 100) : 0,
    }));
    return (
      <AnalyticsPanel title="Events by Category" subtitle="Share of events in each category" {...panel}>
        {chartData.length === 0 ? <AnalyticsEmpty /> : <TvDonut data={chartData} />}
      </AnalyticsPanel>
    );
  }

  if (chartKey === "thematic") {
    const rows = (data.charts?.by_thematic_area || []).map((d) => ({ area: d.thematic_area, count: d.count }));
    return (
      <AnalyticsPanel title="Events by Thematic Area" subtitle="Number of events per thematic area" {...panel}>
        {rows.length === 0 ? <AnalyticsEmpty /> : <TvRankedBars data={rows} labelKey="area" countKey="count" />}
      </AnalyticsPanel>
    );
  }

  if (chartKey === "engagement") {
    const rows = (data.charts?.by_engagement_level || []).map((d) => ({ level: d.engagement_level, count: d.count }));
    return (
      <AnalyticsPanel title="Engagement by Level" subtitle="Number of events by engagement level" {...panel}>
        {rows.length === 0 ? <AnalyticsEmpty /> : <TvRankedBars data={rows} labelKey="level" countKey="count" orientation="vertical" />}
      </AnalyticsPanel>
    );
  }

  return (
    <AnalyticsPanel
      title={ANALYTICS_CHART_BASE_LABELS[chartKey] || "Event Analytics"}
      subtitle={ANALYTICS_TREND_UNITS[period] || ANALYTICS_TREND_UNITS.monthly}
      {...panel}
    >
      {trendSeries.length === 0 ? <AnalyticsEmpty /> : <TvTrend series={trendSeries} period={period} />}
    </AnalyticsPanel>
  );
}

// Phase 32 ("System Dashboards"): each pick is a fixed, TV-friendly lens
// on data the main Dashboard already computes and the TV Display already
// fetches in its one shared payload (see the dashboardApi.get call below)
//, no new aggregation, no new endpoint, deliberately distinct from what
// the always-on Event Analytics screen already shows.
function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl bg-[#F7F9FC] px-8 py-7 flex-1 min-w-[200px]">
      <p className="text-lg font-semibold text-ems-primary tracking-wide uppercase mb-2">{label}</p>
      <p className="text-6xl font-black text-ink tabular-nums">{value}</p>
    </div>
  );
}

// Same horizontal-bar treatment as the "Activity by Support Type" chart
// on the Communications Report/Dashboard (Reports > Communications
// Report), so the TV's "Communications Support Overview" pick reads as
// the same chart, not a different-looking summary of the same numbers.
function SupportTypeBarChart({ rows }) {
  const chartRows = (rows || []).filter((r) => r.count > 0);
  if (chartRows.length === 0) {
    return <p className="text-xl text-ink-faint text-center">No support requests in this period.</p>;
  }
  return (
    <div className="w-full max-w-2xl mx-auto" style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartRows} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E9F0" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 14, fill: "#5B6472" }} />
          <YAxis type="category" dataKey="support_type" width={140} tick={{ fontSize: 14, fill: "#5B6472" }} />
          <Bar dataKey="count" fill="#7C5CD6" radius={[0, 4, 4, 0]} barSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DashboardPickScreen({ pickKey, data, commsWeekData }) {
  const label = DASHBOARD_PICK_LABELS[pickKey] || pickKey;

  let body;
  if (pickKey === "org_summary") {
    const s = data.summary || {};
    body = (
      <div className="flex flex-wrap gap-5 justify-center">
        <MiniStat label="Total Events" value={s.total_events ?? 0} />
        <MiniStat label="Completed" value={s.completed_events ?? 0} />
        <MiniStat label="Open Support Requests" value={s.communications_requests ?? 0} />
        <MiniStat label="Upcoming (30 Days)" value={data.upcoming_count_30d ?? 0} />
      </div>
    );
  } else if (pickKey === "participant_overview") {
    const p = data.participant_stats || {};
    body = (
      <div className="flex flex-wrap gap-5 justify-center">
        <MiniStat label="Total Participants" value={p.total_participants ?? 0} />
        <MiniStat label="Average per Event" value={p.average_participants ?? 0} />
      </div>
    );
  } else if (pickKey === "region_breakdown") {
    const rows = (data.charts?.by_region || []).slice(0, 6);
    const max = Math.max(1, ...rows.map((r) => r.count));
    body = (
      <div className="w-full max-w-3xl mx-auto flex flex-col gap-4">
        {rows.length === 0 && <p className="text-xl text-ink-faint text-center">No data for this period.</p>}
        {rows.map((r, i) => (
          <BarRow key={r.region} label={r.region || "Unspecified"} count={r.count} max={max} color={PROGRESS_COLORS[i % PROGRESS_COLORS.length]} />
        ))}
      </div>
    );
  } else if (pickKey === "comms_support") {
    // Matches the "Communications Support Overview" widget on the main
    // Dashboard (same KPI cards) plus the "Activity by Support Type"
    // chart from the Communications Report - not just the totals, so
    // this reads as the same dashboard, not a simplified stand-in for
    // it. Scoped to the last 7 days specifically (commsWeekData, a
    // separate fetch - see loadCommsWeek below), independent of the
    // current-year data the rest of this payload uses, since "last
    // week" is what this pick is meant to summarize on a shared screen.
    const c = (commsWeekData || data).comms_support_overview || {};
    body = (
      <div className="flex flex-col items-center gap-8 w-full">
        <div className="flex flex-wrap gap-5 justify-center">
          <MiniStat label="Total Requests" value={c.total_requests ?? 0} />
        </div>
        <SupportTypeBarChart rows={c.by_support_type} />
      </div>
    );
  } else {
    body = <p className="text-xl text-ink-faint">This dashboard isn't available.</p>;
  }

  return (
    <TvCard
      eyebrow="System Dashboards"
      title={label}
      badge={pickKey === "comms_support" ? "Last 7 days" : null}
    >
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-8">{body}</div>
    </TvCard>
  );
}

// Staff Spotlight / Celebrations / Announcements / Recognitions / Quick
// Information now have a real content model (TVDisplaySlide), Communications/
// Admin add slides from TV Display Settings. This is what shows when a
// section has no active slides yet, instead of pretending it's live.
function EmptySectionScreen({ label }) {
  return (
    <div className="flex-1 min-h-0 rounded-[2rem] bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.14),0_1px_3px_rgba(15,23,42,0.05)] p-8 flex flex-col items-center justify-center text-center">
      <p className="text-sm font-semibold text-ems-primary tracking-[0.28em] uppercase mb-4">{label}</p>
      <p className="text-xl text-ink-faint max-w-md">Nothing added here yet.</p>
    </div>
  );
}

// One manually-added slide (Staff Spotlight, Celebrations, Announcements,
// Recognitions, or Quick Information), plain title + message, large
// enough to read from across a room like every other section here.
// One manually-added slide (Staff Spotlight, Celebrations, Announcements,
// Recognitions, or Quick Information). Layout branches by section to match
// each type's spec example (Phases 27/29/30) while still sharing one
// component, same title/subtitle/message/photo fields underneath, just
// arranged differently, exactly like the management form's per-section
// labels (see TVDisplaySettingsPanel's SECTION_FIELD_CONFIG).
function SlideScreen({ sectionKey, label, slide }) {
  if (sectionKey === "staff_spotlight" || sectionKey === "celebrations") {
    // Phase 27/29: photo (if any) front and center, then Name, then the
    // smaller Position/Occasion line, then a short description, never a
    // large paragraph, same 2-line spirit as the rest of the TV Display.
    return (
      <div className="flex-1 min-h-0 rounded-[2rem] bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.14),0_1px_3px_rgba(15,23,42,0.05)] p-10 flex flex-col items-center justify-center text-center">
        <p className="text-sm font-semibold text-ems-primary tracking-[0.28em] uppercase mb-5">{label}</p>
        {slide.photo ? (
          <img src={slide.photo} alt="" className="h-48 w-48 rounded-full object-cover mb-6 shadow-md" />
        ) : (
          <div className="h-48 w-48 rounded-full mb-6 bg-gradient-to-br from-[#2563C4] to-[#0E9AA8] flex items-center justify-center">
            <span className="text-6xl font-black text-white">{slide.title.trim().charAt(0).toUpperCase()}</span>
          </div>
        )}
        <h2 className="text-5xl font-light text-ink mb-2 max-w-4xl leading-tight">{slide.title}</h2>
        {slide.subtitle && <p className="text-2xl text-ems-primary font-semibold mb-4">{slide.subtitle}</p>}
        {slide.message && <p className="text-2xl text-ink-muted max-w-3xl whitespace-pre-line line-clamp-2">{slide.message}</p>}
      </div>
    );
  }

  if (sectionKey === "recognitions") {
    // Phase 30: "Congratulations" as a fixed header (not stored data ,
    // every Recognition says it), then the Name, then the reason.
    return (
      <div className="flex-1 min-h-0 rounded-[2rem] bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.14),0_1px_3px_rgba(15,23,42,0.05)] p-10 flex flex-col items-center justify-center text-center">
        <p className="text-sm font-semibold text-ems-primary tracking-[0.28em] uppercase mb-5">{label}</p>
        <p className="text-2xl text-ink-muted mb-2">Congratulations</p>
        <h2 className="text-6xl font-light text-ink mb-3 max-w-4xl leading-tight">{slide.title}</h2>
        {slide.subtitle && <p className="text-xl text-ink-muted mb-4">{slide.subtitle}</p>}
        {slide.message && <p className="text-2xl text-ink-muted max-w-3xl whitespace-pre-line line-clamp-2">{slide.message}</p>}
      </div>
    );
  }

  // Announcements / Quick Information / a custom queue: plain title +
  // message, with an optional supporting photo (Phase 26) alongside
  // instead of centered, a photo here is illustrative, not the point,
  // unlike Staff Spotlight's portrait. Subtitle is blank for the two
  // fixed sections that reach this branch (their form never collects
  // one), so rendering it here is a no-op for them and only shows up
  // for a custom queue whose admin filled it in.
  return (
    <div className="flex-1 min-h-0 rounded-[2rem] bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.14),0_1px_3px_rgba(15,23,42,0.05)] p-10 flex items-center gap-10">
      <div className={"flex-1 flex flex-col " + (slide.photo ? "text-left" : "items-center text-center")}>
        <p className="text-sm font-semibold text-ems-primary tracking-[0.28em] uppercase mb-4">{label}</p>
        <h2 className={"text-5xl font-light text-ink max-w-4xl leading-tight " + (slide.subtitle ? "mb-2" : "mb-6")}>
          {slide.title}
        </h2>
        {slide.subtitle && <p className="text-2xl text-ems-primary font-semibold mb-4">{slide.subtitle}</p>}
        {slide.message && <p className="text-2xl text-ink-muted max-w-3xl whitespace-pre-line">{slide.message}</p>}
      </div>
      {slide.photo && (
        <img src={slide.photo} alt="" className="w-[38%] max-h-full rounded-2xl object-cover shrink-0" />
      )}
    </div>
  );
}

// News (Home Page) / Major Events (Home Page) / Announcements (Home Page) -
// three separate queues (home_news / home_major_events / home_announcements)
// but the exact same card anatomy as the public Home Page's ContentCard
// (photo, date line for News/Major Event, title, description), just sized
// to read from across a room like every other TV screen. Deliberately NO
// "Read more" control: that's a click-to-expand interaction, and this
// screen can't be clicked - so the full description always shows instead
// of a clamped preview.
function HomeContentScreen({ item, label }) {
  if (!item) return <EmptySectionScreen label={label} />;

  const title = item.effective_title || item.title;
  const date =
    item.content_type === "news"
      ? item.publish_date && formatDate(item.publish_date)
      : item.content_type === "major_event" && (item.effective_start_date || item.effective_end_date)
      ? formatDateRange(item.effective_start_date, item.effective_end_date)
      : null;
  const typeLabel =
    item.content_type === "major_event" ? "Major Event" : item.content_type === "news" ? "News" : "Announcement";

  return (
    <div className="flex-1 min-h-0 rounded-[2rem] bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.14),0_1px_3px_rgba(15,23,42,0.05)] p-10 flex items-center gap-10">
      {item.image && (
        <img src={item.image} alt="" className="w-[38%] max-h-full rounded-2xl object-cover shrink-0" />
      )}
      <div className={"flex-1 min-w-0 flex flex-col " + (item.image ? "text-left" : "items-center text-center")}>
        <p className="text-sm font-semibold text-ems-primary tracking-[0.28em] uppercase mb-4">{typeLabel}</p>
        {date && <p className="text-xl text-ink-faint mb-2">{date}</p>}
        <h2 className="text-5xl font-light text-ink max-w-4xl leading-tight mb-4">{title}</h2>
        {item.description && (
          <p className="text-2xl text-ink-muted max-w-3xl whitespace-pre-line">{item.description}</p>
        )}
      </div>
    </div>
  );
}

function SectionScreen({ sectionKey, label, slide, manual, data, pickKey, chartKey, commsWeekData, analyticsPeriod, analyticsPeriodQualifier, analyticsPeriodRange, homeContentItem }) {
  // Manual mode on an automatic-capable section: slides only.
  if (manual) {
    return slide ? (
      <SlideScreen sectionKey={sectionKey} label={label} slide={slide} />
    ) : (
      <EmptySectionScreen label={label} />
    );
  }
  switch (sectionKey) {
    case "upcoming_events":
      return <UpcomingEventsScreen data={data} />;
    case "home_news":
    case "home_major_events":
    case "home_announcements":
      return <HomeContentScreen item={homeContentItem} label={label} />;
    case "system_dashboards":
      return (
        <AnalyticsChartScreen
          chartKey={chartKey}
          data={data}
          period={analyticsPeriod}
          periodQualifier={analyticsPeriodQualifier}
          periodRange={analyticsPeriodRange}
        />
      );
    case "system_dashboard_picks":
      return <DashboardPickScreen pickKey={pickKey} data={data} commsWeekData={commsWeekData} />;
    default:
      return slide ? (
        <SlideScreen sectionKey={sectionKey} label={label} slide={slide} />
      ) : (
        <EmptySectionScreen label={label} />
      );
  }
}

// Safety net: an unattended kiosk screen should never freeze because one
// screen's data has something unexpected in it. A render error in
// SectionScreen (from a genuinely malformed record - a photo/date field
// in a shape this code hasn't seen before, etc.) would otherwise be an
// UNCAUGHT exception, which React handles by tearing down and blanking
// the *entire* page - not just that one screen - since nothing here
// previously caught it. This boundary contains that to a plain "couldn't
// show this" fallback for just the current screen, while the rotation
// timer (a plain useEffect on the parent TvDisplay, entirely unaffected
// by a child's render error) keeps running and moves on right on
// schedule - so a single bad record now costs one skipped-looking turn,
// not a stuck or blank screen until someone notices and refreshes.
class SectionErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error("TV Display: a section failed to render, skipping it until the next rotation:", error);
  }

  componentDidUpdate(prevProps) {
    // Clear the error as soon as the rotation moves to a different entry
    // (resetKey changes) rather than staying stuck on the fallback forever.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return <EmptySectionScreen label={this.props.label} />;
    }
    return this.props.children;
  }
}

export default function TvDisplay() {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [slides, setSlides] = useState([]);
  const [homeContentByType, setHomeContentByType] = useState({ news: [], major_event: [], announcement: [] });
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [screenIndex, setScreenIndex] = useState(0);
  const now = useClock();
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Phase 37 (full-screen TV mode): the browser's actual Fullscreen API,
  // not just this route's own full-bleed CSS layout, hides the browser
  // chrome/address bar too, which matters for a screen meant to run
  // unattended on an office TV. Tracked via the fullscreenchange event
  // (rather than just flipping local state on click) so the button's
  // label/icon stays correct even if the person exits with Esc instead of
  // clicking it again.
  useEffect(() => {
    function handleChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {
        // Some embedded/kiosk browsers don't support or permit this from
        // script, nothing to do but leave the page as-is; F11 (or
        // whatever that browser's native fullscreen shortcut is) still
        // works as a fallback.
      });
    }
  }

  // Phase 43 (network failure resilience): every poller below retries
  // automatically, but at two different speeds, fast (10s) until its
  // FIRST successful load ever (so a TV that boots before the network/
  // backend is fully up catches up quickly instead of sitting on a
  // "Loading..." screen for up to 5 minutes), then settles into its normal,
  // much less chatty interval once it's established a connection. A
  // single later hiccup doesn't trigger fast retries again, that's
  // normal, occasional network noise, not "still trying to connect."
  const FAST_RETRY_MS = 10 * 1000;
  const dataLoadedOnce = useRef(false);
  const settingsLoadedOnce = useRef(false);
  const slidesLoadedOnce = useRef(false);
  const homeContentLoadedOnce = useRef(false);

  // Always-current settings, readable from inside the polling loop below
  // without adding `settings` as an effect dependency (which would tear
  // down and restart the whole poll/retry timer chain on every settings
  // refresh). The analytics fetch below reads this at the moment it
  // actually runs, so a period change picked up by the settings poll
  // (at most SETTINGS_REFRESH_INTERVAL_MS old) is used on the very next
  // analytics refresh, same "eventually consistent" tolerance already
  // used for section on/off/order and every other TV Display setting.
  const settingsRef = useRef(null);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId;
    async function load() {
      try {
        // Event Trend and the other three Event Analytics charts are
        // scoped to whichever period is configured in TV Display Settings
        // > Event Analytics > Period (defaults to "monthly"/"this month")
        //, the exact same period vocabulary and date math as the main
        // Dashboard's own Weekly/Monthly/Quarterly/Yearly/All toggle (see
        // computeAnalyticsPeriodRange above), so all four charts agree
        // with each other AND with what that dashboard shows for the same
        // period, instead of a fixed window that can drift out of sync.
        const analyticsPeriod = settingsRef.current?.analytics_period || "monthly";
        const analyticsPeriodSelection = settingsRef.current?.analytics_period_selection || {};
        const { date_from, date_to } = computeAnalyticsPeriodRange(analyticsPeriod, analyticsPeriodSelection);
        const { data: payload } = await dashboardApi.get({
          scope: "generic",
          upcoming_limit: 20,
          date_from,
          date_to,
          // Same period the Dashboard would send, so `charts.trend` comes
          // back bucketed to match (weekly points for "This Month", etc.).
          period: analyticsPeriod,
          // Whichever account happens to be logged into the TV's browser
          // is incidental, every viewer expects the whole organization's
          // upcoming events, not just that one account's own (which is
          // what Staff otherwise get on their personal Dashboard, FR3).
          upcoming_scope: "org",
        });
        if (!cancelled) {
          setData(payload);
          setLastUpdated(new Date());
          setError(null);
          dataLoadedOnce.current = true;
        }
      } catch {
        if (!cancelled) {
          setError(
            dataLoadedOnce.current
              ? "Couldn't refresh. Showing the last data received."
              : "Connecting to EMS..."
          );
        }
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(load, dataLoadedOnce.current ? REFRESH_INTERVAL_MS : FAST_RETRY_MS);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeoutId;
    async function loadSettings() {
      try {
        const { data: payload } = await tvDisplayApi.getSettings();
        if (!cancelled) {
          setSettings(payload);
          settingsLoadedOnce.current = true;
        }
      } catch {
        // Settings are non-critical to have fresh every minute, if this
        // particular poll fails, just keep whatever we last had (or the
        // "not configured yet" fallback below if we never got any).
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(loadSettings, settingsLoadedOnce.current ? SETTINGS_REFRESH_INTERVAL_MS : FAST_RETRY_MS);
        }
      }
    }
    loadSettings();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  // "Communications Support Overview" (system_dashboard_picks: comms_support)
  // is meant to summarize the LAST 7 DAYS specifically - a separate,
  // narrower-scoped fetch from the main dashboard payload above (which is
  // scoped to the current calendar month for Event Analytics). Without
  // this, the TV's comms figures would follow the Event Analytics month
  // instead of "last week" like the pick's own label promises - a real
  // mismatch from what the Communications Dashboard would show for that
  // same week.
  const commsWeekLoadedOnce = useRef(false);
  const [commsWeekData, setCommsWeekData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let timeoutId;
    async function loadCommsWeek() {
      try {
        const today = new Date();
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 6);
        const fmt = (d) => {
          const pad = (n) => String(n).padStart(2, "0");
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        };
        const { data: payload } = await dashboardApi.get({
          scope: "generic",
          date_from: fmt(weekAgo),
          date_to: fmt(today),
          upcoming_limit: 1,
          upcoming_scope: "org",
        });
        if (!cancelled) {
          setCommsWeekData(payload);
          commsWeekLoadedOnce.current = true;
        }
      } catch {
        // non-critical, keep whatever we last had
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(loadCommsWeek, commsWeekLoadedOnce.current ? REFRESH_INTERVAL_MS : FAST_RETRY_MS);
        }
      }
    }
    loadCommsWeek();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  // Manually-added slides, same polling cadence as settings (cheap call,
  // and Communications adding/editing a slide should show up on the shared
  // screen about as quickly as a settings change would).
  useEffect(() => {
    let cancelled = false;
    let timeoutId;
    async function loadSlides() {
      try {
        const { data: payload } = await tvDisplayApi.listSlides({ active_only: 1, page_size: 500 });
        if (!cancelled) {
          setSlides(payload.results || payload);
          slidesLoadedOnce.current = true;
        }
      } catch {
        // non-critical, keep whatever slides we last had
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(loadSlides, slidesLoadedOnce.current ? SETTINGS_REFRESH_INTERVAL_MS : FAST_RETRY_MS);
        }
      }
    }
    loadSlides();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  // News (Home Page) / Major Events (Home Page) / Announcements (Home Page)
  // - the exact same read the public Home Page uses (contentApi.getHomeFeed
  // already returns only currently-showable items, split by type). Same
  // polling cadence as slides/settings: an Admin adding this from either TV
  // Display Settings or Home Page > Manage Content should show up on the
  // shared screen about as quickly as any other content change would.
  useEffect(() => {
    let cancelled = false;
    let timeoutId;
    async function loadHomeContent() {
      try {
        const { data: payload } = await contentApi.getHomeFeed({ all: 1, audience: "tv" });
        if (!cancelled) {
          setHomeContentByType({
            news: payload.latest_news || [],
            major_event: payload.major_events || [],
            announcement: payload.announcements || [],
          });
          homeContentLoadedOnce.current = true;
        }
      } catch {
        // non-critical, keep whatever we last had
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(loadHomeContent, homeContentLoadedOnce.current ? SETTINGS_REFRESH_INTERVAL_MS : FAST_RETRY_MS);
        }
      }
    }
    loadHomeContent();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  // Phase 36 (Preview): ?preview=<section_key> locks the live screen onto
  // just that one section, no separate preview UI/component, this is the
  // exact same TvDisplay the office TV runs, just filtered down to what
  // whoever's editing wants to check before it goes out to everyone. The
  // "Preview" link in TVDisplaySettingsPanel builds this URL.
  const previewSection = new URLSearchParams(window.location.search).get("preview");

  const enabledSections = useMemo(() => {
    // Preview intentionally ignores the enabled/disabled toggle, you
    // should be able to check a section's content before switching it on,
    // not just after.
    if (previewSection) return [previewSection];
    return (settings?.sections || []).filter((s) => s.enabled).map((s) => s.key);
  }, [settings, previewSection]);

  // Merges the fixed SECTION_LABELS with any admin-created custom
  // queue's own `label` (carried on its entry in settings.sections, see
  // TVDisplaySettingsPanel's "+ Add queue") so a custom queue shows its
  // real name instead of its generated key.
  const sectionLabels = useMemo(() => {
    const map = { ...SECTION_LABELS };
    for (const section of settings?.sections || []) {
      if (section.label) map[section.key] = section.label;
    }
    return map;
  }, [settings]);

  const sharedDuration = Math.max(3, settings?.screen_duration_seconds || 15);

  // Per-section timing override (TV Display Settings > each section's own
  // "Automatic"/custom-seconds control), null/missing means "automatic",
  // i.e. just use the shared screen_duration_seconds like before this
  // existed. Automatic sections and dashboard-pick/chart entries fall
  // back to this instead of always using the flat shared duration, so a
  // section can be sped up or slowed down on its own without changing
  // the timing for everything else.
  const sectionDurationOverrides = useMemo(() => {
    const map = {};
    for (const section of settings?.sections || []) {
      if (section.duration_seconds) map[section.key] = Math.max(3, section.duration_seconds);
    }
    return map;
  }, [settings]);
  const durationFor = (key) => sectionDurationOverrides[key] ?? sharedDuration;

  // Flattened rotation queue: automatic sections get one entry each (that
  // section's own duration, or the shared one); a manual section with
  // active slides gets one entry PER slide, each using that slide's own
  // duration if it set one, falling back to the section's/shared duration
  // otherwise. This is what actually fills in the "displayed after the
  // default, with the given time" behavior, Communications' slides take
  // their own turn(s) in the same rotation as everything else, in
  // whatever position their section is configured to be.
  //
  // A manual section with NO active slides yet is left out of the
  // rotation entirely (outside preview, see below) rather than getting
  // a placeholder turn: a section nobody has added anything to yet has
  // nothing to show, so it shouldn't take up a slot in the rotation
  // alongside the automatic sections and the sections that do have real
  // content. Preview is the one exception, ?preview=<key> should still
  // show that section's current (possibly empty) state so whoever's
  // setting it up can see there's nothing there yet, rather than the
  // preview link silently doing nothing.
  //
  // "recent_events" (Last Week's Events) gets the same "one entry per
  // item" treatment as a manual section with active slides, one queue
  // entry per event, each using the configured event duration (default 4
  // minutes) rather than the shared section duration, since an event's
  // whole point is to stay on screen long enough to cycle through its own
  // photos (Phase 9-10). Zero events still gets exactly one entry (empty
  // state) when previewing; otherwise, like the manual sections above, it
  // just doesn't take a rotation slot.
  const rotationQueue = useMemo(() => {
    const queue = [];
    for (const key of enabledSections) {
      if (HOME_CONTENT_SECTION_KEYS.has(key)) {
        // Same "one entry per item" treatment as dashboard
        // picks, each currently-showable item of THIS queue's type gets
        // its own rotation turn (News (Home Page) only gets news items,
        // etc., see HOME_CONTENT_TYPE_BY_SECTION_KEY). Nothing added yet
        // is skipped entirely (outside preview), same as every other
        // manual section with no content.
        const items = homeContentByType[HOME_CONTENT_TYPE_BY_SECTION_KEY[key]] || [];
        if (items.length === 0) {
          if (previewSection) queue.push({ sectionKey: key, homeContentItem: null, duration: durationFor(key) });
        } else {
          for (const item of items) {
            queue.push({ sectionKey: key, homeContentItem: item, duration: durationFor(key) });
          }
        }
        continue;
      }
      if (DASHBOARD_PICK_SECTION_KEYS.has(key)) {
        // Phase 32: unlike every other section, zero selected picks means
        // ZERO queue entries here, no empty-state screen. "Only selected
        // dashboards should appear" is explicit that this section is
        // meant to be fully invisible until an Admin opts something in,
        // not "on but showing a placeholder."
        const enabledPicks = (settings?.dashboard_picks || []).filter((p) => p.enabled);
        for (const pick of enabledPicks) {
          queue.push({ sectionKey: key, pickKey: pick.key, duration: durationFor(key) });
        }
        continue;
      }
      // An automatic-capable section (Upcoming Events / Event Analytics)
      // set to Manual never shows its automatic screen: it falls through
      // to the slide queue below and shows only the slides authored for it.
      const manualOverride =
        AUTOMATIC_SECTION_KEYS.has(key) &&
        (settings?.sections || []).find((s) => s.key === key)?.content_mode === "manual";
      if (key === "system_dashboards" && !manualOverride) {
        // Event Analytics: one queue entry per chart (Event Trend, Events
        // by Category, Engagement Level, Thematic Areas) rather than one
        // entry for a combined 2x2 grid, each chart gets its own full
        // rotation turn, same "expand into one entry per item" treatment
        // as dashboard_picks above.
        for (const chartKey of ANALYTICS_CHART_KEYS) {
          queue.push({ sectionKey: key, chartKey, duration: durationFor(key) });
        }
        continue;
      }
      if (AUTOMATIC_SECTION_KEYS.has(key) && !manualOverride) {
        queue.push({ sectionKey: key, slide: null, duration: durationFor(key) });
        continue;
      }
      const sectionSlides = slides.filter((s) => s.section_key === key);
      if (sectionSlides.length === 0) {
        // Only take a rotation slot while previewing, otherwise, a
        // manual section nobody has added content to yet is skipped
        // entirely instead of flashing an empty placeholder screen.
        if (previewSection) queue.push({ sectionKey: key, slide: null, manual: manualOverride, duration: durationFor(key) });
      } else {
        for (const slide of sectionSlides) {
          queue.push({
            sectionKey: key,
            slide,
            manual: manualOverride,
            duration: Math.max(3, slide.duration_seconds || durationFor(key)),
          });
        }
      }
    }
    return queue;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledSections.join(","), slides, homeContentByType, sharedDuration, settings, previewSection]);

  const rotationQueueKey = rotationQueue
    .map(
      (item) =>
        `${item.sectionKey}:${item.slide?.id ?? item.event?.id ?? item.homeContentItem?.id ?? item.pickKey ?? item.chartKey ?? ""}:${item.duration}`
    )
    .join("|");

  // Reset to the first screen whenever the rotation's composition actually
  // changes (new settings saved, a slide added/edited/removed), rather
  // than pointing at a now out-of-range or now-different entry.
  useEffect(() => {
    setScreenIndex(0);
  }, [rotationQueueKey]);

  // setTimeout (re-armed each time, using the *current* entry's own
  // duration) instead of one fixed-period setInterval, different entries
  // in the queue can have different durations now that per-slide overrides
  // exist, where before every section shared the single global duration.
  //
  // Bug fix: this used to depend on `rotationQueue` itself, but that's a
  // useMemo result that gets a brand-new array reference on every
  // settings/slides/recentEvents poll (as often as every 60s) even when
  // nothing in it actually changed. That tore down and re-armed this
  // timeout from scratch every ~60s, fine for short screens that
  // complete within that window, but a screen with a longer duration
  // (Last Week's Events defaults to 240s) never survived long enough to
  // fire, so rotation looked stuck there forever. `rotationQueueKey`
  // (already used by the reset-to-0 effect above, for the same reason)
  // is a stable string that only changes when the composition actually
  // changes, so the timer is left alone across routine polls.
  useEffect(() => {
    if (rotationQueue.length < 2) return undefined;
    const current = rotationQueue[screenIndex % rotationQueue.length];
    const id = setTimeout(() => {
      setScreenIndex((i) => (i + 1) % rotationQueue.length);
    }, current.duration * 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenIndex, rotationQueueKey]);

  if (!data || !settings) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-pagebg text-center px-10">
        <p className="text-2xl text-ink-muted">{error || "Loading EMS TV Display..."}</p>
      </div>
    );
  }

  if (!settings.is_active && !previewSection) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-pagebg text-center px-10">
        <h1 className="text-3xl font-bold text-ink mb-2">TV Display is currently turned off</h1>
        <p className="text-lg text-ink-muted max-w-md">
          An Admin or Leadership user can turn it back on from TV Display settings.
        </p>
      </div>
    );
  }

  if (rotationQueue.length === 0) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-pagebg text-center px-10">
        <h1 className="text-3xl font-bold text-ink mb-2">Nothing configured to display</h1>
        <p className="text-lg text-ink-muted max-w-md">
          An Admin or Leadership user needs to turn on at least one section in TV Display settings.
        </p>
      </div>
    );
  }

  const current = rotationQueue[screenIndex % rotationQueue.length];
  // Phase 41 (image performance): fetch the NEXT queue item's photo(s)
  // now, while the CURRENT one is still on screen, so switching to it
  // doesn't show a blank/loading gap while the browser fetches for the
  // first time. Within an event/slide, PhotoCarousel already mounts all
  // of that item's own photos up front (see its comment), this covers
  // the one gap that leaves: the moment the rotation itself advances.
  const next = rotationQueue[(screenIndex + 1) % rotationQueue.length];
  const preloadUrls =
    next?.event?.photos ||
    (next?.slide?.photo ? [next.slide.photo] : null) ||
    (next?.homeContentItem?.image ? [next.homeContentItem.image] : []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#F7F9FC] flex flex-col px-16 py-10">
      {preloadUrls.map((url, i) => (
        <img key={`${url}-${i}`} src={url} alt="" className="hidden" aria-hidden="true" />
      ))}
      {previewSection && (
        <div className="fixed top-0 inset-x-0 z-50 bg-ems-primary text-white text-sm px-4 py-2 text-center">
          Previewing "{sectionLabels[previewSection] || previewSection}" only - not the live rotation. Close this
          tab to return to TV Display Settings.
        </div>
      )}
      {/* Header, branding + live clock, so a screen left running all day
          never looks "frozen"; the clock alone proves it's still alive.
          Stays fixed while the content below rotates. */}
      <div className="flex items-center justify-between shrink-0 mb-8">
        <div className="flex items-center gap-5">
          <div>
            <p className="text-3xl font-semibold text-ink tracking-tight leading-none">EMS</p>
            <p className="text-sm text-ink-faint mt-2 tracking-[0.2em] uppercase">Event Management System</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-6xl font-light text-ink tabular-nums leading-none">
            {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </p>
          <p className="text-sm font-semibold text-ink-muted mt-2 tracking-[0.12em]">
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </div>

      {/* Rotating content, one entry at a time in the queue built above:
          automatic sections and manually-added slides interleaved in the
          saved section order, each for its own (or the shared) duration.
          key={screenIndex} forces a remount on every rotation advance so
          the tv-fade-in animation replays, a deliberate, gentle crossfade
          rather than a hard cut between screens (Phase 11/54), matching
          the same "near-invisible, no flash/bounce/zoom" spirit as the
          photo carousel's own transition. */}
      <div key={screenIndex} className="flex-1 min-h-0 flex flex-col animate-tv-fade-in">
        <SectionErrorBoundary resetKey={`${screenIndex}:${rotationQueueKey}`} label={sectionLabels[current.sectionKey] || current.sectionKey}>
          <SectionScreen
            sectionKey={current.sectionKey}
            label={sectionLabels[current.sectionKey] || current.sectionKey}
            slide={current.slide}
            manual={current.manual}
            data={data}
            homeContentItem={current.homeContentItem}
            pickKey={current.pickKey}
            chartKey={current.chartKey}
            commsWeekData={commsWeekData}
            analyticsPeriod={settings?.analytics_period || "monthly"}
            analyticsPeriodQualifier={ANALYTICS_PERIOD_QUALIFIERS[settings?.analytics_period || "monthly"]}
            analyticsPeriodRange={computeAnalyticsPeriodRange(settings?.analytics_period || "monthly", settings?.analytics_period_selection || {})}
          />
        </SectionErrorBoundary>
      </div>

      {/* Footer, proves the screen is live and refreshing, not frozen,
          plus dots showing rotation position when there's more than one
          entry queued. */}
      <div className="shrink-0 pt-6 grid grid-cols-3 items-center text-xs text-ink-faint uppercase tracking-[0.16em]">
        <span className="justify-self-start">
          {error ? (
            <span className="text-warning">{error}</span>
          ) : (
            `Updated ${lastUpdated ? lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "..."} \u2022 Refreshes every 5 minutes`
          )}
        </span>
        <span className="justify-self-center flex items-center">
          {rotationQueue.length > 1 && (
            <span className="flex items-center gap-1.5">
              {rotationQueue.map((item, i) => (
                <span
                  key={`${item.sectionKey}-${item.slide?.id ?? item.homeContentItem?.id ?? "auto"}-${i}`}
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: i === screenIndex % rotationQueue.length ? 20 : 6,
                    backgroundColor: i === screenIndex % rotationQueue.length ? "#2563C4" : "#D5DBE6",
                  }}
                />
              ))}
            </span>
          )}
        </span>
        <span className="justify-self-end flex items-center">
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit full screen" : "Enter full screen"}
            aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
            className="mr-5 text-ink-faint hover:text-ems-primary transition-colors shrink-0"
          >
            {isFullscreen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 3v4a2 2 0 0 1-2 2H3M15 3v4a2 2 0 0 0 2 2h4M9 21v-4a2 2 0 0 0-2-2H3M15 21v-4a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <span>Event Management System</span>
        </span>
      </div>
    </div>
  );
}
