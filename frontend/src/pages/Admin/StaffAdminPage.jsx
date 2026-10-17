import { usePersistentState } from "../../utils/persistentFilters.js";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { staffApi } from "../../api/staff";
import { useAuth } from "../../auth/AuthContext.jsx";
import ConfirmDialog from "../../components/common/ConfirmDialog.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage } from "../../utils/format";

const ROLE_OPTIONS = [
  { value: "staff", label: "Staff" },
  { value: "communications", label: "Communications" },
  { value: "comms_lead", label: "Communications Lead" },
  { value: "leadership", label: "Leadership/SMT" },
  { value: "admin", label: "Admin" },
];

const EMPTY_FORM = {
  email: "",
  username: "",
  first_name: "",
  last_name: "",
  // A person can hold several roles; they get the combined access of all of them.
  roles: ["staff"],
  department: "",
  position: "",
  password: "",
};


// ---- Small inline icons (no icon library in this project) ----
function Icon({ children, size = 18, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}
const UsersIcon = (p) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <path d="M16 5.2a3 3 0 0 1 0 5.6M18 14c2 .6 3.3 2.3 3.3 5" />
  </Icon>
);
const ShieldCheckIcon = (p) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    <path d="M9 12l2.2 2.2L15.5 10" />
  </Icon>
);
const ShieldOffIcon = (p) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
  </Icon>
);
const MailIcon = (p) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3.5 7l8.5 6 8.5-6" />
  </Icon>
);
const SearchIcon = (p) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Icon>
);
const RefreshIcon = (p) => (
  <Icon {...p}>
    <path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5" />
    <path d="M4 13a8 8 0 0 0 14 4.5L20 15M20 20v-5h-5" />
  </Icon>
);
const UserPlusIcon = (p) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M18 8v6M15 11h6" />
  </Icon>
);
const SortIcon = (p) => (
  <Icon {...p}>
    <path d="M8 4v16M8 4L4.5 7.5M8 4l3.5 3.5M16 20V4M16 20l-3.5-3.5M16 20l3.5-3.5" />
  </Icon>
);
const ChevronIcon = (p) => (
  <Icon size={16} {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
const ExternalIcon = (p) => (
  <Icon {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </Icon>
);
const TrashIcon = (p) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7" />
  </Icon>
);
const KebabIcon = (p) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <circle cx="12" cy="5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="19" r="1.7" />
  </Icon>
);

function statusOf(person) {
  if (person.is_active) return "active";
  return "inactive";
}
const STATUS_LABEL = { active: "Active", inactive: "Inactive" };

function initialsOf(person) {
  const a = (person.first_name || "").trim()[0] || "";
  const b = (person.last_name || "").trim()[0] || "";
  return (a + b).toUpperCase() || (person.username || "?").slice(0, 2).toUpperCase();
}

const SORT_OPTIONS = [
  { value: "newest", label: "Newest users" },
  { value: "oldest", label: "Oldest users" },
  { value: "name_asc", label: "Name A-Z" },
  { value: "name_desc", label: "Name Z-A" },
];

// Select with a custom chevron so every filter looks the same.
function FilterSelect({ value, onChange, children, icon, className = "" }) {
  return (
    <div className={"relative " + className}>
      {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">{icon}</span>}
      <select
        value={value}
        onChange={onChange}
        className={"form-input appearance-none pr-9 w-full " + (icon ? "pl-10" : "")}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">
        <ChevronIcon />
      </span>
    </div>
  );
}

function StatCard({ label, value, icon, tone, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={
        "jm-card text-left flex flex-col justify-between min-h-[130px] transition-shadow hover:shadow-md " +
        (selected ? "ring-2 ring-ems-primary" : "")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-ink-muted">{label}</span>
        <span className={"h-9 w-9 rounded-full flex items-center justify-center shrink-0 " + tone}>{icon}</span>
      </div>
      <span className="text-3xl font-bold text-ink tabular-nums mt-4">{value}</span>
    </button>
  );
}

export default function StaffAdminPage() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();
  const [staff, setStaff] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = usePersistentState("admin-users.search", "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  // Row "..." menu: {person, top, right} (fixed-position so the table's
  // horizontal scroll container can't clip it).
  const [menu, setMenu] = useState(null);
  const [editingUser, setEditingUser] = useState(null); // null = closed, {} = create, {...} = edit
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  // Same smooth-update pattern as EventsList/CommsRequestsList: only the
  // very first load shows the full "Loading..." swap; a search/filter
  // change afterward keeps the current rows visible instead of blanking.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Delete: confirm-before-destroy, same pattern as Configuration options
  // (permanent action, backend blocks it with a clear error if the
  // account owns any events).
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  async function load() {
    setIsLoading(true);
    try {
      const { data } = await staffApi.list();
      setStaff(data.results || data);
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsLoading(false);
      setHasLoadedOnce(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the row menu on outside click / scroll / resize / Escape.
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const counts = useMemo(() => {
    const c = { total: staff.length, active: 0, inactive: 0 };
    staff.forEach((p) => {
      c[statusOf(p)] += 1;
    });
    return c;
  }, [staff]);

  const roleCounts = useMemo(() => {
    const map = new Map();
    staff.forEach((p) => {
      (p.roles && p.roles.length ? p.roles : [p.role]).forEach((key) => {
        const label = ROLE_OPTIONS.find((o) => o.value === key)?.label || key;
        const entry = map.get(key) || { role: key, label, count: 0 };
        entry.count += 1;
        map.set(key, entry);
      });
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [staff]);

  const visibleStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = staff.filter((p) => {
      if (statusFilter !== "all" && statusOf(p) !== statusFilter) return false;
      if (roleFilter !== "all" && !(p.roles && p.roles.length ? p.roles : [p.role]).includes(roleFilter)) return false;
      if (q) {
        const hay = `${p.full_name || ""} ${p.email || ""} ${p.username || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const byName = (a, b) => (a.full_name || a.username || "").localeCompare(b.full_name || b.username || "", undefined, { sensitivity: "base" });
    const byJoined = (a, b) => new Date(a.date_joined || 0) - new Date(b.date_joined || 0);
    const sorted = [...rows];
    if (sortBy === "newest") sorted.sort((a, b) => byJoined(b, a));
    else if (sortBy === "oldest") sorted.sort(byJoined);
    else if (sortBy === "name_asc") sorted.sort(byName);
    else if (sortBy === "name_desc") sorted.sort((a, b) => byName(b, a));
    return sorted;
  }, [staff, search, statusFilter, roleFilter, sortBy]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setErrors({});
    setEditingUser({});
  }

  function openDetails(person) {
    navigate(`/admin/staff/${person.id}`);
  }

  function closeModal() {
    setEditingUser(null);
  }

  function deriveUsername(email) {
    return email.split("@")[0] || "";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setIsSaving(true);
    setErrors({});
    const isCreate = !editingUser?.id;
    if (!form.roles || form.roles.length === 0) {
      setErrors({ roles: "Select at least one role." });
      setIsSaving(false);
      return;
    }
    try {
      if (isCreate) {
        const { data } = await staffApi.create(form);
        setStaff((prev) => [...prev, data].sort((a, b) => a.last_name.localeCompare(b.last_name)));
        showToast(`${data.full_name} added.`, "success");
      } else {
        const { password, ...rest } = form; // password not editable here
        const { data } = await staffApi.update(editingUser.id, rest);
        setStaff((prev) => prev.map((p) => (p.id === data.id ? data : p)));
        showToast(`${data.full_name} updated.`, "success");
      }
      closeModal();
    } catch (error) {
      const data = error?.response?.data?.errors || error?.response?.data;
      if (data && typeof data === "object") setErrors(data);
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleActive(person) {
    try {
      const { data } = await staffApi.update(person.id, { is_active: !person.is_active });
      setStaff((prev) => prev.map((p) => (p.id === data.id ? data : p)));
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  }

  async function confirmDelete() {
    const person = pendingDelete;
    if (!person) return;
    setIsDeleting(true);
    try {
      await staffApi.remove(person.id);
      setStaff((prev) => prev.filter((p) => p.id !== person.id));
      setPendingDelete(null);
      showToast(`${person.full_name || person.username} deleted.`, "success");
    } catch (error) {
      // Backend returns a specific, clear reason (owns N events / last
      // Admin account), surfaced exactly as-is rather than a generic
      // failure message, so the admin knows precisely why and what to do
      // instead (deactivate, or grant Admin access elsewhere first).
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsDeleting(false);
    }
  }

  const isSelf = (person) => person.id === currentUser?.id;

  const hasFilters = statusFilter !== "all" || roleFilter !== "all" || search.trim() !== "";

  function openMenu(e, person) {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu((m) => (m?.person.id === person.id ? null : { person, top: r.bottom + 4, right: window.innerWidth - r.right }));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink">User Management</h1>
          <p className="text-sm text-ink-muted mt-1">Manage user accounts and access status.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="jm-btn-secondary" onClick={load} disabled={isLoading}>
            <RefreshIcon size={16} className={isLoading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button className="jm-btn-primary" onClick={openCreate}>
            <UserPlusIcon size={16} />
            Add User
          </button>
        </div>
      </div>

      {/* Stat cards (click one to filter the table by that status) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total Users"
          value={counts.total}
          icon={<UsersIcon />}
          tone="bg-ems-primaryLight text-ems-primaryLightText"
          selected={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        <StatCard
          label="Active"
          value={counts.active}
          icon={<ShieldCheckIcon />}
          tone="bg-pill-successLight text-pill-successText"
          selected={statusFilter === "active"}
          onClick={() => setStatusFilter(statusFilter === "active" ? "all" : "active")}
        />
        <StatCard
          label="Inactive"
          value={counts.inactive}
          icon={<ShieldOffIcon />}
          tone="bg-pill-warningLight text-pill-warning"
          selected={statusFilter === "inactive"}
          onClick={() => setStatusFilter(statusFilter === "inactive" ? "all" : "inactive")}
        />
      </div>

      {/* Top roles (click to filter) */}
      {roleCounts.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-ink-muted">Top roles:</span>
          {roleCounts.map((r) => (
            <button
              key={r.role}
              type="button"
              onClick={() => setRoleFilter(roleFilter === r.role ? "all" : r.role)}
              className={
                "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                (roleFilter === r.role
                  ? "bg-ems-primary text-white"
                  : "bg-ems-primaryLight text-ems-primaryLightText hover:opacity-80")
              }
            >
              {r.label} ({r.count})
            </button>
          ))}
        </div>
      )}

      {/* Users card */}
      <div className="jm-card">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 mb-5">
          <div className="lg:w-56 shrink-0">
            <h2 className="text-lg font-semibold text-ink">Users</h2>
            <p className="text-sm text-ink-muted">Click a user to view details and edit.</p>
          </div>
          <div className="flex flex-wrap gap-3 flex-1">
            <div className="relative flex-1 min-w-[200px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                <SearchIcon size={16} />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users..."
                className="form-input pl-10 w-full"
              />
            </div>
            <FilterSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </FilterSelect>
            <FilterSelect value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">All roles</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect value={sortBy} onChange={(e) => setSortBy(e.target.value)} icon={<SortIcon size={16} />}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </FilterSelect>
            {hasFilters && (
              <button
                type="button"
                className="text-sm text-ems-primary hover:underline"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setRoleFilter("all");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-line overflow-hidden">
          {!hasLoadedOnce ? (
            <p className="text-sm text-ink-faint py-6 text-center">Loading...</p>
          ) : visibleStaff.length === 0 ? (
            <p className="text-sm text-ink-faint py-6 text-center">No accounts found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-ink text-sm font-semibold border-b border-line">
                  <tr>
                    <th className="text-left px-4 py-2.5">User</th>
                    <th className="text-left px-4 py-2.5">Email</th>
                    <th className="text-left px-4 py-2.5">Role</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="text-right px-4 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visibleStaff.map((person) => {
                    const st = statusOf(person);
                    return (
                      <tr
                        key={person.id}
                        className="hover:bg-surface-muted/60 cursor-pointer"
                        onClick={() => openDetails(person)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <span className="h-10 w-10 rounded-full bg-ems-primaryLight text-ems-primaryLightText flex items-center justify-center text-sm font-semibold shrink-0">
                              {initialsOf(person)}
                            </span>
                            <div className="min-w-0">
                              <p className={"font-semibold truncate " + (person.is_active ? "text-ink" : "text-ink-faint")}>
                                {person.full_name || person.username}
                                {isSelf(person) && <span className="text-ink-faint font-normal"> (you)</span>}
                              </p>
                              <p className="text-xs text-ink-muted truncate">{person.position || "N/A"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-ink">
                          <span className="inline-flex items-center gap-2">
                            <MailIcon size={16} className="text-ink-muted shrink-0" />
                            {person.email}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex rounded-md px-2 py-0.5 text-xs font-medium bg-ems-primaryLight text-ems-primaryLightText">
                            {person.role_display}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={
                              "inline-flex rounded-md px-2.5 py-1 text-xs font-semibold " +
                              (st === "active"
                                ? "bg-ems-primary text-white"
                                : "bg-surface-sunken text-ink-faint")
                            }
                          >
                            {STATUS_LABEL[st]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            aria-label={`Actions for ${person.full_name || person.username}`}
                            aria-haspopup="menu"
                            onClick={(e) => {
                              e.stopPropagation();
                              openMenu(e, person);
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-surface-muted"
                          >
                            <KebabIcon size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {hasLoadedOnce && (
          <p className="text-xs text-ink-faint mt-3">
            Showing {visibleStaff.length} of {staff.length} users
          </p>
        )}
      </div>

      {/* Row actions menu */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            role="menu"
            className="fixed z-50 w-52 rounded-lg border border-line bg-surface shadow-lg py-1.5 text-sm"
            style={{ top: menu.top, right: menu.right }}
          >
            <button
              role="menuitem"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-ink hover:bg-surface-muted"
              onClick={() => {
                const p = menu.person;
                setMenu(null);
                openDetails(p);
              }}
            >
              <ExternalIcon size={18} className="text-ink-muted" />
              View Details
            </button>
            <button
              role="menuitem"
              disabled={isSelf(menu.person)}
              title={isSelf(menu.person) ? "You can't disable your own account" : undefined}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-ink hover:bg-surface-muted disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => {
                const p = menu.person;
                setMenu(null);
                toggleActive(p);
              }}
            >
              <ShieldOffIcon size={18} className="text-ink-muted" />
              {menu.person.is_active ? "Disable" : "Enable"}
            </button>
            <button
              role="menuitem"
              disabled={isSelf(menu.person)}
              title={isSelf(menu.person) ? "You can't delete your own account" : undefined}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-warning hover:bg-warning/10 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => {
                const p = menu.person;
                setMenu(null);
                setPendingDelete(p);
              }}
            >
              <TrashIcon size={18} />
              Delete
            </button>
          </div>
        </>
      )}

      {editingUser !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="jm-card w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-ink mb-4">
              {editingUser.id ? `Edit ${editingUser.full_name}` : "Add User"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">First name</label>
                  <input
                    className="form-input"
                    required
                    value={form.first_name}
                    onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                  />
                  {errors.first_name && <p className="form-error">{errors.first_name}</p>}
                </div>
                <div>
                  <label className="form-label">Last name</label>
                  <input
                    className="form-input"
                    required
                    value={form.last_name}
                    onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                  />
                  {errors.last_name && <p className="form-error">{errors.last_name}</p>}
                </div>
              </div>

              <div>
                <label className="form-label">Email</label>
                <input
                  type="email"
                  className="form-input"
                  required
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      email: e.target.value,
                      // Convenience only, still editable, not derived on every keystroke once touched.
                      username: !editingUser.id && !f.username ? deriveUsername(e.target.value) : f.username,
                    }))
                  }
                />
                {errors.email && <p className="form-error">{errors.email}</p>}
              </div>

              <div>
                <label className="form-label">Username</label>
                <input
                  className="form-input"
                  required
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                />
                {errors.username && <p className="form-error">{errors.username}</p>}
              </div>

              {!editingUser.id && (
                <div>
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    className="form-input"
                    required
                    minLength={8}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  />
                  {errors.password && <p className="form-error">{errors.password}</p>}
                </div>
              )}

              <div>
                <label className="form-label">Roles</label>
                <p className="text-xs text-ink-muted mb-2">Select one or more. The person gets the access of every role selected.</p>
                <div role="group" className="rounded-lg border border-line divide-y divide-line">
                  {ROLE_OPTIONS.map((r) => {
                    const checked = (form.roles || []).includes(r.value);
                    return (
                      <label key={r.value} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-muted/60">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-ems-primary"
                          checked={checked}
                          onChange={() =>
                            setForm((f) => {
                              const cur = f.roles || [];
                              return { ...f, roles: cur.includes(r.value) ? cur.filter((v) => v !== r.value) : [...cur, r.value] };
                            })
                          }
                        />
                        <span className="text-ink">{r.label}</span>
                      </label>
                    );
                  })}
                </div>
                {errors.roles && <p className="form-error">{Array.isArray(errors.roles) ? errors.roles.join(" ") : String(errors.roles)}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Department</label>
                  <input
                    className="form-input"
                    value={form.department}
                    onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label">Position</label>
                  <input
                    className="form-input"
                    value={form.position}
                    onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="jm-btn-primary" disabled={isSaving}>
                  {isSaving ? "Saving..." : editingUser.id ? "Save Changes" : "Add User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete ${pendingDelete?.full_name || pendingDelete?.username}?`}
        message="This permanently removes the account. This can't be undone. If they own any events, deletion will be blocked - deactivate them instead in that case."
        confirmLabel="Delete"
        danger
        isSubmitting={isDeleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

    </div>
  );
}
