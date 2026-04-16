"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import InlineClearButton from "../../components/InlineClearButton";

function SignUpPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const isStrongPassword = (value: string) =>
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value) &&
    value.length >= 8;

  const invitedEmail = searchParams.get("email") || "";
  const nextPath = searchParams.get("next") || "/";
  const safeNextPath = nextPath.startsWith("/") ? nextPath : "/";

  useEffect(() => {
    if (!invitedEmail || email) {
      return;
    }
    setEmail(invitedEmail);
  }, [email, invitedEmail]);

  const handleSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthMessage(null);

    if (!isStrongPassword(password)) {
      setAuthMessage(
        "Password must be at least 8 characters and include uppercase, lowercase, number, and special character."
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

      if (!registerResponse.ok) {
        const payload = (await registerResponse.json().catch(async () => {
          const text = await registerResponse.text().catch(() => "");
          return text ? { detail: text } : null;
        })) as { detail?: string; message?: string } | null;
        const detail = payload?.detail || payload?.message || "Registration failed";
        throw new Error(`Registration failed (${registerResponse.status}): ${detail}`);
      }

      const loginResponse = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!loginResponse.ok) {
        setAuthMessage("Account created. Please sign in.");
        const signInParams = new URLSearchParams({ returnTo: safeNextPath });
        if (email) {
          signInParams.set("email", email);
        }
        setTimeout(() => router.push(`/signin?${signInParams.toString()}`), 800);
        return;
      }

      setAuthMessage("Account created. Redirecting...");
      setTimeout(() => router.push(safeNextPath), 500);
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Registration failed");
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
                Use at least 8 characters with uppercase, lowercase, number, and special character.
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
              <Link href="/signin" className="font-semibold text-[color:var(--accent)] hover:underline">
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
