"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import InlineClearButton from "../../components/InlineClearButton";

const SIGNUP_DRAFT_STORAGE_KEY = "auth_signup_draft_v1";

type SignUpDraft = {
  email: string;
  username: string;
  fullName: string;
  password: string;
  confirmPassword: string;
};

type RegistrationResponse = {
  detail?: string;
  message?: string;
  requires_email_verification?: boolean;
  verification_email_sent?: boolean;
};

function SignUpPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [isResendingVerification, setIsResendingVerification] = useState(false);

  const isStrongPassword = (value: string) =>
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[^A-Za-z0-9]/.test(value) &&
    value.length >= 8;

  const invitedEmail = searchParams.get("email") || "";
  const nextPath = searchParams.get("next") || "/";
  const safeNextPath = nextPath.startsWith("/") ? nextPath : "/";
  const signInQuery = new URLSearchParams({ returnTo: safeNextPath });
  const signInEmail = email.trim() || invitedEmail;
  if (signInEmail) {
    signInQuery.set("email", signInEmail);
  }
  const signInHref = `/signin?${signInQuery.toString()}`;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(SIGNUP_DRAFT_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const draft = JSON.parse(raw) as Partial<SignUpDraft>;
      if (typeof draft.email === "string") setEmail(draft.email);
      if (typeof draft.username === "string") setUsername(draft.username);
      if (typeof draft.fullName === "string") setFullName(draft.fullName);
      if (typeof draft.password === "string") setPassword(draft.password);
      if (typeof draft.confirmPassword === "string") setConfirmPassword(draft.confirmPassword);
    } catch {
      // Ignore malformed draft payloads.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const draft: SignUpDraft = {
        email,
        username,
        fullName,
        password,
        confirmPassword,
      };
      window.sessionStorage.setItem(SIGNUP_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Ignore storage write failures.
    }
  }, [email, username, fullName, password, confirmPassword]);

  useEffect(() => {
    if (!invitedEmail || email) {
      return;
    }
    setEmail(invitedEmail);
  }, [email, invitedEmail]);

  const handleSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthMessage(null);
    setResendMessage(null);

    if (!isStrongPassword(password)) {
      setAuthMessage(
        "Password must be at least 8 characters and include uppercase, lowercase, and special character."
      );
      return;
    }

    if (password !== confirmPassword) {
      setAuthMessage("Password and confirm password do not match.");
      return;
    }

    try {
      const registerResponse = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          username: username || undefined,
          full_name: fullName || undefined,
        }),
      });

      const registerPayload = (await registerResponse.json().catch(async () => {
        const text = await registerResponse.text().catch(() => "");
        return text ? { detail: text } : null;
      })) as RegistrationResponse | null;

      if (!registerResponse.ok) {
        const detail = registerPayload?.detail || registerPayload?.message || "Registration failed";
        throw new Error(`Registration failed (${registerResponse.status}): ${detail}`);
      }

      const requiresEmailVerification = Boolean(registerPayload?.requires_email_verification);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(SIGNUP_DRAFT_STORAGE_KEY);
      }

      if (requiresEmailVerification) {
        setPendingVerificationEmail(email);
        setPassword("");
        setConfirmPassword("");
        setAuthMessage(
          registerPayload?.message || "Account created. Check your email to confirm your account."
        );
        return;
      }

      const loginResponse = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!loginResponse.ok) {
        setPendingVerificationEmail(null);
        setAuthMessage("Account created. Please sign in.");
        const signInParams = new URLSearchParams({ returnTo: safeNextPath });
        if (email) {
          signInParams.set("email", email);
        }
        setTimeout(() => router.push(`/signin?${signInParams.toString()}`), 800);
        return;
      }

      setPendingVerificationEmail(null);
      setAuthMessage("Account created. Redirecting...");
      setTimeout(() => router.push(safeNextPath), 500);
    } catch (err) {
      setPendingVerificationEmail(null);
      setAuthMessage(err instanceof Error ? err.message : "Registration failed");
    }
  };

  const handleResendVerification = async () => {
    if (!pendingVerificationEmail || isResendingVerification) {
      return;
    }
    setIsResendingVerification(true);
    setResendMessage(null);
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: pendingVerificationEmail }),
      });
      const payload = (await response.json().catch(async () => {
        const text = await response.text().catch(() => "");
        return text ? { detail: text } : null;
      })) as { message?: string; detail?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.message || "Failed to resend verification email.");
      }
      setResendMessage(payload?.message || "Verification email sent.");
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : "Failed to resend verification email.");
    } finally {
      setIsResendingVerification(false);
    }
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (authMessage) setAuthMessage(null);
  };

  const handleConfirmPasswordChange = (value: string) => {
    setConfirmPassword(value);
    if (authMessage) setAuthMessage(null);
  };

  return (
    <div className="grainy-bg min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-black/10 bg-white/90 p-8 shadow-lg">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
              Create Account
            </h1>
            <Link
              href="/"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/80 text-zinc-600 transition hover:bg-black/5 hover:text-zinc-900"
              aria-label="Cancel account creation"
              title="Cancel"
            >
              ✕
            </Link>
          </div>

          {authMessage && (
            <div
              className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
                authMessage.includes("created")
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {authMessage}
            </div>
          )}

          {pendingVerificationEmail && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <div>Finish registration from the confirmation email sent to {pendingVerificationEmail}.</div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={isResendingVerification}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isResendingVerification ? "Sending..." : "Resend confirmation email"}
                </button>
                <Link href={signInHref} className="font-semibold text-[color:var(--accent)] hover:underline">
                  Go to sign in
                </Link>
              </div>
              {resendMessage && <div className="mt-2 text-xs text-amber-900">{resendMessage}</div>}
            </div>
          )}

          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-700 mb-2">
                Email
              </label>
              <div className="group relative">
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-black/10 bg-white/80 px-4 py-2 pr-10 text-sm text-zinc-900 placeholder-zinc-400 focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/30"
                  placeholder="your@email.com"
                />
                <InlineClearButton
                  visible={Boolean(email)}
                  onClear={() => setEmail("")}
                  ariaLabel="Clear email"
                />
              </div>
            </div>

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-zinc-700 mb-2">
                Username (optional)
              </label>
              <div className="group relative">
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-black/10 bg-white/80 px-4 py-2 pr-10 text-sm text-zinc-900 placeholder-zinc-400 focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/30"
                  placeholder="yourname"
                />
                <InlineClearButton
                  visible={Boolean(username)}
                  onClear={() => setUsername("")}
                  ariaLabel="Clear username"
                />
              </div>
            </div>

            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-zinc-700 mb-2">
                Full name (optional)
              </label>
              <div className="group relative">
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-black/10 bg-white/80 px-4 py-2 pr-10 text-sm text-zinc-900 placeholder-zinc-400 focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/30"
                  placeholder="Your Name"
                />
                <InlineClearButton
                  visible={Boolean(fullName)}
                  onClear={() => setFullName("")}
                  ariaLabel="Clear full name"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-zinc-700 mb-2">
                Password
              </label>
              <div className="group relative">
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  required
                  className="w-full rounded-lg border border-black/10 bg-white/80 px-4 py-2 pr-10 text-sm text-zinc-900 placeholder-zinc-400 focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/30"
                  placeholder="••••••••"
                />
                <InlineClearButton
                  visible={Boolean(password)}
                  onClear={() => handlePasswordChange("")}
                  ariaLabel="Clear password"
                />
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Use at least 8 characters with uppercase, lowercase, and special character.
              </p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-zinc-700 mb-2">
                Confirm Password
              </label>
              <div className="group relative">
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => handleConfirmPasswordChange(e.target.value)}
                  required
                  className="w-full rounded-lg border border-black/10 bg-white/80 px-4 py-2 pr-10 text-sm text-zinc-900 placeholder-zinc-400 focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/30"
                  placeholder="••••••••"
                />
                <InlineClearButton
                  visible={Boolean(confirmPassword)}
                  onClear={() => handleConfirmPasswordChange("")}
                  ariaLabel="Clear confirm password"
                />
              </div>
            </div>

            <button
              type="submit"
              className="mt-2 w-full rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-4 py-2 text-sm font-medium text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20 hover:shadow-md"
            >
              Create Account
            </button>
          </form>

          <div className="mt-6 border-t border-black/10 pt-4">
            <p className="text-center text-sm text-zinc-600">
              Already have an account?{" "}
              <Link href={signInHref} className="font-semibold text-[color:var(--accent)] hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div className="grainy-bg min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="rounded-3xl border border-black/10 bg-white/90 p-8 shadow-lg text-sm text-zinc-600">
              Loading sign up...
            </div>
          </div>
        </div>
      }
    >
      <SignUpPageContent />
    </Suspense>
  );
}
