"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AppBanner from "@/components/scriptle/AppBanner";

const isStrongPassword = (value: string) =>
  /[A-Z]/.test(value) &&
  /[a-z]/.test(value) &&
  /[^A-Za-z0-9]/.test(value) &&
  value.length >= 8;

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const initialToken = useMemo(
    () => searchParams.get("token") || "",
    [searchParams]
  );

  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    if (!isStrongPassword(newPassword)) {
      setIsSuccess(false);
      setMessage(
        "Password must be at least 8 characters with uppercase, lowercase, and a special character."
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setIsSuccess(false);
      setMessage("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: newPassword }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; detail?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.detail || "Unable to reset password");
      }
      setIsSuccess(true);
      setMessage(payload?.message || "Password reset successfully.");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setIsSuccess(false);
      setMessage(
        err instanceof Error ? err.message : "Unable to reset password"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-scriptle="true">
      <AppBanner active="search" />
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-head">
            <h1 className="auth-title">Choose a new password</h1>
            <p className="auth-sub">
              Use the token from your reset email below.
            </p>
          </div>

          {message ? (
            <div className={`auth-alert ${isSuccess ? "success" : "error"}`}>
              {message}
              {isSuccess ? (
                <div style={{ marginTop: 10 }}>
                  <Link href="/signin" className="auth-link primary">
                    Sign in →
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="token">
                Reset token
              </label>
              <input
                id="token"
                className="auth-input"
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                placeholder="Paste token from email"
              />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                className="auth-input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
                placeholder="••••••••"
              />
              <div className="auth-hint">
                At least 8 characters with uppercase, lowercase, and a special
                character.
              </div>
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="confirm-password">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                className="auth-input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              className="auth-submit"
              disabled={submitting}
            >
              {submitting ? "Resetting…" : "Reset password"}
            </button>
          </form>

          <div className="auth-links">
            <Link href="/signin" className="auth-link">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div data-scriptle="true">
          <AppBanner active="search" />
          <div className="auth-shell">
            <div className="auth-card">
              <div className="auth-head">
                <h1 className="auth-title">Choose a new password</h1>
                <p className="auth-sub">Loading…</p>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
