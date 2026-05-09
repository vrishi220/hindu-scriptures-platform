"use client";

import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type ScriptleCategory,
} from "@/lib/scriptle/categories";

export type RoleContext = "guest" | "viewer" | "contributor" | "editor" | "admin";

type LibraryControlsProps = {
  query: string;
  onQueryChange: (value: string) => void;
  activeCategory: ScriptleCategory | null;
  onCategoryChange: (next: ScriptleCategory | null) => void;
  bookCount: number;
  role: RoleContext;
  onAddScripture?: () => void;
};

const ROLE_LABEL: Record<RoleContext, string> = {
  guest: "Read only",
  viewer: "Read only",
  contributor: "Contributor",
  editor: "Contributor",
  admin: "Admin",
};

const ROLE_SUBTEXT: Record<RoleContext, string> = {
  guest: "Browse the public library.",
  viewer: "Browse the public library.",
  contributor: "Browse the library and contribute to drafts.",
  editor: "Browse and edit the library.",
  admin: "Browse, edit, and add scriptures.",
};

export default function LibraryControls({
  query,
  onQueryChange,
  activeCategory,
  onCategoryChange,
  bookCount,
  role,
  onAddScripture,
}: LibraryControlsProps) {
  const showAdd = role === "admin";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1
          style={{
            fontFamily: "var(--font-scriptle-serif)",
            fontSize: "32px",
            color: "var(--color-text)",
            letterSpacing: "-0.01em",
          }}
        >
          The Library
        </h1>
        <p
          style={{
            fontFamily: "var(--font-scriptle-sans)",
            color: "var(--color-text-muted)",
            fontSize: "13px",
          }}
        >
          {ROLE_SUBTEXT[role]}
        </p>
      </header>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search books"
          aria-label="Search the library"
          className="h-10 w-full rounded-[8px] border bg-white px-3 outline-none transition focus:ring-2 md:max-w-md"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
            fontFamily: "var(--font-scriptle-sans)",
            fontSize: "14px",
          }}
        />

        {showAdd && onAddScripture ? (
          <button
            type="button"
            onClick={onAddScripture}
            className="self-start rounded-[8px] px-4 py-2 text-white transition hover:opacity-90 md:self-auto"
            style={{
              background: "var(--color-accent)",
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "12px",
              fontWeight: 500,
              letterSpacing: "0.04em",
            }}
          >
            Add scripture
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <CategoryChip
          label="All"
          active={activeCategory === null}
          onClick={() => onCategoryChange(null)}
        />
        {CATEGORY_ORDER.map((category) => (
          <CategoryChip
            key={category}
            label={CATEGORY_LABEL[category]}
            active={activeCategory === category}
            onClick={() => onCategoryChange(category)}
          />
        ))}
      </div>

      <div
        className="flex items-center justify-between border-t pt-3"
        style={{
          borderColor: "var(--color-border-soft)",
          fontFamily: "var(--font-scriptle-sans)",
          fontSize: "11px",
          letterSpacing: "0.06em",
          color: "var(--color-text-faint)",
          textTransform: "uppercase",
        }}
      >
        <span>
          {bookCount} scripture{bookCount === 1 ? "" : "s"}
        </span>
        <span>{ROLE_LABEL[role]}</span>
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full px-3 py-1.5 transition"
      style={{
        background: active ? "var(--color-accent)" : "var(--color-surface)",
        color: active ? "#fff" : "var(--color-text-muted)",
        fontFamily: "var(--font-scriptle-sans)",
        fontSize: "12px",
        fontWeight: 500,
        border: active
          ? "1px solid var(--color-accent)"
          : "1px solid var(--color-border)",
      }}
    >
      {label}
    </button>
  );
}
