import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useTheme } from "../../context/ThemeContext.jsx";
import { notificationsApi } from "../../api/notifications";
import { formatDateTime } from "../../utils/format";

// Item #9: the bell was a static icon with no backing data at all. Now
// backed by a real per-user Notification model (apps/notifications),
// created at real trigger points (new event needing Comms support,
// support request submitted, support request fully completed).
export default function TopNav({ onMenuClick, sidebarCollapsed = false, onToggleSidebar }) {
  const { isCommunications, isLeadership } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const searchInputRef = useRef(null);
  const [searchValue, setSearchValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const dropdownRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    function pollUnread() {
      notificationsApi
        .unreadCount()
        .then(({ data }) => {
          if (!cancelled) setUnreadCount(data?.count || 0);
        })
        .catch((error) => {
          // Was previously silent, surfaced now since "the bell doesn't
          // work" has been hard to diagnose without knowing whether this
          // call is even succeeding.
          if (!cancelled) console.error("Notification unread-count fetch failed:", error);
        });
    }
    pollUnread();
    const interval = setInterval(pollUnread, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Cmd+K (Mac) / Ctrl+K (Windows/Linux) focuses the search box.
  useEffect(() => {
    function handleShortcut(e) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        const input = searchInputRef.current;
        if (!input || input.offsetParent === null) return; // search hidden (small screens)
        e.preventDefault();
        input.focus();
        input.select();
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function openDropdown() {
    setIsOpen((v) => !v);
    if (!isOpen) {
      setIsLoading(true);
      notificationsApi
        .list()
        .then(({ data }) => setNotifications(data.results || data))
        .catch((error) => {
          console.error("Notification list fetch failed:", error);
          setNotifications([]);
        })
        .finally(() => setIsLoading(false));
    }
  }

  async function handleNotificationClick(n) {
    if (!n.is_read) {
      try {
        await notificationsApi.markRead(n.id);
        setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        /* Non-critical, still navigate even if marking read failed. */
      }
    }
    setIsOpen(false);
    if (n.link) navigate(n.link);
  }

  async function handleMarkAllRead() {
    try {
      await notificationsApi.markRead();
      setNotifications((list) => list.map((x) => ({ ...x, is_read: true })));
      setUnreadCount(0);
    } catch {
      /* Non-critical */
    }
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    const query = searchValue.trim();
    if (!query) return;
    navigate(`/events?search=${encodeURIComponent(query)}`);
  }

  return (
    <header className="h-14 bg-surface border-b border-line flex items-center justify-between px-4 lg:px-6 sticky top-0 z-20 gap-4">
      <button
        className="lg:hidden text-ink-muted hover:text-ink shrink-0"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* Desktop sidebar collapse (icon-only rail). The mobile hamburger
          above is unchanged. */}
      <button
        type="button"
        onClick={onToggleSidebar}
        className="hidden lg:inline-flex shrink-0 h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-surface-muted transition-colors"
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={sidebarCollapsed}
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9.5 4v16" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>

      <form onSubmit={handleSearchSubmit} className="hidden md:flex flex-1 max-w-2xl">
        <div className="flex items-center gap-3 w-full rounded-xl border border-line bg-surface-muted/60 px-4 py-2 focus-within:bg-surface focus-within:border-ems-primary/40 focus-within:ring-2 focus-within:ring-ems-primary/15 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-ink-muted">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={searchInputRef}
            type="search"
            placeholder="Search events, reports, staff..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="text-[15px] text-ink placeholder-ink-muted outline-none bg-transparent w-full"
          />
          {!searchValue && (
            <button
              type="button"
              onClick={() => searchInputRef.current?.focus()}
              aria-label="Focus search (Ctrl + K)"
              title="Search (Ctrl + K)"
              className="shrink-0 cursor-pointer rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold leading-none text-ink-muted hover:text-ink hover:border-ink-faint transition-colors"
            >
              Ctrl K
            </button>
          )}
        </div>
      </form>

      <div className="flex items-center gap-1.5 ml-auto">
        <Link
          to="/"
          title="Home"
          aria-label="Home"
          className="h-10 w-10 inline-flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors shrink-0"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 11.5 12 4l8 7.5M6 10v9a1 1 0 001 1h3v-5a2 2 0 012-2v0a2 2 0 012 2v5h3a1 1 0 001-1v-9"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>

        <button
          type="button"
          onClick={toggleTheme}
          className="h-10 w-10 inline-flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors shrink-0"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={openDropdown}
            className="h-10 w-10 inline-flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors relative"
            aria-label="Notifications"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-0.5 right-0.5 h-[18px] min-w-[18px] px-1 rounded-full bg-warning text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-surface">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {isOpen && (
            <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto jm-card p-0 shadow-lg z-30">
              <div className="flex items-center justify-between px-4 py-3 border-b border-line">
                <p className="text-sm font-semibold text-ink">Notifications</p>
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead} className="text-xs text-ems-primary hover:underline">
                    Mark all read
                  </button>
                )}
              </div>
              {isLoading ? (
                <p className="px-4 py-6 text-sm text-ink-faint text-center">Loading...</p>
              ) : notifications.length === 0 ? (
                <p className="px-4 py-6 text-sm text-ink-faint text-center">No notifications yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {notifications.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => handleNotificationClick(n)}
                        className={
                          "w-full text-left px-4 py-3 hover:bg-surface-muted transition-colors flex gap-2.5 items-start " +
                          (n.is_read ? "" : "bg-ems-primaryLight/40")
                        }
                      >
                        {!n.is_read && <span className="h-2 w-2 rounded-full bg-ems-primary mt-1.5 shrink-0" />}
                        <div className={n.is_read ? "pl-4.5" : ""}>
                          <p className="text-sm text-ink">{n.message}</p>
                          <p className="text-xs text-ink-faint mt-0.5">{formatDateTime(n.created_at)}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Resolved: Comms and Leadership can't actually create events
            (/events/new is Staff-only), so the button is now hidden for
            those two roles instead of showing and then blocking them. */}
        {!isCommunications && !isLeadership && (
          <button onClick={() => navigate("/events/new")} className="jm-btn-primary ml-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            Log Event
          </button>
        )}
      </div>
    </header>
  );
}
