"use client";

import { useEffect, useMemo, useState } from "react";
import LibraryControls, {
  type RoleContext,
} from "@/components/scriptle/LibraryControls";
import BookGrid from "@/components/scriptle/BookGrid";
import { MutedNote } from "@/components/scriptle/typography";
import type { ScriptleCategory } from "@/lib/scriptle/categories";
import {
  toLibraryBook,
  type LibraryBookView,
  type RawBook,
} from "@/lib/scriptle/bookAdapter";
import { getMe } from "@/lib/authClient";

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
  const [books, setBooks] = useState<LibraryBookView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<ScriptleCategory | null>(
    null
  );
  const [role, setRole] = useState<RoleContext>("guest");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/books", { credentials: "include" }),
      getMe().catch(() => null),
    ])
      .then(async ([booksRes, me]) => {
        if (cancelled) return;
        if (!booksRes.ok) throw new Error("Could not load library");
        const data = (await booksRes.json()) as RawBook[];
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
      if (!trimmed) return true;
      return (
        book.titleEnglish.toLowerCase().includes(trimmed) ||
        (book.titleSanskrit?.toLowerCase().includes(trimmed) ?? false) ||
        (book.bookCode?.toLowerCase().includes(trimmed) ?? false)
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
          <MutedNote>Loading the library…</MutedNote>
        ) : error ? (
          <MutedNote>{error}</MutedNote>
        ) : visibleBooks.length === 0 ? (
          <MutedNote>No matching scriptures.</MutedNote>
        ) : (
          <BookGrid books={visibleBooks} activeCategory={activeCategory} />
        )}
      </div>
    </div>
  );
}
