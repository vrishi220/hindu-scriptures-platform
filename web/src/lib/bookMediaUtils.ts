import type { BookDetails, BookOption, BookMediaItem, MediaFile } from "./scriptureTypes";
import {
  WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES,
  WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES,
} from "./wordMeanings";
import { resolveMediaUrlWithMetadataVersion } from "./mediaUrl";
import { inferMediaTypeFromUrl } from "./externalMedia";

export const resolveCanonicalLevelName = (
  levelName: string,
  levelNameOverrides: Record<string, unknown> | null | undefined,
): string => {
  const trimmed = levelName.trim();
  if (!trimmed) {
    return "";
  }

  if (!levelNameOverrides || typeof levelNameOverrides !== "object") {
    return trimmed;
  }

  const normalizedInput = trimmed.toLowerCase();
  for (const [canonicalRaw, displayRaw] of Object.entries(levelNameOverrides)) {
    if (typeof canonicalRaw !== "string") {
      continue;
    }

    const canonical = canonicalRaw.trim();
    if (!canonical) {
      continue;
    }
    if (canonical.toLowerCase() === normalizedInput) {
      return canonical;
    }

    if (typeof displayRaw !== "string") {
      continue;
    }
    const display = displayRaw.trim();
    if (!display) {
      continue;
    }
    if (display.toLowerCase() === normalizedInput) {
      return canonical;
    }
  }

  return trimmed;
};

export const getWordMeaningsEnabledLevelsFromBook = (book: BookDetails | null): Set<string> => {
  if (!book) {
    return new Set();
  }

  const metadata =
    book.metadata_json && typeof book.metadata_json === "object"
      ? book.metadata_json
      : book.metadata && typeof book.metadata === "object"
        ? book.metadata
        : null;

  const wordMeaningsConfig =
    metadata &&
    typeof metadata.word_meanings === "object" &&
    metadata.word_meanings !== null
      ? (metadata.word_meanings as Record<string, unknown>)
      : null;

  const enabledLevels = wordMeaningsConfig?.enabled_levels;
  if (!Array.isArray(enabledLevels)) {
    return new Set();
  }

  const levelNameOverrides =
    book.level_name_overrides && typeof book.level_name_overrides === "object"
      ? (book.level_name_overrides as Record<string, unknown>)
      : null;

  return new Set(
    enabledLevels
      .filter((level): level is string => typeof level === "string" && level.trim().length > 0)
      .map((level) => resolveCanonicalLevelName(level, levelNameOverrides).toLowerCase())
      .filter(Boolean)
  );
};

export const getWordMeaningsMetadataConfig = (
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null => {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const candidate = metadata.word_meanings;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  return candidate as Record<string, unknown>;
};

export const getBookMetadataObject = (book: BookDetails | BookOption | null): Record<string, unknown> | null => {
  const metadata =
    book?.metadata_json && typeof book.metadata_json === "object"
      ? book.metadata_json
      : book?.metadata && typeof book.metadata === "object"
        ? book.metadata
        : null;
  return metadata ? { ...metadata } : null;
};

export const getWordMeaningsDefaultSourceLanguageFromBook = (book: BookDetails | null): string | null => {
  const metadata = getBookMetadataObject(book);
  const config = getWordMeaningsMetadataConfig(metadata);
  const rawValue = typeof config?.default_source_language === "string"
    ? config.default_source_language.trim().toLowerCase()
    : "";
  if (
    WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES.includes(
      rawValue as (typeof WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES)[number]
    )
  ) {
    return rawValue;
  }
  return null;
};

export const getWordMeaningsDefaultMeaningLanguageFromBook = (book: BookDetails | null): string | null => {
  const metadata = getBookMetadataObject(book);
  const config = getWordMeaningsMetadataConfig(metadata);
  const rawValue = typeof config?.default_meaning_language === "string"
    ? config.default_meaning_language.trim().toLowerCase()
    : "";
  if (
    WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES.includes(
      rawValue as (typeof WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES)[number]
    )
  ) {
    return rawValue;
  }
  return null;
};

export const normalizeWordMeaningsEnabledLevels = (levels: string[]): string[] =>
  Array.from(
    new Set(
      levels
        .map((level) => level.trim())
        .filter(Boolean)
        .map((level) => level.toLowerCase())
    )
  ).sort();

export const getBookThumbnailUrl = (book: BookDetails | BookOption | null): string | null => {
  if (!book) {
    return null;
  }

  const metadata =
    book.metadata_json && typeof book.metadata_json === "object"
      ? book.metadata_json
      : book.metadata && typeof book.metadata === "object"
        ? book.metadata
        : null;

  if (!metadata) {
    return null;
  }

  const thumbnailUrlCandidates = [
    metadata.thumbnail_url,
    metadata.thumbnailUrl,
    metadata.cover_image_url,
    metadata.coverImageUrl,
  ];

  for (const candidate of thumbnailUrlCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return resolveMediaUrlWithMetadataVersion(candidate, metadata);
    }
  }

  return null;
};

export const normalizeBookMediaType = (rawType: unknown, rawUrl: string): BookMediaItem["media_type"] => {
  if (typeof rawType === "string" && rawType.trim()) {
    return rawType.trim().toLowerCase();
  }
  return inferMediaTypeFromUrl(rawUrl);
};

