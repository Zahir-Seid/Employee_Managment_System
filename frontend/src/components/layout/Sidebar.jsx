import { Fragment, useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.jsx";
import { eventsApi } from "../../api/events";
import { communicationsApi } from "../../api/communications";

// Design spec §2 originally called for exactly 5 identical nav items for
// every role. Audit Trail stays hidden from Staff (Comms/Leadership-only
// route). Support Requests was hidden from Staff entirely in an earlier
// pass (every tab 403'd for them), un-hidden once a "List" tab gave them
// something real to see (their own submitted requests), hidden again
// once that tab was removed, and un-hidden once more now that the
// Support Requests Enhancement's requests tab restores
// exactly that same read-only "my own submitted requests" view (see
// SupportRequestsPage.jsx). Leadership stays hidden from this nav item on
// purpose, unchanged from before this feature, not revisited here.
const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: IconGrid },
  { to: "/events", label: "Events", icon: IconCalendar, countKey: "open_events", hideForRoles: ["leadership"], section: "Event Management" },
  {
    to: "/support-requests",
    label: "Support Requests",
    icon: IconShieldQuestion,
    countKey: "open_support_requests",
    hideForRoles: ["leadership"],
    section: "Communications",
  },
  {
    to: "/post-event-reports",
    label: "Event Status Reports",
    icon: IconDoc,
    section: "Event Management",
    // Item 22: expands right in the Sidebar (not a separate page section).
    // Draft/Pending, Upcoming, Completed, and Overdue were previously
    // removed from this list by request (My Reports/Overdue were still
    // reachable as tabs on the page itself, just not deep-linked from
    // here) - restored per follow-up request, back to all 5 sub-items.
    // The `status=` values match what PostEventReportsList/
    // PostEventReportsPage already read from the URL, and `reportCounts`
    // below was already computed with these exact keys the whole time
    // (it just had nothing to attach to while only "generate" existed).
    //
    // Bug fix: "generate" used to have no `search` at all, so it just
    // cleared whatever ?status= was already in the URL. PostEventReportsPage
    // treats a *cleared* status as "don't force a tab switch" (needed for
    // its own "Show all" link), so clicking this while on e.g. the
    // Overdue tab cleared the URL's status but never actually switched
    // the visible tab away from Overdue. It now sends its own explicit
    // ?tab=generate marker so PostEventReportsPage can tell "go to
    // Generate" apart from "just clear the filter" and always switch.
    subItems: [
      { key: "pending", label: "Pending", search: "status=pending" },
      { key: "upcoming", label: "Upcoming", search: "status=upcoming" },
      { key: "completed", label: "Completed", search: "status=completed" },
      { key: "overdue", label: "Overdue", search: "status=overdue" },
      { key: "generate", label: "Generate Report", search: "tab=generate" },
    ],
    // These sub-links deep-link into "My Reports"/"Overdue" on
    // PostEventReportsPage, views that only exist for Staff (isStaff, in
    // AuthContext terms, is staff+admin). Communications used to see this
    // same sub-item list but had nothing to land on when clicking any of
    // them, so it's now Staff-only, matching PostEventReportsPage itself.
    subItemsForRoles: ["staff", "admin"],
  },
  // Six-Report System spec, Part 2: top-level "Reports", visible to
  // Communications/Admin/Leadership. Hidden from Staff per follow-up
  // request (the Reports tab is excluded from the Staff nav).
  // "Reports" menu link removed for every role by request. The /reports page
  // and route still exist in the code, they just have no menu entry now.
  { to: "/audit-trail", label: "Audit Trail", icon: IconShield, hideForRoles: ["staff", "leadership"], section: "Reporting" },
  // TV Display management (settings, queue, content) is Admin/Communications
  // only now, Staff and Leadership have no write access to any of it
  // (see IsAdminOrLeadership/IsCommunicationsOrAdmin on the backend), so a
  // nav link that only ever 403'd or showed a read-only page for them was
  // just noise. The live kiosk screen itself (/tv-display) is unaffected ,
  // this only hides the management/settings link.
  { to: "/tv-display-settings", label: "TV Display", icon: IconTv, hideForRoles: ["staff", "leadership"], section: "Communications" },
  {
    to: "/admin",
    label: "Settings",
    icon: IconSettings,
    requiresAdmin: true,
    section: "Administration",
    // No count badge on Settings (the org-wide overdue count was removed).
    // Dropdown: each sub-link goes to its own /admin/... page (`path`).
    subItems: [
      { key: "user-management", label: "User Management", path: "/admin/staff" },
      { key: "configuration", label: "Configuration", path: "/admin/configuration" },
      { key: "admin-tv-display", label: "TV Display", path: "/admin/tv-display" },
      { key: "home-content", label: "Home Content", path: "/admin/home-content" },
    ],
  },
  // Profile: one menu item for every role (no hideForRoles / requiresAdmin).
  { to: "/profile", label: "Profile", icon: IconUser, section: "Account" },
];

