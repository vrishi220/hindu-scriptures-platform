import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  hasDevanagariLetters,
  normalizeTransliterationScript,
  transliterateFromDevanagari,
  transliterateFromIast,
  transliterationScriptLabel,
  type TransliterationScriptOption,
} from "@/lib/indicScript";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";
const REFRESH_TOKEN_COOKIE = process.env.REFRESH_TOKEN_COOKIE || "refresh_token";
const BACKEND_UNAVAILABLE = "Auth/content service unavailable. Please try again shortly.";
const ENABLE_BROWSER_RENDERED_PDF =
  (process.env.ENABLE_BROWSER_RENDERED_PDF || "true").trim().toLowerCase() === "true";

const buildFallbackReason = (prefix: string, error: unknown): string => {
  if (error instanceof Error && error.name) {
    return `${prefix}_${error.name}`;
  }
  return prefix;
};

type PdfPageBreakMode = "none" | "between_level" | "between_leaf";
type PdfPageSize = "A4" | "Letter";

type NormalizedPdfSettings = {
  pageBreakMode: PdfPageBreakMode;
  pageSize: PdfPageSize;
  landscape: boolean;
  marginMm: number;
  includeCoverPage: boolean;
  pageRanges?: string;
};

const DEFAULT_PDF_SETTINGS: NormalizedPdfSettings = {
  pageBreakMode: "none",
  pageSize: "A4",
  landscape: false,
  marginMm: 16,
  includeCoverPage: true,
};

const normalizePdfPageRanges = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 80) return undefined;
  // Accept values like: "1", "1-3", "1-3, 5, 7-9"
  if (!/^[0-9\-,\s]+$/.test(trimmed)) return undefined;
  return trimmed;
};

const normalizePdfSettings = (value: unknown): NormalizedPdfSettings => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  const pageBreakMode: PdfPageBreakMode =
    raw.page_break_mode === "between_level" || raw.page_break_mode === "between_leaf"
      ? raw.page_break_mode
      : "none";

  const pageSize: PdfPageSize = raw.page_size === "Letter" ? "Letter" : "A4";
  const landscape = raw.orientation === "landscape";
  const marginCandidate = typeof raw.margin_mm === "number" ? raw.margin_mm : Number(raw.margin_mm);
  const marginMm = Number.isFinite(marginCandidate)
    ? Math.max(8, Math.min(32, Math.round(marginCandidate)))
    : DEFAULT_PDF_SETTINGS.marginMm;
  const includeCoverPage = raw.include_cover_page !== false;
  const pageRanges = normalizePdfPageRanges(raw.page_ranges);

  return {
    pageBreakMode,
    pageSize,
    landscape,
    marginMm,
    includeCoverPage,
    ...(pageRanges ? { pageRanges } : {}),
  };
};

type BrowserLaunchResult = {
  browser: {
    newPage: () => Promise<{
      setContent: (html: string, options?: { waitUntil?: "networkidle" | "load" | "domcontentloaded" }) => Promise<void>;
      pdf: (options: {
        format?: "A4" | "Letter";
        landscape?: boolean;
        pageRanges?: string;
        printBackground: boolean;
      }) => Promise<Uint8Array | Buffer | ArrayBuffer>;
    }>;
    close: () => Promise<void>;
  };
  engine: string;
};

const launchPdfBrowser = async (): Promise<BrowserLaunchResult> => {
  try {
    const pw = await import("@playwright/test");
    const browser = await pw.chromium.launch({ headless: true });
    return { browser, engine: "playwright-test" };
  } catch {
    const chromium = await import("@sparticuz/chromium");
    const playwrightCore = await import("playwright-core");
    const executablePath = await chromium.default.executablePath();
    const browser = await playwrightCore.chromium.launch({
      args: chromium.default.args,
      executablePath,
      headless: true,
    });
    return { browser, engine: "playwright-core-sparticuz" };
  }
};

type BookPreviewRenderLine = {
  field?: string;
  label?: string;
  value?: string;
};

type BookPreviewWordMeaningRow = {
  resolved_source?: {
    text?: string;
    mode?: string;
    scheme?: string;
  };
  source?: {
    language?: string;
  };
  resolved_meaning?: {
    text?: string;
    language?: string;
    fallback_badge_visible?: boolean;
  };
};

type BookPreviewBlock = {
  order: number;
  title: string;
  template_key: string;
  source_node_id: number | null;
  content: {
    translations?: Record<string, string>;
    rendered_lines?: BookPreviewRenderLine[];
    word_meanings_rows?: BookPreviewWordMeaningRow[];
  };
};

type BookPreviewArtifact = {
  book_id: number;
  book_name: string;
  book_media_items?: Array<{
    media_type?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  }>;
  preview_scope?: "book" | "node";
  root_node_id?: number | null;
  root_title?: string | null;
  reader_hierarchy_path?: string | null;
  sections: {
    body: BookPreviewBlock[];
  };
  has_more?: boolean;
  total_blocks?: number;
  offset?: number;
  limit?: number;
  render_settings?: {
    show_sanskrit: boolean;
    show_transliteration: boolean;
    show_english: boolean;
    show_metadata: boolean;
    show_media?: boolean;
    text_order: Array<"sanskrit" | "transliteration" | "english" | "text">;
  };
};

const TRANSLATION_LANGUAGE_ALIAS_TO_CANONICAL: Record<string, string> = {
  en: "english",
  eng: "english",
  english: "english",
  hi: "hindi",
  hindi: "hindi",
  te: "telugu",
  telugu: "telugu",
  kn: "kannada",
  kannada: "kannada",
  ta: "tamil",
  tamil: "tamil",
  ml: "malayalam",
  malayalam: "malayalam",
  sa: "sanskrit",
  sanskrit: "sanskrit",
};

const TRANSLATION_CANONICAL_TO_CODE: Record<string, string> = {
  english: "en",
  hindi: "hi",
  telugu: "te",
  kannada: "kn",
  tamil: "ta",
  malayalam: "ml",
  sanskrit: "sa",
};

const TRANSLATION_LANGUAGE_LABELS: Record<string, string> = {
  english: "English",
  hindi: "Hindi",
  telugu: "Telugu",
  kannada: "Kannada",
  tamil: "Tamil",
  malayalam: "Malayalam",
  sanskrit: "Sanskrit",
};

const normalizeTranslationLanguage = (value?: string | null): string => {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) {
    return "english";
  }
  return TRANSLATION_LANGUAGE_ALIAS_TO_CANONICAL[normalized] || normalized;
};

