import { useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import ExecutiveManagementReport from "./ExecutiveManagementReport.jsx";
import EventActivityReport from "./EventActivityReport.jsx";
import CommunicationsReport from "./CommunicationsReport.jsx";
import PartnerEngagementReport from "./PartnerEngagementReport.jsx";
import AnnualEventReport from "./AnnualEventReport.jsx";
import SavedReports from "./SavedReports.jsx";

// Reporting nav, EMS Reporting System: Complete Development + UI/UX
// Spec, §1-3. This supersedes the earlier role-based-nav pass: that
// version scoped Communications down to a Staff-like reduced view;
// this spec explicitly reverses that ("Communication should have the
// same report structure as Lead") because Communication needs
// visibility into the events/activities their communication work
// supports. So the real split now is:
//   - Communication, Leadership, Admin: full report suite, identical
//     navigation, all landing on Management Report by default.
//   - Staff: only the reports the spec's own role table marks ✓/✓*/
//     "Relevant" for them (Event Activity, Saved Reports,
//     Communications to relevant-subset). Reports marked "Permission"
//     (Management, Partner Engagement, Annual Event) are excluded
//     outright for Staff, not merely grayed out, no general
//     permission-grant system exists yet to hang a per-user override on,
//     so the default is exclusion rather than a fake toggle.
// Management Report, Event Activity Report (§14), Communications
// Report (§15/§16), Partner Engagement Report (§17), Annual Event
// Report (§18), and Saved Reports (§19) now all have a real page/data
// endpoint, this module's own §29/§40 phase this in one report at a
// time, so those six are the only cards marked available, for the
// roles the table actually grants each of them to. Report Builder
// (§39) is explicitly NOT to be built yet, so unlike the other
// not-built-yet reports it isn't listed as a card at all, there's
// nothing to preview or point at.
const ALL_REPORT_CARDS = [
  { key: "executive", label: "Management Report", available: true,
    description: "The primary management view - overall event and organizational performance.",
    roles: ["communications", "comms_lead", "leadership", "admin"] },
  { key: "event-activity", label: "Event Activity Report", available: true,
    description: "What events were conducted, where, when, by whom, and with what results.",
    roles: ["staff", "communications", "comms_lead", "leadership", "admin"] },
  { key: "partner-engagement", label: "Partner Engagement Report", available: true,
    description: "Which organizations and partners are engaged, and how often.",
    roles: ["communications", "comms_lead", "leadership", "admin"] },
  { key: "communications", label: "Communications Report", available: true,
    description: "Communication requests, support activity, status, and outputs.",
    roles: ["staff", "communications", "comms_lead", "leadership", "admin"] },
  { key: "annual", label: "Annual Event Report", available: true,
    description: "A full-year organizational summary - different from the current-period Management Report.",
    roles: ["communications", "comms_lead", "leadership", "admin"] },
  { key: "saved", label: "Saved Reports", available: true,
    description: "Previously saved report configurations you can reopen, re-run, or export.",
    roles: ["staff", "communications", "comms_lead", "leadership", "admin"] },
];

export default function ReportsHub() {
  const { userRoles, hasRole } = useAuth();
  // Full report suite (§1): Communication (incl. Communications Lead ,
  // see Support Requests Enhancement), Leadership, Admin all get the
  // same navigation. Only Staff gets the reduced, permission-gated set.
  const hasFullSuite = hasRole("communications", "comms_lead", "leadership", "admin");

  const cards = useMemo(() => ALL_REPORT_CARDS.filter((c) => c.roles.some((r) => userRoles.includes(r))), [userRoles]);

  // Overview tab removed: everyone lands directly on their first real
  // report tab instead of an intermediate card-grid landing page. Full
  // suite roles (Communication included, now the same as Lead/Admin)
  // land on Management Report; Staff lands on the first report their
  // role actually has (Event Activity Report).
  const [view, setView] = useState(hasFullSuite ? "executive" : cards[0]?.key || "event-activity");
  // Filter carry-over (spec §9): when the Management Report links to
  // "Completed Events" / "Communication Activities" etc., it hands its
  // active filters here so the destination report opens pre-filtered
  // instead of asking the user to re-select what they'd already chosen.
  // Cleared once consumed so a later plain tab-click starts clean.
  const [eventActivityFilters, setEventActivityFilters] = useState(null);
  const [communicationsFilters, setCommunicationsFilters] = useState(null);
  const [managementFilters, setManagementFilters] = useState(null);
  const [partnerEngagementFilters, setPartnerEngagementFilters] = useState(null);
  const [annualFilters, setAnnualFilters] = useState(null);

  function openEventActivity(filters) {
    setEventActivityFilters(filters || {});
    setView("event-activity");
  }

  function openCommunications(filters) {
    setCommunicationsFilters(filters || {});
    setView("communications");
  }

  function openPartnerEngagement(filters) {
    setPartnerEngagementFilters(filters || {});
    setView("partner-engagement");
  }

  // Saved Reports' "Open" action (spec §19): report_type -> the matching
  // tab/view, handing over the saved filters the exact same way the
  // Management Report's own drill-down links above do.
  function openSavedReport(reportType, filters) {
    if (reportType === "management") {
      setManagementFilters(filters || {});
      setView("executive");
    } else if (reportType === "event_activity") {
      openEventActivity(filters);
    } else if (reportType === "communications") {
      openCommunications(filters);
    } else if (reportType === "partner_engagement") {
      openPartnerEngagement(filters);
    } else if (reportType === "annual") {
      setAnnualFilters(filters || {});
      setView("annual");
    }
  }

  const tabs = hasFullSuite
    ? [
        { key: "executive", label: "Management Report" },
        { key: "event-activity", label: "Event Activity Report" },
        { key: "partner-engagement", label: "Partner Engagement Report" },
        { key: "communications", label: "Communications Report" },
        { key: "annual", label: "Annual Event Report" },
        { key: "saved", label: "Saved Reports" },
      ]
    : cards.filter((c) => c.available).map((c) => ({ key: c.key, label: c.label }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Reports</h1>
        <p className="text-sm text-ink-muted mt-1">
          {hasFullSuite ? "Organization-wide reporting, built on one shared data engine." : "Reports relevant to your own work."}
        </p>
      </div>

      <div className="inline-flex rounded-lg border border-[#E5E9F0] bg-white p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={
              "px-4 py-1.5 text-sm rounded-md transition-colors " +
              (view === t.key ? "bg-ems-primary text-white font-medium" : "text-ink-muted hover:text-ink")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tabs.length === 0 && (
        <p className="text-sm text-ink-muted">No reports are available for your role yet.</p>
      )}
      {view === "executive" && hasFullSuite && (
        <ExecutiveManagementReport
          onOpenEventActivity={openEventActivity}
          onOpenCommunications={openCommunications}
          onOpenPartnerEngagement={openPartnerEngagement}
          initialFilters={managementFilters}
          onFiltersConsumed={() => setManagementFilters(null)}
        />
      )}
      {view === "event-activity" && (
        <EventActivityReport
          initialFilters={eventActivityFilters}
          onFiltersConsumed={() => setEventActivityFilters(null)}
        />
      )}
      {view === "communications" && (
        <CommunicationsReport
          initialFilters={communicationsFilters}
          onFiltersConsumed={() => setCommunicationsFilters(null)}
        />
      )}
      {view === "partner-engagement" && hasFullSuite && (
        <PartnerEngagementReport
          onOpenEventActivity={openEventActivity}
          initialFilters={partnerEngagementFilters}
          onFiltersConsumed={() => setPartnerEngagementFilters(null)}
        />
      )}
      {view === "annual" && hasFullSuite && (
        <AnnualEventReport
          initialFilters={annualFilters}
          onFiltersConsumed={() => setAnnualFilters(null)}
        />
      )}
      {view === "saved" && <SavedReports onOpenReport={openSavedReport} />}
    </div>
  );
}
