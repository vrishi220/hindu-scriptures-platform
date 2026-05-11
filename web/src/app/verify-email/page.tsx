"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppBanner from "@/components/scriptle/AppBanner";

type Status = "loading" | "success" | "error";

function VerifyEmailPageContent() {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Verifying your email…");
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const token = searchParams.get("token") || "";
    if (!token) {
      queueMicrotask(() => {
        setStatus("error");
        setMessage("This verification link is missing a token.");
      });
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

        if (cancelled) return;

        if (!response.ok) {
          setStatus("error");
          setMessage(
            payload?.detail || payload?.message || "Verification failed."
          );
          return;
        }
        setStatus("success");
        setMessage(
          payload?.message || "Email verified. You can now sign in."
        );
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage(
            "Verification failed. Try again or request a new confirmation email."
          );
        }
      }
    };

    void verify();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const alertVariant =
    status === "success" ? "success" : status === "error" ? "error" : "info";

  return (
    <div data-scriptle="true">
      <AppBanner active="search" />
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-head">
            <h1 className="auth-title">Confirm email</h1>
            <p className="auth-sub">
              {status === "loading"
                ? "One moment…"
                : status === "success"
                  ? "Your account is ready."
                  : "We could not verify this link."}
            </p>
          </div>

          <div className={`auth-alert ${alertVariant}`}>{message}</div>

          <div className="auth-links">
            <Link href="/signin" className="auth-link primary">
              Continue to sign in →
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
        <div data-scriptle="true">
          <AppBanner active="search" />
          <div className="auth-shell">
            <div className="auth-card">
              <div className="auth-head">
                <h1 className="auth-title">Confirm email</h1>
                <p className="auth-sub">Loading…</p>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <VerifyEmailPageContent />
    </Suspense>
  );
}