const translationLanguageToCode = (value?: string | null): string => {
  const canonical = normalizeTranslationLanguage(value);
  return TRANSLATION_CANONICAL_TO_CODE[canonical] || canonical;
};

const translationLanguageLabel = (value?: string | null): string => {
  const canonical = normalizeTranslationLanguage(value);
  return TRANSLATION_LANGUAGE_LABELS[canonical] || canonical.toUpperCase();
};

const transliterationScriptToLang = (script: TransliterationScriptOption): string => {
  if (script === "devanagari") return "sa-Deva";
  if (script === "telugu") return "te";
  if (script === "kannada") return "kn";
  if (script === "tamil") return "ta";
  if (script === "malayalam") return "ml";
  return "sa-Latn";
};

const transliterationScriptClassName = (script: TransliterationScriptOption): string => {
  if (script === "devanagari") return "script-devanagari";
  if (script === "telugu") return "script-telugu";
  if (script === "kannada") return "script-kannada";
  if (script === "tamil") return "script-tamil";
  if (script === "malayalam") return "script-malayalam";
  return "script-iast";
};

const normalizeIndicDisplayText = (value: string): string => {
  if (!value) return "";
  return value
    .normalize("NFC")
    .replace(/[\u200B\uFEFF\u00AD]/g, "")
    .replace(/([\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D4D])\s+([\u0900-\u0D7F])/g, "$1$2");
};

const expandVerseSeparatorsForPdf = (value: string): string => {
  if (!value) return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/॥/g, "\n॥\n")
    .replace(/\|\|/g, "\n||\n")
    .replace(/।/g, "\n।\n")
    .replace(/(?<!\|)\|(?!\|)/g, "\n|\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const detectIndicScriptClassAndLang = (
  text: string,
  language?: string
): { className: string; lang: string } | null => {
  const normalizedLanguage = normalizeTranslationLanguage(language);
  if (normalizedLanguage === "telugu") return { className: "script-telugu", lang: "te" };
  if (normalizedLanguage === "kannada") return { className: "script-kannada", lang: "kn" };
  if (normalizedLanguage === "tamil") return { className: "script-tamil", lang: "ta" };
  if (normalizedLanguage === "malayalam") return { className: "script-malayalam", lang: "ml" };
  if (normalizedLanguage === "sanskrit") return { className: "script-devanagari", lang: "sa-Deva" };

  if (!text) return null;
  if (/[\u0C00-\u0C7F]/.test(text)) return { className: "script-telugu", lang: "te" };
  if (/[\u0C80-\u0CFF]/.test(text)) return { className: "script-kannada", lang: "kn" };
  if (/[\u0B80-\u0BFF]/.test(text)) return { className: "script-tamil", lang: "ta" };
  if (/[\u0D00-\u0D7F]/.test(text)) return { className: "script-malayalam", lang: "ml" };
  if (/[\u0900-\u097F]/.test(text)) return { className: "script-devanagari", lang: "sa-Deva" };
  return null;
};

const inferLanguageFromLabel = (label: string): string => {
  const normalized = (label || "").trim().toLowerCase();
  if (normalized.includes("telugu")) return "telugu";
  if (normalized.includes("kannada")) return "kannada";
  if (normalized.includes("tamil")) return "tamil";
  if (normalized.includes("malayalam")) return "malayalam";
  if (normalized.includes("sanskrit")) return "sanskrit";
  if (normalized.includes("hindi")) return "hindi";
  if (normalized.includes("english")) return "english";
  return "";
};

const getTranslationLookupKeys = (language: string): string[] => {
  const canonical = normalizeTranslationLanguage(language);
  const code = translationLanguageToCode(canonical);
  const keys = [canonical, code];
  if (canonical === "english") {
    keys.push("english", "en");
  }
  return Array.from(new Set(keys.filter(Boolean)));
};

const pickTranslationTextForLanguageOnly = (
  translations: Record<string, string>,
  language: string
): string => {
  for (const key of getTranslationLookupKeys(language)) {
    const value = translations[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const normalizeSelectedTranslationLanguages = (value: unknown): string[] => {
  const rawValues = Array.isArray(value) ? value : [];
  const normalized = rawValues
    .map((entry) => normalizeTranslationLanguage(typeof entry === "string" ? entry : ""))
    .filter(Boolean);
  if (!normalized.includes("english")) {
    normalized.unshift("english");
  }
  return Array.from(new Set(normalized));
};

const buildAuthHeader = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

const refreshAccessToken = async (refreshToken: string) => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as
    | { access_token: string; refresh_token: string }
    | null;
};

const tryReadErrorPayload = async (response: Response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await response.json().catch(() => null)) as Record<string, unknown> | null;
  }

  const text = await response.text().catch(() => "");
  const detail = text.trim();
  return detail ? { detail } : null;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const isLikelyImageUrl = (url: string): boolean => {
  const normalized = (url || "").trim().toLowerCase();
  return /(\.png|\.jpe?g|\.webp|\.gif|\.bmp|\.svg)(\?|$)/.test(normalized);
};

const normalizeCoverImageUrl = (rawUrl: string): string => {
  const value = (rawUrl || "").trim();
  if (!value) {
    return "";
  }

  if (value.startsWith("data:")) {
    return value;
  }

  if (value.startsWith("/api/media/")) {
    return value;
  }

  if (value.startsWith("api/media/")) {
    return `/${value}`;
  }

  if (value.startsWith("/media/")) {
    return `/api/media/${value.slice("/media/".length)}`;
  }

  if (value.startsWith("media/")) {
    return `/api/media/${value.slice("media/".length)}`;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith("/media/")) {
        const suffix = parsed.pathname.slice("/media/".length);
        return `/api/media/${suffix}${parsed.search || ""}${parsed.hash || ""}`;
      }
    } catch {
      return value;
    }
  }

  return value;
};

const pickPrimaryCoverImage = (
  items: Array<{ media_type?: string; url?: string; metadata?: Record<string, unknown> }>
): string | null => {
  const normalized = items
    .map((item) => {
      const url = typeof item.url === "string" ? item.url.trim() : "";
      const mediaType = typeof item.media_type === "string" ? item.media_type.trim().toLowerCase() : "";
      const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
      if (!url) {
        return null;
      }
      const primaryFlag =
        metadata["is_primary"] === true ||
        metadata["primary"] === true ||
        metadata["isPrimary"] === true ||
        String(metadata["role"] || "").toLowerCase() === "cover" ||
        String(metadata["role"] || "").toLowerCase() === "primary" ||
        String(metadata["display_name"] || "").toLowerCase().includes("cover");
      const imageLike = mediaType.includes("image") || isLikelyImageUrl(url);
      return {
        url,
        primaryFlag,
        imageLike,
      };
    })
    .filter(
      (entry): entry is { url: string; primaryFlag: boolean; imageLike: boolean } => Boolean(entry)
    );

  const primaryImage = normalized.find((entry) => entry.imageLike && entry.primaryFlag);
  if (primaryImage) {
    return primaryImage.url;
  }

  const firstImage = normalized.find((entry) => entry.imageLike);
  return firstImage?.url || null;
};

