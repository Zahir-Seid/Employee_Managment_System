import { useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import api from "../../api/client";
import { authApi } from "../../api/auth";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage } from "../../utils/format";
import Spinner from "../../components/common/Spinner.jsx";

export default function Profile() {
  const { user, updateUserLocally } = useAuth();
  const { showToast } = useToast();

  const [form, setForm] = useState({
    first_name: user?.first_name || "",
    last_name: user?.last_name || "",
    position: user?.position || "",
    department: user?.department || "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const [passwordForm, setPasswordForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  async function handleSaveProfile(e) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const { data } = await authApi.updateProfile(form);
      updateUserLocally(data);
      showToast("Profile updated.", "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePictureChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("profile_picture", file);
    try {
      const { data } = await api.patch("/auth/profile/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      updateUserLocally(data);
      showToast("Profile picture updated.", "success");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      e.target.value = "";
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (passwordForm.new_password !== passwordForm.confirm) {
      showToast("New password and confirmation do not match.", "error");
      return;
    }
    setIsChangingPassword(true);
    try {
      await authApi.changePassword(passwordForm.current_password, passwordForm.new_password);
      showToast("Password changed successfully.", "success");
      setPasswordForm({ current_password: "", new_password: "", confirm: "" });
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsChangingPassword(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl">Profile</h1>

      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-navy-100 text-navy-700 flex items-center justify-center text-xl font-medium overflow-hidden">
            {user?.profile_picture ? (
              <img src={user.profile_picture} alt="" className="h-full w-full object-cover" />
            ) : (
              (user?.full_name || user?.email || "?").charAt(0).toUpperCase()
            )}
          </div>
          <label className="btn-secondary cursor-pointer">
            Update Profile Picture
            <input type="file" accept="image/*" className="hidden" onChange={handlePictureChange} />
          </label>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4 pt-2">
          <div>
            <label className="form-label">Email</label>
            <input className="form-input bg-surface-muted" value={user?.email || ""} disabled />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">First Name</label>
              <input
                className="form-input"
                value={form.first_name}
                onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">Last Name</label>
              <input
                className="form-input"
                value={form.last_name}
                onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="form-label">Position</label>
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
          <div className="flex justify-end pt-2 border-t border-line">
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving && <Spinner size={14} className="!text-white" />}
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>

      <div className="card p-5">
        <h3 className="text-base mb-4">Change Password</h3>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="form-label">Current Password</label>
            <input
              type="password"
              className="form-input"
              value={passwordForm.current_password}
              onChange={(e) => setPasswordForm((f) => ({ ...f, current_password: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="form-label">New Password</label>
            <input
              type="password"
              className="form-input"
              value={passwordForm.new_password}
              onChange={(e) => setPasswordForm((f) => ({ ...f, new_password: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="form-label">Confirm New Password</label>
            <input
              type="password"
              className="form-input"
              value={passwordForm.confirm}
              onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))}
              required
            />
          </div>
          <div className="flex justify-end pt-2 border-t border-line">
            <button type="submit" className="btn-primary" disabled={isChangingPassword}>
              {isChangingPassword && <Spinner size={14} className="!text-white" />}
              {isChangingPassword ? "Updating..." : "Change Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
