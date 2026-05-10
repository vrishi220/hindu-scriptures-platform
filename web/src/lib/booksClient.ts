// Session-scoped cache for the books list. Mirrors the shape of authClient.ts
// so both Library (full list) and /read/[bookCode] (lookup by code) hit a
// single fetch per ~30s window with in-flight de-duplication.
//
// All callers that previously did `fetch("/api/books")` should switch here.
// Mutations (book create / delete / metadata edit) should call invalidate().

import type { RawBook } from "./scriptle/bookAdapter";

const CACHE_TTL_MS = 30_000;

let cached: RawBook[] | undefined;
let cachedAt = 0;
let inFlight: Promise<RawBook[]> | null = null;

export function invalidateBooksCache(): void {
  cached = undefined;
  cachedAt = 0;
}

export async function getBooks(): Promise<RawBook[]> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch("/api/books", { credentials: "include" });
      if (!res.ok) throw new Error(`Books fetch failed (${res.status})`);
      const data = (await res.json()) as RawBook[];
      cached = data;
      cachedAt = Date.now();
      return data;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function getBookByCode(
  bookCode: string
): Promise<RawBook | null> {
  if (!bookCode) return null;
  const books = await getBooks();
  return books.find((b) => b.book_code === bookCode) ?? null;
}