const pickCoverImageFromBookPayload = (bookPayload: Record<string, unknown> | null): string | null => {
  const metadata =
    bookPayload && typeof bookPayload.metadata_json === "object" && bookPayload.metadata_json
      ? (bookPayload.metadata_json as Record<string, unknown>)
      : {};

  const candidates = [
    metadata.thumbnail_url,
    metadata.thumbnailUrl,
    metadata.cover_image_url,
    metadata.coverImageUrl,
    metadata.primary_image_url,
    metadata.primaryImageUrl,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

const resolveAbsoluteUrl = (rawUrl: string, requestUrl: string): string => {
  try {
    return new URL(rawUrl).toString();
  } catch {
    return new URL(rawUrl, requestUrl).toString();
  }
};

const inferImageMimeType = (url: string, contentTypeHeader: string): string | null => {
  const header = (contentTypeHeader || "").toLowerCase().split(";")[0].trim();
  if (header.startsWith("image/")) {
    return header;
  }
  // Guard against embedding HTML/login/error pages as image data.
  if (header.startsWith("text/") || header.includes("json") || header.includes("xml")) {
    return null;
  }

  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }

  if (/\.png($|\?)/.test(path)) return "image/png";
  if (/\.(jpg|jpeg)($|\?)/.test(path)) return "image/jpeg";
  if (/\.webp($|\?)/.test(path)) return "image/webp";
  if (/\.gif($|\?)/.test(path)) return "image/gif";
  if (/\.bmp($|\?)/.test(path)) return "image/bmp";
  if (/\.svg($|\?)/.test(path)) return "image/svg+xml";

  // Some media gateways return octet-stream for image files.
  if (header === "application/octet-stream") {
    return "image/jpeg";
  }

  return null;
};

const fetchImageAsDataUri = async (
  imageUrl: string,
  requestUrl: string,
  token?: string,
  requestCookieHeader?: string | null
): Promise<string | null> => {
  const normalizedImageUrl = normalizeCoverImageUrl(imageUrl);
  if (!normalizedImageUrl.trim()) {
    return null;
  }

  if (normalizedImageUrl.startsWith("data:")) {
    return normalizedImageUrl;
  }

  const absoluteUrl = resolveAbsoluteUrl(normalizedImageUrl, requestUrl);
  const isBackendUrl = absoluteUrl.startsWith(API_BASE_URL);
  const requestOrigin = new URL(requestUrl).origin;
  const isSameOrigin = absoluteUrl.startsWith(requestOrigin);
  const headers: HeadersInit = isBackendUrl && token ? buildAuthHeader(token) : {};

  if (isSameOrigin && requestCookieHeader) {
    headers["Cookie"] = requestCookieHeader;
  }

  let response: Response;
  try {
    response = await fetch(absoluteUrl, {
      headers,
      cache: "no-store",
    });
  } catch {
    return null;
  }

  // Fallback path: if same-origin media proxy call failed, try direct backend media with bearer token.
  if (
    !response.ok &&
    token &&
    normalizedImageUrl.startsWith("/api/media/")
  ) {
    try {
      response = await fetch(`${API_BASE_URL}${normalizedImageUrl}`, {
        headers: buildAuthHeader(token),
        cache: "no-store",
      });
    } catch {
      return null;
    }
  }

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const resolvedMimeType = inferImageMimeType(absoluteUrl, contentType);
  if (!resolvedMimeType) {
    return null;
  }

  const bytes = await response.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${resolvedMimeType};base64,${base64}`;
};

const pickAuthor = (bookPayload: Record<string, unknown> | null): string => {
  const metadata =
    bookPayload && typeof bookPayload.metadata_json === "object" && bookPayload.metadata_json
      ? (bookPayload.metadata_json as Record<string, unknown>)
      : {};
  const candidates = [
    metadata.author,
    metadata.authors,
    metadata.author_name,
    metadata.source_attribution,
    metadata.composer,
    metadata.writer,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "Unknown Author";
};

const buildBookPreviewHtml = (
  artifact: BookPreviewArtifact,
  selectedTranslationLanguages: string[],
  options?: {
    author?: string | null;
    coverImageSrc?: string | null;
    showPreviewTitles?: boolean;
    showPreviewLabels?: boolean;
    previewTransliterationScript?: string;
    wordMeaningsDisplayMode?: "inline" | "table" | "hide";
    pdfSettings?: NormalizedPdfSettings;
  }
) => {
  const renderSettings = artifact.render_settings || {
    show_sanskrit: true,
    show_transliteration: true,
    show_english: true,
    show_metadata: false,
    text_order: ["sanskrit", "transliteration", "english", "text"] as Array<
      "sanskrit" | "transliteration" | "english" | "text"
    >,
  };

  const labelForField = (field: string): string => {
    if (field === "sanskrit") return "Sanskrit";
    if (field === "transliteration") return "Transliteration";
    if (field === "english") return "English";
    return "Text";
  };

  const shouldShowField = (field: string): boolean => {
    if (field === "sanskrit") return Boolean(renderSettings.show_sanskrit);
    if (field === "transliteration") return Boolean(renderSettings.show_transliteration);
    if (field === "english") return Boolean(renderSettings.show_english);
    return true;
  };

  const bodyBlocks = artifact.sections?.body || [];
  const appliedShowPreviewTitles = options?.showPreviewTitles === true;
  const appliedShowPreviewLabels = options?.showPreviewLabels === true;
  const appliedPreviewTransliterationScript: TransliterationScriptOption =
    normalizeTransliterationScript(options?.previewTransliterationScript || "iast");
  const appliedWordMeaningsDisplayMode: "inline" | "table" | "hide" =
    options?.wordMeaningsDisplayMode ?? "inline";
  const appliedPdfSettings = options?.pdfSettings ?? DEFAULT_PDF_SETTINGS;
  const pageSizeCss = appliedPdfSettings.pageSize;
  const pageMarginCss = `${appliedPdfSettings.marginMm}mm`;
  const coverAuthor = (options?.author || "").trim() || "Unknown Author";
  const coverImageSrc = (options?.coverImageSrc || "").trim();
  const blocksHtml = bodyBlocks
    .map((block, blockIndex) => {
      const renderedLines = Array.isArray(block.content?.rendered_lines)
        ? block.content.rendered_lines
        : [];

      const renderedEntries = renderedLines
        .map((line) => {
          const field = (line.field || "text").toLowerCase();
          const rawValue = typeof line.value === "string" ? line.value.trim() : "";
          const value =
            field === "transliteration"
              ? hasDevanagariLetters(rawValue)
                ? transliterateFromDevanagari(rawValue, appliedPreviewTransliterationScript)
                : transliterateFromIast(rawValue, appliedPreviewTransliterationScript)
              : rawValue;
          const normalizedValueForPdf =
            field === "sanskrit" || field === "transliteration"
              ? expandVerseSeparatorsForPdf(value)
              : value;
          if (!normalizedValueForPdf || !shouldShowField(field)) {
            return null;
          }

          const hasSemanticLabel =
            typeof line.label === "string" && /[A-Za-z0-9\u0900-\u097F]/.test(line.label);
          const label = hasSemanticLabel ? line.label!.trim() : labelForField(field);
          return { field, label, value: normalizedValueForPdf };
        })
        .filter((entry): entry is { field: string; label: string; value: string } => Boolean(entry));

      const translationMapRaw =
        block.content?.translations && typeof block.content.translations === "object"
          ? block.content.translations
          : {};
      const translationMap: Record<string, string> = {};
      for (const [key, rawValue] of Object.entries(translationMapRaw)) {
        const normalizedKey = (key || "").trim().toLowerCase();
        if (!normalizedKey || typeof rawValue !== "string" || !rawValue.trim()) {
          continue;
        }
        translationMap[normalizedKey] = rawValue.trim();
      }

      const groupAdjacentEntries = (entries: Array<{ field: string; label: string; value: string }>) => {
        return entries.reduce<Array<{ field: string; label: string; value: string }>>((acc, entry) => {
          const previous = acc[acc.length - 1];
          if (previous && previous.field === entry.field && previous.label === entry.label) {
            previous.value = `${previous.value}\n${entry.value}`;
          } else {
            acc.push({ ...entry });
          }
          return acc;
        }, []);
      };

      const nonTranslationEntries = groupAdjacentEntries(
        renderedEntries.filter((entry) => entry.field !== "english")
      );
      const translationEntries = groupAdjacentEntries(
        renderedEntries.filter((entry) => entry.field === "english")
      );

      const primarySelectedTranslationLanguage = selectedTranslationLanguages[0] || "english";
      const existingTranslationValues = new Set(
        translationEntries.map((entry) => entry.value.trim()).filter(Boolean)
      );
      for (const language of selectedTranslationLanguages) {
        if (language === primarySelectedTranslationLanguage) {
          continue;
        }
        const value = pickTranslationTextForLanguageOnly(translationMap, language);
        if (!value || existingTranslationValues.has(value)) {
          continue;
        }
        translationEntries.push({
          field: "english",
          label: `${translationLanguageLabel(language)} Translation`,
          value,
        });
        existingTranslationValues.add(value);
      }

      const wordMeaningRows = Array.isArray(block.content?.word_meanings_rows)
        ? block.content.word_meanings_rows
        : [];
      const wordMeaningEntries = wordMeaningRows
        .map((row) => {
          const source =
            typeof row.resolved_source?.text === "string"
              ? normalizeIndicDisplayText(row.resolved_source.text.trim())
              : "";
          const sourceMode =
            typeof row.resolved_source?.mode === "string"
              ? row.resolved_source.mode.trim().toLowerCase()
              : "";
          const sourceScheme =
            typeof row.resolved_source?.scheme === "string"
              ? row.resolved_source.scheme.trim().toLowerCase()
              : "";
          const sourceLanguage =
            typeof row.source?.language === "string" ? row.source.language.trim().toLowerCase() : "";
          const meaning =
            typeof row.resolved_meaning?.text === "string"
              ? normalizeIndicDisplayText(row.resolved_meaning.text.trim())
              : "";
          if (!source && !meaning) {
            return null;
          }

          let renderedSource = source;
          if (source && sourceLanguage === "sa") {
            if (hasDevanagariLetters(source)) {
              renderedSource = transliterateFromDevanagari(source, appliedPreviewTransliterationScript);
            } else if (sourceMode === "transliteration" && (!sourceScheme || sourceScheme === "iast")) {
              renderedSource = transliterateFromIast(source, appliedPreviewTransliterationScript);
            }
          }

          const fallbackBadgeVisible = Boolean(row.resolved_meaning?.fallback_badge_visible);
          const meaningLanguage =
            typeof row.resolved_meaning?.language === "string"
              ? row.resolved_meaning.language.trim().toLowerCase()
              : "";
          const meaningScript = detectIndicScriptClassAndLang(meaning, meaningLanguage);
          const meaningWithBadge =
            meaning && fallbackBadgeVisible && meaningLanguage ? `${meaning} (${meaningLanguage})` : meaning;

          const sourceScriptClass =
            source && sourceLanguage === "sa"
              ? transliterationScriptClassName(appliedPreviewTransliterationScript)
              : "";
          const sourceLang =
            source && sourceLanguage === "sa"
              ? transliterationScriptToLang(appliedPreviewTransliterationScript)
              : "";

          return {
            field: "word_meaning",
            label: "Word Meanings",
            source: renderedSource,
            meaning: meaningWithBadge,
            sourceScriptClass,
            sourceLang,
            meaningScriptClass: meaningScript?.className || "",
            meaningLang: meaningScript?.lang || "",
          };
        })
        .filter((entry): entry is {
          field: string;
          label: string;
          source: string;
          meaning: string;
          sourceScriptClass: string;
          sourceLang: string;
          meaningScriptClass: string;
          meaningLang: string;
        } => Boolean(entry));

      const nonTranslationHtml = nonTranslationEntries
        .map((entry) => {
          const isSanskrit = entry.field === "sanskrit";
          const lineClass = `line field-${entry.field}${isSanskrit ? " sanskrit" : ""}`;
          if (entry.field === "sanskrit") {
            return `<div class=\"${lineClass}\">${escapeHtml(entry.value)}</div>`;
          }
          if (entry.field === "transliteration") {
            const value = escapeHtml(entry.value);
            const transliterationScriptClass = transliterationScriptClassName(
              appliedPreviewTransliterationScript
            );
            const transliterationLang = transliterationScriptToLang(appliedPreviewTransliterationScript);
            return `<div class=\"${lineClass}\"><span class=\"script-text ${transliterationScriptClass}\" lang=\"${escapeHtml(
              transliterationLang
            )}\">${value}</span></div>`;
          }
          const label =
            entry.field === "transliteration"
              ? `${escapeHtml(entry.label)} (${escapeHtml(transliterationScriptLabel(appliedPreviewTransliterationScript))})`
              : escapeHtml(entry.label);
          const value = escapeHtml(entry.value);
          const transliterationScriptClass =
            entry.field === "transliteration"
              ? transliterationScriptClassName(appliedPreviewTransliterationScript)
              : "";
          const transliterationLang =
            entry.field === "transliteration"
              ? transliterationScriptToLang(appliedPreviewTransliterationScript)
              : "";
          const renderedValue =
            entry.field === "transliteration"
              ? `<span class=\"script-text ${transliterationScriptClass}\" lang=\"${escapeHtml(
                  transliterationLang
                )}\">${value}</span>`
              : value;
          return appliedShowPreviewLabels
            ? `<div class=\"${lineClass}\"><strong>${label}:</strong> ${renderedValue}</div>`
            : `<div class=\"${lineClass}\">${renderedValue}</div>`;
        })
        .join("");

      const wordMeaningsHtml = (() => {
        if (wordMeaningEntries.length === 0 || appliedWordMeaningsDisplayMode === "hide") return "";
        if (appliedWordMeaningsDisplayMode === "inline") {
          const inlineParts = wordMeaningEntries.map((entry) => {
            const source = escapeHtml(entry.source);
            const meaning = escapeHtml(entry.meaning);
            const sourceClass = entry.sourceScriptClass ? ` ${entry.sourceScriptClass}` : "";
            const langAttr = entry.sourceLang ? ` lang="${escapeHtml(entry.sourceLang)}"` : "";
            const meaningClass = entry.meaningScriptClass ? ` ${entry.meaningScriptClass}` : "";
            const meaningLangAttr = entry.meaningLang ? ` lang="${escapeHtml(entry.meaningLang)}"` : "";
            return `<span class="word-meaning-source${sourceClass}"${langAttr}>${source}</span><span class="word-meaning-sep"> : </span><span class="word-meaning-target${meaningClass}"${meaningLangAttr}>${meaning}</span>`;
          });
          return `<div class="line word-meanings-inline">${inlineParts.join('<span class="word-meaning-sep"> ; </span>')}</div>`;
        }
        // "table" mode — one div per entry
        const rows = wordMeaningEntries.map((entry) => {
          const source = escapeHtml(entry.source);
          const meaning = escapeHtml(entry.meaning);
          const sourceClass = entry.sourceScriptClass ? ` ${entry.sourceScriptClass}` : "";
          const langAttr = entry.sourceLang ? ` lang="${escapeHtml(entry.sourceLang)}"` : "";
          const meaningClass = entry.meaningScriptClass ? ` ${entry.meaningScriptClass}` : "";
          const meaningLangAttr = entry.meaningLang ? ` lang="${escapeHtml(entry.meaningLang)}"` : "";
          return `<div class="line indented"><span class="word-meaning-source${sourceClass}"${langAttr}>${source}</span><span class="word-meaning-sep"> — </span><span class="word-meaning-target${meaningClass}"${meaningLangAttr}>${meaning}</span></div>`;
        });
        return `<div class="line"><strong>Word Meanings:</strong></div>${rows.join("")}`;
      })();

      const translationHtml = translationEntries
        .map((entry) => {
          const label = escapeHtml(entry.label);
          const normalizedValue = normalizeIndicDisplayText(entry.value);
          const value = escapeHtml(normalizedValue);
          const inferredLanguage = inferLanguageFromLabel(entry.label);
          const scriptInfo = detectIndicScriptClassAndLang(normalizedValue, inferredLanguage);
          const valueClass = scriptInfo?.className ? ` ${scriptInfo.className}` : "";
          const valueLangAttr = scriptInfo?.lang ? ` lang=\"${escapeHtml(scriptInfo.lang)}\"` : "";
          const renderedValue = `<span class=\"word-meaning-target${valueClass}\"${valueLangAttr}>${value}</span>`;
          return appliedShowPreviewLabels
            ? `<div class=\"line\"><strong>${label}:</strong></div><div class=\"line indented\">${renderedValue}</div>`
            : `<div class=\"line\">${renderedValue}</div>`;
        })
        .join("");

      const nonTranslationSectionHtml = nonTranslationHtml
        ? `<div class=\"content-section section-primary\">${nonTranslationHtml}</div>`
        : "";
      const wordMeaningsSectionHtml = wordMeaningsHtml
        ? `<div class=\"content-section section-word-meanings\">${wordMeaningsHtml}</div>`
        : "";
      const translationSectionHtml = translationHtml
        ? `<div class=\"content-section section-translation\">${translationHtml}</div>`
        : "";
      const linesHtml = `${nonTranslationSectionHtml}${wordMeaningsSectionHtml}${translationSectionHtml}`;
      const hideNodeFallbackTitle = /^Node\s+\d+$/i.test((block.title || "").trim());
      const titleHtml =
        appliedShowPreviewTitles && !hideNodeFallbackTitle
          ? `<h3>${escapeHtml(block.title)}</h3>`
          : "";

      const metadataSourceNode =
        typeof block.source_node_id === "number" ? ` • source_node=${block.source_node_id}` : "";
      const metadata = renderSettings.show_metadata
        ? `<div class=\"meta\">template=${escapeHtml(block.template_key)}${metadataSourceNode}</div>`
        : "";

      const templateKey = (block.template_key || "").trim().toLowerCase();
      const isLeafTemplate = templateKey.includes("leaf");
      const isLevelTemplate = templateKey.includes("level");
      const hasNextBlock = blockIndex < bodyBlocks.length - 1;
      const hasPageBreakAfter =
        // Leaf mode should break between successive rendered blocks regardless of template naming.
        (appliedPdfSettings.pageBreakMode === "between_leaf" && hasNextBlock) ||
        (appliedPdfSettings.pageBreakMode === "between_level" && isLevelTemplate);
      const blockClass = `block${hasPageBreakAfter ? " page-break-after" : ""}`;

      return `
        <div class=\"${blockClass}\">
          ${titleHtml}
          ${linesHtml || '<p class=\"muted\">No visible content for current settings.</p>'}
          ${metadata}
        </div>
      `;
    })
    .join("");

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset=\"utf-8\" />
        <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" />
        <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin />
        <link href=\"https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,400;0,700;1,400&family=Noto+Sans+Devanagari:wght@400;700&family=Noto+Sans+Telugu:wght@400;700&family=Noto+Serif+Telugu:wght@400;700&family=Noto+Sans+Kannada:wght@400;700&family=Noto+Sans+Tamil:wght@400;700&family=Noto+Sans+Malayalam:wght@400;700&family=Noto+Serif:ital,wght@0,400;1,400&display=block\" rel=\"stylesheet\" />
        <style>
          @page { size: ${pageSizeCss}; margin: 22mm ${pageMarginCss}; }
          body {
            font-family: "Noto Sans", "Noto Sans Devanagari", "Noto Sans Telugu", "Noto Sans Kannada", "Noto Sans Tamil", "Noto Sans Malayalam", "Arial Unicode MS", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            color: #111;
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
          }
          .cover-page { min-height: calc(100vh - 44mm); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
          .cover-title { font-size: 36px; margin: 0 0 8px 0; line-height: 1.2; }
          .cover-author { font-size: 20px; margin: 0 0 22px 0; color: #444; }
          .cover-image-wrap { width: 100%; display: flex; justify-content: center; align-items: center; }
          .cover-image {
            width: min(96%, 185mm);
            max-height: calc(100vh - 120mm);
            object-fit: contain;
            border-radius: 10px;
          }
          .page-break { page-break-after: always; break-after: page; }
          h1 { font-size: 24px; margin: 0 0 6px 0; }
          h3 { font-size: 16px; margin: 0 0 8px; }
          .block { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; break-inside: avoid; }
          .block.page-break-after { page-break-after: always; break-after: page; }
          .content-section + .content-section {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid #e3e3e3;
          }
          .line { font-size: 14px; line-height: 1.55; margin-top: 4px; white-space: pre-wrap; }
          .line + .line { margin-top: 6px; }
          .line.indented { margin-left: 14px; }
          .line.sanskrit { font-family: "Noto Sans Devanagari", "Noto Sans Telugu", "Noto Sans Kannada", "Noto Sans Tamil", "Noto Sans Malayalam", "Arial Unicode MS", serif; font-size: 18px; line-height: 1.75; }
          .field-sanskrit { margin-bottom: 8px; }
          .field-transliteration { margin-bottom: 12px; }
          .field-transliteration .script-text { font-size: 15px; line-height: 1.7; }
          .script-devanagari {
            font-family: "Noto Sans Devanagari", "Kohinoor Devanagari", "Devanagari Sangam MN", "Mangal", "Nirmala UI", "Arial Unicode MS", serif;
          }
          .script-telugu {
            font-family: "Noto Serif Telugu", "Noto Sans Telugu", "Kohinoor Telugu", "Telugu Sangam MN", "Gautami", "Vani", "Nirmala UI", "Arial Unicode MS", serif;
            line-height: 1.78;
            font-feature-settings: "kern" 1, "liga" 1;
          }
          .script-kannada {
            font-family: "Noto Sans Kannada", "Noto Serif Kannada", "Kannada Sangam MN", "Tunga", "Nirmala UI", "Arial Unicode MS", sans-serif;
          }
          .script-tamil {
            font-family: "Noto Sans Tamil", "Noto Serif Tamil", "Tamil Sangam MN", "InaiMathi", "Latha", "Nirmala UI", "Arial Unicode MS", sans-serif;
          }
          .script-malayalam {
            font-family: "Noto Sans Malayalam", "Noto Serif Malayalam", "Malayalam Sangam MN", "Nirmala UI", "Arial Unicode MS", sans-serif;
          }
          .script-iast {
            font-family: "Noto Serif", "Times New Roman", "Georgia", serif;
            font-variant-ligatures: common-ligatures;
          }
          .word-meaning-source { font-weight: 500; }
          .word-meaning-sep { color: #444; }
          .meta { margin-top: 8px; color: #555; font-size: 12px; }
          .muted { color: #666; }
        </style>
      </head>
      <body>
        ${
          appliedPdfSettings.includeCoverPage
            ? `<section class=\"cover-page\">\n          <h1 class=\"cover-title\">${escapeHtml(artifact.book_name)}</h1>\n          <p class=\"cover-author\">${escapeHtml(coverAuthor)}</p>\n          ${
                coverImageSrc
                  ? `<div class=\"cover-image-wrap\"><img class=\"cover-image\" src=\"${escapeHtml(coverImageSrc)}\" alt=\"Book cover\" /></div>`
                  : ""
              }\n        </section>\n        <div class=\"page-break\"></div>`
            : ""
        }
        ${blocksHtml || '<p class=\"muted\">No items in this section.</p>'}
      </body>
    </html>
  `;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  const requestCookieHeader = request.headers.get("cookie");
  const body = {};
  const pdfSettings = normalizePdfSettings(undefined);
  const selectedTranslationLanguages = normalizeSelectedTranslationLanguages(undefined);
  let activeAccessToken = accessToken;

  const PAGE_LIMIT = 500;

  const doPostPreviewPage = (token: string | undefined, offset: number) =>
    fetch(`${API_BASE_URL}/api/books/${bookId}/preview/render`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...buildAuthHeader(token),
      },
      body: JSON.stringify({ ...body, offset, limit: PAGE_LIMIT }),
      cache: "no-store",
    });

  const fetchAllPreviewPages = async (token: string | undefined): Promise<Response> => {
    const firstResp = await doPostPreviewPage(token, 0);
    if (!firstResp.ok) return firstResp;
    const firstArtifact = (await firstResp.json()) as BookPreviewArtifact;
    if (!firstArtifact.has_more) {
      return new Response(JSON.stringify(firstArtifact), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const allBlocks: BookPreviewBlock[] = [...firstArtifact.sections.body];
    let offset = PAGE_LIMIT;
    const total = firstArtifact.total_blocks ?? 0;
    while (offset < total) {
      const pageResp = await doPostPreviewPage(token, offset);
      if (!pageResp.ok) break;
      const pageArtifact = (await pageResp.json()) as BookPreviewArtifact;
      allBlocks.push(...pageArtifact.sections.body);
      if (!pageArtifact.has_more) break;
      offset += PAGE_LIMIT;
    }
    const merged: BookPreviewArtifact = {
      ...firstArtifact,
      sections: { body: allBlocks },
      has_more: false,
      total_blocks: allBlocks.length,
      offset: 0,
      limit: allBlocks.length,
    };
    return new Response(JSON.stringify(merged), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const doGetPdf = (token?: string) =>
    fetch(`${API_BASE_URL}/api/books/${bookId}/export/pdf`, {
      headers: {
        Accept: "application/pdf",
        ...buildAuthHeader(token),
      },
      cache: "no-store",
    });

  const doGetBook = (token?: string) =>
    fetch(`${API_BASE_URL}/api/content/books/${bookId}`, {
      headers: {
        Accept: "application/json",
        ...buildAuthHeader(token),
      },
      cache: "no-store",
    });

  let fallbackReason: string | null = null;

  // Browser-rendered PDF can produce inconsistent mobile output on some viewers.
  // Prefer backend-generated PDF bytes by default.
  if (ENABLE_BROWSER_RENDERED_PDF) {
    try {
    let previewResponse = await fetchAllPreviewPages(activeAccessToken);
    if (previewResponse.status === 401 && refreshToken) {
      const newTokens = await refreshAccessToken(refreshToken);
      if (newTokens) {
        const { access_token, refresh_token } = newTokens;
        activeAccessToken = access_token;
        store.set(ACCESS_TOKEN_COOKIE, access_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
        });
        store.set(REFRESH_TOKEN_COOKIE, refresh_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
        });
        previewResponse = await fetchAllPreviewPages(activeAccessToken);
      }
    }

    if (previewResponse.ok) {
      const artifact = (await previewResponse.json()) as BookPreviewArtifact;
      let bookPayload: Record<string, unknown> | null = null;
      try {
        const bookResponse = await doGetBook(activeAccessToken);
        if (bookResponse.ok) {
          bookPayload = (await bookResponse.json().catch(() => null)) as Record<string, unknown> | null;
        }
      } catch {
        bookPayload = null;
      }
      const author = pickAuthor(bookPayload);
      const coverImageUrl =
        pickPrimaryCoverImage(artifact.book_media_items || []) ||
        pickCoverImageFromBookPayload(bookPayload);
      const coverImageSrc = coverImageUrl
        ?
            (await fetchImageAsDataUri(
              coverImageUrl,
              request.url,
              activeAccessToken,
              requestCookieHeader
            )) || resolveAbsoluteUrl(normalizeCoverImageUrl(coverImageUrl), request.url)
        : null;
      const html = buildBookPreviewHtml(artifact, selectedTranslationLanguages, {
        author,
        coverImageSrc,
        showPreviewTitles: false,
        showPreviewLabels: false,
        previewTransliterationScript: "iast",
        pdfSettings,
      });
      let browser: BrowserLaunchResult["browser"];
      let browserEngine = "unknown";
      try {
        const launched = await launchPdfBrowser();
        browser = launched.browser;
        browserEngine = launched.engine;
      } catch (error) {
        fallbackReason = buildFallbackReason("playwright_launch_failed", error);
        throw error;
      }
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });
        const pdfBuffer = await page.pdf({
          format: pdfSettings.pageSize,
          landscape: pdfSettings.landscape,
          printBackground: true,
          ...(pdfSettings.pageRanges ? { pageRanges: pdfSettings.pageRanges } : {}),
        });
        const pdfBytes = new Uint8Array(pdfBuffer);
        const safeBookName = (artifact.book_name || `book-${bookId}`)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        const fileName = `${safeBookName || `book-${bookId}`}.pdf`;

        return new NextResponse(new Uint8Array(pdfBytes), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename=\"${fileName}\"`,
            "Cache-Control": "no-store",
            "X-PDF-Renderer": "browser",
            "X-PDF-Browser-Engine": browserEngine,
          },
        });
      } catch (error) {
        fallbackReason = buildFallbackReason("playwright_render_failed", error);
        throw error;
      } finally {
        await browser.close();
      }
    } else {
      fallbackReason = `preview_status_${previewResponse.status}`;
    }
    } catch (error) {
      if (!fallbackReason) {
        fallbackReason = buildFallbackReason("browser_render_failed", error);
      }
      // Fall through to backend PDF fallback.
    }
  }

  let response: Response;
  try {
    response = await doGetPdf(activeAccessToken);
  } catch {
    return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
  }

  if (response.status === 401 && refreshToken) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      const { access_token, refresh_token } = newTokens;
      store.set(ACCESS_TOKEN_COOKIE, access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      store.set(REFRESH_TOKEN_COOKIE, refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });

      try {
        response = await doGetPdf(access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
      }
    }
  }

  if (!response.ok) {
    const payload = await tryReadErrorPayload(response);
    return NextResponse.json(payload || { detail: "Failed to export book PDF" }, { status: response.status });
  }

  const pdfBytes = new Uint8Array(await response.arrayBuffer());
  const disposition = response.headers.get("Content-Disposition") || `attachment; filename="book-${bookId}.pdf"`;
  const backendFontDiagnostics = response.headers.get("X-Backend-PDF-Fonts");

  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
      "X-PDF-Renderer": "backend",
      ...(fallbackReason ? { "X-PDF-Fallback-Reason": fallbackReason } : {}),
      ...(backendFontDiagnostics ? { "X-Backend-PDF-Fonts": backendFontDiagnostics } : {}),
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  const requestCookieHeader = request.headers.get("cookie");
  const body = await request.json().catch(() => ({}));
  const pdfSettings = normalizePdfSettings((body as { pdf_settings?: unknown }).pdf_settings);
  const selectedTranslationLanguages = normalizeSelectedTranslationLanguages(
    (body as { selected_translation_languages?: unknown }).selected_translation_languages
  );
  let activeAccessToken = accessToken;

  const doPostPdf = (token?: string) =>
    fetch(`${API_BASE_URL}/api/books/${bookId}/export/pdf`, {
      method: "POST",
      headers: {
        Accept: "application/pdf",
        "Content-Type": "application/json",
        ...buildAuthHeader(token),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

  const PAGE_LIMIT_POST = 500;

  const doPostPreviewPage = (token: string | undefined, offset: number) =>
    fetch(`${API_BASE_URL}/api/books/${bookId}/preview/render`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...buildAuthHeader(token),
      },
      body: JSON.stringify({ ...body, offset, limit: PAGE_LIMIT_POST }),
      cache: "no-store",
    });

  const fetchAllPreviewPagesPost = async (token: string | undefined): Promise<Response> => {
    const firstResp = await doPostPreviewPage(token, 0);
    if (!firstResp.ok) return firstResp;
    const firstArtifact = (await firstResp.json()) as BookPreviewArtifact;
    if (!firstArtifact.has_more) {
      return new Response(JSON.stringify(firstArtifact), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const allBlocks: BookPreviewBlock[] = [...firstArtifact.sections.body];
    let offset = PAGE_LIMIT_POST;
    const total = firstArtifact.total_blocks ?? 0;
    while (offset < total) {
      const pageResp = await doPostPreviewPage(token, offset);
      if (!pageResp.ok) break;
      const pageArtifact = (await pageResp.json()) as BookPreviewArtifact;
      allBlocks.push(...pageArtifact.sections.body);
      if (!pageArtifact.has_more) break;
      offset += PAGE_LIMIT_POST;
    }
    const merged: BookPreviewArtifact = {
      ...firstArtifact,
      sections: { body: allBlocks },
      has_more: false,
      total_blocks: allBlocks.length,
      offset: 0,
      limit: allBlocks.length,
    };
    return new Response(JSON.stringify(merged), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const doGetBook = (token?: string) =>
    fetch(`${API_BASE_URL}/api/content/books/${bookId}`, {
      headers: {
        Accept: "application/json",
        ...buildAuthHeader(token),
      },
      cache: "no-store",
    });

  let fallbackReason: string | null = null;

  // Browser-rendered PDF can produce inconsistent mobile output on some viewers.
  // Prefer backend-generated PDF bytes by default.
  if (ENABLE_BROWSER_RENDERED_PDF) {
    try {
    let previewResponse = await fetchAllPreviewPagesPost(activeAccessToken);
    if (previewResponse.status === 401 && refreshToken) {
      const newTokens = await refreshAccessToken(refreshToken);
      if (newTokens) {
        const { access_token, refresh_token } = newTokens;
        activeAccessToken = access_token;
        store.set(ACCESS_TOKEN_COOKIE, access_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
        });
        store.set(REFRESH_TOKEN_COOKIE, refresh_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
        });
        previewResponse = await fetchAllPreviewPagesPost(activeAccessToken);
      }
    }

    if (previewResponse.ok) {
      const artifact = (await previewResponse.json()) as BookPreviewArtifact;
      let bookPayload: Record<string, unknown> | null = null;
      try {
        const bookResponse = await doGetBook(activeAccessToken);
        if (bookResponse.ok) {
          bookPayload = (await bookResponse.json().catch(() => null)) as Record<string, unknown> | null;
        }
      } catch {
        bookPayload = null;
      }
      const author = pickAuthor(bookPayload);
      const coverImageUrl =
        pickPrimaryCoverImage(artifact.book_media_items || []) ||
        pickCoverImageFromBookPayload(bookPayload);
      const coverImageSrc = coverImageUrl
        ?
            (await fetchImageAsDataUri(
              coverImageUrl,
              request.url,
              activeAccessToken,
              requestCookieHeader
            )) || resolveAbsoluteUrl(normalizeCoverImageUrl(coverImageUrl), request.url)
        : null;
      const rawDisplayMode = (body as { preview_word_meanings_display_mode?: string }).preview_word_meanings_display_mode;
      const wordMeaningsDisplayMode: "inline" | "table" | "hide" =
        rawDisplayMode === "table" || rawDisplayMode === "hide" ? rawDisplayMode : "inline";
      const html = buildBookPreviewHtml(artifact, selectedTranslationLanguages, {
        author,
        coverImageSrc,
        showPreviewTitles: (body as { preview_show_titles?: boolean }).preview_show_titles === true,
        showPreviewLabels: (body as { preview_show_labels?: boolean }).preview_show_labels === true,
        previewTransliterationScript:
          (body as { preview_transliteration_script?: string }).preview_transliteration_script || "iast",
        wordMeaningsDisplayMode,
        pdfSettings,
      });
      let browser: BrowserLaunchResult["browser"];
      let browserEngine = "unknown";
      try {
        const launched = await launchPdfBrowser();
        browser = launched.browser;
        browserEngine = launched.engine;
      } catch (error) {
        fallbackReason = buildFallbackReason("playwright_launch_failed", error);
        throw error;
      }
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });
        const pdfBuffer = await page.pdf({
          format: pdfSettings.pageSize,
          landscape: pdfSettings.landscape,
          printBackground: true,
          ...(pdfSettings.pageRanges ? { pageRanges: pdfSettings.pageRanges } : {}),
        });
        const pdfBytes = new Uint8Array(pdfBuffer);
        const safeBookName = (artifact.book_name || `book-${bookId}`)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        const fileName = `${safeBookName || `book-${bookId}`}.pdf`;

        return new NextResponse(new Uint8Array(pdfBytes), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename=\"${fileName}\"`,
            "Cache-Control": "no-store",
            "X-PDF-Renderer": "browser",
            "X-PDF-Browser-Engine": browserEngine,
          },
        });
      } catch (error) {
        fallbackReason = buildFallbackReason("playwright_render_failed", error);
        throw error;
      } finally {
        await browser.close();
      }
    } else {
      fallbackReason = `preview_status_${previewResponse.status}`;
    }
    } catch (error) {
      if (!fallbackReason) {
        fallbackReason = buildFallbackReason("browser_render_failed", error);
      }
      // Fall through to backend PDF fallback.
    }
  }

  let response: Response;
  try {
    response = await doPostPdf(activeAccessToken);
  } catch {
    return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
  }

  if (response.status === 401 && refreshToken) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      const { access_token, refresh_token } = newTokens;
      store.set(ACCESS_TOKEN_COOKIE, access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      store.set(REFRESH_TOKEN_COOKIE, refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });

      try {
        response = await doPostPdf(access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
      }
    }
  }

  if (!response.ok) {
    const payload = await tryReadErrorPayload(response);
    return NextResponse.json(payload || { detail: "Failed to export book PDF" }, { status: response.status });
  }

  const pdfBytes = new Uint8Array(await response.arrayBuffer());
  const disposition = response.headers.get("Content-Disposition") || `attachment; filename="book-${bookId}.pdf"`;
  const backendFontDiagnostics = response.headers.get("X-Backend-PDF-Fonts");

  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
      "X-PDF-Renderer": "backend",
      ...(fallbackReason ? { "X-PDF-Fallback-Reason": fallbackReason } : {}),
      ...(backendFontDiagnostics ? { "X-Backend-PDF-Fonts": backendFontDiagnostics } : {}),
    },
  });
}
