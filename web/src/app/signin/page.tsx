"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AppBanner from "@/components/scriptle/AppBanner";
import { invalidateMeCache } from "@/lib/authClient";

const SIGNIN_DRAFT_STORAGE_KEY = "auth_signin_draft_v1";

type SignInDraft = { email: string; password: string };

function SignInPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const invitedEmail = searchParams.get("email") || "";
  const returnTo =
    searchParams.get("returnTo") || searchParams.get("next") || "/";
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/";
  const signUpQuery = new URLSearchParams({ next: safeReturnTo });
  const signUpEmail = email.trim() || invitedEmail;
  if (signUpEmail) signUpQuery.set("email", signUpEmail);
  const signUpHref = `/signup?${signUpQuery.toString()}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(SIGNIN_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<SignInDraft>;
      if (typeof draft.email === "string") setEmail(draft.email);
      if (typeof draft.password === "string") setPassword(draft.password);
    } catch {
      // ignore malformed draft
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        SIGNIN_DRAFT_STORAGE_KEY,
        JSON.stringify({ email, password })
      );
    } catch {
      // ignore storage write failures
    }
  }, [email, password]);

  useEffect(() => {
    if (!invitedEmail || email) return;
    setEmail(invitedEmail);
  }, [email, invitedEmail]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthMessage(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(async () => {
          const text = await response.text().catch(() => "");
          return text ? { detail: text } : null;
        })) as { detail?: string; message?: string } | null;
        const detail = payload?.detail || payload?.message || "Login failed";
        throw new Error(detail);
      }
      setAuthMessage("Signed in. Redirecting…");
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(SIGNIN_DRAFT_STORAGE_KEY);
      }
      setEmail("");
      setPassword("");
      invalidateMeCache();
      setTimeout(() => {
        router.replace(safeReturnTo);
        router.refresh();
      }, 500);
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const isSuccess = authMessage?.toLowerCase().includes("signed in");

  return (
    <div data-scriptle="true">
      <AppBanner active="search" />
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-head">
            <h1 className="auth-title">Welcome back</h1>
            <p className="auth-sub">Sign in to continue your study.</p>
          </div>

          {authMessage ? (
            <div className={`auth-alert ${isSuccess ? "success" : "error"}`}>
              {authMessage}
            </div>
          ) : null}

          <form className="auth-form" onSubmit={handleLogin}>
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
              <label className="auth-label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="auth-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              className="auth-submit"
              disabled={submitting}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="auth-links">
            <Link href="/forgot-password" className="auth-link">
              Forgot password?
            </Link>
            <span className="auth-divider">·</span>
            <Link href={signUpHref} className="auth-link primary">
              Create account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div data-scriptle="true">
          <AppBanner active="search" />
          <div className="auth-shell">
            <div className="auth-card">
              <div className="auth-head">
                <h1 className="auth-title">Welcome back</h1>
                <p className="auth-sub">Loading…</p>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <SignInPageContent />
    </Suspense>
  );
}