// Sidebar groups, in display order. Items with no `section` (Dashboard) sit
// at the top with no label. Items are stable-sorted by this order at render
// time, so the flat NAV_ITEMS array above can stay in any order.
const SECTION_ORDER = ["Event Management", "Communications", "Reporting", "Administration", "Account"];

const ROLE_LABELS = {
  staff: "Staff",
  communications: "Communications",
  comms_lead: "Communications Lead",
  leadership: "Leadership, SMT",
};

function IconGrid(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function IconCalendar(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconShieldQuestion(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 15v.01M12 9a1.8 1.8 0 111.6 2.7c-.6.4-1 .8-1 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconDoc(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M6 3h8l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 12h6M9 16h6M9 9h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function IconShield(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconTv(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 21h8M12 19v2M8 6l4-3 4 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconUser(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconChevron(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconSettings(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 13a7.6 7.6 0 000-2l2-1.5-2-3.5-2.4 1a7.6 7.6 0 00-1.7-1L15 3.5h-4l-.3 2.5a7.6 7.6 0 00-1.7 1l-2.4-1-2 3.5L6.6 11a7.6 7.6 0 000 2l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 001.7 1l.3 2.5h4l.3-2.5a7.6 7.6 0 001.7-1l2.4 1 2-3.5-2-1.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Sidebar({ open, onClose, collapsed = false }) {
  // `collapsed` only affects desktop (lg+): an icon-only rail. The mobile
  // drawer always shows the full sidebar.
  const hideWhenCollapsed = collapsed ? " lg:hidden" : "";
  const { user, logout, isAdminRole, userRoles, hasRole } = useAuth();
  const rolesKey = userRoles.join(",");
  const navigate = useNavigate();
  const location = useLocation();
  // Bug fix: badges previously read from the aggregate Dashboard summary
  // (org-wide totals, not scoped per role), reused as a stand-in for "my
  // open events" / "open support requests", which is both semantically
  // wrong and was reportedly showing 0 for Staff. Both counts now come
  // straight from their real list endpoints, which the backend scopes
  // correctly per role (Staff: only their own events / support requests
  // tied to their own events; Comms/Leadership: everything).
  const [counts, setCounts] = useState({ open_events: null, open_support_requests: null });
  // Notification-style counts for the Event Status Reports sub-links
  // (Draft/Upcoming/Completed/Overdue), own-events scope, same as what
  // PostEventReportsList actually shows, computed the
  // same way PostEventReportsList does (report_status + end_date vs
  // today) rather than a new backend endpoint.
  const [reportCounts, setReportCounts] = useState({ pending: null, upcoming: null, overdue: null });

  useEffect(() => {
    let cancelled = false;
    eventsApi
      // Item #15: this badge represents "active" events, not a lifetime
      // total, Completed events shouldn't count toward it, and since this
      // is a live query (not a cached counter), the number naturally drops
      // the moment an event's status flips to Completed, no extra
      // bookkeeping needed. Event Status Update: "active" now spans three
      // display statuses (Upcoming/Ongoing/Held) rather than one "logged"
      // catch-all, and the backend's filter_events_by_display_status only
      // accepts one value per call, so this sums three page_size:1
      // count-only requests instead of one.
      .list({ page_size: 1, status: "upcoming" })
      .then(({ data: upcoming }) =>
        Promise.all([
          eventsApi.list({ page_size: 1, status: "ongoing" }),
          eventsApi.list({ page_size: 1, status: "held" }),
        ]).then(([{ data: ongoing }, { data: held }]) => {
          if (!cancelled) {
            const total = (upcoming?.count ?? 0) + (ongoing?.count ?? 0) + (held?.count ?? 0);
            setCounts((c) => ({ ...c, open_events: total }));
          }
        })
      )
      .catch(() => {
        /* Sidebar badges are non-critical, fail silently and just hide them. */
      });
    communicationsApi
      .listSupportRequests({ page_size: 1 })
      .then(({ data }) => {
        if (!cancelled) setCounts((c) => ({ ...c, open_support_requests: data?.count ?? null }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rolesKey]);

  // Event Status Report badges (Pending, Upcoming, Overdue). Each count comes
  // straight from the server with the same `report_view` rule the list pages
  // use, so a badge always equals the total on its page: Pending = reports
  // awaiting action within the deadline (not started, plus saved drafts);
  // Upcoming = not ended, nothing started; Overdue = past the deadline and not
  // submitted (drafts included). Completed needs no action, so it gets no
  // badge. Draft has no sidebar link; drafts are counted where they sit.
  // Refetched on every page change so a saved draft or a submitted report
  // moves the numbers immediately.
  useEffect(() => {
    let cancelled = false;
    const isReportsStaffRole = hasRole("staff", "admin");
    if (!isReportsStaffRole) {
      setReportCounts({ pending: null, upcoming: null, overdue: null });
      return undefined;
    }
    ["pending", "upcoming", "overdue"].forEach((view) => {
      eventsApi
        .list({ report_view: view, page_size: 1 })
        .then(({ data }) => {
          if (!cancelled) setReportCounts((c) => ({ ...c, [view]: data?.count ?? null }));
        })
        .catch(() => {
          /* Sidebar badges are non-critical, fail silently and just hide them. */
        });
    });
    return () => {
      cancelled = true;
    };
  }, [rolesKey, location.pathname]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  // Which items with subItems are expanded. Clicking the tab (or its arrow)
  // toggles its sub-links open/closed without leaving the current page;
  // arriving on the item's route (direct link / refresh / sub-link click)
  // opens it too.
  const [openKeys, setOpenKeys] = useState(() => new Set());
  function setExpanded(key, value) {
    setOpenKeys((prev) => {
      if (prev.has(key) === value) return prev;
      const next = new Set(prev);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }
  useEffect(() => {
    NAV_ITEMS.forEach((item) => {
      if (item.subItems && (location.pathname === item.to || location.pathname.startsWith(item.to + "/"))) {
        setExpanded(item.to, true);
      }
    });
  }, [location.pathname]);

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} />}
      <aside
        className={
          "fixed z-40 inset-y-0 left-0 w-[230px] font-nav bg-sidebar-bg border-r border-sidebar-border text-ink flex flex-col transition-[transform,width] lg:translate-x-0 lg:static shrink-0 " +
          (collapsed ? "lg:w-[72px] " : "") +
          (open ? "translate-x-0" : "-translate-x-full")
        }
      >
        <Link
          to="/"
          title="Home page"
          className={"flex items-center gap-3 px-5 pt-6 pb-4 hover:opacity-80 transition-opacity" + (collapsed ? " lg:justify-center lg:px-2" : "")}
        >
          {/* New theme spec: 28x28 logo mark, using the real logo image
              instead of a fabricated colored box. Red now appears
              throughout active states too (this theme's only strong
              accent), not just here, but this stays the brand mark.
              Linked to "/" (the public marketing page), matching the
              top-nav's house icon, both are "go to the public Home
              page" for a logged-in user. Landing on the Dashboard by
              default after logging in is handled separately, by
              Login.jsx's post-login redirect. */}
          <div className={"min-w-0" + hideWhenCollapsed}>
            <p className="text-[21px] font-bold text-ink leading-tight tracking-tight truncate">EMS</p>
            <p className="text-[13px] font-normal text-ink-muted leading-tight truncate mt-1">Event Management System</p>
          </div>
        </Link>

        <nav className={"flex-1 overflow-y-auto px-4 pb-4 space-y-1 [scrollbar-width:thin]" + (collapsed ? " lg:px-2" : "")}>
          {NAV_ITEMS.filter(
            (item) => !(item.hideForRoles && userRoles.every((r) => item.hideForRoles.includes(r))) && (!item.requiresAdmin || isAdminRole)
          )
            .map((item, i) => ({ item, i }))
            .sort((a, b) => {
              const ai = a.item.section ? SECTION_ORDER.indexOf(a.item.section) : -1;
              const bi = b.item.section ? SECTION_ORDER.indexOf(b.item.section) : -1;
              return ai - bi || a.i - b.i;
            })
            .map(({ item }) => item)
            .map((item, idx, arr) => {
            const showHeading = item.section && item.section !== arr[idx - 1]?.section;
            const node = (({ to, label, icon: Icon, countKey, subItems: rawSubItems, subItemsForRoles }) => {
            const count = countKey ? counts[countKey] : null;
            const subItems = rawSubItems && (!subItemsForRoles || hasRole(...subItemsForRoles))
              ? rawSubItems
              : null;

            // Item 22: plain items keep the exact original NavLink
            // behavior (prefix-matching "active" state, e.g. "/events"
            // stays highlighted on "/events/123"). Only items with
            // subItems (currently just Event Status Reports, and only for
            // roles subItemsForRoles allows, Communications has nothing
            // to land on from these, see subItemsForRoles above) get the
            // extra expand/collapse row + sub-links below them.
            if (!subItems) {
              return (
                <NavLink
                  key={to}
                  to={to}
                  onClick={onClose}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    "flex items-center gap-3.5 rounded-[10px] px-3 py-2.5 text-[16px] leading-[22px] transition-colors " +
                    (collapsed ? "lg:justify-center lg:px-0 " : "") +
                    (isActive
                      ? "bg-ems-primaryLight text-ink font-semibold shadow-sm"
                      : "text-ink font-normal hover:bg-surface-muted")
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon width={20} height={20} className={"shrink-0 " + (isActive ? "text-ems-primary" : "text-ink-muted")} />
                      <span className={"flex-1 truncate" + hideWhenCollapsed}>{label}</span>
                      {count !== null && count !== undefined && (
                        <span className={"text-[13px] font-medium text-ems-primary" + hideWhenCollapsed}>{count}</span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            }

            const onOwnRoute = location.pathname === to || location.pathname.startsWith(to + "/");
            const isExpanded = openKeys.has(to);
            const params = onOwnRoute ? new URLSearchParams(location.search) : null;
            const activeStatus = params ? params.get("status") : null;
            const activeTab = params ? params.get("tab") : null;

            return (
              <div key={to}>
                {/* The whole row (icon, name, count and arrow) is one big
                    button that opens/closes the sub-links, it does not
                    navigate. In the collapsed icon-only sidebar the sub-links
                    are hidden, so there it goes to the page instead. */}
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={`subnav-${to}`}
                  title={collapsed ? label : undefined}
                  onClick={() => {
                    if (collapsed && window.matchMedia("(min-width: 1024px)").matches) {
                      navigate(to);
                      return;
                    }
                    setExpanded(to, !isExpanded);
                  }}
                  className={
                    "w-full flex items-center gap-3.5 rounded-[10px] px-3 py-2.5 text-left text-[16px] leading-[22px] transition-colors " +
                    (collapsed ? "lg:justify-center lg:px-0 " : "") +
                    (onOwnRoute
                      ? "bg-ems-primaryLight text-ink font-semibold shadow-sm"
                      : "text-ink font-normal hover:bg-surface-muted")
                  }
                >
                  <Icon width={20} height={20} className={"shrink-0 " + (onOwnRoute ? "text-ems-primary" : "text-ink-muted")} />
                  <span className={"flex-1 truncate" + hideWhenCollapsed}>{label}</span>
                  {count !== null && count !== undefined && (
                    <span className={"text-[13px] font-medium text-ems-primary" + hideWhenCollapsed}>{count}</span>
                  )}
                  <IconChevron
                    width={16}
                    height={16}
                    className={"shrink-0 text-ink-faint transition-transform" + hideWhenCollapsed + " " + (isExpanded ? "-rotate-90" : "rotate-90")}
                  />
                </button>

                {isExpanded && (
                  <div id={`subnav-${to}`} className={"mt-1 mb-2 ml-5 pl-3 border-l border-sidebar-border space-y-1" + hideWhenCollapsed}>
                    {subItems.map((sub) => {
                      const subActive = sub.path
                        ? location.pathname === sub.path || location.pathname.startsWith(sub.path + "/")
                        : onOwnRoute &&
                        (sub.key === "generate"
                          ? activeTab === "generate" || (!activeStatus && !activeTab)
                          : activeStatus === sub.key);
                      const subCount = reportCounts[sub.key];
                      return (
                        <Link
                          key={sub.key}
                          to={sub.path ? sub.path : sub.search ? `${to}?${sub.search}` : to}
                          onClick={onClose}
                          className={
                            "flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[14px] transition-colors " +
                            (subActive
                              ? "bg-ems-primaryLight text-ink font-semibold"
                              : "text-ink-muted font-normal hover:bg-surface-muted hover:text-ink")
                          }
                        >
                          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                          <span className="flex-1 leading-snug">{sub.label}</span>
                          {!!subCount && (
                            <span
                              className={
                                "shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold leading-[18px] text-center " +
                                (subActive ? "bg-white/70 text-ems-primaryLightText" : "bg-ems-primary text-white")
                              }
                            >
                              {subCount > 99 ? "99+" : subCount}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
            })(item);
            return (
              <Fragment key={item.to}>
                {showHeading && !collapsed && (
                  <p className="px-3 pt-7 pb-2.5 text-[12.5px] leading-4 font-semibold uppercase tracking-[0.08em] text-ink-muted">
                    {item.section}
                  </p>
                )}
                {showHeading && collapsed && <div aria-hidden="true" className="hidden lg:block mx-3 my-3 border-t border-sidebar-border" />}
                {node}
              </Fragment>
            );
          })}
        </nav>

        <div className={"mt-auto border-t border-sidebar-border px-4 py-4" + (collapsed ? " lg:px-2" : "")}>
          <div className={"flex items-center gap-2 w-full" + (collapsed ? " lg:flex-col" : "")}>
            {/* The user card doubles as the link to /profile (Profile used
                to be its own nav item). */}
            <Link
              to="/profile"
              onClick={onClose}
              title="Your profile"
              className={"flex items-center gap-3 min-w-0 flex-1 rounded-xl px-2 py-2 hover:bg-surface-muted transition-colors" + (collapsed ? " lg:flex-none lg:px-1" : "")}
            >
              <span className="h-10 w-10 shrink-0 rounded-full bg-ems-primary text-white flex items-center justify-center text-sm font-semibold">
                {initials(user?.full_name || user?.email)}
              </span>
              <span className={"min-w-0 flex-1" + hideWhenCollapsed}>
                <span className="block text-[16px] font-semibold text-ink truncate leading-tight">
                  {user?.full_name || user?.email}
                </span>
                <span className="block text-[14px] font-normal text-ink-muted truncate mt-0.5">
                  {userRoles.map((r) => ROLE_LABELS[r] || r).join(", ")}
                </span>
              </span>
            </Link>
            <button
              type="button"
              aria-label="Log out"
              title="Log out"
              onClick={handleLogout}
              className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors shrink-0"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 17l5-5-5-5M20 12H9M12 19H6a2 2 0 01-2-2V7a2 2 0 012-2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
