import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.jsx";
import MarketingHeader from "../../components/marketing/MarketingHeader.jsx";
import MarketingFooter from "../../components/marketing/MarketingFooter.jsx";
import { contentApi } from "../../api/content";
import { formatDate, formatDateRange } from "../../utils/format";

// Item #1 (redesign) + landing-page merge: this page is converted from the
// ems-landing.html mockup into a real React route, recolored from the
// mockup's red palette onto the app's actual brand blue (ems.primary /
// theme(colors.ems.*), same tokens Dashboard.jsx etc. already use) so
// the marketing page and the logged-in app feel like one product.

const iconBase = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function SearchIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function LifecycleIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function ShieldIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function EventsIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function CommsIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M3 11l18-5v13L3 15v-4z" />
      <path d="M11.6 16.8 3 11" />
    </svg>
  );
}
function ReportsIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M9 13h6M9 17h6" />
    </svg>
  );
}
function DashboardsIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M3 3v18h18" />
      <rect x="7" y="12" width="3" height="6" />
      <rect x="12" y="8" width="3" height="10" />
      <rect x="17" y="5" width="3" height="13" />
    </svg>
  );
}
function GlobeIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: SearchIcon,
    title: "Smart Event Search",
    description: "Quickly find any event, communication request, or report through unified search across regions and years.",
  },
  {
    icon: LifecycleIcon,
    title: "Lifecycle Management",
    description: "Manage event logging, communications support, post-event reporting, and archival in a single workflow.",
  },
  {
    icon: ShieldIcon,
    title: "Secured System",
    description: "Protect event and communications data with role-based access, audit logs, and secure institutional sign-in.",
  },
];

// Item #10 / feedback: each module card gets a subtle color "bleed", a
// soft glow anchored in the top-right corner, using the app's existing
// category taxonomy colors (the same International/National/Sub-national/
// Internal palette used everywhere else) instead of inventing new colors.
const MODULES = [
  {
    num: "/01",
    icon: EventsIcon,
    title: "Log Events",
    description: "International, National, Sub-national, and Internal events captured in one guided form.",
    glow: "#0E9AA8", // category.international
  },
  {
    num: "/02",
    icon: CommsIcon,
    title: "Comms Support",
    description: "Photography, banners, and branded materials with built-in to-do tracking.",
    glow: "#E58A2E", // category.internal
  },
  {
    num: "/03",
    icon: ReportsIcon,
    title: "Event Status Reports",
    description: "Document outcomes, contributions, and follow-up actions the same day.",
    glow: "#7C5CD6", // category.regional (design token name; label is Sub-national)
  },
  {
    num: "/04",
    icon: DashboardsIcon,
    title: "Live Dashboards",
    description: "Engagement, support level, thematic area: weekly, monthly, quarterly.",
    glow: "#2B3A55", // category.national
  },
];

// Hover response for anything on the Home page that shows a photo: the same
// soft growing shadow the Dashboard KPI cards give (plus the faint blue ring
// those cards get when clickable). Only applied where there is a real photo.
const PHOTO_HOVER =
  "transition-shadow duration-200 ease-out hover:shadow-[0_8px_22px_rgba(15,23,42,0.08)] hover:ring-2 hover:ring-ems-primary/20";

