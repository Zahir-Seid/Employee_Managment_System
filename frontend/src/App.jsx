import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import AppLayout from "./components/layout/AppLayout.jsx";
import Login from "./pages/Login/Login.jsx";
import Register from "./pages/Login/Register.jsx";
import ForgotPassword from "./pages/Login/ForgotPassword.jsx";
import Home from "./pages/Home/Home.jsx";
import AboutUs from "./pages/About/AboutUs.jsx";
import Dashboard from "./pages/Dashboard/Dashboard.jsx";
import UpcomingEventsPage from "./pages/Dashboard/UpcomingEventsPage.jsx";
import EventsList from "./pages/Events/EventsList.jsx";
import EventCreate from "./pages/Events/EventCreate.jsx";
import EventDetail from "./pages/Events/EventDetail.jsx";
import CommsRequestDetail from "./pages/CommsRequests/CommsRequestDetail.jsx";
import SupportRequestsPage from "./pages/SupportRequests/SupportRequestsPage.jsx";
import PostEventReportsPage from "./pages/PostEventReports/PostEventReportsPage.jsx";
import ReportsHub from "./pages/Reports/ReportsHub.jsx";
import PostEventReportForm from "./pages/PostEventReport/PostEventReportForm.jsx";
import AuditTrail from "./pages/AuditTrail/AuditTrail.jsx";
import AdminPage from "./pages/Admin/AdminPage.jsx";
import Profile from "./pages/Profile/Profile.jsx";
import TvDisplay from "./pages/TvDisplay/TvDisplay.jsx";
import TVDisplaySettingsPanel from "./pages/TvDisplay/TVDisplaySettingsPanel.jsx";
import BackendHealthBanner from "./components/common/BackendHealthBanner.jsx";

export default function App() {
  return (
    <>
      <BackendHealthBanner />
      <Routes>
      <Route path="/login" element={<Login />} />
      {/* User Registration Update: public, unauthenticated, same as
          /login, outside ProtectedRoute/AppLayout. */}
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      {/* Deliberately outside AppLayout, no sidebar/topnav. Meant to be
          opened on a shared office screen and left running, not used
          interactively, so the normal app chrome would just waste space. */}
      <Route
        path="/tv-display"
        element={
          <ProtectedRoute>
            <TvDisplay />
          </ProtectedRoute>
        }
      />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        {/* Dashboard Upcoming Events Enhancement, "View All" from the
            Upcoming Events card. Same access as /dashboard itself (no
            `roles` prop): every authenticated role can open it. */}
        <Route path="/dashboard/upcoming-events" element={<UpcomingEventsPage />} />

        <Route
          path="/events"
          element={
            <ProtectedRoute roles={["staff", "communications", "comms_lead", "admin"]}>
              <EventsList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/events/new"
          element={
            <ProtectedRoute roles={["staff"]}>
              <EventCreate />
            </ProtectedRoute>
          }
        />
        {/* Item 10: Leadership's nav is Dashboard-only now, so Event
            Details is Staff (own events) + Communications + Admin (the
            sidebar's "Events" link is shown to Admin too, so the route
            itself has to admit them or the link just bounces to
            Dashboard). */}
        <Route
          path="/events/:id"
          element={
            <ProtectedRoute roles={["staff", "communications", "comms_lead", "admin"]}>
              <EventDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/events/:id/report"
          element={
            <ProtectedRoute roles={["staff"]}>
              <PostEventReportForm />
            </ProtectedRoute>
          }
        />

        {/* Design spec §2 consolidation: Communications To-Do and Calendar
            live as tabs inside one Support Requests page, nav items stay
            identical across roles, and the tabs themselves gate what each
            role sees inside the page. The page's own List tab (a wrapper
            around CommsRequestsList) has been removed; Staff no longer has
            a nav link here as a result (see Sidebar.jsx), but the route
            itself stays reachable for them since /support-requests/:id
            below is a separate detail view, not the removed list. */}
        <Route
          path="/support-requests"
          element={
            <ProtectedRoute roles={["staff", "communications", "comms_lead", "admin"]}>
              <SupportRequestsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/support-requests/:id"
          element={
            <ProtectedRoute roles={["staff", "communications", "comms_lead", "admin"]}>
              <CommsRequestDetail />
            </ProtectedRoute>
          }
        />

        {/* Post-Event Reports: "My Reports" (staff) + "Generate Reports"
            (org-wide export) as tabs on one page. Admin included, the
            Sidebar's "Event Status Reports" subItems are explicitly shown
            to admin (subItemsForRoles), so the route has to accept them. */}
        <Route
          path="/post-event-reports"
          element={
            <ProtectedRoute roles={["staff", "communications", "comms_lead", "leadership", "admin"]}>
              <PostEventReportsPage />
            </ProtectedRoute>
          }
        />

        {/* Six-Report System spec, Part 2, top-level Reports section,
            not nested under Event Status Reports (whose route above is
            staff/communications-only, Leadership/Admin could never have
            reached an org-wide report living there). No `roles` prop:
            every authenticated role can open this, matching "not
            Leadership-only" for the Executive Management Report. */}
        <Route path="/reports" element={<ProtectedRoute><ReportsHub /></ProtectedRoute>} />

        {/* New page per design spec §2, audit trail previously had no
            frontend view (FR49, backend-only). Admin included, the
            Sidebar shows Admin this link too, and the backend's
            IsCommunicationsOrLeadership permission already admits Admin
            ("sees more, not less"), so the route needs to match. */}
        <Route
          path="/audit-trail"
          element={
            <ProtectedRoute roles={["communications", "comms_lead", "admin"]}>
              <AuditTrail />
            </ProtectedRoute>
          }
        />

        <Route path="/profile" element={<Profile />} />

        {/* TV Display management now belongs to Admin/Communications only
            (matches the Sidebar's hideForRoles above and the backend's
            IsAdminOrLeadership/IsCommunicationsOrAdmin gates), Staff and
            Leadership are redirected to the Dashboard if they hit this URL
            directly, same pattern as /audit-trail below. Still the same
            shared panel component the Admin "TV Display" tab uses, so
            there's exactly one of these. */}
        <Route
          path="/tv-display-settings"
          element={
            <ProtectedRoute roles={["communications", "comms_lead", "admin"]}>
              <TVDisplaySettingsPanel />
            </ProtectedRoute>
          }
        />

        {/* Admin-only (Admin role or Django superuser), Configuration
            (dropdown lists) and Staff (item 7.2) so far; Communications
            and Events sections get added here as each is built. */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute adminOnly>
              <AdminPage />
            </ProtectedRoute>
          }
        />
        {/* Old bookmarks/links still work. */}
        <Route path="/configuration" element={<Navigate to="/admin/configuration" replace />} />
      </Route>

      <Route path="/" element={<Home />} />
      <Route path="/about" element={<AboutUs />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}
