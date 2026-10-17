import { forwardRef, useState } from "react";
import { Link } from "react-router-dom";

// Shared frame for the Login and Register pages: page background, home
// shortcut, logo + product name header, and the white card.

function HomeLink() {
  return (
    <Link
      to="/"
      title="Home"
      aria-label="Home"
      className="fixed top-4 right-4 sm:top-6 sm:right-6 flex items-center justify-center h-10 w-10 rounded-full bg-white border border-line text-ink-muted hover:text-ems-primary hover:border-ems-primary shadow-sm transition-colors"
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
  );
}

export default function AuthShell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-pagebg px-4 py-10">
      <HomeLink />
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-6">
          <div>
            <h1 className="text-ink text-lg font-bold leading-tight">EMS</h1>
            <p className="text-ink-muted text-xs">Event Management System</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthCard({ children, className = "" }) {
  return (
    <div className={"bg-surface rounded-2xl border border-line shadow-[0_8px_30px_rgba(15,23,42,0.06)] p-6 sm:p-8 " + className}>
      {children}
    </div>
  );
}

// Password input with an eye icon to show/hide, replacing the old text
// "Show"/"Hide" link. Forwards its ref so it works with react-hook-form's
// register().
export const PasswordInput = forwardRef(function PasswordInput({ className = "", ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input ref={ref} type={visible ? "text" : "password"} className={"jm-auth-input pr-11 " + className} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {visible ? (
            <>
              <path d="M3 3l18 18" />
              <path d="M10.6 6.1A9.8 9.8 0 0112 6c5 0 8.5 4.2 9.5 6-.4.8-1.3 2-2.6 3.2M6.5 7.6C4.5 9 3.2 10.8 2.5 12c1 1.8 4.5 6 9.5 6 1.5 0 2.8-.4 4-.9" />
              <path d="M9.9 9.9a3 3 0 004.2 4.2" />
            </>
          ) : (
            <>
              <path d="M2.5 12C3.5 10.2 7 6 12 6s8.5 4.2 9.5 6c-1 1.8-4.5 6-9.5 6s-8.5-4.2-9.5-6z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
});

export function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
