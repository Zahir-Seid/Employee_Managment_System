import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../../api/auth";
import { extractErrorMessage } from "../../utils/format";
import Spinner from "../../components/common/Spinner.jsx";
import AuthShell, { AuthCard, ChevronRight, PasswordInput } from "../../components/auth/AuthShell.jsx";

// Forgot password: 1) enter email, 2) enter the 6-digit code emailed to it,
// 3) set a new password. On success the person is sent to Login.

const OTP_LENGTH = 6;

function Req() {
  return (
    <span className="text-red-600 ml-0.5" aria-hidden="true">
      *
    </span>
  );
}

function ErrorBox({ children }) {
  return (
    <div className="rounded border border-warning bg-warning/5 text-warning text-sm px-3 py-2">{children}</div>
  );
}

function Heading({ title, description }) {
  return (
    <div>
      <h3 className="text-base font-bold text-ink">{title}</h3>
      <p className="text-sm text-ink-muted mt-0.5">{description}</p>
    </div>
  );
}

function SubmitButton({ busy, label, busyLabel }) {
  return (
    <button type="submit" className="jm-btn-primary w-full !rounded-lg !py-3 font-semibold" disabled={busy}>
      {busy && <Spinner size={14} className="!text-white" />}
      {busy ? busyLabel : label}
      {!busy && <ChevronRight />}
    </button>
  );
}

export default function ForgotPassword() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const navigate = useNavigate();

  return (
    <AuthShell>
      <AuthCard>
        <h2 className="text-2xl font-bold text-ink">Reset password</h2>
        <p className="text-sm text-ink-muted mt-1 mb-6">Verify your email, then choose a new password.</p>
        <div className="border-t border-line pt-5">
          {step === 1 && (
            <EmailStep
              initialEmail={email}
              onSent={(sentEmail, seconds) => {
                setEmail(sentEmail);
                setCooldown(seconds);
                setStep(2);
              }}
            />
          )}
          {step === 2 && (
            <CodeStep
              email={email}
              initialCooldown={cooldown}
              onVerified={(token) => {
                setVerificationToken(token);
                setStep(3);
              }}
              onChangeEmail={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <PasswordStep
              email={email}
              verificationToken={verificationToken}
              onDone={() =>
                navigate("/login", {
                  replace: true,
                  state: { notice: "Your password has been reset. You can now log in with your new password." },
                })
              }
            />
          )}
        </div>
        <p className="text-center text-sm text-ink-muted mt-6">
          Remembered it?{" "}
          <Link to="/login" className="text-ems-primary hover:underline font-semibold">
            Sign in
          </Link>
        </p>
      </AuthCard>
      <p className="text-center text-sm text-ink-muted mt-6">
        <Link to="/" className="hover:text-ems-primary hover:underline">
          ← Back to home
        </Link>
      </p>
    </AuthShell>
  );
}

function EmailStep({ initialEmail, onSent }) {
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { email: initialEmail || "" } });

  async function onSubmit(values) {
    setServerError("");
    const email = values.email.trim();
    try {
      const { data } = await authApi.requestPasswordResetOtp(email);
      onSent(email, data.resend_cooldown ?? 60);
    } catch (error) {
      setServerError(extractErrorMessage(error));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Heading title="Email address" description="We'll send a verification code to your email." />
      {serverError && <ErrorBox>{serverError}</ErrorBox>}
      <div>
        <label className="form-label" htmlFor="email">
          Organizational Email <Req />
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          placeholder="you@ee.org"
          className="jm-auth-input"
          {...register("email", { required: "Email is required" })}
        />
        {errors.email && <p className="form-error">{errors.email.message}</p>}
      </div>
      <SubmitButton busy={isSubmitting} label="Send Verification Code" busyLabel="Sending code..." />
    </form>
  );
}

function CodeStep({ email, initialCooldown, onVerified, onChangeEmail }) {
  const [code, setCode] = useState("");
  const [serverError, setServerError] = useState("");
  const [resendMessage, setResendMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(initialCooldown);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    intervalRef.current = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooldown > 0]);

  async function handleVerify(e) {
    e.preventDefault();
    setServerError("");
    if (code.trim().length !== OTP_LENGTH) {
      setServerError(`Enter the ${OTP_LENGTH}-digit code from your email.`);
      return;
    }
    setIsSubmitting(true);
    try {
      const { data } = await authApi.verifyPasswordResetOtp(email, code.trim());
      onVerified(data.verification_token);
    } catch (error) {
      setServerError(extractErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    setServerError("");
    setResendMessage("");
    setIsResending(true);
    try {
      const { data } = await authApi.requestPasswordResetOtp(email);
      setCode("");
      setCooldown(data.resend_cooldown ?? 60);
      setResendMessage("If this email has an account, a new code has been sent.");
    } catch (error) {
      setServerError(extractErrorMessage(error));
    } finally {
      setIsResending(false);
    }
  }

  return (
    <form onSubmit={handleVerify} className="space-y-4">
      <Heading title="Verify your email" description={`Enter the ${OTP_LENGTH}-digit code sent to ${email}.`} />
      {serverError && <ErrorBox>{serverError}</ErrorBox>}
      {resendMessage && !serverError && (
        <div className="rounded border border-success bg-success/5 text-success text-sm px-3 py-2">{resendMessage}</div>
      )}
      <div>
        <label className="form-label" htmlFor="otp">
          Verification Code <Req />
        </label>
        <input
          id="otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          placeholder="000000"
          className="jm-auth-input text-center text-lg tracking-[0.4em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
        />
      </div>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onChangeEmail} className="text-ink-muted hover:underline">
          Change email
        </button>
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0 || isResending}
          className={
            cooldown > 0 || isResending
              ? "text-ink-faint cursor-not-allowed"
              : "text-ems-primary hover:underline font-medium"
          }
        >
          {isResending ? "Sending..." : cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
      </div>
      <SubmitButton busy={isSubmitting} label="Verify Code" busyLabel="Verifying..." />
    </form>
  );
}

function PasswordStep({ email, verificationToken, onDone }) {
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm();
  const password = watch("password");

  async function onSubmit(values) {
    setServerError("");
    try {
      await authApi.completePasswordReset({
        email,
        verification_token: verificationToken,
        password: values.password,
      });
      onDone();
    } catch (error) {
      setServerError(extractErrorMessage(error));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Heading title="New password" description={`Choose a new password for ${email}.`} />
      {serverError && <ErrorBox>{serverError}</ErrorBox>}
      <div>
        <label className="form-label" htmlFor="password">
          New Password <Req />
        </label>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          {...register("password", {
            required: "Password is required",
            minLength: { value: 8, message: "Password must be at least 8 characters." },
          })}
        />
        {errors.password && <p className="form-error">{errors.password.message}</p>}
      </div>
      <div>
        <label className="form-label" htmlFor="confirm_password">
          Confirm New Password <Req />
        </label>
        <PasswordInput
          id="confirm_password"
          autoComplete="new-password"
          {...register("confirm_password", {
            required: "Please confirm your password",
            validate: (value) => value === password || "Passwords don't match.",
          })}
        />
        {errors.confirm_password && <p className="form-error">{errors.confirm_password.message}</p>}
      </div>
      <SubmitButton busy={isSubmitting} label="Reset Password" busyLabel="Resetting..." />
    </form>
  );
}
