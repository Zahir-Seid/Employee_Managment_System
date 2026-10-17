import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { staffApi } from "../../api/staff";
import { useAuth } from "../../auth/AuthContext.jsx";
import ConfirmDialog from "../../components/common/ConfirmDialog.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage } from "../../utils/format";

// User details (opened from User Management > "..." > View Details).
// Two tabs: Overview (personal info + account actions) and Roles. A
// profile card sits on the right. Only fields EMS actually stores are
// shown (name, email, username, title, department, role, status).

const rolesOf = (p) => (p?.roles && p.roles.length ? p.roles : p?.role ? [p.role] : []);
const sameRoles = (a, b) => a.length === b.length && a.every((r) => b.includes(r));

const ROLE_OPTIONS = [
  { value: "staff", label: "Staff", hint: "Creates and manages their own events." },
  { value: "communications", label: "Communications", hint: "Handles communications support requests." },
  { value: "comms_lead", label: "Communications Lead", hint: "Leads the communications team." },
  { value: "leadership", label: "Leadership/SMT", hint: "Organization-wide view and reports." },
  { value: "admin", label: "Admin", hint: "Full access, including user management and settings." },
];

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
const ArrowLeftIcon = (p) => (
  <Icon {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);
const TrashIcon = (p) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7" />
  </Icon>
);
const PencilIcon = (p) => (
  <Icon {...p}>
    <path d="M4 20l4.2-1 10-10a2 2 0 0 0-2.8-2.8l-10 10L4 20zM14.5 7.5l2 2" />
  </Icon>
);
const UserIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
  </Icon>
);
const MailIcon = (p) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3.5 7l8.5 6 8.5-6" />
  </Icon>
);
const AtIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8" />
  </Icon>
);
const BriefcaseIcon = (p) => (
  <Icon {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M3 13h18" />
  </Icon>
);
const BuildingIcon = (p) => (
  <Icon {...p}>
    <rect x="5" y="3" width="14" height="18" rx="1.5" />
    <path d="M9 7.5h2M13 7.5h2M9 11.5h2M13 11.5h2M10 21v-4h4v4" />
  </Icon>
);
const ShieldIcon = (p) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
  </Icon>
);

function statusOf(person) {
  if (person.is_active) return "active";
  return person.self_registered ? "pending" : "inactive";
}
const STATUS_LABEL = { active: "Active", pending: "Pending Approval", inactive: "Inactive" };

function initialsOf(person) {
  const a = (person.first_name || "").trim()[0] || "";
  const b = (person.last_name || "").trim()[0] || "";
  return (a + b).toUpperCase() || (person.username || "?").slice(0, 2).toUpperCase();
}

function InfoItem({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3 min-w-0">
      <span className="text-ink-muted mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm text-ink-muted">{label}</p>
        <p className="text-base font-medium text-ink break-words">{value || "N/A"}</p>
      </div>
    </div>
  );
}

function CardHeader({ title, children }) {
  return (
    <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-line">
      <h2 className="text-sm font-bold uppercase tracking-wide text-ems-primary">{title}</h2>
      {children}
    </div>
  );
}

function StatusPill({ person }) {
  const st = statusOf(person);
  return (
    <span
      className={
        "inline-flex rounded-md px-2.5 py-1 text-xs font-semibold " +
        (st === "active"
          ? "bg-ems-primary text-white"
          : st === "pending"
            ? "bg-pill-warningLight text-pill-warning"
            : "bg-surface-sunken text-ink-faint")
      }
    >
      {STATUS_LABEL[st]}
    </span>
  );
}

