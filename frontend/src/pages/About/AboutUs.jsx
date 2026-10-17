import MarketingHeader from "../../components/marketing/MarketingHeader.jsx";
import MarketingFooter from "../../components/marketing/MarketingFooter.jsx";

// About EMS content update: full six-section rewrite (Introduction,
// About the System, Who Uses EMS, What EMS Supports, Purpose, Contact
// and Support), reusing the same visual language as Home.jsx (GlowCard
// module cards, jm-eyebrow section labels) so the two marketing pages
// read as one product rather than two different templates. "About the
// System" and "What EMS Supports" cover the same ground on purpose:
// the former is one short paragraph, the latter is the itemized/visual
// version, so the capabilities are never listed out twice in two formats.

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
function ReportsIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M9 13h6M9 17h6" />
    </svg>
  );
}
function TvIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 19v2M8 6l4-3 4 3" />
    </svg>
  );
}
function BookIcon(props) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20" />
    </svg>
  );
}

const SUPPORT_AREAS = [
  {
    icon: EventsIcon,
    title: "Event Management",
    description: "Register events, edit details, and track each one from planning through completion.",
    glow: "#0E9AA8",
  },
  {
    icon: CommsIcon,
    title: "Communications",
    description: "Submit and manage Communications support requests, with checklist tracking built in.",
    glow: "#E58A2E",
  },
  {
    icon: DashboardsIcon,
    title: "Analytics & Dashboards",
    description: "View live dashboards on engagement, categories, thematic areas, and organizational activity.",
    glow: "#2B3A55",
  },
  {
    icon: ReportsIcon,
    title: "Event Reporting",
    description: "Complete Event Status Reports and generate reports across events, participants, and outcomes.",
    glow: "#7C5CD6",
  },
  {
    icon: TvIcon,
    title: "TV Display",
    description: "Show upcoming events, today's activities, and organizational updates on shared screens.",
    glow: "#2563C4",
  },
  {
    icon: BookIcon,
    title: "Knowledge & Resources",
    description: "Access shared resources and institutional knowledge connected to past and current events.",
    glow: "#1D9E75",
  },
];

const USER_GROUPS = [
  { title: "EE Staff", description: "Log events, submit support requests, and complete post event reports." },
  { title: "Communications Team", description: "Review and fulfill support requests and manage the TV Display." },
  { title: "Leadership / Management", description: "Monitor organizational activity through dashboards and reports." },
  { title: "System Administrators", description: "Manage configuration, user accounts, and system settings." },
];

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

export default function AboutUs() {
  return (
    <div className="min-h-screen bg-pagebg">
      <MarketingHeader active="about" />

      {/* 1. Introduction */}
      <section className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -left-24 h-96 w-96 rounded-full blur-3xl opacity-20"
          style={{ background: "#2563C4" }}
        />
        <div className="max-w-[640px] mx-auto px-6 py-20 text-center relative">
          <p className="jm-eyebrow text-ems-primary mb-3">About EMS</p>
          <h1 className="text-3xl md:text-5xl font-extrabold text-ink tracking-tight leading-tight mb-5">
            Event Management System
          </h1>
          <p className="text-ink-muted text-base md:text-lg max-w-2xl mx-auto">
            EMS is an internal platform for logging events, coordinating communications support,
            and documenting outcomes in one shared place, so information stays with the organization instead of
            scattered spreadsheets and inboxes.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16 space-y-14">
        {/* 2. About the System */}
        <div>
          <h2 className="text-xl font-bold text-ink mb-3">About the System</h2>
          <p className="text-sm text-ink-muted max-w-2xl leading-relaxed">
            EMS gives every team a centralized way to register and manage events, coordinate related
            activities, and keep a dependable record of what happened and why. It brings event registration,
            communications support, status tracking, reporting, dashboards, and shared resources into one
            connected system that Staff, Communications, and Leadership all rely on, instead of information
            sitting apart in separate spreadsheets, emails, and folders.
          </p>
        </div>

        {/* 3. Who Uses EMS */}
        <div>
          <h2 className="text-xl font-bold text-ink mb-1">Who Uses EMS</h2>
          <p className="text-sm text-ink-muted max-w-2xl mb-6">
            EMS is built around four groups who each rely on it differently.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {USER_GROUPS.map((group) => (
              <div key={group.title} className="rounded-card bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5">
                <h3 className="text-sm font-bold text-ink mb-1">{group.title}</h3>
                <p className="text-sm text-ink-muted">{group.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. What EMS Supports */}
      <section className="bg-ems-primaryLight/40 border-t border-line py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="jm-eyebrow text-ems-primary mb-2">What EMS Supports</p>
          <h2 className="text-2xl md:text-3xl font-bold text-ink tracking-tight max-w-lg mb-12">
            Everything an event needs, in one system.
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {SUPPORT_AREAS.map((area) => (
              <GlowCard key={area.title} glow={area.glow}>
                <div
                  className="h-12 w-12 rounded-lg flex items-center justify-center mb-5"
                  style={{ background: `${area.glow}1A`, color: area.glow }}
                >
                  <area.icon />
                </div>
                <h3 className="text-lg font-bold text-ink mb-2">{area.title}</h3>
                <p className="text-sm text-ink-muted">{area.description}</p>
              </GlowCard>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16 space-y-14">
        {/* 5. Purpose */}
        <div>
          <h2 className="text-xl font-bold text-ink mb-3">Purpose</h2>
          <p className="text-sm text-ink-muted max-w-2xl leading-relaxed">
            EMS exists to improve coordination, visibility, documentation, and the use of event information
            across the organization. By keeping every event's activity organized and accessible in one place, it
            helps teams work together more effectively and gives Leadership a clear, current view of
            organizational activity.
          </p>
        </div>

        {/* 6. Contact / Support */}
        <div className="rounded-card bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6">
          <h2 className="text-xl font-bold text-ink mb-3">Contact and Support</h2>
          <p className="text-sm text-ink-muted max-w-2xl leading-relaxed">
            For help with a Communications support request, reach the Communications team at{" "}
            <a href="mailto:communications@ee.local" className="text-ems-primary hover:underline">
              communications@ee.local
            </a>
            . For questions about your account or access to EMS, contact your System Administrator.
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

