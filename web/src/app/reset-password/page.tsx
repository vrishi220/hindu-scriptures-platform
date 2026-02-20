"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const initialToken = useMemo(() => searchParams.get("token") || "", [searchParams]);

  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

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

      setMessage(payload?.message || "Password reset successful");
      setNewPassword("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to reset password");
    }
  };

  return (
    <div className="grainy-bg min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-black/10 bg-white/90 p-8 shadow-lg">
          <h1 className="mb-6 font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
            Reset Password
          </h1>

          {message && (
            <div className="mb-4 rounded-2xl border border-black/10 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="token" className="block text-sm font-medium text-zinc-700 mb-2">
                Reset token
              </label>
              <input
                id="token"
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                className="w-full rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/30"
                placeholder="Paste reset token"
              />
            </div>

            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-zinc-700 mb-2">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
                className="w-full rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/30"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="mt-2 w-full rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-4 py-2 text-sm font-medium text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20 hover:shadow-md"
            >
              Reset Password
            </button>
          </form>

          <div className="mt-6 border-t border-black/10 pt-4">
            <p className="text-center text-sm text-zinc-600">
              Continue to{" "}
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="grainy-bg min-h-screen" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
