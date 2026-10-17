import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import TopNav from "./TopNav.jsx";

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop icon-only rail. Persisted across sessions; the mobile drawer
  // (sidebarOpen) is separate and unchanged.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("ems.sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("ems.sidebarCollapsed", collapsed ? "1" : "0");
    } catch {
      /* Non-critical */
    }
  }, [collapsed]);

  return (
    <div className="flex h-screen bg-pagebg">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} collapsed={collapsed} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav
          onMenuClick={() => setSidebarOpen(true)}
          sidebarCollapsed={collapsed}
          onToggleSidebar={() => setCollapsed((c) => !c)}
        />
        {/* Breadcrumbs (e.g. "Dashboard / Reports") removed from the very
            top of every page, the Sidebar's own active-item highlighting
            already shows where you are, and each page's own h1 restates
            its name, so the breadcrumb line was a third, redundant place
            saying the same thing before any real content appeared. */}
        <main className="flex-1 overflow-y-auto px-4 py-5 lg:pl-5 lg:pr-5 lg:pt-5 lg:pb-5">
          {/* No mx-auto: content always starts 26px from the Sidebar (and
              24px below the top bar) instead of drifting to the centre on
              wide screens. */}
          <div className="w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
