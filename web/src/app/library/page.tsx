"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getMe } from "@/lib/authClient";
import {
  CATEGORY_ORDER,
  categoryForBook,
  type ScriptleCategory,
} from "@/lib/scriptle/categories";
import { coverGradientForBook } from "@/lib/scriptle/covers";
import {
  ALL_LANGUAGE_CODES,
  type ScriptleLanguageCode,
} from "@/lib/scriptle/languages";
import {
  toLibraryBook,
  type LibraryBookView,
} from "@/lib/scriptle/bookAdapter";
import { getBooks } from "@/lib/booksClient";

type RoleContext = "guest" | "viewer" | "contributor" | "researcher" | "editor" | "admin";

type CategoryFilter = ScriptleCategory | "all";

const CATEGORY_DEFS: { key: CategoryFilter; label: string; desc?: string }[] = [
  { key: "all", label: "All" },
  { key: "gita", label: "Gitas", desc: "Philosophical dialogues" },
  { key: "veda", label: "Vedas & Suktams", desc: "Vedic hymns" },
  { key: "purana", label: "Puranas & Itihasas", desc: "Epic narratives" },
  { key: "stotra", label: "Stotras & Sahasranamas", desc: "Devotional hymns" },
  {
    key: "upanishad",
    label: "Upanishads & Sutras",
    desc: "Philosophical treatises",
  },
];

const LANG_CLASS: Record<ScriptleLanguageCode, string> = {
  en: "l-en",
  te: "l-te",
  hi: "l-hi",
  ta: "l-ta",
  sa: "l-en",
};

function deriveRole(me: Awaited<ReturnType<typeof getMe>>): RoleContext {
  if (!me) return "guest";
  if (me.role === "admin" || me.permissions?.can_admin) return "admin";
  if (me.role === "editor" || me.permissions?.can_edit) return "editor";
  if (me.role === "contributor" || me.permissions?.can_contribute) {
    return "contributor";
  }
  if (me.role === "researcher") return "researcher";
  return "viewer";
}

function roleLabel(role: RoleContext): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "editor":
    case "contributor":
      return "Contributor";
    case "researcher":
      return "Researcher";
    default:
      return "Read only";
  }
}

function subText(role: RoleContext, total: number): string {
  if (role === "admin") return "All scriptures · full access";
  if (role === "contributor" || role === "editor") {
    return `${total} public scriptures · contributor access`;
  }
  if (role === "researcher") {
    return `${total} public scriptures · researcher access`;
  }
  return `${total} public scriptures`;
}