function GlowCard({ glow, children, className = "" }) {
  return (
    <div className={`relative overflow-hidden bg-white rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-7 ${className}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full blur-3xl opacity-25"
        style={{ background: glow }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

// Home Page Dynamic Content Update: the static "Dashboard Preview" mock
// (hardcoded chart/pie-chart numbers) is retired, it showed fabricated
// data, not real content. Replaced below with the real dynamic content
// area (Featured Content, Latest News, Event Photos), fed by
// contentApi.getHomeFeed().

const KM_DEFAULTS = {
  km_resource_title: "EE News & Success Stories",
  km_resource_description: "See the latest updates and impact stories from EE globally.",
  km_resource_url: "https://www.ee.org",
};

// Shared pieces so News, Announcements, Major Events, Recently Held and
// Upcoming events all look identical: one card design (several items) and
// one spotlight design (exactly one item).

// Card used when a section has two or more items.
// visual = photo/date block for the 4:3 top slot.
function SectionCard({ visual, hideVisual = false, date, title, description, meta, action }) {
  const [expanded, setExpanded] = useState(false);
  const hasPhoto = !hideVisual && !!visual;
  return (
    <div
      className={`rounded-card bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col h-full ${hasPhoto ? PHOTO_HOVER : ""}`}
    >
      {!hideVisual && <div className="w-full aspect-[4/3] shrink-0 bg-ems-primaryLight/40">{visual}</div>}
      <div className="flex flex-col p-6 flex-1">
        {date && <p className="text-xs text-ink-faint mb-2">{date}</p>}
        <h4 className="text-lg font-bold text-ink mb-2 line-clamp-2">{title}</h4>
        {description && (
          <p className={`text-sm text-ink-muted flex-1 whitespace-pre-line ${expanded ? "" : "line-clamp-4"}`}>
            {description}
          </p>
        )}
        {meta}
        {(description || action) && (
          <div className="flex items-center justify-between gap-3 mt-5">
            {description ? (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="text-sm font-medium text-ems-primary hover:underline shrink-0"
              >
                {expanded ? "Show less" : "Read more \u2192"}
              </button>
            ) : (
              <span />
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

// Spotlight used when a section has exactly one item: photo/date block
// on the left, date pill, large bold headline (same Roboto as the rest of
// the app - no separate serif font), then details.
function SectionSpotlight({ visual, hideVisual = false, hasPhoto = false, date, title, children }) {
  return (
    <div className={`grid grid-cols-1 ${hideVisual ? "" : "lg:grid-cols-2"} gap-10 items-start`}>
      {!hideVisual && (
        <div
          className={`rounded-card overflow-hidden bg-ems-primaryLight/40 aspect-[4/3] lg:aspect-auto lg:h-[420px] ${hasPhoto ? PHOTO_HOVER : ""}`}
        >
          {visual}
        </div>
      )}
      <div>
        {date && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ems-primary bg-ems-primaryLight px-3 py-1 rounded-full mb-4">
            {date}
          </span>
        )}
        <h3 className="text-3xl md:text-4xl font-bold text-ink leading-tight mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function itemDate(item) {
  return item.content_type === "news"
    ? item.publish_date && formatDate(item.publish_date)
    : item.content_type === "major_event" && (item.effective_start_date || item.effective_end_date)
    ? formatDateRange(item.effective_start_date, item.effective_end_date)
    : null;
}

function itemVisual(item) {
  return item.image ? (
    <img src={item.image} alt="" className="h-full w-full object-cover" />
  ) : null;
}

// News / Announcement / Major Event card.
function ContentCard({ item }) {
  const title = item.effective_title || item.title;
  const viewHref =
    item.content_type === "major_event" && item.linked_event_detail ? `/events/${item.linked_event_detail.id}` : null;
  return (
    <SectionCard
      visual={itemVisual(item)}
      date={itemDate(item)}
      title={title}
      description={item.description}
      action={
        viewHref ? (
          <Link to={viewHref} className="text-sm font-medium text-ems-primary hover:underline shrink-0">
            View Event
          </Link>
        ) : null
      }
    />
  );
}

function ContentSpotlight({ item }) {
  const [expanded, setExpanded] = useState(false);
  const title = item.effective_title || item.title;
  const viewHref =
    item.content_type === "major_event" && item.linked_event_detail ? `/events/${item.linked_event_detail.id}` : null;
  const isLong = (item.description || "").length > 280;
  return (
    <SectionSpotlight
      hasPhoto={!!item.image}
      visual={
        item.image ? (
          <img src={item.image} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-xs font-semibold text-ems-primary uppercase tracking-wide px-6 text-center">
            {title}
          </div>
        )
      }
      date={itemDate(item)}
      title={title}
    >
      {item.description && (
        <>
          <p className={`text-sm text-ink-muted whitespace-pre-line ${expanded ? "" : "line-clamp-6"}`}>
            {item.description}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-sm font-medium text-ems-primary hover:underline mt-3"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}
      {viewHref && (
        <Link to={viewHref} className="jm-btn-primary inline-block mt-6 px-5 py-2 text-sm">
          View Event
        </Link>
      )}
    </SectionSpotlight>
  );
}

// Upcoming Events / Recently Held Events: two separate sections (not one
// shared panel), each with a blue eyebrow, a large heading whose last word
// is blue, a "Page 01 of 02" pager with square Prev/Next buttons, and one
// page of cards at a time (three on desktop, two on tablets, one on
// phones). Upcoming = white cards with a calendar icon tile, title, date
// and location; Recently Held = photo cards with a blue date and title.
// Upcoming sits on a light band and Recently Held below it on white,
// divided by a thin line. A section hides itself when it has no items.

function parseDay(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

// "October 12-14, 2026" / "November 5, 2026" / "October 30 - November 2, 2026"
function formatEventRange(start, end) {
  const a = parseDay(start);
  const b = parseDay(end) || a;
  if (!a) return "";
  const full = { month: "long", day: "numeric", year: "numeric" };
  if (!b || a.getTime() === b.getTime()) return a.toLocaleDateString("en-US", full);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.toLocaleDateString("en-US", { month: "long" })} ${a.getDate()}\u2013${b.getDate()}, ${b.getFullYear()}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    const md = { month: "long", day: "numeric" };
    return `${a.toLocaleDateString("en-US", md)} \u2013 ${b.toLocaleDateString("en-US", full)}`;
  }
  return `${a.toLocaleDateString("en-US", full)} \u2013 ${b.toLocaleDateString("en-US", full)}`;
}

function PinIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function ChevronIcon({ direction = "right" }) {
  return (
    <svg {...iconBase} width={18} height={18} aria-hidden="true">
      <path d={direction === "right" ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} />
    </svg>
  );
}

function cardsPerPage() {
  if (typeof window === "undefined" || !window.matchMedia) return 3;
  if (window.matchMedia("(min-width: 1024px)").matches) return 3;
  if (window.matchMedia("(min-width: 640px)").matches) return 2;
  return 1;
}

function usePageSize() {
  const [size, setSize] = useState(cardsPerPage);
  useEffect(() => {
    const onResize = () => setSize(cardsPerPage());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

function PagedSection({ eyebrow, title, items, renderItem }) {
  const pageSize = usePageSize();
  const [page, setPage] = useState(0);
  const total = items ? items.length : 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Clamp if the screen is resized (or the list shrinks) past the last page.
  const current = Math.min(page, pageCount - 1);
  if (total === 0) return null;

  const words = title.split(" ");
  const last = words.pop();
  const pad = (n) => String(n).padStart(2, "0");
  const visible = items.slice(current * pageSize, current * pageSize + pageSize);

  const arrowClass = (enabled) =>
    "h-11 w-11 rounded-xl border flex items-center justify-center transition-colors " +
    (enabled
      ? "border-line bg-white text-ink shadow-sm hover:bg-surface-muted"
      : "border-line bg-transparent text-ink-faint cursor-default");

  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-10">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ems-primary mb-3">{eyebrow}</p>
          <h2 className="text-3xl md:text-5xl font-extrabold text-ink tracking-tight">
            {words.join(" ")} <span className="text-ems-primary">{last}</span>
          </h2>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm font-medium text-ink-muted mr-1">
              Page {pad(current + 1)} of {pad(pageCount)}
            </span>
            <button
              type="button"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
              aria-label={`Previous ${title}`}
              className={arrowClass(current > 0)}
            >
              <ChevronIcon direction="left" />
            </button>
            <button
              type="button"
              onClick={() => setPage(current + 1)}
              disabled={current >= pageCount - 1}
              aria-label={`Next ${title}`}
              className={arrowClass(current < pageCount - 1)}
            >
              <ChevronIcon direction="right" />
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {visible.map((item) => (
          <div key={item.id}>{renderItem(item)}</div>
        ))}
      </div>
    </div>
  );
}

function UpcomingEventTile({ item }) {
  const start = item.effective_start_date || item.start_date;
  const end = item.effective_end_date || item.end_date;
  const location = item.effective_location || item.location;
  const dateLabel = formatEventRange(start, end);
  return (
    <Link
      to={`/events/${item.id}`}
      className="h-full rounded-2xl bg-white border border-line shadow-[0_1px_3px_rgba(15,23,42,0.05)] p-7 flex flex-col"
    >
      <div className="h-12 w-14 rounded-xl bg-ems-primaryLight flex items-center justify-center text-ems-primary mb-8">
        <EventsIcon width={24} height={24} />
      </div>
      <h3 className="text-xl md:text-2xl font-bold text-ink leading-snug mb-6 line-clamp-2 min-h-[3.5rem]">{item.title}</h3>
      <div className="space-y-3 text-ink-muted">
        {dateLabel && (
          <p className="flex items-start gap-3">
            <EventsIcon width={18} height={18} className="mt-1 shrink-0 text-ems-primary" />
            <span>{dateLabel}</span>
          </p>
        )}
        {location && (
          <p className="flex items-start gap-3">
            <PinIcon width={18} height={18} className="mt-1 shrink-0 text-ems-primary" />
            <span>{location}</span>
          </p>
        )}
      </div>
      <span className="mt-5 self-start text-sm font-medium text-ems-primary">View details &rarr;</span>
    </Link>
  );
}

function HeldEventTile({ event }) {
  const dateLabel = formatEventRange(event.end_date || event.start_date, event.end_date || event.start_date);
  return (
    <div>
      <div
        className={`aspect-[4/3] w-full rounded-2xl overflow-hidden bg-[#F4F6F9] mb-6 ${event.image ? PHOTO_HOVER : ""}`}
      >
        {event.image ? (
          <img src={event.image} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-ink-faint">
            <EventsIcon width={36} height={36} />
          </div>
        )}
      </div>
      {dateLabel && <p className="text-sm font-bold text-ems-primary mb-3">{dateLabel}</p>}
      <h3 className="text-xl md:text-2xl font-bold text-ink leading-snug line-clamp-2">{event.title}</h3>
    </div>
  );
}

function EventsShowcase({ upcoming, held }) {
  const hasUpcoming = upcoming && upcoming.length > 0;
  const hasHeld = held && held.length > 0;
  if (!hasUpcoming && !hasHeld) return null;
  return (
    <>
      {hasUpcoming && (
        <section className="bg-[#F7F9FC] border-t border-line">
          {/* Starts at the page's left edge, same padding as the header
              (MarketingHeader) so the heading lines up under the logo,
              instead of floating in a centered box. The inner max-width
              (976px = the old max-w-5xl minus its padding) keeps the cards
              exactly the size they were. */}
          <div className="w-full px-4 sm:px-6 lg:px-8 py-16 md:py-20">
            <div className="max-w-[976px]">
              <PagedSection
                eyebrow="Institutional Calendar"
                title="Upcoming Events"
                items={upcoming}
                renderItem={(item) => <UpcomingEventTile item={item} />}
              />
            </div>
          </div>
        </section>
      )}
      {hasHeld && (
        <section className="bg-white border-t border-line">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-16 md:py-20">
            <div className="max-w-[976px]">
              <PagedSection
                eyebrow="Event Archive"
                title="Recently Held Events"
                items={held}
                renderItem={(event) => <HeldEventTile event={event} />}
              />
            </div>
          </div>
        </section>
      )}
    </>
  );
}

// One shared section shell for every dynamic section on the Home page
// (Major Events, Announcements, News, Recently Held, Upcoming): a single
// title, hidden when empty, spotlight layout for exactly one item,
// otherwise a 3-column grid capped at 6 items.
function ContentGridSection({ heading, items, renderCard, renderSpotlight }) {
  if (!items || items.length === 0) return null;
  const capped = items.slice(0, 6);
  return (
    <section className="max-w-5xl mx-auto px-6 pb-16">
      <h2 className="text-xl font-bold text-ink tracking-tight mb-6 pb-6 border-b border-line">{heading}</h2>
      {capped.length === 1 ? (
        renderSpotlight(capped[0])
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {capped.map((item) => renderCard(item))}
        </div>
      )}
    </section>
  );
}

// "Recent moments" slideshow. Doc §10: fully automatic, pulled from photos
// already attached to Event Status Reports, never a separate admin upload.
// Hidden entirely if empty.
//
// One large photo at a time that changes by itself every 5 seconds with a
// slow cross-fade (not a sliding animation), with the event title and date
// shown on the photo, prev/next arrows and dots to move manually, and the
// automatic change paused while the pointer is over the slideshow (or a
// control inside it has keyboard focus). Moving manually restarts the 5 s.
const SLIDE_INTERVAL_MS = 5000;

function EventPhotosStrip({ photos }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = photos ? photos.length : 0;
  const current = count > 0 ? index % count : 0;

  useEffect(() => {
    if (count < 2 || paused) return undefined;
    // Re-created on every slide change, so a manual move (arrows/dots) also
    // gives the new photo a full 5 seconds.
    const timer = setTimeout(() => setIndex((i) => (i + 1) % count), SLIDE_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [current, paused, count]);

  if (count === 0) return null;

  const go = (next) => setIndex(((next % count) + count) % count);
  const arrowClass =
    "absolute top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/90 text-ink shadow-md flex items-center justify-center transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ems-primary";

  return (
    <section className="max-w-4xl mx-auto px-6 pb-16">
      <h2 className="text-xl font-bold text-ink tracking-tight mb-6">Recent moments</h2>
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label="Recent moments"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-[#F4F6F9]">
          {photos.map((photo, i) => {
            const dateLabel = formatEventRange(photo.event_start_date, photo.event_end_date);
            const active = i === current;
            return (
              <figure
                key={photo.id}
                aria-hidden={!active}
                className={`absolute inset-0 m-0 transition-opacity duration-1000 ease-in-out motion-reduce:transition-none ${
                  active ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                <img
                  src={photo.image}
                  alt={photo.event_title}
                  className="h-full w-full object-cover"
                  loading={i === 0 ? "eager" : "lazy"}
                />
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-6 pb-6 pt-16 md:px-8 md:pb-8">
                  <p className="text-xl md:text-3xl font-bold text-white leading-snug">{photo.event_title}</p>
                  {dateLabel && <p className="text-sm md:text-base text-white/85 mt-1">{dateLabel}</p>}
                </figcaption>
              </figure>
            );
          })}
          {count > 1 && (
            <>
              <button type="button" onClick={() => go(current - 1)} aria-label="Previous photo" className={arrowClass + " left-4"}>
                <ChevronIcon direction="left" />
              </button>
              <button type="button" onClick={() => go(current + 1)} aria-label="Next photo" className={arrowClass + " right-4"}>
                <ChevronIcon direction="right" />
              </button>
            </>
          )}
        </div>
        {count > 1 && (
          <div className="flex items-center justify-center gap-2 mt-5">
            {photos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`Show photo ${i + 1} of ${count}`}
                aria-current={i === current ? "true" : undefined}
                className={`h-2 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ems-primary ${
                  i === current ? "w-6 bg-ems-primary" : "w-2 bg-[#D5DBE6] hover:bg-ink-faint"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [feed, setFeed] = useState(null);

  useEffect(() => {
    let cancelled = false;
    contentApi
      .getHomeFeed()
      .then(({ data }) => {
        if (!cancelled) setFeed(data);
      })
      .catch(() => {
        // Doc §1: the Hero must never depend on this content existing or
        // loading successfully, fail silently and just show fewer
        // dynamic sections below it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const siteSettings = feed?.site_settings || KM_DEFAULTS;

  return (
    <div className="min-h-screen bg-pagebg">
      {/* HEADER */}
      <MarketingHeader active="home" />

      {/* HERO: soft light wash, big centered headline with the middle line
          in the brand blue-to-teal gradient (ems primary #2563C4 ->
          chartSecondary teal #0E9AA8). Content is unchanged. */}
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-ems-primaryLight/50 via-pagebg to-pagebg">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 left-1/2 -translate-x-1/2 h-96 w-[36rem] rounded-full blur-3xl opacity-25"
          style={{ background: "linear-gradient(90deg, #2563C4, #0E9AA8)" }}
        />
        <div className="max-w-4xl mx-auto px-6 py-20 md:py-28 text-center relative">
          <h1 className="text-5xl md:text-7xl font-extrabold text-ink tracking-tight leading-[1.08] mb-6">
            <span className="bg-gradient-to-r from-ems-primary to-ems-chartSecondary bg-clip-text text-transparent">
              Event Management
            </span>
            <br />
            System
          </h1>
          <p className="text-ink-muted text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
            The single workspace for planning events, coordinating communications, and tracking engagement
            built for staff, Communications, and Leadership.
          </p>
          {!isAuthenticated && (
            <div className="mt-10 flex items-center justify-center gap-3 flex-wrap">
              <Link
                to="/login"
                className="jm-btn-primary px-7 py-3 text-sm rounded-lg shadow-[0_8px_20px_rgba(37,99,196,0.28)]"
              >
                Get Started
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* DYNAMIC CONTENT AREA, redesign: Major Events, Announcements,
          and News each get their own section using one shared card
          style. Each section hides itself entirely when there's nothing
          active to show. */}
      <ContentGridSection
        heading="Major Events"
        items={feed?.major_events}
        renderCard={(item) => <ContentCard key={item.id} item={item} />}
        renderSpotlight={(item) => <ContentSpotlight item={item} />}
      />
      <ContentGridSection
        heading="Announcements"
        items={feed?.announcements}
        renderCard={(item) => <ContentCard key={item.id} item={item} />}
        renderSpotlight={(item) => <ContentSpotlight item={item} />}
      />
      <ContentGridSection
        heading="From around EMS"
        items={feed?.latest_news}
        renderCard={(item) => <ContentCard key={item.id} item={item} />}
        renderSpotlight={(item) => <ContentSpotlight item={item} />}
      />

      {/* Upcoming (automatic from the Event Registry) and Recently Held (automatic from
          Events): two separate paged sections divided by a thin line. */}
      <EventsShowcase upcoming={feed?.upcoming_events} held={feed?.held_events} />

      {/* INTRO / FEATURES */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <p className="jm-eyebrow text-ems-primary mb-2">Overview</p>
        <h2 className="text-2xl md:text-3xl font-bold text-ink tracking-tight mb-4">
          Event Intelligence <span className="text-ems-primary">Redefined.</span>
        </h2>
        <p className="text-ink-muted text-base max-w-xl mb-12">
          EMS maps every event, request, and report across your institutional memory, so every team,
          every region, every quarter is in view.
        </p>

        <div className="flex flex-col gap-9">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex gap-5 items-start max-w-xl">
              <div className="h-12 w-12 min-w-[3rem] rounded-lg bg-ems-primaryLight text-ems-primary flex items-center justify-center">
                <f.icon />
              </div>
              <div>
                <h3 className="text-base font-bold text-ink mb-1">{f.title}</h3>
                <p className="text-sm text-ink-muted">{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* MODULES */}
      <section className="bg-ems-primaryLight/40 border-t border-line py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="jm-eyebrow text-ems-primary mb-2">The Platform</p>
          <h2 className="text-2xl md:text-3xl font-bold text-ink tracking-tight max-w-lg mb-12">
            Four modules. One story per event.
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {MODULES.map((m) => (
              <GlowCard key={m.title} glow={m.glow}>
                <p className="text-xs font-mono font-bold text-ink-faint tracking-wide mb-4">{m.num}</p>
                <div
                  className="h-12 w-12 rounded-lg flex items-center justify-center mb-5"
                  style={{ background: `${m.glow}1A`, color: m.glow }}
                >
                  <m.icon />
                </div>
                <h3 className="text-lg font-bold text-ink mb-2">{m.title}</h3>
                <p className="text-sm text-ink-muted">{m.description}</p>
              </GlowCard>
            ))}

            {/* Doc §1: the KM Resource card, permanently on the Home
                Page, admin-editable link/title/description, same
                GlowCard pattern as the four module cards above. The
                link wraps the whole card so it's clickable. */}
            <a
              href={siteSettings.km_resource_url}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              <GlowCard glow="#2563C4" className="h-full hover:shadow-[0_4px_14px_rgba(0,0,0,0.08)] transition-shadow">
                <div
                  className="h-12 w-12 rounded-lg flex items-center justify-center mb-5"
                  style={{ background: "#2563C41A", color: "#2563C4" }}
                >
                  <GlobeIcon />
                </div>
                <h3 className="text-lg font-bold text-ink mb-2">{siteSettings.km_resource_title}</h3>
                <p className="text-sm text-ink-muted mb-3">{siteSettings.km_resource_description}</p>
                <span className="text-sm font-medium text-ems-primary">Visit ee.org &rarr;</span>
              </GlowCard>
            </a>
          </div>
        </div>
      </section>

      <EventPhotosStrip photos={feed?.event_photos} />

      <MarketingFooter />
    </div>
  );
}
