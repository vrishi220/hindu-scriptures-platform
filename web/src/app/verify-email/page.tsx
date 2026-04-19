"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function VerifyEmailPageContent() {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Verifying your email...");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    const token = searchParams.get("token") || "";
    if (!token) {
      setStatus("error");
      setMessage("This verification link is missing a token.");
      return;
    }

    let cancelled = false;
    const verify = async () => {
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        });
        const payload = (await response.json().catch(async () => {
          const text = await response.text().catch(() => "");
          return text ? { detail: text } : null;
        })) as { message?: string; detail?: string } | null;

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setStatus("error");
          setMessage(payload?.detail || payload?.message || "Verification failed.");
          return;
        }

        setStatus("success");
        setMessage(payload?.message || "Email verified. You can now sign in.");
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("Verification failed. Please try again or request a new confirmation email.");
        }
      }
    };

    void verify();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <div className="grainy-bg min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-black/10 bg-white/90 p-8 shadow-lg">
          <h1 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
            Confirm Email
          </h1>
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
              status === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : status === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-zinc-200 bg-zinc-50 text-zinc-700"
            }`}
          >
            {message}
          </div>
          <div className="mt-6 border-t border-black/10 pt-4 text-sm text-zinc-600">
            <Link href="/signin" className="font-semibold text-[color:var(--accent)] hover:underline">
              Continue to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="grainy-bg min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="rounded-3xl border border-black/10 bg-white/90 p-8 shadow-lg text-sm text-zinc-600">
              Loading email verification...
            </div>
          </div>
        </div>
      }
    >
      <VerifyEmailPageContent />
    </Suspense>
  );
}