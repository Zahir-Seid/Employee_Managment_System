import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { authApi } from "../../api/auth";
import { extractErrorMessage } from "../../utils/format";
import Spinner from "../../components/common/Spinner.jsx";
import { CheckIcon } from "../../components/common/UiGlyphs.jsx";
import AuthShell, { AuthCard, ChevronRight, PasswordInput } from "../../components/auth/AuthShell.jsx";

// Mirrors the backend's own OTP_LENGTH (apps.accounts.registration) ,
// only used for the input's maxLength/pattern, the backend is what
// actually validates the code.
const OTP_LENGTH = 6;

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
};

const STEP_ICONS = {
  Email: (
    <svg {...iconProps}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  ),
  Verify: (
    <svg {...iconProps}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  Details: (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </svg>
  ),
};

// Progress header: "Step X of 3", percentage, progress bar and the three
// icon steps (spec steps 2-4, 5-6, 7-8).
function Steps({ current }) {
  const labels = ["Email", "Verify", "Details"];
  const percent = Math.round((current / labels.length) * 100);
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="font-semibold text-ink">
          Step {current} of {labels.length}
        </span>
        <span className="text-ink-muted">{percent}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-ems-primaryLight overflow-hidden">
        <div className="h-full rounded-full bg-ems-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-5">
        {labels.map((label, i) => {
          const step = i + 1;
          const active = step === current;
          const done = step < current;
          return (
            <div key={label} className="flex flex-col items-center gap-2">
              <div
                className={
                  "h-10 w-10 rounded-full flex items-center justify-center " +
                  (done
                    ? "bg-ems-primary text-white"
                    : active
                      ? "bg-ems-primaryLight text-ems-primary ring-2 ring-ems-primary/40"
                      : "bg-surface-muted text-ink-muted border border-line")
                }
              >
                {done ? <CheckIcon width={18} height={18} /> : STEP_ICONS[label]}
              </div>
              <span className={"text-xs " + (active ? "text-ink font-semibold" : "text-ink-muted")}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Red asterisk shown after the label of a required field.
function Req() {
  return (
    <span className="text-red-600 ml-0.5" aria-hidden="true">
      *
    </span>
  );
}

// Section title + one-line description shown under the step icons.
function StepHeading({ title, description }) {
  return (
    <div className="border-t border-line pt-5 mb-5">
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {description && <p className="text-sm text-ink-muted mt-0.5">{description}</p>}
    </div>
  );
}

// Back + primary action, as on the design reference. `onBack` omitted on the
// first step (nothing to go back to).
function StepFooter({ onBack, isSubmitting, label, busyLabel }) {
  return (
    <div className="flex gap-3 border-t border-line pt-5 mt-6">
      {onBack && (
        <button type="button" onClick={onBack} disabled={isSubmitting} className="jm-back-btn shrink-0 !py-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
      )}
      <button type="submit" className="jm-btn-primary flex-1 !rounded-lg !py-3 font-semibold" disabled={isSubmitting}>
        {isSubmitting && <Spinner size={14} className="!text-white" />}
        {isSubmitting ? busyLabel : label}
        {!isSubmitting && <ChevronRight />}
      </button>
    </div>
  );
}

export default function Register() {
  // Which step of the flow is showing. "done" is the final confirmation
  // screen (spec step 8's "account created" message), not a form step.
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  // Kept so going Back from the details step doesn't wipe what was typed.
  const [detailsDraft, setDetailsDraft] = useState({});

  return (
    <AuthShell>
      {step === "done" ? (
        <DoneStep />
      ) : (
        <AuthCard>
          <h2 className="text-2xl font-bold text-ink">Create account</h2>
          <p className="text-sm text-ink-muted mt-1 mb-6">Register with your official EE organizational email.</p>
          <Steps current={step} />
          {step === 1 && (
            <EmailStep
              initialEmail={email}
              onVerified={(sentEmail, cooldown) => {
                setEmail(sentEmail);
                // A fresh code was just sent, so any earlier verification no longer applies.
                setVerificationToken("");
                setResendCooldown(cooldown);
                setStep(2);
              }}
            />
          )}
          {step === 2 && (
            <OtpStep
              email={email}
              initialCooldown={resendCooldown}
              alreadyVerified={!!verificationToken}
              onVerified={(token) => {
                // `token` is null when the email was already verified and the
                // person just came back to this step; keep the existing one.
                if (token) setVerificationToken(token);
                setStep(3);
              }}
              onChangeEmail={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <DetailsStep
              email={email}
              verificationToken={verificationToken}
              initialValues={detailsDraft}
              onBack={(values) => {
                setDetailsDraft(values);
                setStep(2);
              }}
              onDone={() => setStep("done")}
            />
          )}
          <p className="text-center text-sm text-ink-muted mt-6">
            Already have an account?{" "}
            <Link to="/login" className="text-ems-primary hover:underline font-semibold">
              Sign in
            </Link>
          </p>
        </AuthCard>
      )}
      {step !== "done" && (
        <p className="text-center text-sm text-ink-muted mt-6">
          <Link to="/" className="hover:text-ems-primary hover:underline">
            ← Back to home
          </Link>
        </p>
      )}
    </AuthShell>
  );
}

function EmailStep({ initialEmail, onVerified }) {
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
      const { data } = await authApi.requestRegistrationOtp(email);
      onVerified(email, data.resend_cooldown ?? 60);
    } catch (error) {
      setServerError(extractErrorMessage(error));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <StepHeading
        title="Email address"
        description="We'll send a verification code to confirm it's yours."
      />
      {serverError && (
        <div className="rounded border border-warning bg-warning/5 text-warning text-sm px-3 py-2">
          {serverError}
        </div>
      )}
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
      <StepFooter isSubmitting={isSubmitting} label="Send Verification Code" busyLabel="Sending code..." />
    </form>
  );
}

function OtpStep({ email, initialCooldown, alreadyVerified, onVerified, onChangeEmail }) {
  const [code, setCode] = useState("");
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(initialCooldown);
  const [resendMessage, setResendMessage] = useState("");
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
      const { data } = await authApi.verifyRegistrationOtp(email, code.trim());
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
      const { data } = await authApi.requestRegistrationOtp(email);
      setCode("");
      setCooldown(data.resend_cooldown ?? 60);
      setResendMessage("A new code has been sent.");
    } catch (error) {
      setServerError(extractErrorMessage(error));
    } finally {
      setIsResending(false);
    }
  }

  // Came back from the details step: the email is already verified, so
  // there's no code to enter again, just continue.
  if (alreadyVerified) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onVerified(null);
        }}
        className="space-y-4"
      >
        <StepHeading title="Verify your email" description="Your email is already verified." />
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink">{email}</span> has been verified.
        </p>
        <StepFooter onBack={onChangeEmail} label="Continue" busyLabel="Continue" />
      </form>
    );
  }

  return (
    <form onSubmit={handleVerify} className="space-y-4">
      <StepHeading
        title="Verify your email"
        description={`Enter the ${OTP_LENGTH}-digit code sent to ${email}.`}
      />
      {serverError && (
        <div className="rounded border border-warning bg-warning/5 text-warning text-sm px-3 py-2">
          {serverError}
        </div>
      )}
      {resendMessage && !serverError && (
        <div className="rounded border border-success bg-success/5 text-success text-sm px-3 py-2">
          {resendMessage}
        </div>
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
      <div className="flex justify-end text-sm">
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
      <StepFooter onBack={onChangeEmail} isSubmitting={isSubmitting} label="Verify Code" busyLabel="Verifying..." />
    </form>
  );
}

function DetailsStep({ email, verificationToken, initialValues, onBack, onDone }) {
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: initialValues });
  const password = watch("password");

  async function onSubmit(values) {
    setServerError("");
    try {
      await authApi.completeRegistration({
        email,
        verification_token: verificationToken,
        title: values.title,
        first_name: values.first_name,
        middle_name: (values.middle_name || "").trim(),
        last_name: values.last_name,
        sex: values.sex,
        password: values.password,
      });
      onDone();
    } catch (error) {
      setServerError(extractErrorMessage(error));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <StepHeading
        title="Your details"
        description={`Email verified, ${email}. Complete your account below.`}
      />
      {serverError && (
        <div className="rounded border border-warning bg-warning/5 text-warning text-sm px-3 py-2">
          {serverError}
        </div>
      )}
      {/* One field per row, in this order: Title, First Name, Middle Name,
          Last Name, Sex. */}
      <div>
        <label className="form-label" htmlFor="title">
          Title <Req />
        </label>
        <select
          id="title"
          className="jm-auth-input"
          defaultValue=""
          {...register("title", { required: "Title is required" })}
        >
          <option value="" disabled>
            Select title
          </option>
          {["Mr", "Mrs", "Ms", "Dr", "Prof"].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {errors.title && <p className="form-error">{errors.title.message}</p>}
      </div>
      <div>
        <label className="form-label" htmlFor="first_name">
          First Name <Req />
        </label>
        <input
          id="first_name"
          className="jm-auth-input"
          {...register("first_name", { required: "First name is required" })}
        />
        {errors.first_name && <p className="form-error">{errors.first_name.message}</p>}
      </div>
      <div>
        <label className="form-label" htmlFor="middle_name">
          Middle Name
        </label>
        <input id="middle_name" className="jm-auth-input" {...register("middle_name")} />
      </div>
      <div>
        <label className="form-label" htmlFor="last_name">
          Last Name <Req />
        </label>
        <input
          id="last_name"
          className="jm-auth-input"
          {...register("last_name", { required: "Last name is required" })}
        />
        {errors.last_name && <p className="form-error">{errors.last_name.message}</p>}
      </div>
      <div>
        <label className="form-label" htmlFor="sex">
          Sex <Req />
        </label>
        <select
          id="sex"
          className="jm-auth-input"
          defaultValue=""
          {...register("sex", { required: "Sex is required" })}
        >
          <option value="" disabled>
            Select sex
          </option>
          <option value="Female">Female</option>
          <option value="Male">Male</option>
        </select>
        {errors.sex && <p className="form-error">{errors.sex.message}</p>}
      </div>
      <div>
        <label className="form-label" htmlFor="password">
          Password <Req />
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
          Confirm Password <Req />
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
      <StepFooter
        onBack={() => onBack(getValues())}
        isSubmitting={isSubmitting}
        label="Create Account"
        busyLabel="Creating account..."
      />
    </form>
  );
}

function DoneStep() {
  return (
    <AuthCard className="space-y-4 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-success/10 text-success flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div>
        <h2 className="text-ink font-semibold mb-1">Account created</h2>
        <p className="text-sm text-ink-muted">
          Your Staff account is ready. You can log in now. If you need a different role, ask an Admin to assign it.
        </p>
      </div>
      <Link to="/login" className="jm-back-btn w-full">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Login
      </Link>
    </AuthCard>
  );
}
