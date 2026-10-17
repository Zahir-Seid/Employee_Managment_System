import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.jsx";
import PostEventReportsList from "../PostEventReport/PostEventReportsList.jsx";
import Reports from "../Reports/Reports.jsx";

// Design spec §2 consolidation: the org-wide Reports (PDF/Excel export) page
// becomes a "Generate Reports" tab here, alongside "My Reports" (Staff's own
// pending/submitted post-event reports). Both child components are
// unmodified. Staff see both tabs; Communications/Leadership see only
// Generate Reports, since My Reports is inherently staff's-own-events scoped
// (mirrors the original /post-event-reports route's staff-only protection).
//
// Six-Report System spec: the Executive Management Report used to have a
// tab here ("Organizational Performance"), moved out to its own top-level
// /reports route instead (see ReportsHub.jsx), since this whole page's
// route is staff/communications-only and Leadership could never reach an
// org-wide report living here in the first place.
export default function PostEventReportsPage() {
  const { isStaff } = useAuth();
  const [searchParams] = useSearchParams();

  // Default landing tab is now always Generate Reports, clicking the
  // "Event Status Reports" nav item itself (no ?status=) should go
  // straight there, not to My Reports. Computed from the URL at mount
  // (not a plain "generate" default + a follow-up effect) so a direct
  // link/bookmark/refresh to e.g. ?status=upcoming lands on the right tab
  // immediately, with no flash of Generate Reports first.
  function tabForStatus(status) {
    if (!isStaff || !status) return "generate";
    return status === "overdue" ? "overdue" : "mine";
  }
  // The Sidebar's "Generate Report" sub-link carries its own explicit
  // ?tab=generate marker rather than just clearing ?status=, see why below.
  function initialTab() {
    if (searchParams.get("tab") === "generate") return "generate";
    return tabForStatus(searchParams.get("status"));
  }
  const [tab, setTab] = useState(initialTab);

  // The Sidebar's sub-links deep-link here with ?status=..., which routes to
  // the tab that renders it: "overdue" to the Overdue tab, everything else to
  // My Reports. The Generate Report link carries an explicit ?tab=generate
  // marker, checked first, so it always wins over a cleared status. A status
  // that is merely removed does not force a tab switch.
  useEffect(() => {
    if (searchParams.get("tab") === "generate") {
      setTab("generate");
      return;
    }
    const status = searchParams.get("status");
    if (status) setTab(tabForStatus(status));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Per-view header: breadcrumb (small, names which view you're on - kept
  // per earlier request; the app-wide breadcrumb row was intentionally
  // removed elsewhere, see AppLayout.jsx, this isn't reversing that) plus
  // a real bold title + one-line description for each of the 5 Sidebar
  // sub-links (Pending, Upcoming, Completed, Overdue, Generate
  // Report). This title+description is the ONLY place that view's name
  // and explanation appear now - PostEventReportsList's own per-section
  // heading/description is suppressed whenever a single status is
  // filtered in (see its showSectionLabel), since repeating "Upcoming"
  // and its description a second time, right under this, was the
  // complaint. (The small tiny-caption version this replaced read as an
  // empty gap once that repeat was dropped - a real title fills it.)
  const statusFilter = searchParams.get("status");
  const VIEW_HEADERS = {
    draft: {
      title: "Draft",
      description: "Reports you have saved but not sent yet, whether the event is upcoming, recently ended, or overdue.",
    },
    pending: {
      title: "Pending",
      description: "Reports awaiting action before their deadline. A report you saved but have not submitted shows a Draft badge.",
    },
    upcoming: {
      title: "Upcoming",
      description: "Upcoming events with no report yet. Draft reports are not shown here.",
    },
    completed: {
      title: "Completed",
      description: "Event Status Reports you have already submitted. Drafts are not shown here.",
    },
    overdue: {
      title: "Overdue",
      description: "Reports past their deadline that have not been submitted, including drafts. Each shows its real status.",
    },
    generate: {
      title: "Generate Report",
      description: "Generate org-wide report exports (PDF/Excel).",
    },
  };
  const viewKey =
    tab === "generate" ? "generate" : tab === "overdue" ? "overdue" : tab === "mine" ? statusFilter : null;
  const header = VIEW_HEADERS[viewKey];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{header ? header.title : "Event Status Reports"}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {header ? header.description : "Submit your own reports and generate org-wide report exports."}
        </p>
      </div>

      {/* The in-page "My Reports / Overdue / Generate Reports" pill-button
          row used to live here, but it duplicated the Sidebar's own
          Pending, Upcoming, Completed, Overdue, Generate Report
          sub-links one-for-one, two separate switchers for the same five
          views. Removed per feedback; the Sidebar is now the only
          navigation between these views. `tab` itself is untouched, it's
          still driven by the URL (via the effect above), which is exactly
          how the Sidebar's own links already navigate here. */}

      {(tab === "mine" || tab === "overdue") && isStaff && <PostEventReportsList />}
      {tab === "generate" && <Reports />}
    </div>
  );
}
