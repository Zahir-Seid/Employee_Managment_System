import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.jsx";
import { extractErrorMessage } from "../../utils/format";
import Spinner from "../../components/common/Spinner.jsx";
import AuthShell, { AuthCard, ChevronRight, PasswordInput } from "../../components/auth/AuthShell.jsx";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm();

  async function onSubmit(values) {
    setServerError("");
    try {
      await login(values.email, values.password);
      const redirectTo = location.state?.from?.pathname || "/dashboard";
      navigate(redirectTo, { replace: true });
    } catch (error) {
      console.error("Login failed:", error);
      setServerError(extractErrorMessage(error));
    }
  }

  return (
    <AuthShell>
      <AuthCard>
        <h2 className="text-2xl font-bold text-ink">Sign in</h2>
        <p className="text-sm text-ink-muted mt-1 mb-6">Enter your email and password to continue.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 border-t border-line pt-5">
          {location.state?.notice && !serverError && (
            <div className="rounded border border-success bg-success/5 text-success text-sm px-3 py-2">
              {location.state.notice}
            </div>
          )}
          {serverError && (
            <div className="rounded border border-warning bg-warning/5 text-warning text-sm px-3 py-2">
              {serverError}
            </div>
          )}

          <div>
            <label className="form-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="jm-auth-input"
              {...register("email", { required: "Email is required" })}
            />
            {errors.email && <p className="form-error">{errors.email.message}</p>}
          </div>

          <div>
            <label className="form-label" htmlFor="password">
              Password
            </label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              {...register("password", { required: "Password is required" })}
            />
            {errors.password && <p className="form-error">{errors.password.message}</p>}
          </div>

          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-ink-muted">
              <input type="checkbox" className="rounded border-line" {...register("rememberMe")} />
              Remember me
            </label>
            <Link to="/forgot-password" className="text-ems-primary hover:underline">
              Forgot password?
            </Link>
          </div>

          <button type="submit" className="jm-btn-primary w-full !rounded-lg !py-3 font-semibold" disabled={isSubmitting}>
            {isSubmitting && <Spinner size={14} className="!text-white" />}
            {isSubmitting ? "Signing in..." : "Login"}
            {!isSubmitting && <ChevronRight />}
          </button>
        </form>
      </AuthCard>

      <p className="text-center text-sm text-ink-muted mt-6">
        New here?{" "}
        <Link to="/register" className="text-ems-primary hover:underline font-medium">
          Register with your EE email
        </Link>
      </p>
    </AuthShell>
  );
}