export const getBookMediaItems = (book: BookDetails | BookOption | null): BookMediaItem[] => {
  const metadata = getBookMetadataObject(book);
  const mediaItemsRaw = metadata?.media_items;
  const normalized: BookMediaItem[] = [];

  if (Array.isArray(mediaItemsRaw)) {
    for (const item of mediaItemsRaw) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const candidate = item as Record<string, unknown>;
      const rawUrl = typeof candidate.url === "string" ? candidate.url.trim() : "";
      if (!rawUrl) {
        continue;
      }
      const mediaType = normalizeBookMediaType(candidate.media_type, rawUrl);
      const assetIdRaw = candidate.asset_id;
      const assetId =
        typeof assetIdRaw === "number"
          ? assetIdRaw
          : typeof assetIdRaw === "string" && assetIdRaw.trim()
            ? Number.parseInt(assetIdRaw, 10)
            : undefined;
      const displayOrderRaw = candidate.display_order;
      const displayOrder =
        typeof displayOrderRaw === "number"
          ? displayOrderRaw
          : typeof displayOrderRaw === "string" && displayOrderRaw.trim()
            ? Number.parseInt(displayOrderRaw, 10)
            : undefined;

      normalized.push({
        media_type: mediaType,
        url: rawUrl,
        display_name:
          typeof candidate.display_name === "string" && candidate.display_name.trim()
            ? candidate.display_name.trim()
            : undefined,
        content_type:
          typeof candidate.content_type === "string" && candidate.content_type.trim()
            ? candidate.content_type.trim()
            : undefined,
        size_bytes:
          typeof candidate.size_bytes === "number" || typeof candidate.size_bytes === "string"
            ? candidate.size_bytes
            : undefined,
        replaced_at:
          typeof candidate.replaced_at === "string" && candidate.replaced_at.trim()
            ? candidate.replaced_at.trim()
            : undefined,
        asset_id: typeof assetId === "number" && Number.isFinite(assetId) ? assetId : undefined,
        is_default: Boolean(candidate.is_default),
        display_order: typeof displayOrder === "number" && Number.isFinite(displayOrder) ? displayOrder : undefined,
      });
    }
  }

  if (normalized.length > 0) {
    return normalized;
  }

  const fallbackThumbnailUrl = getBookThumbnailUrl(book);
  if (!fallbackThumbnailUrl) {
    return [];
  }

  return [
    {
      media_type: "image",
      url: fallbackThumbnailUrl,
      display_name: "Book Thumbnail",
      is_default: true,
      display_order: 0,
    },
  ];
};

export const getBookMediaDisplayOrder = (media: BookMediaItem): number => {
  const raw = media.display_order;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};

export const sortBookMediaItems = (items: BookMediaItem[]): BookMediaItem[] =>
  [...items].sort((a, b) => {
    const typeCompare = (a.media_type || "").localeCompare(b.media_type || "");
    if (typeCompare !== 0) {
      return typeCompare;
    }
    const defaultCompare = Number(Boolean(b.is_default)) - Number(Boolean(a.is_default));
    if (defaultCompare !== 0) {
      return defaultCompare;
    }
    return getBookMediaDisplayOrder(a) - getBookMediaDisplayOrder(b);
  });

export const getNodeThumbnailUrl = (mediaItems: MediaFile[]): string | null => {
  const imageItems = mediaItems.filter((item) => item.media_type === "image" && typeof item.url === "string" && item.url.trim());
  if (imageItems.length === 0) {
    return null;
  }
  const defaultImage = imageItems.find((item) => {
    const metadata =
      item.metadata && typeof item.metadata === "object"
        ? item.metadata
        : item.metadata_json && typeof item.metadata_json === "object"
          ? item.metadata_json
          : null;
    return Boolean(metadata?.is_default);
  });
  const picked = defaultImage || imageItems[0];
  const metadata =
    picked.metadata && typeof picked.metadata === "object"
      ? picked.metadata
      : picked.metadata_json && typeof picked.metadata_json === "object"
        ? picked.metadata_json
        : null;
  return resolveMediaUrlWithMetadataVersion(picked.url, metadata);
};

export const getYouTubeEmbedUrl = (rawUrl: string): string | null => {
  if (!rawUrl || typeof rawUrl !== "string") {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    if (host === "youtu.be") {
      const videoId = parsed.pathname.replace(/^\//, "").split("/")[0];
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (parsed.pathname === "/watch") {
        const videoId = parsed.searchParams.get("v");
        return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
      }

      if (parsed.pathname.startsWith("/embed/")) {
        const videoId = parsed.pathname.split("/")[2];
        return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
      }

      if (parsed.pathname.startsWith("/shorts/")) {
        const videoId = parsed.pathname.split("/")[2];
        return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
      }
    }
  } catch {
    return null;
  }

  return null;
};

export const getYouTubeVideoId = (rawUrl: string): string | null => {
  if (!rawUrl || typeof rawUrl !== "string") {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    if (host === "youtu.be") {
      const videoId = parsed.pathname.replace(/^\//, "").split("/")[0];
      return videoId || null;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v") || null;
      }
      if (parsed.pathname.startsWith("/embed/") || parsed.pathname.startsWith("/shorts/")) {
        const videoId = parsed.pathname.split("/")[2];
        return videoId || null;
      }
    }
  } catch {
    return null;
  }

  return null;
};

export const getMediaLookupKey = (mediaType: string | undefined, rawUrl: string): string => {
  const normalizedType = (mediaType || "").trim().toLowerCase() || "unknown";
  const trimmedUrl = (rawUrl || "").trim();
  if (!trimmedUrl) {
    return `${normalizedType}:`;
  }

  const youTubeVideoId = getYouTubeVideoId(trimmedUrl);
  if (youTubeVideoId) {
    return `${normalizedType}:youtube:${youTubeVideoId.toLowerCase()}`;
  }

  try {
    const parsed = new URL(trimmedUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = decodeURIComponent(parsed.pathname || "").replace(/\/+$/, "");
    return `${normalizedType}:${host}${pathname}`;
  } catch {
    return `${normalizedType}:${trimmedUrl.toLowerCase()}`;
  }
};
