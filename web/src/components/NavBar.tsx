"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getMe, invalidateMeCache } from "@/lib/authClient";

export default function NavBar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [canAdmin, setCanAdmin] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const loadAuth = async (force = false) => {
      const data = await getMe({ force });
      if (!data) {
        setAuthEmail(null);
        setCanAdmin(false);
        return;
      }
      setAuthEmail(data.email || null);
      setCanAdmin(Boolean(data.permissions?.can_admin || data.role === "admin"));
    };
    void loadAuth();

    // Re-check auth when window regains focus
    const handleFocus = () => {
      void loadAuth(true);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [pathname]);

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore errors
    }
    invalidateMeCache();
    setAuthEmail(null);
    setCanAdmin(false);
    setMobileMenuOpen(false);
    window.location.href = "/";
  };

  const isActive = (href: string) => pathname === href;

  return (
    <nav className="border-b border-black/10 bg-white/80 sticky top-0 z-40">
      <div className="mx-auto flex w-full items-center justify-between px-4 sm:px-6 py-3 sm:py-4">
        {/* Left section: Mobile menu button + Logo */}
        <div className="flex items-center gap-2 sm:gap-6">
          {/* Mobile menu button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="sm:hidden flex h-10 w-10 items-center justify-center rounded-lg border border-black/10 bg-white/90 text-xl font-bold text-zinc-700 hover:bg-black/5 hover:text-[color:var(--accent)] transition"
            title="Menu"
          >
            ☰
          </button>

          {/* Logo - always visible */}
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/logo-mark.svg"
              alt="Hindu Scriptures"
              className="h-7 sm:h-8 w-7 sm:w-8"
            />
            <span className="inline text-sm font-semibold text-[color:var(--deep)]">
              Hindu Scriptures
            </span>
          </Link>
        </div>

        {/* Desktop menu - hidden on mobile */}
        <div className="hidden items-center gap-4 text-sm text-zinc-600 sm:flex">
          <Link
            href="/"
            className={`hover:text-[color:var(--accent)] ${
              isActive("/") ? "font-semibold text-[color:var(--deep)]" : ""
            }`}
          >
            Home
          </Link>
          <a
            href="/scriptures"
            className={`hover:text-[color:var(--accent)] ${
              isActive("/scriptures")
                ? "font-semibold text-[color:var(--deep)]"
                : ""
            }`}
          >
            Scriptures
          </a>
          {authEmail && (
            <a
              href="/compilations"
              className={`hover:text-[color:var(--accent)] ${
                isActive("/compilations")
                  ? "font-semibold text-[color:var(--deep)]"
                  : ""
              }`}
            >
              Compilations
            </a>
          )}
          {authEmail && (
            <a
              href="/drafts"
              className={`hover:text-[color:var(--accent)] ${
                isActive("/drafts")
                  ? "font-semibold text-[color:var(--deep)]"
                  : ""
              }`}
            >
              Drafts
            </a>
          )}
          <a
            href="/explorer"
            className={`hover:text-[color:var(--accent)] ${
              isActive("/explorer")
                ? "font-semibold text-[color:var(--deep)]"
                : ""
            }`}
          >
            Explorer
          </a>
          {canAdmin && (
            <>
              <a
                href="/admin"
                className={`hover:text-[color:var(--accent)] ${
                  isActive("/admin") ? "font-semibold text-[color:var(--deep)]" : ""
                }`}
              >
                Users
              </a>
              <a
                href="/admin/schemas"
                className={`hover:text-[color:var(--accent)] ${
                  isActive("/admin/schemas")
                    ? "font-semibold text-[color:var(--deep)]"
                    : ""
                }`}
              >
                Schemas
              </a>
              <a
                href="/admin/metadata/properties"
                className={`hover:text-[color:var(--accent)] ${
                  isActive("/admin/metadata/properties")
                    ? "font-semibold text-[color:var(--deep)]"
                    : ""
                }`}
              >
                Properties
              </a>
              <a
                href="/admin/metadata/categories"
                className={`hover:text-[color:var(--accent)] ${
                  isActive("/admin/metadata/categories")
                    ? "font-semibold text-[color:var(--deep)]"
                    : ""
                }`}
              >
                Categories
              </a>
            </>
          )}
        </div>

        {/* Desktop auth - hidden on mobile */}
        <div className="hidden sm:flex items-center gap-2">
          {authEmail ? (
            <button
              onClick={handleSignOut}
              className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              title={authEmail || ""}
            >
              Sign out
            </button>
          ) : (
            <a
              href="/signin"
              className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              Sign in
            </a>
          )}
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="sm:hidden border-t border-black/10 bg-white/95">
          <div className="flex flex-col gap-2 px-4 py-3">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className={`rounded-lg px-3 py-2 text-sm hover:bg-black/5 ${
                isActive("/")
                  ? "font-semibold text-[color:var(--deep)]"
                  : "text-zinc-600 hover:text-[color:var(--accent)]"
              }`}
            >
              Home
            </Link>
            <a
              href="/scriptures"
              onClick={() => setMobileMenuOpen(false)}
              className={`rounded-lg px-3 py-2 text-sm hover:bg-black/5 ${
                isActive("/scriptures")
                  ? "font-semibold text-[color:var(--deep)]"
                  : "text-zinc-600 hover:text-[color:var(--accent)]"
              }`}
            >
              Scriptures
            </a>
            {authEmail && (
              <a
                href="/compilations"
                onClick={() => setMobileMenuOpen(false)}
                className={`rounded-lg px-3 py-2 text-sm hover:bg-black/5 ${
                  isActive("/compilations")
                    ? "font-semibold text-[color:var(--deep)]"
                    : "text-zinc-600 hover:text-[color:var(--accent)]"
                }`}
              >
                Compilations
              </a>
            )}
            {authEmail && (
              <a
                href="/drafts"
                onClick={() => setMobileMenuOpen(false)}
                className={`rounded-lg px-3 py-2 text-sm hover:bg-black/5 ${
                  isActive("/drafts")
                    ? "font-semibold text-[color:var(--deep)]"
                    : "text-zinc-600 hover:text-[color:var(--accent)]"
                }`}
              >
                Drafts
              </a>
            )}
            <a
              href="/explorer"
              onClick={() => setMobileMenuOpen(false)}
              className={`rounded-lg px-3 py-2 text-sm hover:bg-black/5 ${
                isActive("/explorer")
                  ? "font-semibold text-[color:var(--deep)]"
                  : "text-zinc-600 hover:text-[color:var(--accent)]"
              }`}
            >
              Explorer
            </a>
            {canAdmin && (
              <>
                <a
                  href="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`rounded-lg px-3 py-2 text-sm hover:bg-black/5 ${
                    isActive("/admin")
                      ? "font-semibold text-[color:var(--deep)]"
                      : "text-zinc-600 hover:text-[color:var(--accent)]"
                  }`}
                >
                  Users
                </a>
                <a
                  href="/admin/schemas"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`rounded-lg px-3 py-2 text-sm hover:bg-black/5 ${
                    isActive("/admin/schemas")
                      ? "font-semibold text-[color:var(--deep)]"
                      : "text-zinc-600 hover:text-[color:var(--accent)]"
                  }`}
                >
                  Schemas
                </a>
                <a
                  href="/admin/metadata/properties"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`rounded-lg px-3 py-2 text-sm hover:bg-black/5 ${
                    isActive("/admin/metadata/properties")
                      ? "font-semibold text-[color:var(--deep)]"
                      : "text-zinc-600 hover:text-[color:var(--accent)]"
                  }`}
                >
                  Properties
                </a>
                <a
                  href="/admin/metadata/categories"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`rounded-lg px-3 py-2 text-sm hover:bg-black/5 ${
                    isActive("/admin/metadata/categories")
                      ? "font-semibold text-[color:var(--deep)]"
                      : "text-zinc-600 hover:text-[color:var(--accent)]"
                  }`}
                >
                  Categories
                </a>
              </>
            )}
            <div className="border-t border-black/10 pt-2 mt-2">
              {authEmail ? (
                <>
                  <span className="block rounded-lg px-3 py-2 text-xs text-zinc-500">
                    {authEmail}
                  </span>
                  <button
                    onClick={() => {
                      handleSignOut();
                      setMobileMenuOpen(false);
                    }}
                    className="w-full text-left rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-black/5"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <a
                  href="/signin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-black/5"
                >
                  Sign in
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
