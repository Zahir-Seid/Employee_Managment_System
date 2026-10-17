import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.jsx";

// Fix: the nav row (Home + About Us + Sign In + primary button) had no
// responsive handling at all, at laptop/tablet widths it could run out
// of room and wrap or overflow, throwing the whole header out of
// alignment. Below `md` the text links now collapse behind a menu
// button instead of fighting the logo lockup for space; the wordmark's
// descriptive line also hides below `sm`, where it has no room to sit
// next to anything.
function HomeIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
    </svg>
  );
}

function MenuIcon({ open }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

function NavLinks({ active, onNavigate, className = "" }) {
  return (
    <div className={`flex items-center gap-6 ${className}`}>
      <Link
        to="/"
        onClick={onNavigate}
        aria-label="Home"
        title="Home"
        className={
          "flex items-center gap-1.5 text-sm font-medium transition-colors " +
          (active === "home" ? "text-ems-primary" : "text-ink hover:text-ems-primary")
        }
      >
        <HomeIcon />
      </Link>
      <Link
        to="/about"
        onClick={onNavigate}
        className={
          "text-sm font-medium transition-colors " +
          (active === "about" ? "text-ems-primary" : "text-ink hover:text-ems-primary")
        }
      >
        About Us
      </Link>
      <Link to="/login" onClick={onNavigate} className="text-sm font-medium text-ink hover:text-ems-primary transition-colors">
        Sign In
      </Link>
    </div>
  );
}

export default function MarketingHeader({ active = "home" }) {
  const { isAuthenticated } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 bg-pagebg/95 backdrop-blur border-b border-line">
      <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-3 min-w-0 shrink-0">
          <div className="leading-tight min-w-0">
            <p className="font-bold text-ink text-base tracking-tight">EMS</p>
            <p className="hidden sm:block text-[11px] text-ink-muted truncate">Event Management System</p>
          </div>
        </Link>

        <div className="hidden md:flex items-center gap-6 shrink-0 ml-auto">
          <NavLinks active={active} />
          {isAuthenticated ? (
            <Link to="/dashboard" className="jm-btn-primary">
              Go to Dashboard
            </Link>
          ) : (
            <Link to="/login" className="jm-btn-primary">
              Get Started
            </Link>
          )}
        </div>

        <button
          type="button"
          className="md:hidden text-ink-muted hover:text-ink shrink-0 p-1.5 -mr-1.5"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MenuIcon open={menuOpen} />
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-line bg-pagebg px-4 sm:px-6 py-4 flex flex-col gap-4">
          <NavLinks active={active} onNavigate={() => setMenuOpen(false)} className="flex-col items-start gap-4" />
          {isAuthenticated ? (
            <Link to="/dashboard" className="jm-btn-primary justify-center" onClick={() => setMenuOpen(false)}>
              Go to Dashboard
            </Link>
          ) : (
            <Link to="/login" className="jm-btn-primary justify-center" onClick={() => setMenuOpen(false)}>
              Get Started
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
