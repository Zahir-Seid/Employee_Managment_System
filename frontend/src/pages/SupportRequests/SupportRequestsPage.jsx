import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.jsx";
import CommsTodo from "../CommsTodo/CommsTodo.jsx";
import CalendarPage from "../Calendar/CalendarPage.jsx";
import CommsOverview from "./CommsOverview.jsx";
import CommsRequestsList from "../CommsRequests/CommsRequestsList.jsx";
import EmptyState from "../../components/common/EmptyState.jsx";

// Design spec §2 consolidation: Communications To-Do + Calendar live
// under this one "Support Requests" page as tabs. The old "List" tab was
// removed by request, then restored by the Support Requests Enhancement
// as "Requested Supports" (called "Assigned Requests" only for Communications
// team members, who see just the requests assigned to them; the Communications
// Lead keeps "Requested Supports" and sees all), visible to Staff too (scoped to their own events, same as before) so
// the "Support Requests was hidden from Staff because nothing here was
// theirs to see" problem doesn't recur (see Sidebar.jsx's nav-item
// comment for that history). "Overview" is new, Communications
// (including Comms Lead) and Leadership only, matching the Calendar's
// existing audience, since it's an org-wide summary Staff don't need.
// To-Do and Calendar are unchanged, exactly as they worked before.
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "requested_supports", label: "Requested Supports" },
  { key: "todo", label: "To-Do" },
  { key: "calendar", label: "Calendar" },
];

export default function SupportRequestsPage() {
  const { isCommunications, isCommunicationsLead, isLeadership, hasRole } = useAuth();
  const canSeeOverview = isCommunications || isLeadership;
  const canSeeRequestedSupports = true; // everyone with a role that reaches this page can see their scope of requests
  const canSeeTodo = isCommunications;
  const canSeeCalendar = isCommunications || isLeadership;
  // Wording only: team members' tab is "Assigned Requests"; the Lead's (and
  // everyone else's) stays "Requested Supports".
  const isTeamMember = isCommunications && !isCommunicationsLead;
  const visibleTabs = TABS.map((t) =>
    t.key === "requested_supports" && isTeamMember ? { ...t, label: "Assigned Requests" } : t
  ).filter((t) => {
    if (t.key === "overview") return canSeeOverview;
    if (t.key === "requested_supports") return canSeeRequestedSupports;
    if (t.key === "todo") return canSeeTodo;
    if (t.key === "calendar") return canSeeCalendar;
    return true;
  });
  // The tab lives in the URL (?tab=calendar) so that opening an event from the
  // Calendar and pressing Back lands on the same tab, not the first one.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab = visibleTabs.some((t) => t.key === requestedTab) ? requestedTab : visibleTabs[0]?.key || null;
  const setTab = (key) => setSearchParams({ tab: key }, { replace: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Support Requests</h1>
        <p className="text-sm text-ink-muted mt-1">Communications support requests, to-do items, and calendar in one place.</p>
      </div>

      {visibleTabs.length > 1 && (
        <div className="inline-flex flex-wrap rounded-lg border border-[#E5E9F0] bg-white p-1">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                "px-4 py-1.5 text-sm rounded-md transition-colors " +
                (tab === t.key ? "bg-ems-primary text-white font-medium" : "text-ink-muted hover:text-ink")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "overview" && canSeeOverview && <CommsOverview />}
      {tab === "requested_supports" && canSeeRequestedSupports && (
        <CommsRequestsList hideHeading={hasRole("staff", "admin")} />
      )}
      {tab === "todo" && canSeeTodo && <CommsTodo />}
      {tab === "calendar" && canSeeCalendar && <CalendarPage />}
      {visibleTabs.length === 0 && (
        <EmptyState
          title="Nothing here for your role"
          message="Support Requests' tabs are for Communications, Leadership, and Staff accounts."
        />
      )}
    </div>
  );
}
