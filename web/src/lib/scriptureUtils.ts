import type { TreeNode } from "./scriptureTypes";

export const formatValue = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return value.toString();
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return "";
};

export const normalizeErrorValue = (value: unknown): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value.map((entry) => normalizeErrorValue(entry)).filter(Boolean);
    return parts.join("; ");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.msg === "string" && record.msg.trim()) {
      return record.msg.trim();
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
    if ("detail" in record) {
      const nested = normalizeErrorValue(record.detail);
      if (nested) return nested;
    }
    return formatValue(value);
  }
  return "";
};

export const getErrorMessageFromPayload = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = normalizeErrorValue((payload as { detail?: unknown }).detail);
    if (detail) return detail;
  }
  const generic = normalizeErrorValue(payload);
  return generic || fallback;
};

export const parseSequenceNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = value.toString().match(/(\d+)(?!.*\d)/);
  return match ? parseInt(match[1], 10) : null;
};

export const getSequenceSortValue = (node: TreeNode) => {
  const direct = parseSequenceNumber(node.sequence_number);
  if (direct !== null) return direct;
  const titleCandidate =
    node.title_english || node.title_sanskrit || node.title_transliteration;
  const titleSeq = titleCandidate ? parseSequenceNumber(titleCandidate) : null;
  if (titleSeq !== null) return titleSeq;
  return node.id;
};

export const formatSequenceDisplay = (value: unknown, isLeaf: boolean) => {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const dottedMatch = raw.match(/\d+(?:\.\d+)*/);
  if (dottedMatch) return dottedMatch[0];
  const parsed = parseSequenceNumber(raw);
  if (parsed === null) return "";
  if (!isLeaf) return parsed.toString();
  return parsed.toString();
};

export const LOCAL_SCRIPTURES_PREFERENCES_KEY = "scriptures_preferences";
export const ACTIVE_IMPORT_JOB_STORAGE_KEY = "scriptures_active_import_job";
export const SCRIPTURES_BOOK_BROWSER_VIEW_KEY = "scriptures_book_browser_view";
export const SCRIPTURES_BOOK_BROWSER_DENSITY_KEY = "scriptures_book_browser_density";
export const SCRIPTURES_MEDIA_MANAGER_VIEW_KEY = "scriptures_media_manager_view";
export const SCRIPTURES_MEDIA_MANAGER_DENSITY_KEY = "scriptures_media_manager_density";
export const SCRIPTURES_MEDIA_MANAGER_DENSITY_NODE_KEY = "scriptures_media_manager_density_node";
export const SCRIPTURES_MEDIA_MANAGER_DENSITY_BOOK_KEY = "scriptures_media_manager_density_book";
export const SCRIPTURES_MEDIA_MANAGER_DENSITY_BANK_KEY = "scriptures_media_manager_density_bank";
export const ANONYMOUS_BOOK_NOT_FOUND_MESSAGE = "Book not found. Sign in and try again.";
export const BOOK_PREVIEW_PAGE_SIZE = 500;
export const BOOK_PREVIEW_LOAD_MORE_THRESHOLD_PX = 240;
export const NODE_CONTENT_CACHE_TTL_MS = 60_000;
export const NODE_CONTENT_CACHE_MAX_ENTRIES = 250;
export const BOOK_PREVIEW_CACHE_TTL_MS = 120_000;
export const BOOK_PREVIEW_CACHE_MAX_ENTRIES = 120;
export const DEFAULT_CONTENT_FIELD_LABELS = {
  sanskrit: "Sanskrit",
  transliteration: "Transliteration",
  english: "English",
} as const;
