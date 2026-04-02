"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { getMe, invalidateMeCache } from "@/lib/authClient";
import {
  UserPreferencesForm,
  serializeUserPreferencesForComparison,
  type UserPreferences,
} from "@/components/UserPreferencesDialog";
import {
  applyUiPreferencesToDocument,
  normalizeUiDensity,
  normalizeUiTheme,
  persistUiPreferences,
  readStoredUiPreferences,
} from "@/lib/uiPreferences";

const DEFAULT_PREFERENCES: UserPreferences = {
  source_language: "english",
  transliteration_enabled: true,
  transliteration_script: "iast",
  show_roman_transliteration: true,
  show_media: true,
  show_commentary: true,
  show_only_preferred_script: false,
  preview_show_titles: false,
  preview_show_labels: false,
  preview_show_level_numbers: false,
  preview_show_details: false,
  preview_show_media: true,
  preview_show_sanskrit: true,
  preview_show_transliteration: true,
  preview_show_english: true,
  preview_show_commentary: true,
  preview_transliteration_script: "iast",
  preview_word_meanings_display_mode: "inline",
  preview_translation_languages: "english",
  preview_hidden_levels: "",
  ui_theme: "classic",
  ui_density: "comfortable",
};

type AuthUser = {
  email: string | null;
  username: string | null;
  fullName: string | null;
};

