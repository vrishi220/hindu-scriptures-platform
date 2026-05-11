"use client";

import { useState } from "react";
import Link from "next/link";
import AppBanner from "@/components/scriptle/AppBanner";

const SHOW_DEBUG_RESET_TOKEN =
  process.env.NEXT_PUBLIC_SHOW_RESET_TOKEN === "true";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setToken(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; detail?: string; reset_token?: string | null }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.detail || "Unable to request a password reset"
        );
      }
      setIsSuccess(true);
      setMessage(
        payload?.message ||
          "If an account exists for that email, a reset link is on its way."
      );
      if (SHOW_DEBUG_RESET_TOKEN && payload?.reset_token) {
        setToken(payload.reset_token);
      }
    } catch (err) {
      setIsSuccess(false);
      setMessage(
        err instanceof Error
          ? err.message
          : "Unable to request a password reset"
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
            <h1 className="auth-title">Reset your password</h1>
            <p className="auth-sub">
              Enter your email and we&apos;ll send a reset link.
            </p>
          </div>

          {message ? (
            <div className={`auth-alert ${isSuccess ? "success" : "error"}`}>
              {message}
            </div>
          ) : null}

          <form className="auth-form" onSubmit={handleSubmit}>
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
            <button
              type="submit"
              className="auth-submit"
              disabled={submitting}
            >
              {submitting ? "Sending…" : "Send reset link"}
            </button>
          </form>

          {token ? (
            <div
              className="auth-alert info"
              style={{ wordBreak: "break-all" }}
            >
              Reset token: {token}
              <div style={{ marginTop: 8 }}>
                <Link
                  href={`/reset-password?token=${encodeURIComponent(token)}`}
                  className="auth-link primary"
                >
                  Open reset page →
                </Link>
              </div>
            </div>
          ) : null}

          <div className="auth-links">
            <span>Remembered it?</span>
            <Link href="/signin" className="auth-link primary">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
