import { Navigate, Route, Routes } from "react-router-dom";
import ConfigurationPage from "../Configuration/ConfigurationPage.jsx";
import StaffAdminPage from "./StaffAdminPage.jsx";
import UserDetailPage from "./UserDetailPage.jsx";
import TVDisplaySettingsPanel from "../TvDisplay/TVDisplaySettingsPanel.jsx";
import HomeContentPanel from "../Content/HomeContentPanel.jsx";

// Item 12: Events tab removed from Admin.
// Item 15: "Configuration" tab renamed to "Settings".
// Item 20: "Communications" renamed to "TV Display" (it only ever held TV
// Display settings after Support Requests moved out) and now renders the
// same shared TVDisplaySettingsPanel used on the Sidebar-accessible page
// below, one implementation, not two.
// Home Page Dynamic Content Update: "Home Content" tab added, same
// pattern, shared HomeContentPanel component, also reachable directly
// at /admin/home-content from the Home page's own "Manage Content" link.
export default function AdminPage() {
  return (
    <div className="space-y-6">
      <Routes>
        <Route index element={<Navigate to="configuration" replace />} />
        <Route path="configuration" element={<ConfigurationPage />} />
        <Route path="staff" element={<StaffAdminPage />} />
        <Route path="staff/:id" element={<UserDetailPage />} />
        <Route path="tv-display" element={<TVDisplaySettingsPanel />} />
        <Route path="home-content" element={<HomeContentPanel />} />
      </Routes>
    </div>
  );
}
