"use client";

import { useEffect, useMemo, useState } from "react";
import LibraryControls, {
  type RoleContext,
} from "@/components/scriptle/LibraryControls";
import BookGrid, { type LibraryBook } from "@/components/scriptle/BookGrid";
import type { ScriptleCategory } from "@/lib/scriptle/categories";
import {
  ALL_LANGUAGE_CODES,
  type ScriptleLanguageCode,
} from "@/lib/scriptle/languages";
import { getMe } from "@/lib/authClient";

type RawBook = {
  id: number;
  book_name: string;
  book_code?: string | null;
  language_primary?: string | null;
  visibility?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  metadata_json?: Record<string, unknown> | null;
};

function readMetadataValue(book: RawBook, key: string): unknown {
  if (book.metadata && typeof book.metadata === "object" && key in book.metadata) {
    return book.metadata[key];
  }
  if (
    book.metadata_json &&
    typeof book.metadata_json === "object" &&
    key in book.metadata_json
  ) {
    return book.metadata_json[key];
  }
  return undefined;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

function asLanguageList(value: unknown): ScriptleLanguageCode[] | null {
  if (!Array.isArray(value)) return null;
  const filtered = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.toLowerCase().slice(0, 2))
    .filter((code): code is ScriptleLanguageCode =>
      ALL_LANGUAGE_CODES.includes(code as ScriptleLanguageCode)
    );
  return filtered.length > 0 ? Array.from(new Set(filtered)) : null;
}

function toLibraryBook(raw: RawBook): LibraryBook {
  return {
    id: raw.id,
    bookCode: raw.book_code ?? null,
    titleEnglish:
      asString(readMetadataValue(raw, "title_english")) ??
      raw.book_name ??
      "Untitled",
    titleSanskrit: asString(readMetadataValue(raw, "title_sanskrit")),
    verseCount: asNumber(readMetadataValue(raw, "verse_count")),
    languages:
      asLanguageList(readMetadataValue(raw, "languages_available")) ??
      ["sa", "en"],
    coverImageUrl:
      asString(readMetadataValue(raw, "cover_image_url")) ??
      asString(readMetadataValue(raw, "thumbnail_url")),
    isAiGenerated: Boolean(readMetadataValue(raw, "ai_generated")),
    isPrivate: raw.visibility !== "public",
  };
}

function deriveRole(me: Awaited<ReturnType<typeof getMe>>): RoleContext {
  if (!me) return "guest";
  if (me.role === "admin" || me.permissions?.can_admin) return "admin";
  if (me.role === "editor" || me.permissions?.can_edit) return "editor";
  if (me.role === "contributor" || me.permissions?.can_contribute) {
    return "contributor";
  }
  return "viewer";
}

export default function LibraryPage() {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<ScriptleCategory | null>(
    null
  );
  const [role, setRole] = useState<RoleContext>("guest");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [booksRes, me] = await Promise.all([
          fetch("/api/books", { credentials: "include" }),
          getMe().catch(() => null),
        ]);

        if (cancelled) return;

        if (!booksRes.ok) {
          throw new Error("Could not load library");
        }
        const data = (await booksRes.json()) as RawBook[];
        setBooks(data.map(toLibraryBook));
        setRole(deriveRole(me));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load library");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleBooks = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return books
      .filter((book) => (role === "admin" ? true : !book.isPrivate))
      .filter((book) => {
        if (!trimmed) return true;
        const haystacks = [
          book.titleEnglish,
          book.titleSanskrit ?? "",
          book.bookCode ?? "",
        ];
        return haystacks.some((entry) =>
          entry.toLowerCase().includes(trimmed)
        );
      });
  }, [books, query, role]);

  return (
    <div
      data-scriptle="true"
      className="min-h-[calc(100vh-3rem)] w-full px-4 pb-16 pt-8 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <LibraryControls
          query={query}
          onQueryChange={setQuery}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          bookCount={visibleBooks.length}
          role={role}
        />

        {loading ? (
          <p
            className="text-sm"
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              color: "var(--color-text-muted)",
            }}
          >
            Loading the library…
          </p>
        ) : error ? (
          <p
            className="text-sm"
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              color: "var(--color-text-muted)",
            }}
          >
            {error}
          </p>
        ) : visibleBooks.length === 0 ? (
          <p
            className="text-sm"
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              color: "var(--color-text-muted)",
            }}
          >
            No matching scriptures.
          </p>
        ) : (
          <BookGrid books={visibleBooks} activeCategory={activeCategory} />
        )}
      </div>
    </div>
  );
}
