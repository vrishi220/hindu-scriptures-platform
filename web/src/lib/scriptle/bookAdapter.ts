// Single source of truth for adapting raw `/api/books` rows into the shapes
// the redesign pages render. Both /library and /read/[bookCode] previously
// shipped near-identical copies of these helpers.

import {
  ALL_LANGUAGE_CODES,
  type ScriptleLanguageCode,
} from "./languages";

export type RawBook = {
  id: number;
  book_name: string;
  book_code?: string | null;
  language_primary?: string | null;
  visibility?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  metadata_json?: Record<string, unknown> | null;
};

export type LibraryBookView = {
  id: number;
  bookCode: string | null;
  titleEnglish: string;
  titleSanskrit: string | null;
  verseCount: number | null;
  languages: ScriptleLanguageCode[];
  coverImageUrl: string | null;
  isAiGenerated: boolean;
  isPrivate: boolean;
};

export type ResolvedBook = LibraryBookView & {
  primaryLanguage: ScriptleLanguageCode;
};

function readMetadata(book: RawBook, key: string): unknown {
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

export function asLanguageCode(
  value: string | null | undefined
): ScriptleLanguageCode {
  if (!value) return "sa";
  const lower = value.toLowerCase().slice(0, 2);
  return ALL_LANGUAGE_CODES.includes(lower as ScriptleLanguageCode)
    ? (lower as ScriptleLanguageCode)
    : "sa";
}

export function toLibraryBook(raw: RawBook): LibraryBookView {
  return {
    id: raw.id,
    bookCode: raw.book_code ?? null,
    titleEnglish:
      asString(readMetadata(raw, "title_english")) ??
      raw.book_name ??
      "Untitled",
    titleSanskrit: asString(readMetadata(raw, "title_sanskrit")),
    verseCount: asNumber(readMetadata(raw, "verse_count")),
    languages:
      asLanguageList(readMetadata(raw, "languages_available")) ?? ["sa", "en"],
    coverImageUrl:
      asString(readMetadata(raw, "cover_image_url")) ??
      asString(readMetadata(raw, "thumbnail_url")),
    isAiGenerated: Boolean(readMetadata(raw, "ai_generated")),
    isPrivate: raw.visibility !== "public",
  };
}

export function resolveBook(raw: RawBook): ResolvedBook {
  return {
    ...toLibraryBook(raw),
    primaryLanguage: asLanguageCode(raw.language_primary),
  };
}
