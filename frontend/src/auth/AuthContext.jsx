import { createContext, useContext, useEffect, useState } from "react";
import { authApi } from "../api/auth";
import { tokenStorage } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      if (!tokenStorage.getAccess()) {
        setIsLoading(false);
        return;
      }
      try {
        const { data } = await authApi.me();
        setUser(data);
      } catch {
        tokenStorage.clear();
      } finally {
        setIsLoading(false);
      }
    }
    loadUser();
  }, []);

  async function login(email, password) {
    const { data } = await authApi.login(email, password);
    tokenStorage.set(data.access, data.refresh);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    tokenStorage.clear();
    setUser(null);
  }

  function updateUserLocally(patch) {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  // A user can hold several roles; access is the union of all of them.
  // `user.role` is only the main role (kept for older code).
  const userRoles = user ? (user.roles && user.roles.length ? user.roles : [user.role]) : [];
  const hasRole = (...wanted) => wanted.some((r) => userRoles.includes(r));

  const value = {
    user,
    userRoles,
    hasRole,
    // Staff and nothing broader (the only case limited to their own events).
    isStaffOnly: userRoles.length > 0 && userRoles.every((r) => r === "staff"),
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    updateUserLocally,
    // Admin carries full Staff-level day-to-day permissions in addition to
    // Configuration access (see accounts/models.py Role docstring on the
    // backend), so isStaff includes Admin here too, matching the
    // backend's User.is_staff_role property exactly.
    isStaff: hasRole("staff", "admin"),
    // Support Requests Enhancement: Communications Lead is a full
    // Communications team member everywhere Communications already had
    // access, mirrors the backend's User.is_communications property.
    isCommunications: hasRole("communications", "comms_lead"),
    isCommunicationsLead: hasRole("comms_lead"),
    isLeadership: hasRole("leadership"),
    // Mirrors the backend's IsAdminOrLeadership permission, gates the
    // Configuration admin area. Checks the Admin role (added on request);
    // is_superuser is kept as a fallback so an existing Django superuser
    // is never locked out just because nobody's set their role to Admin
    // yet, same reasoning as the backend permission class.
    // Role-only, no is_superuser fallback, used for nav visibility only.
    // A superuser whose role field still says Staff or Communications
    // (very possible: Django's createsuperuser defaults role to Staff
    // unless set explicitly) no longer sees the Admin nav item, per
    // request. isAdmin below is unchanged and still includes the
    // is_superuser fallback for actual page/API access, so that same
    // account isn't truly locked out of /admin if they navigate there
    // directly, only the nav link is gone, not the access itself.
    isAdminRole: hasRole("admin"),
    isAdmin: !!user && (hasRole("admin") || user.is_superuser),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
