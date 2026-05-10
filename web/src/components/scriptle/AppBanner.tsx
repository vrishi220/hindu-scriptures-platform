"use client";

import Link from "next/link";

type AppBannerProps = {
  active: "search" | "library";
  showAddScripture?: boolean;
};

/**
 * Global Scriptle banner — same on every redesigned page (Search, Library,
 * Viewer). Sticky to the top of `<main>`. The Viewer page treats Library as
 * its parent route so passes `active="library"`.
 */
export default function AppBanner({
  active,
  showAddScripture = false,
}: AppBannerProps) {
  return (
    <header className="lb-nav app-banner">
      <Link
        href="/"
        className="lb-logo"
        aria-label="Scriptle home"
        data-link-page="search"
      >
        <span className="lb-om" aria-hidden="true">
          ॐ
        </span>{" "}
        Scriptle
      </Link>
      <nav className="lb-nav-links" aria-label="Primary">
        <Link
          href="/"
          className="lb-nav-link"
          {...(active === "search" ? { "aria-current": "page" as const } : {})}
        >
          Search
        </Link>
        <Link
          href="/library"
          className="lb-nav-link"
          {...(active === "library" ? { "aria-current": "page" as const } : {})}
        >
          Library
        </Link>
      </nav>
      {showAddScripture ? (
        <Link
          href="/scriptures?action=create"
          className="lb-add"
          aria-label="Add scripture"
        >
          <svg
            width={12}
            height={12}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add scripture
        </Link>
      ) : (
        <span aria-hidden="true" style={{ width: 1 }} />
      )}
    </header>
  );
}
