"use client";

import { useState } from "react";
import InlineClearButton from "../../components/InlineClearButton";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setToken(null);

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
        throw new Error(payload?.detail || "Unable to request password reset");
      }

      setMessage(payload?.message || "If an account exists, a reset link has been generated.");
      if (payload?.reset_token) {
        setToken(payload.reset_token);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to request password reset");
    }
  };

  return (
    <div className="grainy-bg min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-black/10 bg-white/90 p-8 shadow-lg">
          <h1 className="mb-6 font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
            Forgot Password
          </h1>

          {message && (
            <div className="mb-4 rounded-2xl border border-black/10 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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

            <button
              type="submit"
              className="mt-2 w-full rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-4 py-2 text-sm font-medium text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20 hover:shadow-md"
            >
              Request Reset
            </button>
          </form>

          {token && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 break-all">
              Reset token: {token}
              <div className="mt-2">
                Open <a href={`/reset-password?token=${encodeURIComponent(token)}`} className="underline">reset page</a>
              </div>
            </div>
          )}

          <div className="mt-6 border-t border-black/10 pt-4">
            <p className="text-center text-sm text-zinc-600">
              Back to{" "}
              <a href="/signin" className="font-semibold text-[color:var(--accent)] hover:underline">
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
