"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppBanner from "@/components/scriptle/AppBanner";

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

const isStrongPassword = (value: string) =>
  /[A-Z]/.test(value) &&
  /[a-z]/.test(value) &&
  /[^A-Za-z0-9]/.test(value) &&
  value.length >= 8;

function SignUpPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<
    string | null
  >(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const invitedEmail = searchParams.get("email") || "";
  const nextPath = searchParams.get("next") || "/";
  const safeNextPath = nextPath.startsWith("/") ? nextPath : "/";
  const signInQuery = new URLSearchParams({ returnTo: safeNextPath });
  const signInEmail = email.trim() || invitedEmail;
  if (signInEmail) signInQuery.set("email", signInEmail);
  const signInHref = `/signin?${signInQuery.toString()}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(SIGNUP_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<SignUpDraft>;
      if (typeof draft.email === "string") setEmail(draft.email);
      if (typeof draft.username === "string") setUsername(draft.username);
      if (typeof draft.fullName === "string") setFullName(draft.fullName);
      if (typeof draft.password === "string") setPassword(draft.password);
      if (typeof draft.confirmPassword === "string")
        setConfirmPassword(draft.confirmPassword);
    } catch {
      // ignore malformed draft
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        SIGNUP_DRAFT_STORAGE_KEY,
        JSON.stringify({ email, username, fullName, password, confirmPassword })
      );
    } catch {
      // ignore storage write failures
    }
  }, [email, username, fullName, password, confirmPassword]);

  useEffect(() => {
    if (!invitedEmail || email) return;
    setEmail(invitedEmail);
  }, [email, invitedEmail]);

  const handleSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthMessage(null);
    setResendMessage(null);

    if (!isStrongPassword(password)) {
      setAuthMessage(
        "Password must be at least 8 characters with uppercase, lowercase, and a special character."
      );
      return;
    }
    if (password !== confirmPassword) {
      setAuthMessage("Passwords do not match.");
      return;
    }

    setSubmitting(true);
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

      const registerPayload = (await registerResponse
        .json()
        .catch(async () => {
          const text = await registerResponse.text().catch(() => "");
          return text ? { detail: text } : null;
        })) as RegistrationResponse | null;

      if (!registerResponse.ok) {
        const detail =
          registerPayload?.detail ||
          registerPayload?.message ||
          "Registration failed";
        throw new Error(detail);
      }

      const requiresEmailVerification = Boolean(
        registerPayload?.requires_email_verification
      );
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(SIGNUP_DRAFT_STORAGE_KEY);
      }

      if (requiresEmailVerification) {
        setPendingVerificationEmail(email);
        setPassword("");
        setConfirmPassword("");
        setAuthMessage(
          registerPayload?.message ||
            "Account created. Check your email to confirm."
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
        if (email) signInParams.set("email", email);
        setTimeout(
          () => router.push(`/signin?${signInParams.toString()}`),
          800
        );
        return;
      }

      setPendingVerificationEmail(null);
      setAuthMessage("Account created. Redirecting…");
      setTimeout(() => router.push(safeNextPath), 500);
    } catch (err) {
      setPendingVerificationEmail(null);
      setAuthMessage(
        err instanceof Error ? err.message : "Registration failed"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    if (!pendingVerificationEmail || isResendingVerification) return;
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
        throw new Error(
          payload?.detail ||
            payload?.message ||
            "Failed to resend verification email."
        );
      }
      setResendMessage(payload?.message || "Verification email sent.");
    } catch (err) {
      setResendMessage(
        err instanceof Error
          ? err.message
          : "Failed to resend verification email."
      );
    } finally {
      setIsResendingVerification(false);
    }
  };

  const isSuccess = authMessage?.toLowerCase().includes("created");

  return (
    <div data-scriptle="true">
      <AppBanner active="search" />
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-head">
            <h1 className="auth-title">Begin your study</h1>
            <p className="auth-sub">Create an account to save and contribute.</p>
          </div>

          {authMessage ? (
            <div className={`auth-alert ${isSuccess ? "success" : "error"}`}>
              {authMessage}
            </div>
          ) : null}

          {pendingVerificationEmail ? (
            <div className="auth-alert info">
              Confirmation sent to <strong>{pendingVerificationEmail}</strong>.
              Click the link in that email to finish creating your account.
              <div className="auth-alert-actions">
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={isResendingVerification}
                  className="auth-link"
                >
                  {isResendingVerification ? "Sending…" : "Resend email"}
                </button>
                <Link href={signInHref} className="auth-link primary">
                  Go to sign in
                </Link>
              </div>
              {resendMessage ? (
                <div style={{ marginTop: 8, fontSize: 11 }}>
                  {resendMessage}
                </div>
              ) : null}
            </div>
          ) : null}

          <form className="auth-form" onSubmit={handleSignup}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="auth-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
              />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="username">
                Username <span style={{ opacity: 0.6 }}>(optional)</span>
              </label>
              <input
                id="username"
                className="auth-input"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="yourname"
              />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="fullName">
                Full name <span style={{ opacity: 0.6 }}>(optional)</span>
              </label>
              <input
                id="fullName"
                className="auth-input"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your Name"
              />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="auth-input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (authMessage) setAuthMessage(null);
                }}
                required
                placeholder="••••••••"
              />
              <div className="auth-hint">
                At least 8 characters with uppercase, lowercase, and a special
                character.
              </div>
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="confirmPassword">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                className="auth-input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (authMessage) setAuthMessage(null);
                }}
                required
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              className="auth-submit"
              disabled={submitting}
            >
              {submitting ? "Creating…" : "Create account"}
            </button>
          </form>

          <div className="auth-links">
            <span>Already have an account?</span>
            <Link href={signInHref} className="auth-link primary">
              Sign in
            </Link>
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
        <div data-scriptle="true">
          <AppBanner active="search" />
          <div className="auth-shell">
            <div className="auth-card">
              <div className="auth-head">
                <h1 className="auth-title">Begin your study</h1>
                <p className="auth-sub">Loading…</p>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <SignUpPageContent />
    </Suspense>
  );
}
