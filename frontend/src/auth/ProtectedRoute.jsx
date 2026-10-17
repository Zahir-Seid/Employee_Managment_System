import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext.jsx";

/**
 * Guards a route behind authentication, and optionally behind a specific
 * set of roles (UI/UX Section 17's permission-based navigation). Unknown
 * roles or unauthenticated users are redirected to Login; authenticated
 * users lacking the required role are redirected to the Dashboard rather
 * than shown a raw 403, since the sidebar itself never links them here.
 */
export default function ProtectedRoute({ children, roles, adminOnly }) {
  const { isAuthenticated, isLoading, hasRole, isAdmin } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-muted">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !hasRole(...roles)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