export default function NavBar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [canAdmin, setCanAdmin] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState<string | null>(null);
  const [preferencesSavedSnapshot, setPreferencesSavedSnapshot] = useState<string | null>(null);
  const [profileTab, setProfileTab] = useState<"general" | "preferences">("general");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState({
    fullName: "",
    username: "",
    email: "",
  });
  const pathname = usePathname();
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const loadPreferences = useCallback(async () => {
    if (preferencesLoading || preferences) return;
    setPreferencesLoading(true);
    try {
      const storedUi = readStoredUiPreferences();
      const response = await fetch("/api/preferences", { credentials: "include" });
      if (response.ok) {
        const data = (await response.json()) as UserPreferences;
        setPreferences({
          ...DEFAULT_PREFERENCES,
          ...data,
          ui_theme: normalizeUiTheme(storedUi?.ui_theme ?? data.ui_theme),
          ui_density: normalizeUiDensity(storedUi?.ui_density ?? data.ui_density),
        });
        const normalizedLoaded = {
          ...DEFAULT_PREFERENCES,
          ...data,
          ui_theme: normalizeUiTheme(storedUi?.ui_theme ?? data.ui_theme),
          ui_density: normalizeUiDensity(storedUi?.ui_density ?? data.ui_density),
        };
        setPreferencesSavedSnapshot(
          serializeUserPreferencesForComparison(normalizedLoaded)
        );
      } else {
        const fallbackPrefs = { ...DEFAULT_PREFERENCES, ...(storedUi || {}) };
        setPreferences(fallbackPrefs);
        setPreferencesSavedSnapshot(
          serializeUserPreferencesForComparison(fallbackPrefs)
        );
      }
    } catch {
      const storedUi = readStoredUiPreferences();
      const fallbackPrefs = { ...DEFAULT_PREFERENCES, ...(storedUi || {}) };
      setPreferences(fallbackPrefs);
      setPreferencesSavedSnapshot(
        serializeUserPreferencesForComparison(fallbackPrefs)
      );
    } finally {
      setPreferencesLoading(false);
    }
  }, [preferencesLoading, preferences]);

  useEffect(() => {
    const storedUi = readStoredUiPreferences();
    applyUiPreferencesToDocument(storedUi);
  }, []);

  useEffect(() => {
    const loadAuth = async (force = false) => {
      const data = await getMe({ force });
      if (!data) {
        setAuthUser(null);
        setCanAdmin(false);
        setPreferences(null);
        setPreferencesSavedSnapshot(null);
        applyUiPreferencesToDocument(readStoredUiPreferences());
        return;
      }
      setAuthUser({
        email: data.email || null,
        username: data.username || null,
        fullName: data.full_name || null,
      });
      setProfileDraft({
        fullName: data.full_name || "",
        username: data.username || "",
        email: data.email || "",
      });
      setCanAdmin(Boolean(data.permissions?.can_admin || data.role === "admin"));
      void loadPreferences();
    };
    void loadAuth();

    // Re-check auth when window regains focus
    const handleFocus = () => {
      void loadAuth(true);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [pathname, loadPreferences]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    if (profileOpen && profileTab === "preferences") {
      void loadPreferences();
    }
  }, [profileOpen, profileTab, loadPreferences]);

  useEffect(() => {
    if (!profileOpen) return;

    const { body, documentElement } = document;
    const scrollY = window.scrollY;
    const previousOverflow = body.style.overflow;
    const previousPosition = body.style.position;
    const previousTop = body.style.top;
    const previousWidth = body.style.width;
    const previousOverscroll = body.style.overscrollBehavior;
    const previousHtmlOverscroll = documentElement.style.overscrollBehavior;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overscrollBehavior = "none";
    documentElement.style.overscrollBehavior = "none";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.position = previousPosition;
      body.style.top = previousTop;
      body.style.width = previousWidth;
      body.style.overscrollBehavior = previousOverscroll;
      documentElement.style.overscrollBehavior = previousHtmlOverscroll;
      body.style.paddingRight = "";
      window.scrollTo(0, scrollY);
    };
  }, [profileOpen]);

  useEffect(() => {
    applyUiPreferencesToDocument(preferences);
  }, [preferences]);

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
    setAuthUser(null);
    setPreferences(null);
    setCanAdmin(false);
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
    setProfileOpen(false);
    window.location.href = "/";
  };

  const handleSaveProfile = async () => {
    setProfileMessage(null);
    setProfileSaving(true);
    try {
      const payload = {
        full_name: profileDraft.fullName.trim() || null,
        username: profileDraft.username.trim() || null,
      };
      const response = await fetch("/api/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setProfileMessage(data?.detail || "Failed to save profile");
        return;
      }

      setAuthUser({
        email: data?.email || null,
        username: data?.username || null,
        fullName: data?.full_name || null,
      });
      setProfileDraft({
        fullName: data?.full_name || "",
        username: data?.username || "",
        email: data?.email || "",
      });
      invalidateMeCache();
      setProfileMessage("Profile saved");
    } catch {
      setProfileMessage("Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSavePreferences = async () => {
    if (!preferences) return;
    const currentSnapshot = serializeUserPreferencesForComparison(preferences);
    if (preferencesSavedSnapshot !== null && currentSnapshot === preferencesSavedSnapshot) {
      return;
    }
    setPreferencesMessage(null);
    setPreferencesSaving(true);
    try {
      persistUiPreferences(preferences);
      const response = await fetch("/api/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      const data = (await response.json().catch(() => null)) as UserPreferences | null;
      if (!response.ok) {
        setPreferencesMessage("Failed to save preferences");
        return;
      }
      setPreferences({
        ...DEFAULT_PREFERENCES,
        ...(data || {}),
        ui_theme: normalizeUiTheme(preferences.ui_theme),
        ui_density: normalizeUiDensity(preferences.ui_density),
      });
      const persistedPreferences = {
        ...DEFAULT_PREFERENCES,
        ...(data || {}),
        ui_theme: normalizeUiTheme(preferences.ui_theme),
        ui_density: normalizeUiDensity(preferences.ui_density),
      };
      setPreferencesSavedSnapshot(
        serializeUserPreferencesForComparison(persistedPreferences)
      );
      setPreferencesMessage("Preferences saved");
      setProfileOpen(false);
    } catch {
      setPreferencesMessage("Failed to save preferences");
    } finally {
      setPreferencesSaving(false);
    }
  };

  const preferencesDirty =
    preferences !== null &&
    preferencesSavedSnapshot !== null &&
    serializeUserPreferencesForComparison(preferences) !== preferencesSavedSnapshot;

  const initials = (authUser?.fullName || authUser?.email || "U").trim().charAt(0).toUpperCase();
  const isActive = (href: string) => pathname === href;
  const isAdminActive = pathname?.startsWith("/admin");

  return (
    <nav className="border-b border-black/10 bg-white/80 sticky top-0 z-40">
      <div className="mx-auto flex w-full items-center justify-between px-4 sm:px-6 py-2 sm:py-2.5">
        {/* Left section: Mobile menu button + Logo */}
        <div className="flex items-center gap-2 sm:gap-6">
          {/* Mobile menu button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="sm:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white/90 text-xl font-bold text-zinc-700 hover:bg-black/5 hover:text-[color:var(--accent)] transition"
            title="Menu"
          >
            ☰
          </button>

          {/* Logo - always visible */}
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo-mark.svg"
              alt="Hindu Scriptures"
              width={32}
              height={32}
              className="h-6.5 sm:h-7 w-6.5 sm:w-7"
            />
            <span className="inline text-xs sm:text-sm font-semibold text-[color:var(--deep)]">
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
          {authUser && (
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
          {authUser && (
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
          {authUser && (
            <a
              href="/templates"
              className={`hover:text-[color:var(--accent)] ${
                isActive("/templates")
                  ? "font-semibold text-[color:var(--deep)]"
                  : ""
              }`}
            >
              Templates
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
            <a
              href="/admin"
              className={`hover:text-[color:var(--accent)] ${
                isAdminActive ? "font-semibold text-[color:var(--deep)]" : ""
              }`}
            >
              Admin
            </a>
          )}
        </div>

        {/* Unified auth control (desktop + mobile) */}
        <div className="flex items-center gap-2" ref={userMenuRef}>
          {authUser ? (
            <>
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/90 text-sm font-semibold text-zinc-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                title={authUser.email || "Profile"}
                aria-label="User menu"
              >
                {initials}
              </button>
              {userMenuOpen && (
                <div className="absolute right-4 sm:right-6 top-[58px] sm:top-[66px] z-50 min-w-[180px] rounded-xl border border-black/10 bg-white p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setProfileOpen(true);
                      setProfileTab("general");
                      setProfileMessage(null);
                      setPreferencesMessage(null);
                      setProfileDraft({
                        fullName: authUser.fullName || "",
                        username: authUser.username || "",
                        email: authUser.email || "",
                      });
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-black/5"
                  >
                    Profile
                  </button>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-black/5"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </>
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
            {authUser && (
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
            {authUser && (
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
            {authUser && (
              <a
                href="/templates"
                onClick={() => setMobileMenuOpen(false)}
                className={`rounded-lg px-3 py-2 text-sm hover:bg-black/5 ${
                  isActive("/templates")
                    ? "font-semibold text-[color:var(--deep)]"
                    : "text-zinc-600 hover:text-[color:var(--accent)]"
                }`}
              >
                Templates
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
              <a
                href="/admin"
                onClick={() => setMobileMenuOpen(false)}
                className={`rounded-lg px-3 py-2 text-sm hover:bg-black/5 ${
                  isAdminActive
                    ? "font-semibold text-[color:var(--deep)]"
                    : "text-zinc-600 hover:text-[color:var(--accent)]"
                }`}
              >
                Admin
              </a>
            )}
          </div>
        </div>
      )}

      {profileOpen && authUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-black/10 bg-white p-5 shadow-xl">
            <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
              <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-black/10 bg-white text-base font-semibold text-zinc-700">
                {initials}
              </div>
              <div>
                <h2 className="text-base font-semibold text-zinc-900">Profile</h2>
                <p className="text-xs text-zinc-500">Image support can be plugged into this avatar slot.</p>
              </div>
              </div>
              <button
                type="button"
                onClick={() => setProfileOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/90 text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900"
                aria-label="Close profile"
              >
                ×
              </button>
            </div>

            <div className="mb-4 flex shrink-0 rounded-lg border border-black/10 bg-zinc-50 p-1">
              <button
                type="button"
                onClick={() => setProfileTab("general")}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                  profileTab === "general"
                    ? "bg-white text-[color:var(--deep)] shadow-sm"
                    : "text-zinc-600 hover:text-zinc-800"
                }`}
              >
                General
              </button>
              <button
                type="button"
                onClick={() => setProfileTab("preferences")}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                  profileTab === "preferences"
                    ? "bg-white text-[color:var(--deep)] shadow-sm"
                    : "text-zinc-600 hover:text-zinc-800"
                }`}
              >
                Preferences
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              {profileTab === "general" ? (
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-xs text-zinc-500">Name</span>
                    <input
                      type="text"
                      value={profileDraft.fullName}
                      onChange={(event) =>
                        setProfileDraft((prev) => ({ ...prev, fullName: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-[color:var(--accent)]"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-zinc-500">Username</span>
                    <input
                      type="text"
                      value={profileDraft.username}
                      onChange={(event) =>
                        setProfileDraft((prev) => ({ ...prev, username: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-[color:var(--accent)]"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-zinc-500">Email</span>
                    <input
                      type="email"
                      value={profileDraft.email}
                      readOnly
                      className="mt-1 w-full rounded-lg border border-black/10 bg-zinc-100 px-3 py-2 text-sm text-zinc-700"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveProfile}
                      disabled={profileSaving}
                      className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-2 text-xs font-medium uppercase tracking-[0.2em] text-white transition disabled:opacity-50"
                    >
                      {profileSaving ? "Saving..." : "Save"}
                    </button>
                    {profileMessage && (
                      <span className="text-xs text-zinc-600">{profileMessage}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  {preferencesLoading && (
                    <div className="text-xs text-zinc-600">Loading preferences…</div>
                  )}
                  {preferences && (
                    <>
                      <UserPreferencesForm
                        preferences={preferences}
                        onChange={(next) => setPreferences(next)}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSavePreferences}
                          disabled={preferencesSaving || !preferencesDirty}
                          className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-2 text-xs font-medium uppercase tracking-[0.2em] text-white transition disabled:opacity-50"
                        >
                          {preferencesSaving ? "Saving..." : "Save"}
                        </button>
                        {preferencesMessage && (
                          <span className="text-xs text-zinc-600">{preferencesMessage}</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