export default function LibraryPage() {
  const [books, setBooks] = useState<LibraryBookView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [role, setRole] = useState<RoleContext>("guest");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getBooks(), getMe().catch(() => null)])
      .then(([data, me]) => {
        if (cancelled) return;
        setBooks(data.map(toLibraryBook));
        setRole(deriveRole(me));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load library");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleBooks = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return books.filter((book) => {
      if (book.isPrivate && role !== "admin") return false;
      if (
        activeCategory !== "all" &&
        categoryForBook(book.bookCode) !== activeCategory
      ) {
        return false;
      }
      if (!trimmed) return true;
      return (
        book.titleEnglish.toLowerCase().includes(trimmed) ||
        (book.titleSanskrit?.toLowerCase().includes(trimmed) ?? false) ||
        (book.bookCode?.toLowerCase().includes(trimmed) ?? false)
      );
    });
  }, [books, query, activeCategory, role]);

  const showAddBtn = role === "admin";
  const totalPublic = books.filter((b) => !b.isPrivate).length;

  return (
    <div data-scriptle="true">
      <nav className="lb-nav">
        <Link href="/" className="lb-logo">
          <span className="lb-om">ॐ</span> Scriptle
        </Link>
        <div className="lb-nav-links">
          <Link href="/" className="lb-nav-link">
            Search
          </Link>
          <Link href="/library" className="lb-nav-link active">
            Library
          </Link>
        </div>
        {showAddBtn ? (
          <Link href="/scriptures?action=create" className="lb-add">
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add scripture
          </Link>
        ) : (
          <span style={{ width: 1 }} />
        )}
      </nav>

      <div className="lb-header">
        <div>
          <div className="lb-title">The Library</div>
          <div className="lb-sub">{subText(role, totalPublic)}</div>
        </div>
      </div>

      <div className="lb-controls">
        <div className="lb-search">
          <svg
            width={13}
            height={13}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter…"
            aria-label="Filter the library"
          />
        </div>
        <div className="lb-chips">
          {CATEGORY_DEFS.map((cat) => (
            <button
              key={cat.key}
              type="button"
              className={`lb-chip${activeCategory === cat.key ? " active" : ""}`}
              onClick={() => setActiveCategory(cat.key)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "13px",
          }}
        >
          Loading…
        </div>
      ) : error ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "13px",
          }}
        >
          {error}
        </div>
      ) : visibleBooks.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "13px",
          }}
        >
          No scriptures found
        </div>
      ) : activeCategory !== "all" ? (
        <div className="lb-section">
          <div className="lb-shelf">
            {visibleBooks.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        </div>
      ) : (
        CATEGORY_ORDER.map((category) => {
          const list = visibleBooks.filter(
            (b) => categoryForBook(b.bookCode) === category
          );
          if (list.length === 0) return null;
          const def = CATEGORY_DEFS.find((c) => c.key === category)!;
          return (
            <div className="lb-section" key={category}>
              <div className="lb-cat-label">
                <span>{def.label}</span>
                {def.desc ? (
                  <span
                    style={{
                      fontWeight: 400,
                      textTransform: "none",
                      letterSpacing: 0,
                      fontSize: "10px",
                      opacity: 0.7,
                    }}
                  >
                    {def.desc}
                  </span>
                ) : null}
                <div className="lb-cat-line" />
                <span>{list.length}</span>
              </div>
              <div className="lb-shelf">
                {list.map((book) => (
                  <BookCard key={book.id} book={book} />
                ))}
              </div>
            </div>
          );
        })
      )}

      <div className="lb-footer">
        <span>
          {visibleBooks.length} scripture{visibleBooks.length === 1 ? "" : "s"}
        </span>
        <span>{roleLabel(role)}</span>
      </div>
    </div>
  );
}

function BookCard({ book }: { book: LibraryBookView }) {
  const href = book.bookCode
    ? `/read/${encodeURIComponent(book.bookCode)}`
    : `/scriptures?book=${book.id}`;
  const langs = book.languages.filter(
    (c): c is ScriptleLanguageCode =>
      ALL_LANGUAGE_CODES.includes(c) && c !== "sa"
  );
  const coverStyle = book.coverImageUrl
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.55)), url("${book.coverImageUrl}")`,
        backgroundSize: "cover" as const,
        backgroundPosition: "center" as const,
      }
    : { background: coverGradientForBook(book.bookCode) };
  return (
    <Link href={href} className="lb-book" aria-label={book.titleEnglish}>
      <div className="lb-cover" style={coverStyle}>
        <div className="lb-cover-spine" />
        <div className="lb-cover-content">
          {book.titleSanskrit ? (
            <div className="lb-cover-sk">{book.titleSanskrit}</div>
          ) : (
            <div />
          )}
          <div>
            <div className="lb-cover-title">{book.titleEnglish}</div>
            {typeof book.verseCount === "number" && book.verseCount > 0 ? (
              <div className="lb-cover-verses">
                {book.verseCount.toLocaleString()} verses
              </div>
            ) : null}
          </div>
        </div>
        {book.isAiGenerated ? <span className="lb-cover-badge">AI</span> : null}
        {book.isPrivate ? <span className="lb-cover-lock">🔒</span> : null}
        {langs.length > 0 ? (
          <div className="lb-cover-langs">
            {langs.map((code) => (
              <span key={code} className={`lb-lang-dot ${LANG_CLASS[code]}`} />
            ))}
          </div>
        ) : null}
      </div>
      <div className="lb-book-name">{book.titleEnglish}</div>
      {typeof book.verseCount === "number" && book.verseCount > 0 ? (
        <div className="lb-book-info">
          {book.verseCount.toLocaleString()} verses
        </div>
      ) : null}
    </Link>
  );
}