export default function UserDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();

  const [person, setPerson] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("overview");

  // Personal information edit
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  // Roles
  const [roleDraft, setRoleDraft] = useState([]);
  const [isSavingRole, setIsSavingRole] = useState(false);

  // Account actions
  const [pendingDelete, setPendingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  const isSelf = person && person.id === currentUser?.id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await staffApi.get(id);
        if (cancelled) return;
        setPerson(data);
        setRoleDraft(rolesOf(data));
      } catch (error) {
        if (!cancelled) setLoadError(extractErrorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  function applyUpdate(data) {
    setPerson(data);
    setRoleDraft(rolesOf(data));
  }

  function startEdit() {
    setForm({
      first_name: person.first_name || "",
      last_name: person.last_name || "",
      email: person.email || "",
      username: person.username || "",
      position: person.position || "",
      department: person.department || "",
    });
    setErrors({});
    setEditing(true);
  }

  async function saveProfile(e) {
    e.preventDefault();
    setIsSaving(true);
    setErrors({});
    try {
      const { data } = await staffApi.update(person.id, form);
      applyUpdate(data);
      setEditing(false);
      showToast("Personal information updated.", "success");
    } catch (error) {
      const data = error?.response?.data?.errors || error?.response?.data;
      if (data && typeof data === "object") setErrors(data);
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveRole() {
    setIsSavingRole(true);
    try {
      const { data } = await staffApi.update(person.id, { roles: roleDraft });
      applyUpdate(data);
      showToast("Roles updated.", "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSavingRole(false);
    }
  }

  async function toggleActive() {
    try {
      const { data } = await staffApi.update(person.id, { is_active: !person.is_active });
      applyUpdate(data);
      showToast(data.is_active ? "Account enabled." : "Account disabled.", "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  }

  async function confirmDelete() {
    setIsDeleting(true);
    try {
      await staffApi.remove(person.id);
      showToast(`${person.full_name || person.username} deleted.`, "success");
      navigate("/admin/staff");
    } catch (error) {
      // Backend explains exactly why (owns events / last Admin account).
      showToast(extractErrorMessage(error), "error");
      setPendingDelete(false);
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setIsResetting(true);
    setPasswordError("");
    try {
      await staffApi.setPassword(person.id, newPassword);
      showToast(`Password reset for ${person.full_name || person.username}.`, "success");
      setShowReset(false);
      setNewPassword("");
    } catch (error) {
      const data = error?.response?.data;
      setPasswordError((data && (data.new_password?.[0] || data.detail)) || extractErrorMessage(error));
    } finally {
      setIsResetting(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <button className="jm-back-btn" onClick={() => navigate("/admin/staff")}>
          <ArrowLeftIcon size={16} /> Back
        </button>
        <p className="text-sm text-warning">{loadError}</p>
      </div>
    );
  }
  if (!person) {
    return <p className="text-sm text-ink-faint py-6">Loading...</p>;
  }

  const st = statusOf(person);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">{person.full_name || person.username}</h1>
          <p className="text-sm text-ink-muted mt-1">{person.email}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="jm-btn-secondary" onClick={() => navigate("/admin/staff")}>
            <ArrowLeftIcon size={16} />
            Back
          </button>
          <button
            className="jm-btn-secondary text-warning border-warning/40 hover:bg-warning/10 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setPendingDelete(true)}
            disabled={isSelf}
            title={isSelf ? "You can't delete your own account" : undefined}
          >
            <TrashIcon size={16} />
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        {/* Main column */}
        <div className="space-y-6 min-w-0">
          {/* Tabs */}
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-surface-muted p-1">
            {[
              { key: "overview", label: "Overview" },
              { key: "roles", label: "Roles" },
            ].map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={
                  "rounded-md py-2 text-sm font-medium transition-colors " +
                  (tab === t.key ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink")
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <>
              {/* Personal information */}
              <div className="jm-card p-0 overflow-hidden">
                <CardHeader title="Personal Information">
                  {!editing && (
                    <button
                      className="inline-flex items-center gap-2 text-sm font-medium text-ink hover:text-ems-primary"
                      onClick={startEdit}
                    >
                      <PencilIcon size={16} />
                      Edit
                    </button>
                  )}
                </CardHeader>

                {!editing ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6 p-6">
                    <InfoItem icon={<UserIcon />} label="Full Name" value={person.full_name} />
                    <InfoItem icon={<MailIcon />} label="Email" value={person.email} />
                    <InfoItem icon={<AtIcon />} label="Username" value={person.username} />
                    <InfoItem icon={<BriefcaseIcon />} label="Title" value={person.position} />
                    <InfoItem icon={<BuildingIcon />} label="Department" value={person.department} />
                  </div>
                ) : (
                  <form onSubmit={saveProfile} className="p-6 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      <div>
                        <label className="form-label">Email</label>
                        <input
                          type="email"
                          className="form-input"
                          required
                          value={form.email}
                          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
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
                      <div>
                        <label className="form-label">Title</label>
                        <input
                          className="form-input"
                          value={form.position}
                          onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="form-label">Department</label>
                        <input
                          className="form-input"
                          value={form.department}
                          onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
                        Cancel
                      </button>
                      <button type="submit" className="jm-btn-primary" disabled={isSaving}>
                        {isSaving ? "Saving..." : "Save Changes"}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Account */}
              <div className="jm-card p-0 overflow-hidden">
                <CardHeader title="Account" />
                <div className="p-6 space-y-5">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-sm text-ink-muted">Status</p>
                      <div className="mt-1">
                        <StatusPill person={person} />
                      </div>
                      {st === "pending" && (
                        <p className="text-xs text-ink-faint mt-2">
                          Self-registered, awaiting Admin approval before they can log in.
                        </p>
                      )}
                    </div>
                    <button
                      className="jm-btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={toggleActive}
                      disabled={isSelf}
                      title={isSelf ? "You can't disable your own account" : undefined}
                    >
                      {person.is_active ? "Disable" : person.self_registered ? "Approve" : "Enable"}
                    </button>
                  </div>

                  <div className="border-t border-line pt-5">
                    {!showReset ? (
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                          <p className="text-sm text-ink-muted">Password</p>
                          <p className="text-sm text-ink">Set a new password for this user.</p>
                        </div>
                        <button className="jm-btn-secondary" onClick={() => setShowReset(true)}>
                          Reset Password
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleResetPassword} className="space-y-3 max-w-sm">
                        <div>
                          <label className="form-label">New Password</label>
                          <input
                            type="password"
                            className="form-input"
                            required
                            minLength={8}
                            autoFocus
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                          />
                          {passwordError && <p className="form-error">{passwordError}</p>}
                        </div>
                        <p className="text-xs text-ink-faint">
                          Share this password with {person.full_name || person.username} directly - they aren't
                          notified automatically.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              setShowReset(false);
                              setNewPassword("");
                              setPasswordError("");
                            }}
                          >
                            Cancel
                          </button>
                          <button type="submit" className="jm-btn-primary" disabled={isResetting}>
                            {isResetting ? "Resetting..." : "Reset Password"}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === "roles" && (
            <div className="jm-card p-0 overflow-hidden">
              <CardHeader title="Assigned Roles">
                <button
                  className="jm-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={saveRole}
                  disabled={isSavingRole || roleDraft.length === 0 || sameRoles(roleDraft, rolesOf(person))}
                >
                  {isSavingRole ? "Saving..." : "Save Changes"}
                </button>
              </CardHeader>
              <div className="p-6">
                <div role="group" className="rounded-lg border border-line divide-y divide-line">
                  {ROLE_OPTIONS.map((r) => {
                    const checked = roleDraft.includes(r.value);
                    return (
                      <label
                        key={r.value}
                        className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-surface-muted/60"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-ems-primary"
                          checked={checked}
                          onChange={() =>
                            setRoleDraft((prev) =>
                              prev.includes(r.value) ? prev.filter((v) => v !== r.value) : [...prev, r.value]
                            )
                          }
                        />
                        <div>
                          <p className="font-medium text-ink">{r.label}</p>
                          <p className="text-sm text-ink-muted">{r.hint}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {isSelf && !roleDraft.includes("admin") && (
                  <p className="text-xs text-warning mt-3">
                    You're changing your own role. If you remove Admin access you won't be able to undo it yourself.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Profile card */}
        <div className="jm-card p-0 overflow-hidden">
          <div className="px-6 py-4 bg-surface-muted border-b border-line">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ems-primary">Profile</h2>
          </div>
          <div className="p-6">
            <div className="flex flex-col items-center text-center">
              <span className="h-24 w-24 rounded-full bg-ems-primaryLight text-ems-primaryLightText flex items-center justify-center text-3xl font-semibold">
                {initialsOf(person)}
              </span>
              <p className="mt-4 font-semibold text-ink">{person.full_name || person.username}</p>
              <p className="text-sm text-ink-muted">{person.position || "N/A"}</p>
              <div className="mt-3">
                <StatusPill person={person} />
              </div>
            </div>

            <div className="border-t border-line mt-6 pt-5 space-y-2 text-sm">
              <p className="break-words">
                <span className="font-semibold text-ink">Email:</span>{" "}
                <span className="text-ink-muted">{person.email}</span>
              </p>
              <p>
                <span className="font-semibold text-ink">Department:</span>{" "}
                <span className="text-ink-muted">{person.department || "N/A"}</span>
              </p>
            </div>

            <div className="border-t border-line mt-5 pt-5">
              <p className="text-sm text-ink-muted mb-2">Role</p>
              <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium bg-ems-primaryLight text-ems-primaryLightText">
                <ShieldIcon size={14} />
                {person.role_display}
              </span>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete}
        title={`Delete ${person.full_name || person.username}?`}
        message="This permanently removes the account. This can't be undone. If they own any events, deletion will be blocked - disable them instead in that case."
        confirmLabel="Delete"
        danger
        isSubmitting={isDeleting}
        onCancel={() => setPendingDelete(false)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
