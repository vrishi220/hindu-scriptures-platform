"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import InlineClearButton from "../../components/InlineClearButton";
import { invalidateMeCache } from "../../lib/authClient";

const SIGNIN_DRAFT_STORAGE_KEY = "auth_signin_draft_v1";

type SignInDraft = {
  email: string;
  password: string;
};

function SignInPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const invitedEmail = searchParams.get("email") || "";
  const returnTo = searchParams.get("returnTo") || searchParams.get("next") || "/";
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/";
  const signUpQuery = new URLSearchParams({ next: safeReturnTo });
  const signUpEmail = email.trim() || invitedEmail;
  if (signUpEmail) {
    signUpQuery.set("email", signUpEmail);
  }
  const signUpHref = `/signup?${signUpQuery.toString()}`;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(SIGNIN_DRAFT_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const draft = JSON.parse(raw) as Partial<SignInDraft>;
      if (typeof draft.email === "string") setEmail(draft.email);
      if (typeof draft.password === "string") setPassword(draft.password);
    } catch {
      // Ignore malformed draft payloads.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const draft: SignInDraft = { email, password };
      window.sessionStorage.setItem(SIGNIN_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Ignore storage write failures.
    }
  }, [email, password]);

  useEffect(() => {
    if (!invitedEmail || email) {
      return;
    }
    setEmail(invitedEmail);
  }, [email, invitedEmail]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthMessage(null);
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
        throw new Error(`Login failed (${response.status}): ${detail}`);
      }
      setAuthMessage("Logged in. Redirecting...");
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
    }
  };

  return (
    <div className="grainy-bg min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-black/10 bg-white/90 p-8 shadow-lg">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
              Sign In
            </h1>
            <Link
              href="/"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/80 text-zinc-600 transition hover:bg-black/5 hover:text-zinc-900"
              aria-label="Cancel sign in"
              title="Cancel"
            >
              ✕
            </Link>
          </div>

          {authMessage && (
            <div
              className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
                authMessage.includes("Logged in")
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {authMessage}
            </div>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
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
              <label htmlFor="password" className="block text-sm font-medium text-zinc-700 mb-2">
                Password
              </label>
              <div className="group relative">
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-lg border border-black/10 bg-white/80 px-4 py-2 pr-10 text-sm text-zinc-900 placeholder-zinc-400 focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/30"
                  placeholder="••••••••"
                />
                <InlineClearButton
                  visible={Boolean(password)}
                  onClear={() => setPassword("")}
                  ariaLabel="Clear password"
                />
              </div>
            </div>

            <button
              type="submit"
              className="mt-2 w-full rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-4 py-2 text-sm font-medium text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20 hover:shadow-md"
            >
              Sign In
            </button>

            <Link
              href="/forgot-password"
              className="text-center text-sm font-medium text-[color:var(--accent)] hover:underline"
            >
              Forgot password?
            </Link>
          </form>

          <div className="mt-6 border-t border-black/10 pt-4">
            <p className="text-center text-sm text-zinc-600">
              Don&apos;t have an account?{" "}
              <Link href={signUpHref} className="font-semibold text-[color:var(--accent)] hover:underline">
                Create one
              </Link>
            </p>
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
        <div className="grainy-bg min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="rounded-3xl border border-black/10 bg-white/90 p-8 shadow-lg text-sm text-zinc-600">
              Loading sign in...
            </div>
          </div>
        </div>
      }
    >
      <SignInPageContent />
    </Suspense>
  );
}
