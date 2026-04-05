"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Download,
  Eye,
  LayoutGrid,
  List,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  ShoppingBasket,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { contentPath } from "../../lib/apiPaths";
import BasketPanel from "../../components/BasketPanel";
import BookThumbnailSection from "./components/BookThumbnailSection";
import ExternalMediaFormModal from "../../components/ExternalMediaFormModal";
import InlineClearButton from "../../components/InlineClearButton";
import NodeLevelTemplateSection from "./components/NodeLevelTemplateSection";
import PropertiesPanel from "./components/PropertiesPanel";
import WordMeaningsEditor from "../../components/WordMeaningsEditor";
import { getMe, invalidateMeCache } from "../../lib/authClient";
import UserPreferencesDialog, {
  type UserPreferences,
} from "../../components/UserPreferencesDialog";
import {
  hasDevanagariLetters,
  TRANSLITERATION_SCRIPT_OPTIONS,
  isRomanScript,
  normalizeTransliterationScript,
  transliterateLatinToDevanagari,
  transliterateLatinToIast,
  transliterateFromDevanagari,
  transliterateFromIast,
  type TransliterationScriptOption,
  transliterationScriptLabel,
} from "../../lib/indicScript";
import {
  applyUiPreferencesToDocument,
  normalizeUiDensity,
  normalizeUiTheme,
  persistUiPreferences,
  readStoredUiPreferences,
} from "../../lib/uiPreferences";
import {
  inferDisplayNameFromUrl,
  inferMediaTypeFromUrl,
  type ExternalMediaType,
} from "../../lib/externalMedia";
import {
  createMediaBankLinkAsset as createMediaBankLinkAssetRequest,
  deleteMediaBankAsset,
  listMediaBankAssets,
  MediaBankClientError,
  replaceMediaBankAssetFile,
  renameMediaBankAsset,
  uploadMediaBankAsset,
} from "../../lib/mediaBankClient";
import { resolveMediaUrl } from "../../lib/mediaUrl";
type CanonicalUploadComplete = {
  upload_id?: string;
  canonical_json_url?: string;
  size_bytes?: number;
  detail?: string;
  error?: string;
};

type ImportJobLifecycleStatus = "queued" | "running" | "succeeded" | "failed";

type PersistedImportJobState = {
  jobId: string;
  status?: ImportJobLifecycleStatus;
  progressMessage?: string | null;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  canonicalJsonUrl?: string | null;
};

type MediaFile = {
  id: number;
  node_id: number;
  media_type: "image" | "audio" | "video" | string;
  url: string;
  metadata?: {
    content_type?: string;
    original_filename?: string;
    display_name?: string;
    asset_id?: number | string;
    asset_display_name?: string;
    size_bytes?: number;
    display_order?: number;
    is_default?: boolean;
    [key: string]: unknown;
  } | null;
  metadata_json?: {
    content_type?: string;
    original_filename?: string;
    display_name?: string;
    asset_id?: number | string;
    asset_display_name?: string;
    size_bytes?: number;
    display_order?: number;
    is_default?: boolean;
    [key: string]: unknown;
  } | null;
  created_at?: string | null;
};

type MediaAsset = {
  id: number;
  media_type: "image" | "audio" | "video" | string;
  url: string;
  metadata?: {
    content_type?: string;
    original_filename?: string;
    display_name?: string;
    size_bytes?: number;
    [key: string]: unknown;
  } | null;
  created_by?: number | null;
  created_at?: string | null;
};

type MediaLinkContext = "bank" | "node" | "book";

type BookMediaItem = {
  media_type: "image" | "audio" | "video" | "link" | string;
  url: string;
  display_name?: string;
  content_type?: string;
  asset_id?: number | string;
  is_default?: boolean;
  display_order?: number | string;
};

type SharePermission = "viewer" | "contributor" | "editor";

type BookMetadata = Record<string, unknown> & {
  owner_id?: number | string | null;
  visibility?: "private" | "public" | string;
};

type BookSchema = {
  id: number;
  name?: string;
  levels: string[];
  level_template_defaults?: Record<string, number | string | null>;
};

type BookOption = {
  id: number;
  book_name: string;
  status?: string;
  visibility?: "private" | "public" | string;
  metadata?: BookMetadata | null;
  metadata_json?: BookMetadata | null;
  schema?: BookSchema | null;
  variant_authors?: Record<string, string>;
  level_name_overrides?: Record<string, string> | null;
};

type BookDetails = BookOption & {
  schema: BookSchema;
};

type SchemaOption = {
  id: number;
  name: string;
  description?: string | null;
  levels: string[];
};

type BookShare = {
  id: number;
  shared_with_user_id: number;
  shared_with_email: string;
  shared_with_username?: string | null;
  permission: SharePermission;
};

type ImportResult = {
  success?: boolean;
  book_id?: number;
  nodes_created?: number;
  detail?: string;
  error?: string;
};

type ImportJobStatus = {
  job_id?: string;
  status?: ImportJobLifecycleStatus;
  progress_message?: string | null;
  progress_current?: number | null;
  progress_total?: number | null;
  detail?: string;
  error?: string;
  result?: ImportResult | null;
};

type CanonicalUploadInit = {
  upload_id?: string;
  chunk_size_bytes?: number;
  max_size_bytes?: number;
  detail?: string;
  error?: string;
};

type CanonicalUploadChunk = {
  upload_id?: string;
  received_bytes?: number;
  next_index?: number;
  detail?: string;
  error?: string;
};

type ImportJobStart = {
  job_id?: string;
  status?: ImportJobLifecycleStatus;
  detail?: string;
  error?: string;
};

type CommentaryEntry = {
  id: number;
  node_id: number;
  author_id?: number | null;
  work_id?: number | null;
  content_text: string;
  language_code: string;
  display_order: number;
  metadata?: {
    [key: string]: unknown;
  } | null;
  created_at?: string | null;
};

type CommentaryDisplayItem = {
  id: number | string;
  author: string;
  text: string;
};

type AuthorVariantDraft = {
  author_slug: string;
  author: string;
  language: string;
  field: string;
  text: string;
};

type NodeComment = {
  id: number;
  node_id: number;
  parent_comment_id?: number | null;
  content_text: string;
  language_code: string;
  metadata?: {
    [key: string]: unknown;
  } | null;
  created_by?: number | null;
  created_at?: string | null;
};

type BookPreviewBlock = {
  section: "body";
  order: number;
  block_type: string;
  template_key: string;
  source_node_id: number | null;
  source_book_id: number | null;
  title: string;
  content: {
    level_name?: string;
    sequence_number?: string | number | null;
    sanskrit?: string;
    transliteration?: string;
    english?: string;
    translations?: Record<string, string>;
    translation_variants?: Array<{
      author_slug?: string;
      author?: string;
      language?: string;
      field?: string;
      text?: string;
    }>;
    commentary_variants?: Array<{
      author_slug?: string;
      author?: string;
      language?: string;
      field?: string;
      text?: string;
    }>;
    text?: string;
    rendered_lines?: Array<{
      field?: string;
      label?: string;
      value?: string;
    }>;
    word_meanings_rows?: Array<{
      id?: string;
      order?: number;
      source?: {
        language?: string | null;
      };
      resolved_source?: {
        text?: string;
        mode?: string | null;
        scheme?: string | null;
        generated?: boolean;
      };
      resolved_meaning?: {
        language?: string | null;
        text?: string;
        fallback_used?: boolean;
        fallback_badge_visible?: boolean;
      };
    }>;
    media_items?: Array<{
      id?: number | null;
      media_type?: string;
      url?: string;
      metadata?: Record<string, unknown>;
    }>;
  };
};

type BookPreviewRenderSettings = {
  show_sanskrit: boolean;
  show_transliteration: boolean;
  show_english: boolean;
  show_metadata: boolean;
  show_media: boolean;
  text_order: Array<"sanskrit" | "transliteration" | "english" | "text">;
};

type BookPreviewLanguageSettings = {
  show_sanskrit: boolean;
  show_transliteration: boolean;
  show_english: boolean;
  show_commentary: boolean;
};

type BookPreviewArtifact = {
  book_id: number;
  book_name: string;
  preview_scope?: "book" | "node";
  root_node_id?: number | null;
  root_title?: string | null;
  reader_hierarchy_path?: string | null;
  section_order: Array<"body">;
  sections: {
    body: BookPreviewBlock[];
  };
  book_media_items?: BookMediaItem[];
  book_template?: {
    template_key: string;
    resolved_template_source: string;
    rendered_text: string;
    child_count: number;
  };
  render_settings: BookPreviewRenderSettings;
  warnings?: string[];
  offset?: number;
  limit?: number;
  total_blocks?: number;
  has_more?: boolean;
};

type BasketItem = {
  cart_item_id?: number;
  node_id: number;
  title?: string;
  order: number;
  book_name?: string;
  level_name?: string;
};

type MetadataCategory = {
  id: number;
  name: string;
  description?: string | null;
  applicable_scopes: string[];
  is_deprecated: boolean;
};

type EffectivePropertyBinding = {
  property_internal_name: string;
  property_display_name: string;
  property_data_type: "text" | "boolean" | "number" | "dropdown" | "date" | "datetime";
  description?: string | null;
  default_value?: unknown;
  is_required?: boolean;
  dropdown_options?: string[] | null;
};


type CategoryEffectiveProperties = {
  category_id: number;
  category_name: string;
  properties: EffectivePropertyBinding[];
};

type ResolvedPropertyValue = {
  property_internal_name: string;
  property_data_type: string;
  value: unknown;
};

type ResolvedMetadata = {
  category_id: number | null;
  property_overrides: Record<string, unknown>;
  properties: ResolvedPropertyValue[];
};

type PropertiesScope = "book" | "node";

type TreeNode = {
  id: number;
  parent_node_id?: number | null;
  level_name: string;
  level_order?: number | null;
  sequence_number?: number | string | null;
  title_english?: string | null;
  title_hindi?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  has_content?: boolean | null;
  children?: TreeNode[];
};

type NodeContent = {
  id: number;
  parent_node_id?: number | null;
  level_name: string;
  level_order?: number | null;
  sequence_number?: number | string | null;
  title_english?: string | null;
  title_hindi?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  has_content?: boolean | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  metadata_json?: Record<string, unknown> | null;
  content_data?: {
    basic?: {
      sanskrit?: string | null;
      transliteration?: string | null;
      translation?: string | null;
      [key: string]: unknown;
    } | null;
    translations?: Record<string, string> | null;
    word_meanings?: {
      version?: string;
      rows?: Array<{
        id?: string;
        order?: number;
        source?: {
          language?: string;
          script_text?: string;
          transliteration?: {
            iast?: string;
            [key: string]: string | undefined;
          };
        };
        meanings?: Record<string, { text?: string }>;
      }>;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

type LevelTemplateOption = {
  id: number;
  name: string;
  target_schema_id?: number | null;
  target_level?: string | null;
  visibility: "private" | "published";
  is_system?: boolean;
  system_key?: string | null;
  current_version: number;
  is_active: boolean;
};

type LevelTemplateAssignment = {
  id: number;
  entity_type: string;
  entity_id: number;
  level_key: string;
  template_id: number;
  is_active: boolean;
};

const formatValue = (value: unknown) => {
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

const normalizeErrorValue = (value: unknown): string => {
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

const getErrorMessageFromPayload = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = normalizeErrorValue((payload as { detail?: unknown }).detail);
    if (detail) return detail;
  }
  const generic = normalizeErrorValue(payload);
  return generic || fallback;
};

const parseSequenceNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = value.toString().match(/(\d+)(?!.*\d)/);
  return match ? parseInt(match[1], 10) : null;
};

const getSequenceSortValue = (node: TreeNode) => {
  const direct = parseSequenceNumber(node.sequence_number);
  if (direct !== null) return direct;
  const titleCandidate =
    node.title_english || node.title_sanskrit || node.title_transliteration;
  const titleSeq = titleCandidate ? parseSequenceNumber(titleCandidate) : null;
  if (titleSeq !== null) return titleSeq;
  return node.id;
};

const formatSequenceDisplay = (value: unknown, isLeaf: boolean) => {
  const parsed = parseSequenceNumber(value);
  if (parsed === null) return "";
  if (!isLeaf) return parsed.toString();
  return parsed.toString();
};

const LOCAL_SCRIPTURES_PREFERENCES_KEY = "scriptures_preferences";
const ACTIVE_IMPORT_JOB_STORAGE_KEY = "scriptures_active_import_job";
const SCRIPTURES_BOOK_BROWSER_VIEW_KEY = "scriptures_book_browser_view";
const SCRIPTURES_BOOK_BROWSER_DENSITY_KEY = "scriptures_book_browser_density";
const SCRIPTURES_MEDIA_MANAGER_VIEW_KEY = "scriptures_media_manager_view";
const SCRIPTURES_MEDIA_MANAGER_DENSITY_KEY = "scriptures_media_manager_density";
const SCRIPTURES_MEDIA_MANAGER_DENSITY_NODE_KEY = "scriptures_media_manager_density_node";
const SCRIPTURES_MEDIA_MANAGER_DENSITY_BOOK_KEY = "scriptures_media_manager_density_book";
const SCRIPTURES_MEDIA_MANAGER_DENSITY_BANK_KEY = "scriptures_media_manager_density_bank";
const ANONYMOUS_BOOK_NOT_FOUND_MESSAGE = "Book not found. Sign in and try again.";
const BOOK_PREVIEW_PAGE_SIZE = 500;
const BOOK_PREVIEW_LOAD_MORE_THRESHOLD_PX = 240;
const DEFAULT_CONTENT_FIELD_LABELS = {
  sanskrit: "Sanskrit",
  transliteration: "Transliteration",
  english: "English",
} as const;

const readPersistedImportJobState = (): PersistedImportJobState | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(ACTIVE_IMPORT_JOB_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PersistedImportJobState | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.jobId !== "string" || !parsed.jobId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writePersistedImportJobState = (state: PersistedImportJobState) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ACTIVE_IMPORT_JOB_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures
  }
};

const clearPersistedImportJobState = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(ACTIVE_IMPORT_JOB_STORAGE_KEY);
  } catch {
    // Ignore storage failures
  }
};

type LayoutDeviceBucket = "phone" | "tablet" | "desktop";

const getLayoutDeviceBucket = (): LayoutDeviceBucket => {
  if (typeof window === "undefined") {
    return "desktop";
  }
  const width = window.innerWidth;
  if (width < 768) {
    return "phone";
  }
  if (width < 1024) {
    return "tablet";
  }
  return "desktop";
};

const getDeviceScopedStorageKey = (baseKey: string): string =>
  `${baseKey}_${getLayoutDeviceBucket()}`;

const readStoredBrowserView = (storageKey: string): "list" | "icon" => {
  if (typeof window === "undefined") {
    return "list";
  }
  const scopedValue = window.localStorage.getItem(getDeviceScopedStorageKey(storageKey));
  if (scopedValue !== null) {
    return scopedValue === "icon" ? "icon" : "list";
  }
  return window.localStorage.getItem(storageKey) === "icon" ? "icon" : "list";
};

const normalizeBookBrowserDensity = (value: unknown): 0 | 1 | 2 | 3 | 4 | 5 => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.min(5, Math.max(0, Math.round(value)));
    return normalized as 0 | 1 | 2 | 3 | 4 | 5;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      const normalized = Math.min(5, Math.max(0, Math.round(parsed)));
      return normalized as 0 | 1 | 2 | 3 | 4 | 5;
    }
  }
  return 0;
};

const readStoredBookBrowserDensity = (): 0 | 1 | 2 | 3 | 4 | 5 => {
  if (typeof window === "undefined") {
    return 0;
  }
  const scopedValue = window.localStorage.getItem(
    getDeviceScopedStorageKey(SCRIPTURES_BOOK_BROWSER_DENSITY_KEY)
  );
  if (scopedValue !== null) {
    return normalizeBookBrowserDensity(scopedValue);
  }
  return normalizeBookBrowserDensity(window.localStorage.getItem(SCRIPTURES_BOOK_BROWSER_DENSITY_KEY));
};

const mediaManagerDensityStorageKey = (scope: "node" | "book" | "bank"): string => {
  if (scope === "book") return SCRIPTURES_MEDIA_MANAGER_DENSITY_BOOK_KEY;
  if (scope === "bank") return SCRIPTURES_MEDIA_MANAGER_DENSITY_BANK_KEY;
  return SCRIPTURES_MEDIA_MANAGER_DENSITY_NODE_KEY;
};

const readStoredMediaManagerDensity = (scope: "node" | "book" | "bank"): 0 | 1 | 2 | 3 | 4 | 5 => {
  if (typeof window === "undefined") {
    return 0;
  }
  const scopedValue = window.localStorage.getItem(
    getDeviceScopedStorageKey(mediaManagerDensityStorageKey(scope))
  );
  if (scopedValue !== null) {
    return normalizeBookBrowserDensity(scopedValue);
  }
  const legacyScopedValue = window.localStorage.getItem(mediaManagerDensityStorageKey(scope));
  if (legacyScopedValue !== null) {
    return normalizeBookBrowserDensity(legacyScopedValue);
  }
  return normalizeBookBrowserDensity(window.localStorage.getItem(SCRIPTURES_MEDIA_MANAGER_DENSITY_KEY));
};

const resolveBookBrowserDensity = (
  storedDensity: unknown,
  preferenceDensity: unknown,
  preferenceView: "list" | "icon"
): 0 | 1 | 2 | 3 | 4 | 5 => {
  const normalizedStoredDensity = normalizeBookBrowserDensity(storedDensity);
  if (normalizedStoredDensity !== 0) {
    return normalizedStoredDensity;
  }
  const normalizedPreferenceDensity = normalizeBookBrowserDensity(preferenceDensity);
  if (preferenceView === "icon" && normalizedPreferenceDensity === 0) {
    return 3;
  }
  return normalizedPreferenceDensity;
};

const normalizeBrowserView = (value: unknown): "list" | "icon" =>
  value === "icon" ? "icon" : "list";

const WORD_MEANINGS_VERSION = "1.0";
const BOOK_ROOT_NODE_ID = 0;
const WORD_MEANINGS_REQUIRED_LANGUAGE = "en";
const WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES = ["sa", "pi", "hi", "ta"] as const;
const WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES = ["en", "hi", "ta", "te", "kn", "ml"] as const;
const WORD_MEANINGS_MAX_ROWS = 400;
const WORD_MEANINGS_MAX_SOURCE_CHARS = 120;
const WORD_MEANINGS_MAX_MEANING_CHARS = 400;
const WORD_MEANINGS_HTML_TAG_PATTERN = /<[^>]+>/;

type WordMeaningPayloadRow = {
  id: string;
  order: number;
  source: {
    language: string;
    script_text?: string;
    transliteration?: Record<string, string>;
  };
  meanings: Record<string, { text: string }>;
};

type WordMeaningRow = {
  id: string;
  order: number;
  sourceLanguage: string;
  sourceScriptText: string;
  sourceTransliterationIast: string;
  meanings: Record<string, string>;
  activeMeaningLanguage: string;
};

const validateWordMeaningsPlainText = (value: unknown, path: string, maxChars: number): string[] => {
  if (typeof value !== "string") {
    return [`${path} must be a string`];
  }
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    return [`${path} exceeds max length of ${maxChars}`];
  }
  if (WORD_MEANINGS_HTML_TAG_PATTERN.test(trimmed)) {
    return [`${path} must not contain HTML`];
  }
  return [];
};

const mapWordMeaningRowsForPayload = (rows: WordMeaningRow[]): WordMeaningPayloadRow[] =>
  rows
    .map((row, index) => {
      const sourcePair = autoFillSanskritTransliterationPair(
        row.sourceScriptText,
        row.sourceTransliterationIast
      );

      return {
        id: row.id.trim() || `wm_row_${index + 1}`,
        order: Number.isFinite(row.order) && row.order >= 1 ? row.order : index + 1,
        sourceLanguage: row.sourceLanguage.trim() || "sa",
        sourceScriptText: sourcePair.sanskrit,
        sourceTransliterationIast: sourcePair.transliteration,
        meanings: Object.entries(row.meanings)
          .map(([language, text]) => [language.trim(), text.trim()] as const)
          .filter(([language, text]) => language && text)
          .reduce<Record<string, string>>((acc, [language, text]) => {
            acc[language] = text;
            return acc;
          }, {}),
      };
    })
    .filter(
      (row) =>
        row.sourceScriptText ||
        row.sourceTransliterationIast ||
        Object.values(row.meanings).some((text) => Boolean(text))
    )
    .map((row) => ({
      id: row.id,
      order: row.order,
      source: {
        language: row.sourceLanguage,
        script_text: row.sourceScriptText || undefined,
        transliteration: row.sourceTransliterationIast
          ? { iast: row.sourceTransliterationIast }
          : undefined,
      },
      meanings: Object.entries(row.meanings).reduce<Record<string, { text: string }>>(
        (acc, [language, text]) => {
          acc[language] = { text };
          return acc;
        },
        {}
      ),
    }));

const validateWordMeaningPayloadRows = (rows: WordMeaningPayloadRow[]): string[] => {
  const errors: string[] = [];

  if (rows.length > WORD_MEANINGS_MAX_ROWS) {
    errors.push(`content_data.word_meanings.rows exceeds max size of ${WORD_MEANINGS_MAX_ROWS}`);
  }

  const seenIds = new Set<string>();
  rows.forEach((row, index) => {
    const rowPath = `content_data.word_meanings.rows[${index}]`;

    if (!row.id.trim()) {
      errors.push(`${rowPath}.id is required`);
    }

    const normalizedRowId = row.id.trim();
    if (normalizedRowId) {
      if (seenIds.has(normalizedRowId)) {
        errors.push(`${rowPath}.id must be unique`);
      }
      seenIds.add(normalizedRowId);
    }

    if (!Number.isInteger(row.order) || row.order < 1) {
      errors.push(`${rowPath}.order must be an integer >= 1`);
    }

    if (!WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES.includes(row.source.language as (typeof WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES)[number])) {
      errors.push(
        `${rowPath}.source.language must be one of ${JSON.stringify([...WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES].sort())}`
      );
    }

    let hasSourceForm = false;

    if (row.source.script_text !== undefined) {
      const sourceTextErrors = validateWordMeaningsPlainText(
        row.source.script_text,
        `${rowPath}.source.script_text`,
        WORD_MEANINGS_MAX_SOURCE_CHARS
      );
      errors.push(...sourceTextErrors);
      if (typeof row.source.script_text === "string" && row.source.script_text.trim()) {
        hasSourceForm = true;
      }
    }

    if (row.source.transliteration !== undefined) {
      Object.entries(row.source.transliteration).forEach(([scheme, value]) => {
        if (!scheme.trim()) {
          errors.push(`${rowPath}.source.transliteration keys must be non-empty strings`);
          return;
        }
        const transliterationErrors = validateWordMeaningsPlainText(
          value,
          `${rowPath}.source.transliteration.${scheme}`,
          WORD_MEANINGS_MAX_SOURCE_CHARS
        );
        errors.push(...transliterationErrors);
        if (typeof value === "string" && value.trim()) {
          hasSourceForm = true;
        }
      });
    }

    if (!hasSourceForm) {
      errors.push(
        `${rowPath}.source requires at least one non-empty form in script_text or transliteration`
      );
    }

    const meaningEntries = Object.entries(row.meanings);
    if (meaningEntries.length === 0) {
      errors.push(`${rowPath}.meanings must be a non-empty object`);
    }

    let nonEmptyMeanings = 0;
    meaningEntries.forEach(([languageCode, payload]) => {
      if (!languageCode.trim()) {
        errors.push(`${rowPath}.meanings contains an invalid language key`);
        return;
      }

      const meaningTextErrors = validateWordMeaningsPlainText(
        payload?.text,
        `${rowPath}.meanings.${languageCode}.text`,
        WORD_MEANINGS_MAX_MEANING_CHARS
      );
      errors.push(...meaningTextErrors);
      if (typeof payload?.text === "string" && payload.text.trim()) {
        nonEmptyMeanings += 1;
      }
    });

    if (nonEmptyMeanings === 0) {
      errors.push(`${rowPath}.meanings requires at least one non-empty text value`);
    }

    const requiredPayload = row.meanings[WORD_MEANINGS_REQUIRED_LANGUAGE];
    if (!requiredPayload) {
      errors.push(`${rowPath}.meanings.${WORD_MEANINGS_REQUIRED_LANGUAGE}.text is required`);
    } else {
      const requiredTextErrors = validateWordMeaningsPlainText(
        requiredPayload.text,
        `${rowPath}.meanings.${WORD_MEANINGS_REQUIRED_LANGUAGE}.text`,
        WORD_MEANINGS_MAX_MEANING_CHARS
      );
      errors.push(...requiredTextErrors);
      if (!requiredPayload.text.trim()) {
        errors.push(`${rowPath}.meanings.${WORD_MEANINGS_REQUIRED_LANGUAGE}.text is required`);
      }
    }
  });

  return [...new Set(errors)];
};

const createWordMeaningRowId = () => `wm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const createEmptyWordMeaningRow = (order: number): WordMeaningRow => ({
  id: createWordMeaningRowId(),
  order,
  sourceLanguage: "sa",
  sourceScriptText: "",
  sourceTransliterationIast: "",
  meanings: {
    en: "",
  },
  activeMeaningLanguage: "en",
});

const splitLegacyWordMeaningEntries = (value: unknown): string[] => {
  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.includes(";")) {
    return trimmed
      .split(";")
      .map((entry) => entry.trim().replace(/^\d+\.\s*/, ""))
      .filter(Boolean);
  }

  const questionMarkCount = (trimmed.match(/\?/g) || []).length;
  if (questionMarkCount > 1) {
    return trimmed
      .split("?")
      .map((entry) => entry.trim().replace(/^\d+\.\s*/, ""))
      .filter(Boolean);
  }

  return [trimmed.replace(/^\d+\.\s*/, "")].filter(Boolean);
};

const parseWordMeaningEntry = (entry: string): { sourceText: string; meaningText: string } | null => {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }

  const explicitDelimiterPair = trimmed.match(/^(.*?)\s*(?:=|:|\?)\s*(.+)$/);
  if (explicitDelimiterPair) {
    const sourceText = explicitDelimiterPair[1].trim();
    const meaningText = explicitDelimiterPair[2].trim();
    if (!sourceText) {
      return null;
    }
    return {
      sourceText,
      meaningText,
    };
  }

  const whitespaceDelimitedPair = trimmed.match(/^(\S+)\s+(.+)$/);
  if (whitespaceDelimitedPair) {
    return {
      sourceText: whitespaceDelimitedPair[1].trim(),
      meaningText: whitespaceDelimitedPair[2].trim(),
    };
  }

  return {
    sourceText: trimmed,
    meaningText: "",
  };
};

const mapSemicolonSeparatedWordMeaningsToRows = (
  value: string,
  startingOrder = 1
): WordMeaningRow[] => {
  const rows: WordMeaningRow[] = [];

  splitLegacyWordMeaningEntries(value).forEach((entry, index) => {
    const parsedEntry = parseWordMeaningEntry(entry);
    const sourceToken = parsedEntry?.sourceText || "";
    const meaningToken = parsedEntry?.meaningText || "";

    if (!sourceToken) {
      return;
    }

    const sourcePair = autoFillSanskritTransliterationPair(sourceToken, "");
    rows.push({
      id: createWordMeaningRowId(),
      order: startingOrder + index,
      sourceLanguage: "sa",
      sourceScriptText: sourcePair.sanskrit,
      sourceTransliterationIast: sourcePair.transliteration,
      meanings: {
        [WORD_MEANINGS_REQUIRED_LANGUAGE]: meaningToken,
      },
      activeMeaningLanguage: WORD_MEANINGS_REQUIRED_LANGUAGE,
    });
  });

  return rows;
};

const mapLegacyWordMeaningsRowsFromContent = (wordMeanings: Record<string, unknown>): WordMeaningRow[] => {
  const entriesByLanguage = Object.entries(wordMeanings).reduce<Record<string, string[]>>((acc, [rawLanguage, rawValue]) => {
    const normalizedLanguage = rawLanguage.trim().toLowerCase() === "english" ? "en" : rawLanguage.trim().toLowerCase();
    if (!normalizedLanguage || normalizedLanguage === "version" || normalizedLanguage === "rows") {
      return acc;
    }
    const entries = splitLegacyWordMeaningEntries(rawValue);
    if (entries.length > 0) {
      acc[normalizedLanguage] = entries;
    }
    return acc;
  }, {});

  const primaryEntries = entriesByLanguage.en || Object.values(entriesByLanguage)[0] || [];
  return primaryEntries.map((entry, index) => {
    const parsedEntry = parseWordMeaningEntry(entry);
    const sourceText = parsedEntry?.sourceText || "";
    const fallbackMeaningText = parsedEntry?.meaningText || entry.trim();
    const meanings = Object.entries(entriesByLanguage).reduce<Record<string, string>>((acc, [language, entries]) => {
      const candidate = entries[index];
      if (!candidate) {
        return acc;
      }
      const parsedCandidate = parseWordMeaningEntry(candidate);
      acc[language] = (parsedCandidate?.meaningText || candidate).trim();
      return acc;
    }, {});

    if (!(WORD_MEANINGS_REQUIRED_LANGUAGE in meanings)) {
      meanings[WORD_MEANINGS_REQUIRED_LANGUAGE] = fallbackMeaningText;
    }

    const activeMeaningLanguage =
      Object.entries(meanings).find(([, text]) => text.trim())?.[0] || WORD_MEANINGS_REQUIRED_LANGUAGE;

    return {
      id: createWordMeaningRowId(),
      order: index + 1,
      sourceLanguage: "sa",
      sourceScriptText: /[\u0900-\u097F]/.test(sourceText)
        ? sourceText
        : transliterateLatinToDevanagari(sourceText),
      sourceTransliterationIast: /[\u0900-\u097F]/.test(sourceText)
        ? ""
        : transliterateLatinToIast(sourceText),
      meanings,
      activeMeaningLanguage,
    };
  });
};

const mapWordMeaningsRowsFromContent = (node: NodeContent): WordMeaningRow[] => {
  const wordMeanings = node.content_data?.word_meanings;
  const rows = wordMeanings?.rows;
  if (!Array.isArray(rows)) {
    if (wordMeanings && typeof wordMeanings === "object") {
      return mapLegacyWordMeaningsRowsFromContent(wordMeanings as Record<string, unknown>);
    }
    return [];
  }

  return rows.map((row, index) => ({
    ...(function () {
      const rawMeanings = row?.meanings;
      const mapped: Record<string, string> = {};
      if (rawMeanings && typeof rawMeanings === "object") {
        Object.entries(rawMeanings).forEach(([language, payload]) => {
          const text = payload?.text || "";
          if (typeof language === "string") {
            mapped[language] = text;
          }
        });
      }
      if (!(WORD_MEANINGS_REQUIRED_LANGUAGE in mapped)) {
        mapped[WORD_MEANINGS_REQUIRED_LANGUAGE] = "";
      }
      const firstNonEmptyLanguage =
        Object.entries(mapped).find(([, text]) => text.trim())?.[0] ||
        WORD_MEANINGS_REQUIRED_LANGUAGE;
      return {
        id: typeof row?.id === "string" && row.id.trim() ? row.id.trim() : createWordMeaningRowId(),
        order:
          typeof row?.order === "number" && Number.isFinite(row.order) && row.order >= 1
            ? row.order
            : index + 1,
        sourceLanguage:
          typeof row?.source?.language === "string" && row.source.language.trim()
            ? row.source.language.trim()
            : "sa",
        sourceScriptText: row?.source?.script_text || "",
        sourceTransliterationIast: row?.source?.transliteration?.iast || "",
        meanings: mapped,
        activeMeaningLanguage: firstNonEmptyLanguage,
      };
    })(),
  }));
};

const getWordMeaningsEnabledLevelsFromBook = (book: BookDetails | null): Set<string> => {
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

  return new Set(
    enabledLevels
      .filter((level): level is string => typeof level === "string" && level.trim().length > 0)
      .map((level) => level.trim().toLowerCase())
  );
};

const getWordMeaningsMetadataConfig = (
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

const normalizeWordMeaningsEnabledLevels = (levels: string[]): string[] =>
  Array.from(
    new Set(
      levels
        .map((level) => level.trim())
        .filter(Boolean)
        .map((level) => level.toLowerCase())
    )
  ).sort();

const getBookThumbnailUrl = (book: BookDetails | BookOption | null): string | null => {
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
      return resolveMediaUrl(candidate);
    }
  }

  return null;
};

const normalizeBookMediaType = (rawType: unknown, rawUrl: string): BookMediaItem["media_type"] => {
  if (typeof rawType === "string" && rawType.trim()) {
    return rawType.trim().toLowerCase();
  }
  return inferMediaTypeFromUrl(rawUrl);
};

const getBookMetadataObject = (book: BookDetails | BookOption | null): Record<string, unknown> | null => {
  const metadata =
    book?.metadata_json && typeof book.metadata_json === "object"
      ? book.metadata_json
      : book?.metadata && typeof book.metadata === "object"
        ? book.metadata
        : null;
  return metadata ? { ...metadata } : null;
};

const getBookMediaItems = (book: BookDetails | BookOption | null): BookMediaItem[] => {
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

const getBookMediaDisplayOrder = (media: BookMediaItem): number => {
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

const sortBookMediaItems = (items: BookMediaItem[]): BookMediaItem[] =>
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

const getNodeThumbnailUrl = (mediaItems: MediaFile[]): string | null => {
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
  return resolveMediaUrl((defaultImage || imageItems[0]).url);
};

const getYouTubeEmbedUrl = (rawUrl: string): string | null => {
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

const getYouTubeVideoId = (rawUrl: string): string | null => {
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

const getMediaLookupKey = (mediaType: string | undefined, rawUrl: string): string => {
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

const DEFAULT_USER_PREFERENCES: UserPreferences = {
  source_language: "english",
  transliteration_enabled: true,
  transliteration_script: "iast",
  show_roman_transliteration: true,
  show_only_preferred_script: false,
  show_media: true,
  show_commentary: true,
  preview_show_titles: false,
  preview_show_labels: false,
  preview_show_level_numbers: false,
  preview_show_details: false,
  preview_show_media: true,
  preview_show_sanskrit: true,
  preview_show_transliteration: true,
  preview_show_english: true,
  preview_show_commentary: true,
  preview_transliteration_script: "iast",
  preview_word_meanings_display_mode: "inline",
  preview_translation_languages: "english",
  preview_hidden_levels: "",
  ui_theme: "classic",
  ui_density: "comfortable",
  scriptures_book_browser_view: "list",
  scriptures_book_browser_density: 0,
  scriptures_media_manager_view: "list",
  admin_media_bank_browser_view: "list",
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

const PREVIEW_TRANSLATION_LANGUAGES_STORAGE_KEY = "scriptures.preview.translationLanguages";
const PREVIEW_BOOK_SUMMARY_TOGGLE_STORAGE_KEY = "scriptures.preview.showBookSummary";
const PREVIEW_FONT_SIZE_PERCENT_STORAGE_KEY = "scriptures.preview.fontSizePercent";
const BROWSE_TRANSLATION_LANGUAGES_STORAGE_KEY = "scriptures.browse.translationLanguages";
const IMPORT_CANONICAL_CHUNK_FALLBACK_BYTES = 512 * 1024;
const PREVIEW_FONT_SIZE_PERCENT_MIN = 75;
const PREVIEW_FONT_SIZE_PERCENT_MAX = 200;
const PREVIEW_FONT_SIZE_PERCENT_STEP = 5;

const EDITABLE_TRANSLATION_LANGUAGES = [
  "english",
  "hindi",
  "kannada",
  "malayalam",
  "sanskrit",
  "tamil",
  "telugu",
] as const;

type EditableTranslationLanguage = (typeof EDITABLE_TRANSLATION_LANGUAGES)[number];

type AuthorVariantKind = "translation" | "commentary";

const sortEditableTranslationLanguages = (
  values: EditableTranslationLanguage[]
): EditableTranslationLanguage[] =>
  [...values].sort((left, right) =>
    translationLanguageLabel(left).localeCompare(translationLanguageLabel(right))
  );

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

const SORTED_EDITABLE_TRANSLATION_LANGUAGES: EditableTranslationLanguage[] =
  sortEditableTranslationLanguages([...EDITABLE_TRANSLATION_LANGUAGES]);

const LEGACY_VARIANT_LANGUAGE_PREFIX_TO_CANONICAL: Record<string, string> = {
  e: "english",
  h: "hindi",
  k: "kannada",
  m: "malayalam",
  s: "sanskrit",
  t: "tamil",
};

const getVariantKindSuffix = (kind: AuthorVariantKind): string =>
  kind === "translation" ? "t" : "c";

const deriveVariantLanguageFromField = (field?: string | null): string => {
  const normalizedField = (field || "").trim().toLowerCase();
  if (!normalizedField) {
    return "";
  }

  const base = normalizedField.replace(/[tc]$/, "");
  if (!base) {
    return "";
  }

  if (base in LEGACY_VARIANT_LANGUAGE_PREFIX_TO_CANONICAL) {
    return LEGACY_VARIANT_LANGUAGE_PREFIX_TO_CANONICAL[base];
  }

  return normalizeTranslationLanguage(base);
};

const buildVariantFieldCode = (language: string, kind: AuthorVariantKind): string => {
  const normalizedLanguage = normalizeTranslationLanguage(language || "");
  if (!normalizedLanguage) {
    return "";
  }
  return `${translationLanguageToCode(normalizedLanguage)}${getVariantKindSuffix(kind)}`;
};

const toTranslationRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object") {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== "string" || !key.trim()) {
      continue;
    }
    if (typeof rawValue !== "string" || !rawValue.trim()) {
      continue;
    }
    record[key.trim().toLowerCase()] = rawValue.trim();
  }
  return record;
};

const normalizeAuthorVariantDrafts = (
  value: unknown,
  kind: AuthorVariantKind,
): AuthorVariantDraft[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const objectEntry = entry as Record<string, unknown>;
      const text = typeof objectEntry.text === "string" ? objectEntry.text.trim() : "";
      if (!text) {
        return null;
      }
      const rawLanguage =
        typeof objectEntry.language === "string"
          ? normalizeTranslationLanguage(objectEntry.language)
          : "";
      const rawField =
        typeof objectEntry.field === "string" ? objectEntry.field.trim().toLowerCase() : "";
      const resolvedLanguage = rawLanguage || deriveVariantLanguageFromField(rawField);
      return {
        author_slug:
          typeof objectEntry.author_slug === "string" ? objectEntry.author_slug.trim() : "",
        author: typeof objectEntry.author === "string" ? objectEntry.author.trim() : "",
        language: resolvedLanguage,
        field: buildVariantFieldCode(resolvedLanguage, kind),
        text,
      };
    })
    .filter((entry): entry is AuthorVariantDraft => Boolean(entry));
};

const buildEmptyAuthorVariantDraft = (): AuthorVariantDraft => ({
  author_slug: "",
  author: "",
  language: "",
  field: "",
  text: "",
});

const getVariantAuthorOptions = (
  book: BookDetails | null | undefined,
  entry: AuthorVariantDraft,
): Array<{ slug: string; name: string }> => {
  const options = Object.entries(book?.variant_authors ?? {})
    .map(([slug, name]) => ({
      slug: slug.trim(),
      name: typeof name === "string" ? name.trim() : "",
    }))
    .filter((option) => option.slug && option.name)
    .sort((left, right) => left.name.localeCompare(right.name));

  if (entry.author_slug && !options.some((option) => option.slug === entry.author_slug)) {
    options.unshift({
      slug: entry.author_slug,
      name: entry.author || entry.author_slug,
    });
  }

  return options;
};

const applyVariantAuthorSelection = (
  entry: AuthorVariantDraft,
  slug: string,
  book: BookDetails | null | undefined,
): AuthorVariantDraft => ({
  ...entry,
  author_slug: slug,
  author: slug ? book?.variant_authors?.[slug] || entry.author || "" : "",
});

const applyVariantLanguageSelection = (
  entry: AuthorVariantDraft,
  language: string,
  kind: AuthorVariantKind,
): AuthorVariantDraft => {
  const normalizedLanguage = normalizeTranslationLanguage(language || "");
  return {
    ...entry,
    language: normalizedLanguage,
    field: buildVariantFieldCode(normalizedLanguage, kind),
  };
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

const pickPreferredTranslationText = (
  translations: Record<string, string>,
  preferredLanguage: string,
  ...fallbackValues: unknown[]
): string => {
  const preferredKeys = getTranslationLookupKeys(preferredLanguage);
  const englishKeys = getTranslationLookupKeys("english");
  const candidateValues = [
    ...preferredKeys.map((key) => translations[key]),
    ...englishKeys.map((key) => translations[key]),
    ...fallbackValues,
  ];

  for (const value of candidateValues) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  // Last resort: return any available translation value (e.g. translations.te
  // when preferred language is English but only Telugu is stored).
  for (const v of Object.values(translations)) {
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return "";
};

const pickTranslationTextForLanguageOnly = (
  translations: Record<string, string>,
  language: string
): string => {
  const keys = getTranslationLookupKeys(language);
  for (const key of keys) {
    const value = translations[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const buildEditableTranslationDrafts = (
  translations: Record<string, string>
): Record<EditableTranslationLanguage, string> => {
  const drafts = {} as Record<EditableTranslationLanguage, string>;
  for (const language of EDITABLE_TRANSLATION_LANGUAGES) {
    drafts[language] = pickTranslationTextForLanguageOnly(translations, language);
  }
  return drafts;
};

const normalizeSelectedEditableTranslationLanguages = (
  values: string[] | undefined,
  fallbackLanguage: string
): EditableTranslationLanguage[] => {
  const allowed = new Set<string>(EDITABLE_TRANSLATION_LANGUAGES);
  const normalized = Array.from(
    new Set(
      (values || [])
        .map((value) => normalizeTranslationLanguage(value))
        .filter((value) => allowed.has(value))
    )
  ) as EditableTranslationLanguage[];

  if (normalized.length > 0) {
    return sortEditableTranslationLanguages(normalized);
  }

  const fallbackCanonical = normalizeTranslationLanguage(fallbackLanguage);
  if (allowed.has(fallbackCanonical)) {
    return sortEditableTranslationLanguages([fallbackCanonical as EditableTranslationLanguage]);
  }
  return sortEditableTranslationLanguages(["english"]);
};

const parseStoredPreviewTranslationLanguages = (
  value: unknown,
  fallbackLanguage: string
): EditableTranslationLanguage[] => {
  if (Array.isArray(value)) {
    return normalizeSelectedEditableTranslationLanguages(
      value.filter((item): item is string => typeof item === "string"),
      fallbackLanguage
    );
  }

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) {
      return normalizeSelectedEditableTranslationLanguages([], fallbackLanguage);
    }

    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return normalizeSelectedEditableTranslationLanguages(
            parsed.filter((item): item is string => typeof item === "string"),
            fallbackLanguage
          );
        }
      } catch {
        // Fall back to CSV parsing below.
      }
    }

    return normalizeSelectedEditableTranslationLanguages(
      raw.split(",").map((item) => item.trim()).filter(Boolean),
      fallbackLanguage
    );
  }

  return normalizeSelectedEditableTranslationLanguages([], fallbackLanguage);
};

const serializePreviewTranslationLanguages = (
  values: EditableTranslationLanguage[]
): string => values.join(",");

const parseStoredHiddenPreviewLevels = (value: unknown): Set<string> => {
  if (Array.isArray(value)) {
    return new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) {
      return new Set<string>();
    }

    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(
            parsed
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean)
          );
        }
      } catch {
        // Fall back to CSV parsing below.
      }
    }

    return new Set(raw.split(",").map((item) => item.trim()).filter(Boolean));
  }

  return new Set<string>();
};

const normalizePreviewFontSizePercent = (value: unknown): number => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;
  if (!Number.isFinite(parsed)) {
    return 100;
  }
  const stepped = Math.round(parsed / PREVIEW_FONT_SIZE_PERCENT_STEP) * PREVIEW_FONT_SIZE_PERCENT_STEP;
  return Math.min(PREVIEW_FONT_SIZE_PERCENT_MAX, Math.max(PREVIEW_FONT_SIZE_PERCENT_MIN, stepped));
};

const serializeHiddenPreviewLevels = (values: Set<string>): string =>
  [...values].map((item) => item.trim()).filter(Boolean).join(",");

const normalizeTranslationDraftsForCompare = (
  drafts: Record<EditableTranslationLanguage, string>,
  selectedLanguages: EditableTranslationLanguage[]
) => {
  const normalizedSelected = [...selectedLanguages].sort();
  const normalizedDrafts = normalizedSelected.reduce<Record<string, string>>((acc, language) => {
    acc[language] = (drafts[language] || "").trim();
    return acc;
  }, {});
  return {
    selectedLanguages: normalizedSelected,
    drafts: normalizedDrafts,
  };
};

const areEditableLanguageSelectionsEqual = (
  left: EditableTranslationLanguage[],
  right: EditableTranslationLanguage[]
) => {
  if (left.length !== right.length) {
    return false;
  }
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
};

const areStringSetsEqual = (left: Set<string>, right: Set<string>) => {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
};

type StoredScripturesPreferences = {
  preferences?: Partial<UserPreferences>;
  show_only_preferred_script?: boolean;
};

const normalizePreferences = (value: Partial<UserPreferences> | null | undefined): UserPreferences => ({
  source_language: normalizeSourceLanguage(value?.source_language),
  transliteration_enabled: value?.transliteration_enabled ?? true,
  transliteration_script: normalizeTransliterationScript(value?.transliteration_script),
  show_roman_transliteration: value?.show_roman_transliteration ?? true,
  show_only_preferred_script: value?.show_only_preferred_script ?? false,
  show_media: value?.show_media ?? true,
  show_commentary: value?.show_commentary ?? true,
  preview_show_titles: value?.preview_show_titles ?? false,
  preview_show_labels: value?.preview_show_labels ?? false,
  preview_show_level_numbers: value?.preview_show_level_numbers ?? false,
  preview_show_details: value?.preview_show_details ?? false,
  preview_show_media: value?.preview_show_media ?? true,
  preview_show_sanskrit: value?.preview_show_sanskrit ?? true,
  preview_show_transliteration: value?.preview_show_transliteration ?? true,
  preview_show_english: value?.preview_show_english ?? true,
  preview_show_commentary: value?.preview_show_commentary ?? true,
  preview_transliteration_script: normalizeTransliterationScript(
    value?.preview_transliteration_script
  ),
  preview_word_meanings_display_mode: normalizePreviewWordMeaningsDisplayMode(
    value?.preview_word_meanings_display_mode
  ),
  preview_translation_languages:
    typeof value?.preview_translation_languages === "string"
      ? value.preview_translation_languages
      : "english",
  preview_hidden_levels:
    typeof value?.preview_hidden_levels === "string"
      ? value.preview_hidden_levels
      : "",
  ui_theme: normalizeUiTheme(value?.ui_theme),
  ui_density: normalizeUiDensity(value?.ui_density),
  scriptures_book_browser_view: normalizeBrowserView(value?.scriptures_book_browser_view),
  scriptures_book_browser_density: normalizeBookBrowserDensity(value?.scriptures_book_browser_density),
  scriptures_media_manager_view: normalizeBrowserView(value?.scriptures_media_manager_view),
  admin_media_bank_browser_view: normalizeBrowserView(value?.admin_media_bank_browser_view),
});

const normalizeSourceLanguage = (value?: string | null): string =>
  normalizeTranslationLanguage(value);

const normalizePreviewWordMeaningsDisplayMode = (
  value?: string | null
): "inline" | "table" | "hide" => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "table") return "table";
  if (normalized === "hide") return "hide";
  return "inline";
};

const isBookScopedCategory = (category: MetadataCategory): boolean => {
  const scopes = category.applicable_scopes || [];
  return scopes.includes("book") || scopes.includes("all") || scopes.includes("node");
};

const metadataObjectToDisplayText = (rawValue: unknown): string => {
  if (rawValue === null || rawValue === undefined) {
    return "";
  }

  if (typeof rawValue === "string") {
    return rawValue;
  }

  if (typeof rawValue === "number" || typeof rawValue === "boolean") {
    return String(rawValue);
  }

  if (typeof rawValue === "object") {
    if (!Array.isArray(rawValue)) {
      const textCandidate = (rawValue as Record<string, unknown>).text;
      if (typeof textCandidate === "string") {
        return textCandidate;
      }
    }
    return "";
  }

  return String(rawValue);
};

const normalizeMetadataValue = (dataType: string, rawValue: unknown): unknown => {
  if (dataType === "boolean") {
    return Boolean(rawValue);
  }

  if (dataType === "number") {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      return null;
    }
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) ? numeric : null;
  }

  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const stringValue = metadataObjectToDisplayText(rawValue);
  if (!stringValue.trim()) {
    return null;
  }

  if (dataType === "datetime") {
    const parsed = new Date(stringValue);
    return Number.isNaN(parsed.getTime()) ? stringValue : parsed.toISOString();
  }

  return stringValue;
};

const valuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const isSingleLineTextMetadataField = (field: EffectivePropertyBinding): boolean => {
  const name = field.property_internal_name.toLowerCase();
  if (name.includes("template") || name.endsWith("_key") || name.includes("render_key")) {
    return true;
  }
  if (name.includes("language") || name.includes("slug") || name.includes("code")) {
    return true;
  }
  return false;
};

const isTemplateMetadataField = (field: EffectivePropertyBinding): boolean => {
  const name = field.property_internal_name.toLowerCase();
  return name.includes("template") && name.endsWith("_key");
};

const filterVisibleMetadataFields = (fields: EffectivePropertyBinding[]): EffectivePropertyBinding[] =>
  fields.filter((field) => field.property_internal_name !== "text");

const getFieldDefaultValue = (field: EffectivePropertyBinding): unknown => {
  return field.default_value ?? null;
};

const isEmptyMetadataValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  return false;
};

const normalizeMetadataKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_");

const isUsableBindingValueForField = (
  field: EffectivePropertyBinding,
  value: unknown
): boolean => {
  if (value === null || value === undefined) {
    return false;
  }

  switch (field.property_data_type) {
    case "text":
    case "date":
    case "datetime":
    case "dropdown":
      return typeof value === "string" && value.trim().length > 0;
    case "number":
      if (typeof value === "number") {
        return Number.isFinite(value);
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 && Number.isFinite(Number(trimmed));
      }
      return false;
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
};

const autoFillSanskritTransliterationPair = (
  sanskritRaw: string,
  transliterationRaw: string
): { sanskrit: string; transliteration: string } => {
  const sanskrit = sanskritRaw.trim();
  const transliteration = transliterationRaw.trim();

  if (!sanskrit && !transliteration) {
    return { sanskrit: "", transliteration: "" };
  }

  if (sanskrit && transliteration) {
    return { sanskrit, transliteration };
  }

  if (!sanskrit && transliteration) {
    if (hasDevanagariLetters(transliteration)) {
      return {
        sanskrit: transliteration,
        transliteration: transliterateFromDevanagari(transliteration, "iast"),
      };
    }
    return {
      sanskrit: transliterateLatinToDevanagari(transliteration),
      transliteration: transliterateLatinToIast(transliteration),
    };
  }

  if (hasDevanagariLetters(sanskrit)) {
    return {
      sanskrit,
      transliteration: transliterateFromDevanagari(sanskrit, "iast"),
    };
  }

  return {
    sanskrit: transliterateLatinToDevanagari(sanskrit),
    transliteration: transliterateLatinToIast(sanskrit),
  };
};

const toDatetimeLocalValue = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

function ScripturesContent() {
  const BOOKS_PAGE_SIZE_LIST = 18;
  const BOOKS_PAGE_SIZE_BY_DENSITY: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 25,
    2: 16,
    3: 9,
    4: 4,
    5: 3,
  };
  const router = useRouter();
  const searchParams = useSearchParams();
  const [books, setBooks] = useState<BookOption[]>([]);
  const [bookQuery, setBookQuery] = useState("");
  const [bookHasMore, setBookHasMore] = useState(true);
  const [bookLoadingMore, setBookLoadingMore] = useState(false);
  const [bookId, setBookId] = useState("");
  const [currentBook, setCurrentBook] = useState<BookDetails | null>(null);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [privateBookGate, setPrivateBookGate] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [urlInitialized, setUrlInitialized] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<TreeNode[]>([]);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [copyTarget, setCopyTarget] = useState<"book" | "node" | "leaf" | null>(null);
  const [, setAuthStatus] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [authUserId, setAuthUserId] = useState<number | null>(null);
  const [bookVisibilitySubmitting, setBookVisibilitySubmitting] = useState<number | null>(null);
  const [canView, setCanView] = useState(false);
  const [canAdmin, setCanAdmin] = useState(false);
  const [canContribute, setCanContribute] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canImport, setCanImport] = useState(false);
  const [nodeContent, setNodeContent] = useState<NodeContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [nodeMedia, setNodeMedia] = useState<MediaFile[]>([]);
  const [nodeMediaLoading, setNodeMediaLoading] = useState(false);
  const [nodeMediaError, setNodeMediaError] = useState<string | null>(null);
  const [nodeMediaUploading, setNodeMediaUploading] = useState(false);
  const [nodeMediaUpdating, setNodeMediaUpdating] = useState(false);
  const [nodeMediaMessage, setNodeMediaMessage] = useState<string | null>(null);
  const [nodeMediaSearchQuery, setNodeMediaSearchQuery] = useState("");
  const [mediaBankAssets, setMediaBankAssets] = useState<MediaAsset[]>([]);
  const [mediaBankLoading, setMediaBankLoading] = useState(false);
  const [mediaBankError, setMediaBankError] = useState<string | null>(null);
  const [mediaBankMessage, setMediaBankMessage] = useState<string | null>(null);
  const [mediaBankUploading, setMediaBankUploading] = useState(false);
  const [mediaBankUpdating, setMediaBankUpdating] = useState(false);
  const [mediaBankRenameId, setMediaBankRenameId] = useState<number | null>(null);
  const [mediaBankRenameValue, setMediaBankRenameValue] = useState("");
  const [externalMediaFormOpen, setExternalMediaFormOpen] = useState(false);
  const [externalMediaFormContext, setExternalMediaFormContext] = useState<MediaLinkContext>("bank");
  const [externalMediaFormSubmitting, setExternalMediaFormSubmitting] = useState(false);
  const [bookMediaActionsOpen, setBookMediaActionsOpen] = useState(false);
  const [nodeMediaActionsOpen, setNodeMediaActionsOpen] = useState(false);
  const [mediaManagerSearchQuery, setMediaManagerSearchQuery] = useState("");
  const [mediaManagerTypeFilter, setMediaManagerTypeFilter] = useState("all");
  const [bookBrowserView, setBookBrowserView] = useState<"list" | "icon">("list");
  const [bookBrowserDensity, setBookBrowserDensity] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [bookBrowserDensityHydrated, setBookBrowserDensityHydrated] = useState(false);
  const [showBookBrowserDensityMenu, setShowBookBrowserDensityMenu] = useState(false);
  const [mediaManagerView, setMediaManagerView] = useState<"list" | "icon">("list");
  const [mediaManagerDensity, setMediaManagerDensity] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [mediaManagerDensityHydrated, setMediaManagerDensityHydrated] = useState(false);
  const [showMediaManagerDensityMenu, setShowMediaManagerDensityMenu] = useState(false);
  const [showMediaManagerModal, setShowMediaManagerModal] = useState(false);
  const [mediaManagerScope, setMediaManagerScope] = useState<"node" | "book" | "bank">("node");
  const [mediaBankViewMode, setMediaBankViewMode] = useState<"manage" | "pick-node" | "pick-book">("manage");
  const [nodeCommentary, setNodeCommentary] = useState<CommentaryEntry[]>([]);
  const [nodeCommentaryLoading, setNodeCommentaryLoading] = useState(false);
  const [nodeCommentaryError, setNodeCommentaryError] = useState<string | null>(null);
  const [nodeComments, setNodeComments] = useState<NodeComment[]>([]);
  const [nodeCommentsLoading, setNodeCommentsLoading] = useState(false);
  const [nodeCommentsError, setNodeCommentsError] = useState<string | null>(null);
  const [nodeCommentEditorOpen, setNodeCommentEditorOpen] = useState(false);
  const [nodeCommentEditingId, setNodeCommentEditingId] = useState<number | null>(null);
  const [nodeCommentFormLanguage, setNodeCommentFormLanguage] = useState("en");
  const [nodeCommentFormText, setNodeCommentFormText] = useState("");
  const [nodeCommentSubmitting, setNodeCommentSubmitting] = useState(false);
  const [nodeCommentMessage, setNodeCommentMessage] = useState<string | null>(null);
  const [commentaryEditorOpen, setCommentaryEditorOpen] = useState(false);
  const [commentaryEditingId, setCommentaryEditingId] = useState<number | null>(null);
  const [commentaryFormAuthor, setCommentaryFormAuthor] = useState("");
  const [commentaryFormWorkTitle, setCommentaryFormWorkTitle] = useState("");
  const [commentaryFormLanguage, setCommentaryFormLanguage] = useState("en");
  const [commentaryFormText, setCommentaryFormText] = useState("");
  const [commentarySubmitting, setCommentarySubmitting] = useState(false);
  const [commentaryMessage, setCommentaryMessage] = useState<string | null>(null);
  const [actionNode, setActionNode] = useState<TreeNode | null>(null);
  const [action, setAction] = useState<"add" | "edit" | null>(null);
  const [createParentNodeIdOverride, setCreateParentNodeIdOverride] = useState<number | null>(null);
  const [createInsertAfterNodeId, setCreateInsertAfterNodeId] = useState<number | null>(null);
  const [createNextOnSubmit, setCreateNextOnSubmit] = useState(false);
  const [searchReturnUrl, setSearchReturnUrl] = useState<string | null>(null);
  const lastTreeBookId = useRef<string | null>(null);
  const lastAutoSelectNodeId = useRef<number | null>(null);
  const lastLoadedNodeId = useRef<number | null>(null);
  const activeTreeRequestId = useRef(0);
  const activeTreeAbortController = useRef<AbortController | null>(null);
  const activeContentRequestId = useRef(0);
  const activeContentAbortController = useRef<AbortController | null>(null);
  const activeContentNodeId = useRef<number | null>(null);
  const activeNodeMediaRequestId = useRef(0);
  const activeNodeMediaAbortController = useRef<AbortController | null>(null);
  const activeNodeMediaNodeId = useRef<number | null>(null);
  const mediaBankUploadInputRef = useRef<HTMLInputElement | null>(null);
  const mediaBankReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const mediaBankReplaceTargetIdRef = useRef<number | null>(null);
  const mediaBankSuppressRenameBlurRef = useRef(false);
  const nodeMediaUploadInputRef = useRef<HTMLInputElement | null>(null);
  const bookMediaUploadInputRef = useRef<HTMLInputElement | null>(null);
  const importBookInputRef = useRef<HTMLInputElement | null>(null);
  const activeNodeCommentaryRequestId = useRef(0);
  const activeNodeCommentaryAbortController = useRef<AbortController | null>(null);
  const activeNodeCommentaryNodeId = useRef<number | null>(null);
  const activeNodeCommentsRequestId = useRef(0);
  const activeNodeCommentsAbortController = useRef<AbortController | null>(null);
  const activeNodeCommentsNodeId = useRef<number | null>(null);
  const pendingSavedNodeId = useRef<number | null>(null);
  const lastHandledPreviewRequestKey = useRef<string | null>(null);
  const bookPreviewScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const previewSettingsInitialized = useRef(false);
  const importPollingRunIdRef = useRef(0);
  const activeImportJobIdRef = useRef<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"tree" | "content">("tree");
  const [showExploreStructure, setShowExploreStructure] = useState(false);
  const [formData, setFormData] = useState({
    levelName: "",
    titleSanskrit: "",
    titleTransliteration: "",
    titleEnglish: "",
    sequenceNumber: "",
    hasContent: true,
    contentSanskrit: "",
    contentTransliteration: "",
    contentEnglish: "",
    tags: "",
    wordMeanings: [] as WordMeaningRow[],
  });
  const [inlineEditMode, setInlineEditMode] = useState(false);
  const [inlineSubmitting, setInlineSubmitting] = useState(false);
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [importProgressMessage, setImportProgressMessage] = useState<string | null>(null);
  const [importProgressCurrent, setImportProgressCurrent] = useState<number | null>(null);
  const [importProgressTotal, setImportProgressTotal] = useState<number | null>(null);
  const [showImportUrlInput, setShowImportUrlInput] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [inlineMessage, setInlineMessage] = useState<string | null>(null);
  const [inlineFormData, setInlineFormData] = useState({
    levelName: "",
    titleSanskrit: "",
    titleTransliteration: "",
    titleEnglish: "",
    sequenceNumber: "",
    hasContent: true,
    contentSanskrit: "",
    contentTransliteration: "",
    contentEnglish: "",
    tags: "",
    wordMeanings: [] as WordMeaningRow[],
  });
  const [inlineTranslationDrafts, setInlineTranslationDrafts] =
    useState<Record<EditableTranslationLanguage, string>>(
      buildEditableTranslationDrafts({})
    );
  const [inlineSelectedTranslationLanguages, setInlineSelectedTranslationLanguages] =
    useState<EditableTranslationLanguage[]>(["english"]);
  const [inlineTranslationVariants, setInlineTranslationVariants] =
    useState<AuthorVariantDraft[]>([]);
  const [inlineCommentaryVariants, setInlineCommentaryVariants] =
    useState<AuthorVariantDraft[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateBook, setShowCreateBook] = useState(false);
  const [showBookPreview, setShowBookPreview] = useState(false);
  const [bookThumbnailUploading, setBookThumbnailUploading] = useState(false);
  const [showBrowseBookModal, setShowBrowseBookModal] = useState(false);
  const [browseTransitioningFromPreview, setBrowseTransitioningFromPreview] = useState(false);
  const [bookPreviewLoading, setBookPreviewLoading] = useState(false);
  const [bookPreviewLoadingMore, setBookPreviewLoadingMore] = useState(false);
  const [bookPreviewLoadingScope, setBookPreviewLoadingScope] = useState<"book" | "node">("book");
  const [bookPreviewLoadingElapsedMs, setBookPreviewLoadingElapsedMs] = useState(0);
  const [bookPreviewError, setBookPreviewError] = useState<string | null>(null);
  const [previewLinkMessage, setPreviewLinkMessage] = useState<string | null>(null);
  const [bookPreviewArtifact, setBookPreviewArtifact] = useState<BookPreviewArtifact | null>(null);
  const [bookPreviewLanguageSettings, setBookPreviewLanguageSettings] =
    useState<BookPreviewLanguageSettings>({
      show_sanskrit: true,
      show_transliteration: true,
      show_english: true,
      show_commentary: true,
    });
  const [previewTranslationLanguages, setPreviewTranslationLanguages] =
    useState<EditableTranslationLanguage[]>(["english"]);
  // Track the last applied settings to enable/disable Apply button
  const [appliedBookPreviewLanguageSettings, setAppliedBookPreviewLanguageSettings] =
    useState<BookPreviewLanguageSettings>({
      show_sanskrit: true,
      show_transliteration: true,
      show_english: true,
      show_commentary: true,
    });
  const [appliedPreviewTranslationLanguages, setAppliedPreviewTranslationLanguages] =
    useState<EditableTranslationLanguage[]>(["english"]);
  const [browseTranslationLanguages, setBrowseTranslationLanguages] =
    useState<EditableTranslationLanguage[]>(["english"]);
  const [showPreviewLabels, setShowPreviewLabels] = useState(false);
  const [showPreviewLevelNumbers, setShowPreviewLevelNumbers] = useState(false);
  const [showPreviewDetails, setShowPreviewDetails] = useState(false);
  const [showPreviewTitles, setShowPreviewTitles] = useState(false);
  const [showPreviewMedia, setShowPreviewMedia] = useState(true);
  const [showPreviewBookSummary, setShowPreviewBookSummary] = useState(true);
  const [previewWordMeaningsDisplayMode, setPreviewWordMeaningsDisplayMode] =
    useState<"inline" | "table" | "hide">("inline");
  const [previewFontSizePercent, setPreviewFontSizePercent] = useState(100);
  // Level visibility filter (client-side, per-preview session)
  const [hiddenPreviewLevels, setHiddenPreviewLevels] = useState<Set<string>>(new Set());
  const [appliedHiddenPreviewLevels, setAppliedHiddenPreviewLevels] = useState<Set<string>>(new Set());
  // Author filter for variant translations/commentaries (empty = all authors)
  const [previewVariantAuthorSlugs, setPreviewVariantAuthorSlugs] = useState<string[]>([]);
  const [appliedPreviewVariantAuthorSlugs, setAppliedPreviewVariantAuthorSlugs] = useState<string[]>([]);
  // Track the last applied preview options
  const [appliedShowPreviewLabels, setAppliedShowPreviewLabels] = useState(false);
  const [appliedShowPreviewLevelNumbers, setAppliedShowPreviewLevelNumbers] = useState(false);
  const [appliedShowPreviewDetails, setAppliedShowPreviewDetails] = useState(false);
  const [appliedShowPreviewTitles, setAppliedShowPreviewTitles] = useState(false);
  const [appliedShowPreviewMedia, setAppliedShowPreviewMedia] = useState(true);
  const [appliedPreviewWordMeaningsDisplayMode, setAppliedPreviewWordMeaningsDisplayMode] =
    useState<"inline" | "table" | "hide">("inline");
  const [appliedPreviewFontSizePercent, setAppliedPreviewFontSizePercent] = useState(100);
  const [appliedBookPreviewTransliterationScript, setAppliedBookPreviewTransliterationScript] =
    useState<TransliterationScriptOption>("iast");
  const [showPreviewControls, setShowPreviewControls] = useState(false);
  const [previewControlsTab, setPreviewControlsTab] = useState<"content" | "translations">(
    "content"
  );
  const [bookPreviewTransliterationScript, setBookPreviewTransliterationScript] =
    useState<TransliterationScriptOption>("iast");
  const [bookBrowseMediaSearchQuery, setBookBrowseMediaSearchQuery] = useState("");
  const [showShareManager, setShowShareManager] = useState(false);
  const [schemas, setSchemas] = useState<SchemaOption[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<number | null>(null);
  const [modalTranslationDrafts, setModalTranslationDrafts] =
    useState<Record<EditableTranslationLanguage, string>>(
      buildEditableTranslationDrafts({})
    );
  const [modalSelectedTranslationLanguages, setModalSelectedTranslationLanguages] =
    useState<EditableTranslationLanguage[]>(["english"]);
  const [modalTranslationVariants, setModalTranslationVariants] =
    useState<AuthorVariantDraft[]>([]);
  const [modalCommentaryVariants, setModalCommentaryVariants] =
    useState<AuthorVariantDraft[]>([]);
  const [createBookStep, setCreateBookStep] = useState<"schema" | "details">("schema");
  const [bookFormData, setBookFormData] = useState({
    bookName: "",
    titleTransliteration: "",
    titleEnglish: "",
    author: "",
    bookCode: "",
    languagePrimary: "sanskrit",
  });
  const [bookSubmitting, setBookSubmitting] = useState(false);
  const [bookShares, setBookShares] = useState<BookShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [sharePermission, setSharePermission] = useState<SharePermission>("viewer");
  const [sharesSubmitting, setSharesSubmitting] = useState(false);
  const [shareUpdatingUserId, setShareUpdatingUserId] = useState<number | null>(null);
  const [shareRemovingUserId, setShareRemovingUserId] = useState<number | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState<string | null>(null);
  const [showPreferencesDialog, setShowPreferencesDialog] = useState(false);
  const [isReorderingBasket, setIsReorderingBasket] = useState(false);
  const [basketItems, setBasketItems] = useState<BasketItem[]>([]);
  const [metadataCategories, setMetadataCategories] = useState<MetadataCategory[]>([]);
  const [metadataCategoriesLoading, setMetadataCategoriesLoading] = useState(false);
  const [contentFieldLabels, setContentFieldLabels] = useState<Record<string, string>>({
    ...DEFAULT_CONTENT_FIELD_LABELS,
  });
  const [showPropertiesModal, setShowPropertiesModal] = useState(false);
  const [propertiesScope, setPropertiesScope] = useState<PropertiesScope>("book");
  const [propertiesNodeId, setPropertiesNodeId] = useState<number | null>(null);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesSaving, setPropertiesSaving] = useState(false);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);
  const [propertiesMessage, setPropertiesMessage] = useState<string | null>(null);
  const [levelNameOverridesDraft, setLevelNameOverridesDraft] = useState<Record<string, string>>({});
  const [levelNameOverridesSaving, setLevelNameOverridesSaving] = useState(false);
  const [levelNameOverridesError, setLevelNameOverridesError] = useState<string | null>(null);
  const [levelNameOverridesMessage, setLevelNameOverridesMessage] = useState<string | null>(null);
  const [propertiesName, setPropertiesName] = useState("");
  const [propertiesDescription, setPropertiesDescription] = useState("");
  const [propertiesInitialDescription, setPropertiesInitialDescription] = useState("");
  const [propertiesDirty, setPropertiesDirty] = useState(false);
  // Variant authors registry editor inside Book Properties panel
  const [variantAuthorsRegistry, setVariantAuthorsRegistry] = useState<Array<{slug: string; name: string}>>([]);
  const [variantAuthorsSaving, setVariantAuthorsSaving] = useState(false);
  const [variantAuthorsError, setVariantAuthorsError] = useState<string | null>(null);
  const [variantAuthorsMessage, setVariantAuthorsMessage] = useState<string | null>(null);
  const [propertiesBookAuthor, setPropertiesBookAuthor] = useState("");
  const [propertiesBookTitleEnglish, setPropertiesBookTitleEnglish] = useState("");
  const [propertiesBookTitleSanskrit, setPropertiesBookTitleSanskrit] = useState("");
  const [propertiesBookTitleTransliteration, setPropertiesBookTitleTransliteration] = useState("");
  const [propertiesWordMeaningsEnabledLevels, setPropertiesWordMeaningsEnabledLevels] = useState<string[]>([]);
  const [propertiesCategoryId, setPropertiesCategoryId] = useState<number | null>(null);
  const [propertiesEffectiveFields, setPropertiesEffectiveFields] = useState<EffectivePropertyBinding[]>([]);
  const [propertiesValues, setPropertiesValues] = useState<Record<string, unknown>>({});
  const [propertiesLevelKey, setPropertiesLevelKey] = useState("");
  const [levelDefaultTemplateKey, setLevelDefaultTemplateKey] = useState("");
  const [levelTemplates, setLevelTemplates] = useState<LevelTemplateOption[]>([]);
  const [levelTemplateAssignmentId, setLevelTemplateAssignmentId] = useState<number | null>(null);
  const [selectedLevelTemplateId, setSelectedLevelTemplateId] = useState("");
  const [levelTemplatesLoading, setLevelTemplatesLoading] = useState(false);
  const [levelTemplateSaving, setLevelTemplateSaving] = useState(false);
  const [levelTemplateError, setLevelTemplateError] = useState<string | null>(null);
  const [levelTemplateMessage, setLevelTemplateMessage] = useState<string | null>(null);
  const [openBookRowActionsId, setOpenBookRowActionsId] = useState<number | null>(null);
  const [showBookTreeActionsMenu, setShowBookTreeActionsMenu] = useState(false);
  const [showNodeActionsMenu, setShowNodeActionsMenu] = useState(false);
  const [showBookRootActionsMenu, setShowBookRootActionsMenu] = useState(false);
  const [bookInlineEditMode, setBookInlineEditMode] = useState(false);
  const [bookInlineName, setBookInlineName] = useState("");
  const [bookInlineSubmitting, setBookInlineSubmitting] = useState(false);
  const [bookInfoStatsOpen, setBookInfoStatsOpen] = useState(true);
  const [bookInfoAuthorsOpen, setBookInfoAuthorsOpen] = useState(true);
  const bookRowActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const bookBrowserDensityMenuRef = useRef<HTMLDivElement | null>(null);
  const mediaManagerDensityMenuRef = useRef<HTMLDivElement | null>(null);
  const bookMediaActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const nodeMediaActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const booksScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const booksLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const activeBooksAbortController = useRef<AbortController | null>(null);
  const activeBooksRequestId = useRef(0);
  const bookNextOffsetRef = useRef(0);
  const bookHasMoreRef = useRef(true);
  const bookLoadingRef = useRef(false);
  const bookTreeActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const nodeActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const bookRootActionsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (bookRowActionsMenuRef.current && !bookRowActionsMenuRef.current.contains(target)) {
        setOpenBookRowActionsId(null);
      }
      if (bookBrowserDensityMenuRef.current && !bookBrowserDensityMenuRef.current.contains(target)) {
        setShowBookBrowserDensityMenu(false);
      }
      if (mediaManagerDensityMenuRef.current && !mediaManagerDensityMenuRef.current.contains(target)) {
        setShowMediaManagerDensityMenu(false);
      }
      if (bookMediaActionsMenuRef.current && !bookMediaActionsMenuRef.current.contains(target)) {
        setBookMediaActionsOpen(false);
      }
      if (nodeMediaActionsMenuRef.current && !nodeMediaActionsMenuRef.current.contains(target)) {
        setNodeMediaActionsOpen(false);
      }
      if (bookTreeActionsMenuRef.current && !bookTreeActionsMenuRef.current.contains(target)) {
        setShowBookTreeActionsMenu(false);
      }
      if (nodeActionsMenuRef.current && !nodeActionsMenuRef.current.contains(target)) {
        setShowNodeActionsMenu(false);
      }
      if (bookRootActionsMenuRef.current && !bookRootActionsMenuRef.current.contains(target)) {
        setShowBookRootActionsMenu(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    setOpenBookRowActionsId(null);
  }, [bookId]);

  useEffect(() => {
    setShowBookTreeActionsMenu(false);
  }, [bookId]);

  useEffect(() => {
    setShowNodeActionsMenu(false);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId !== BOOK_ROOT_NODE_ID) {
      setShowBookRootActionsMenu(false);
      setBookInlineEditMode(false);
      setBookInlineName("");
      setBookInlineSubmitting(false);
    }
  }, [selectedId, bookId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setBookBrowserView(readStoredBrowserView(SCRIPTURES_BOOK_BROWSER_VIEW_KEY));
    setBookBrowserDensity(readStoredBookBrowserDensity());
    setBookBrowserDensityHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!bookBrowserDensityHydrated) {
      return;
    }
    window.localStorage.setItem(
      getDeviceScopedStorageKey(SCRIPTURES_BOOK_BROWSER_VIEW_KEY),
      bookBrowserView
    );
  }, [bookBrowserView, bookBrowserDensityHydrated]);

  useEffect(() => {
    if (!authResolved) {
      return;
    }
    if (authEmail) {
      setMediaManagerDensityHydrated(true);
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    setMediaManagerDensity(readStoredMediaManagerDensity(mediaManagerScope));
    setMediaManagerDensityHydrated(true);
  }, [authResolved, authEmail, mediaManagerScope]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!bookBrowserDensityHydrated) {
      return;
    }
    window.localStorage.setItem(
      getDeviceScopedStorageKey(SCRIPTURES_BOOK_BROWSER_DENSITY_KEY),
      String(bookBrowserDensity)
    );
  }, [bookBrowserDensity, bookBrowserDensityHydrated]);

  useEffect(() => {
    if (!bookBrowserDensityHydrated) {
      return;
    }
    const coarseView: "list" | "icon" = bookBrowserDensity === 0 ? "list" : "icon";
    if (coarseView !== bookBrowserView) {
      setBookBrowserView(coarseView);
    }
  }, [bookBrowserDensity, bookBrowserView, bookBrowserDensityHydrated]);

  useEffect(() => {
    if (!authResolved || authEmail) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      getDeviceScopedStorageKey(SCRIPTURES_MEDIA_MANAGER_VIEW_KEY),
      mediaManagerView
    );
  }, [authResolved, authEmail, mediaManagerView]);

  useEffect(() => {
    if (!authResolved || authEmail) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    if (!mediaManagerDensityHydrated) {
      return;
    }
    const value = String(mediaManagerDensity);
    window.localStorage.setItem(
      getDeviceScopedStorageKey(mediaManagerDensityStorageKey(mediaManagerScope)),
      value
    );
  }, [authResolved, authEmail, mediaManagerDensity, mediaManagerDensityHydrated, mediaManagerScope]);

  useEffect(() => {
    if (!mediaManagerDensityHydrated) {
      return;
    }
    const coarseView: "list" | "icon" = mediaManagerDensity === 0 ? "list" : "icon";
    if (coarseView !== mediaManagerView) {
      setMediaManagerView(coarseView);
    }
  }, [mediaManagerDensity, mediaManagerView, mediaManagerDensityHydrated]);

  useEffect(() => {
    setPreferences((prev) => {
      if (!prev) return prev;
      if (
        prev.scriptures_book_browser_view === bookBrowserView &&
        prev.scriptures_media_manager_view === mediaManagerView
      ) {
        return prev;
      }
      return {
        ...prev,
        scriptures_book_browser_view: bookBrowserView,
        scriptures_book_browser_density: bookBrowserDensity,
        scriptures_media_manager_view: mediaManagerView,
      };
    });
  }, [bookBrowserView, bookBrowserDensity, mediaManagerView]);

  useEffect(() => {
    setInlineMessage(null);
  }, [selectedId]);

  useEffect(() => {
    const shouldLockBodyScroll =
      showPropertiesModal ||
      showBookPreview ||
      showShareManager ||
      showCreateBook ||
      showPreferencesDialog ||
      Boolean(action && actionNode);

    if (!shouldLockBodyScroll) {
      return;
    }

    const { body, documentElement } = document;
    const scrollY = window.scrollY;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPosition = body.style.position;
    const previousBodyTop = body.style.top;
    const previousBodyWidth = body.style.width;
    const previousBodyPaddingRight = body.style.paddingRight;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;
    const previousHtmlOverscrollBehavior = documentElement.style.overscrollBehavior;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overscrollBehavior = "none";
    documentElement.style.overscrollBehavior = "none";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousBodyOverflow;
      body.style.position = previousBodyPosition;
      body.style.top = previousBodyTop;
      body.style.width = previousBodyWidth;
      body.style.paddingRight = previousBodyPaddingRight;
      body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      documentElement.style.overscrollBehavior = previousHtmlOverscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, [
    showPropertiesModal,
    showBookPreview,
    showShareManager,
    showCreateBook,
    showPreferencesDialog,
    action,
    actionNode,
  ]);

  const resolvePreviewContentLines = useCallback((
    block: BookPreviewBlock,
    settings?: BookPreviewRenderSettings
  ) => {
    const appliedPreviewTransliterationScript = normalizeTransliterationScript(
      appliedBookPreviewTransliterationScript
    );
    const effectiveSourceLanguage = normalizeSourceLanguage(preferences?.source_language);
    const resolvedSettings: BookPreviewRenderSettings =
      settings || {
        show_sanskrit: true,
        show_transliteration: true,
        show_english: true,
        show_metadata: true,
        show_media: true,
        text_order: ["sanskrit", "transliteration", "english", "text"],
      };

    const visibleByKey: Record<string, boolean> = {
      sanskrit: resolvedSettings.show_sanskrit,
      transliteration: resolvedSettings.show_transliteration,
      english: resolvedSettings.show_english,
      text: true,
    };

    const lineClassNameForField = (fieldName: string) =>
      fieldName === "sanskrit"
        ? "whitespace-pre-wrap text-base leading-relaxed text-[color:var(--deep)]"
        : fieldName === "transliteration"
          ? "whitespace-pre-wrap text-sm italic leading-relaxed text-zinc-700"
          : "whitespace-pre-wrap text-sm leading-relaxed text-zinc-700";

    const metadataLabelForField = (fieldName: string) => {
      if (fieldName === "sanskrit") {
        return contentFieldLabels.sanskrit || DEFAULT_CONTENT_FIELD_LABELS.sanskrit;
      }
      if (fieldName === "transliteration") {
        return contentFieldLabels.transliteration || DEFAULT_CONTENT_FIELD_LABELS.transliteration;
      }
      if (fieldName === "english") {
        return contentFieldLabels.english || DEFAULT_CONTENT_FIELD_LABELS.english;
      }
      return "Text";
    };

    const lines: Array<{
      key: string;
      label: string;
      value: string;
      className: string;
      fieldName: string;
      isFieldStart: boolean;
    }> = [];
    const renderedLines = Array.isArray(block.content.rendered_lines) ? block.content.rendered_lines : [];
    const blockTranslations = toTranslationRecord(block.content.translations);
    const primaryPreviewTranslationLanguage =
      appliedPreviewTranslationLanguages[0] ||
      (normalizeTranslationLanguage(effectiveSourceLanguage) as EditableTranslationLanguage);
    const appendSelectedTranslationLines = () => {
      if (!resolvedSettings.show_english) {
        return;
      }
      const existingValues = new Set(lines.map((line) => (line.value || "").trim()).filter(Boolean));
      for (const language of appliedPreviewTranslationLanguages) {
        if (language === primaryPreviewTranslationLanguage) {
          continue;
        }
        const value = pickTranslationTextForLanguageOnly(blockTranslations, language);
        if (!value || existingValues.has(value)) {
          continue;
        }
        lines.push({
          key: `translation-${language}`,
          label: appliedShowPreviewLabels ? `${translationLanguageLabel(language)} Translation` : "",
          value,
          className: lineClassNameForField("english"),
          fieldName: "english",
          isFieldStart: true,
        });
        existingValues.add(value);
      }
    };
    if (renderedLines.length > 0) {
      let previousFieldName = "";
      for (let index = 0; index < renderedLines.length; index += 1) {
        const line = renderedLines[index];
        const rawValue = (line?.value || "").trim();
        if (!rawValue) {
          continue;
        }

        const fieldName = (line?.field || "text").trim().toLowerCase();
        if (fieldName in visibleByKey && !visibleByKey[fieldName]) {
          continue;
        }

        const value =
          fieldName === "transliteration"
            ? hasDevanagariLetters(rawValue)
              ? transliterateFromDevanagari(rawValue, appliedPreviewTransliterationScript)
              : transliterateFromIast(rawValue, appliedPreviewTransliterationScript)
            : rawValue;

        const rawLabel = (line?.label || "").trim();
        const baseLabel = metadataLabelForField(fieldName);
        const computedLabel =
          fieldName === "transliteration"
            ? `${baseLabel} (${transliterationScriptLabel(appliedPreviewTransliterationScript)})`
            : rawLabel || baseLabel;
        const isFieldStart = fieldName !== previousFieldName;
        const label = appliedShowPreviewLabels && isFieldStart ? computedLabel : "";

        lines.push({
          key: `${fieldName || "line"}-${index}`,
          label,
          value,
          className: lineClassNameForField(fieldName),
          fieldName,
          isFieldStart,
        });

        previousFieldName = fieldName;
      }

      appendSelectedTranslationLines();
      if (lines.length > 0) {
        return lines;
      }
    }

    for (const key of resolvedSettings.text_order) {
      const rawValue = (block.content[key] || "").trim();
      const value =
        key === "transliteration"
          ? hasDevanagariLetters(rawValue)
            ? transliterateFromDevanagari(rawValue, appliedPreviewTransliterationScript)
            : transliterateFromIast(rawValue, appliedPreviewTransliterationScript)
          : rawValue;
      if (!value || !visibleByKey[key]) {
        continue;
      }

      const label = appliedShowPreviewLabels
        ? key === "sanskrit"
          ? metadataLabelForField("sanskrit")
          : key === "transliteration"
            ? `${metadataLabelForField("transliteration")} (${transliterationScriptLabel(appliedPreviewTransliterationScript)})`
            : key === "english"
              ? metadataLabelForField("english")
              : "Text"
        : "";

      const className = lineClassNameForField(key);

      lines.push({ key, label, value, className, fieldName: key, isFieldStart: true });
    }

    appendSelectedTranslationLines();

    if (lines.length === 0) {
      const fallback = (block.content.text || "").trim();
      if (fallback) {
        lines.push({
          key: "text",
          label: "Text",
          value: fallback,
          className: "whitespace-pre-wrap text-sm leading-relaxed text-zinc-700",
          fieldName: "text",
          isFieldStart: true,
        });
      }
    }

    return lines;
  }, [
    appliedBookPreviewTransliterationScript,
    appliedPreviewTranslationLanguages,
    appliedShowPreviewLabels,
    contentFieldLabels.english,
    contentFieldLabels.sanskrit,
    contentFieldLabels.transliteration,
    preferences?.source_language,
  ]);

  const resolvePreviewWordMeanings = useCallback((block: BookPreviewBlock) => {
    const appliedPreviewTransliterationScript = normalizeTransliterationScript(
      appliedBookPreviewTransliterationScript
    );
    const rows = Array.isArray(block.content.word_meanings_rows)
      ? block.content.word_meanings_rows
      : [];

    return rows
      .map((row, index) => {
        const sourceText = (row?.resolved_source?.text || "").trim();
        const sourceMode = (row?.resolved_source?.mode || "").trim().toLowerCase();
        const sourceScheme = (row?.resolved_source?.scheme || "").trim().toLowerCase();
        const sourceLanguage = (row?.source?.language || "").trim().toLowerCase();
        const meaningText = (row?.resolved_meaning?.text || "").trim();
        if (!sourceText && !meaningText) {
          return null;
        }

        let renderedSourceText = sourceText;
        if (sourceText && sourceLanguage === "sa") {
          if (hasDevanagariLetters(sourceText)) {
            renderedSourceText = transliterateFromDevanagari(
              sourceText,
              appliedPreviewTransliterationScript
            );
          } else if (sourceMode === "transliteration" && (!sourceScheme || sourceScheme === "iast")) {
            renderedSourceText = transliterateFromIast(
              sourceText,
              appliedPreviewTransliterationScript
            );
          }
        }

        return {
          key: `${row?.id || "wm"}_${row?.order || index + 1}_${index}`,
          sourceText: renderedSourceText,
          meaningText,
          meaningLanguage: (row?.resolved_meaning?.language || "").trim().toLowerCase(),
          fallbackBadgeVisible: Boolean(row?.resolved_meaning?.fallback_badge_visible),
        };
      })
      .filter((row): row is {
        key: string;
        sourceText: string;
        meaningText: string;
        meaningLanguage: string;
        fallbackBadgeVisible: boolean;
      } => Boolean(row));
  }, [appliedBookPreviewTransliterationScript]);

  const loadMetadataCategories = async (): Promise<MetadataCategory[]> => {
    setMetadataCategoriesLoading(true);
    try {
      const response = await fetch("/api/metadata/categories", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | MetadataCategory[]
        | { detail?: string }
        | null;
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to load metadata categories");
      }
      const categories = Array.isArray(payload) ? payload : [];
      const visibleCategories = categories.filter(
        (category) => !category.is_deprecated && isBookScopedCategory(category)
      );
      setMetadataCategories(visibleCategories);
      return visibleCategories;
    } catch {
      setMetadataCategories([]);
      return [];
    } finally {
      setMetadataCategoriesLoading(false);
    }
  };

  const loadEffectiveProperties = async (categoryId: number) => {
    const response = await fetch(`/api/metadata/categories/${categoryId}/effective-properties`, {
      credentials: "include",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | CategoryEffectiveProperties
      | { detail?: string }
      | null;
    if (!response.ok) {
      throw new Error((payload as { detail?: string } | null)?.detail || "Failed to load category properties");
    }
    return (payload as CategoryEffectiveProperties).properties || [];
  };

  const propertiesEndpoint = (scope: PropertiesScope, nodeId: number | null) => {
    if (!bookId) {
      throw new Error("Book is required");
    }
    if (scope === "book") {
      return `/api/books/${bookId}/metadata-binding`;
    }
    if (!nodeId) {
      throw new Error("Node is required");
    }
    return `/api/books/${bookId}/nodes/${nodeId}/metadata-binding`;
  };

  const toRecord = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  };

  const deriveNodeMetadataFallback = (nodePayload: {
    level_name?: string | null;
    sequence_number?: string | number | null;
    title_english?: string | null;
    title_sanskrit?: string | null;
    title_transliteration?: string | null;
    content_data?: {
      basic?: {
        sanskrit?: string | null;
        transliteration?: string | null;
        translation?: string | null;
      } | null;
      translations?: Record<string, string> | null;
      [key: string]: unknown;
    } | null;
    summary_data?: {
      basic?: {
        sanskrit?: string | null;
        transliteration?: string | null;
        translation?: string | null;
      } | null;
      translations?: Record<string, string> | null;
      [key: string]: unknown;
    } | null;
  }): Record<string, unknown> => {
    const fallback: Record<string, unknown> = {};
    const contentData = toRecord(nodePayload.content_data);
    const summaryData = toRecord(nodePayload.summary_data);
    const basic = toRecord(contentData.basic);
    const summaryBasic = toRecord(summaryData.basic);
    const translations = toTranslationRecord(contentData.translations);
    const summaryTranslations = toTranslationRecord(summaryData.translations);
    const pickFirstNonEmptyString = (...values: unknown[]): string => {
      for (const value of values) {
        if (typeof value === "string" && value.trim()) {
          return value;
        }
      }
      return "";
    };

    const sanskritText = pickFirstNonEmptyString(
      basic.sanskrit,
      contentData.sanskrit,
      contentData.text_sanskrit,
      summaryBasic.sanskrit,
      summaryBasic.text_sanskrit,
      summaryData.sanskrit,
      summaryData.text_sanskrit
    );
    const transliterationText = pickFirstNonEmptyString(
      basic.transliteration,
      basic.iast,
      contentData.transliteration,
      contentData.iast,
      contentData.text_transliteration,
      summaryBasic.transliteration,
      summaryBasic.iast,
      summaryData.transliteration,
      summaryData.iast,
      summaryData.text_transliteration
    );
    const translationText = pickPreferredTranslationText(
      {
        ...summaryTranslations,
        ...translations,
      },
      sourceLanguage,
      basic.translation,
      basic.english,
      contentData.english,
      contentData.en,
      contentData.translation,
      contentData.text_english,
      summaryBasic.translation,
      summaryBasic.english,
      summaryData.english,
      summaryData.en,
      summaryData.translation,
      summaryData.text_english
    );
    const normalizedLevel = (nodePayload.level_name || "content")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const levelSegment = normalizedLevel || "content";
    const defaultTemplateKey = `default.body.${levelSegment}.content_item.v1`;

    fallback.render_template_key = defaultTemplateKey;
    fallback.template_key = defaultTemplateKey;
    fallback.level_template_key = defaultTemplateKey;
    fallback.content_template_key = defaultTemplateKey;
    fallback[`${levelSegment}_template_key`] = defaultTemplateKey;
    fallback[`body_${levelSegment}_template_key`] = defaultTemplateKey;

    if (sanskritText) {
      fallback.sanskrit = sanskritText;
      fallback.text_sanskrit = sanskritText;
      fallback.sanskrit_text = sanskritText;
      fallback.verse_sanskrit = sanskritText;
      fallback.shloka = sanskritText;
    }
    if (transliterationText) {
      fallback.transliteration = transliterationText;
      fallback.iast = transliterationText;
      fallback.text_transliteration = transliterationText;
      fallback.transliteration_text = transliterationText;
      fallback.verse_transliteration = transliterationText;
    }
    if (translationText) {
      fallback.translation = translationText;
      fallback.english = translationText;
      fallback.text_english = translationText;
      fallback.english_text = translationText;
      fallback.english_translation = translationText;
      fallback.verse_translation = translationText;
    }
    const sequenceNumberValue =
      nodePayload.sequence_number !== null && nodePayload.sequence_number !== undefined
        ? String(nodePayload.sequence_number).trim()
        : "";
    if (sequenceNumberValue) {
      fallback.sequence_number = sequenceNumberValue;
      const sequenceMatch = sequenceNumberValue.match(/^(\d+)(?:\.(\d+))?/);
      if (sequenceMatch?.[1]) {
        fallback.chapter_number = sequenceMatch[1];
      }
      if (sequenceMatch?.[2]) {
        fallback.verse_number = sequenceMatch[2];
        fallback.shloka_number = sequenceMatch[2];
      } else {
        fallback.verse_number = sequenceNumberValue;
        fallback.shloka_number = sequenceNumberValue;
      }
    }
    if (typeof nodePayload.title_english === "string" && nodePayload.title_english.trim()) {
      fallback.title_english = nodePayload.title_english;
    }
    if (typeof nodePayload.title_sanskrit === "string" && nodePayload.title_sanskrit.trim()) {
      fallback.title_sanskrit = nodePayload.title_sanskrit;
    }
    if (typeof nodePayload.title_transliteration === "string" && nodePayload.title_transliteration.trim()) {
      fallback.title_transliteration = nodePayload.title_transliteration;
    }

    return fallback;
  };

  const readCategoryIdFromMetadata = (
    metadata: Record<string, unknown>,
    categories: MetadataCategory[]
  ): number | null => {
    const categoryIdCandidates = [metadata.category_id, metadata.categoryId];
    for (const categoryCandidate of categoryIdCandidates) {
      if (
        typeof categoryCandidate === "number" &&
        Number.isFinite(categoryCandidate) &&
        categoryCandidate > 0
      ) {
        return categoryCandidate;
      }
      if (typeof categoryCandidate === "string") {
        const parsed = Number(categoryCandidate);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }

    const categoryNameCandidates = [metadata.category_name, metadata.categoryName, metadata.category]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (categoryNameCandidates.length === 0) {
      return null;
    }

    const categoriesByNormalizedName = new Map<string, number>();
    categories.forEach((category) => {
      categoriesByNormalizedName.set(normalizeMetadataKey(category.name), category.id);
    });

    for (const categoryName of categoryNameCandidates) {
      const matchedCategoryId = categoriesByNormalizedName.get(normalizeMetadataKey(categoryName));
      if (matchedCategoryId) {
        return matchedCategoryId;
      }
    }

    return null;
  };

  const inferCategoryIdFromMetadata = async (
    metadata: Record<string, unknown>,
    categories: MetadataCategory[]
  ): Promise<number | null> => {
    const ignoredKeys = new Set(["owner_id", "status", "visibility", "category_id", "category_name", "category"]);
    const metadataKeys = Object.keys(metadata)
      .map((key) => normalizeMetadataKey(key))
      .filter((key) => key && !ignoredKeys.has(key));
    const candidateCategories = categories.filter((category) => !category.is_deprecated);
    if (candidateCategories.length === 0) {
      return null;
    }

    if (metadataKeys.length === 0) {
      return candidateCategories.length === 1 ? candidateCategories[0].id : null;
    }

    let bestCategoryId: number | null = null;
    let bestScore = 0;

    for (const category of candidateCategories) {
      try {
        const effective = await loadEffectiveProperties(category.id);
        const effectiveKeys = new Set(
          effective.map((field) => normalizeMetadataKey(field.property_internal_name))
        );
        let score = 0;
        metadataKeys.forEach((key) => {
          if (effectiveKeys.has(key)) {
            score += 1;
          }
        });

        if (score > bestScore) {
          bestScore = score;
          bestCategoryId = category.id;
        }
      } catch {
        continue;
      }
    }

    return bestScore > 0 ? bestCategoryId : null;
  };

  const loadNodeMetadataSnapshot = async (nodeId: number): Promise<Record<string, unknown>> => {
    const mergePreferNonEmpty = (
      baseValues: Record<string, unknown>,
      overlayValues: Record<string, unknown>
    ): Record<string, unknown> => {
      const merged: Record<string, unknown> = { ...baseValues };
      Object.entries(overlayValues).forEach(([key, value]) => {
        if (!isEmptyMetadataValue(value)) {
          merged[key] = value;
        } else if (!(key in merged)) {
          merged[key] = value;
        }
      });
      return merged;
    };

    if (nodeContent?.id === nodeId) {
      const fromCurrent = toRecord(nodeContent.metadata_json || nodeContent.metadata);
      const derivedFromCurrent = deriveNodeMetadataFallback(nodeContent);
      if (Object.keys(fromCurrent).length > 0 || Object.keys(derivedFromCurrent).length > 0) {
        return mergePreferNonEmpty(derivedFromCurrent, fromCurrent);
      }
    }

    try {
      const response = await fetch(contentPath(`/nodes/${nodeId}`), {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        return {};
      }
      const payload = (await response.json().catch(() => null)) as
        | {
            metadata_json?: unknown;
            metadata?: unknown;
          level_name?: string | null;
            sequence_number?: string | number | null;
            title_english?: string | null;
            title_sanskrit?: string | null;
            title_transliteration?: string | null;
            content_data?: {
              basic?: {
                sanskrit?: string;
                transliteration?: string;
                translation?: string;
              };
              translations?: {
                english?: string;
              };
              [key: string]: unknown;
            } | null;
            summary_data?: {
              basic?: {
                sanskrit?: string;
                transliteration?: string;
                translation?: string;
              };
              translations?: {
                english?: string;
              };
              [key: string]: unknown;
            } | null;
          }
        | null;
      const fromMetadata = toRecord(payload?.metadata_json || payload?.metadata);
      const derivedFromPayload = payload ? deriveNodeMetadataFallback(payload) : {};
      if (Object.keys(fromMetadata).length > 0 || Object.keys(derivedFromPayload).length > 0) {
        return mergePreferNonEmpty(derivedFromPayload, fromMetadata);
      }
      return {};
    } catch {
      return {};
    }
  };

  const openPropertiesModal = async (scope: PropertiesScope, nodeId: number | null = null) => {
    if (!bookId) return;
    if (scope === "node" && !nodeId) return;

    setShowPropertiesModal(true);
    setPropertiesScope(scope);
    setPropertiesNodeId(nodeId);
    setPropertiesName(
      scope === "book"
        ? currentBook?.book_name || ""
        : nodeContent?.title_english ||
            nodeContent?.title_sanskrit ||
            nodeContent?.title_transliteration ||
            `Node ${nodeId || ""}`
    );
              setPropertiesDescription("");
              setPropertiesInitialDescription("");
    if (scope === "book") {
      const metadata = getBookMetadataObject(currentBook) || {};
      setPropertiesBookAuthor(typeof metadata.author === "string" ? metadata.author : "");
      setPropertiesBookTitleEnglish(
        typeof metadata.title_english === "string" ? metadata.title_english : ""
      );
      setPropertiesBookTitleSanskrit(
        typeof metadata.title_sanskrit === "string" ? metadata.title_sanskrit : ""
      );
      setPropertiesBookTitleTransliteration(
        typeof metadata.title_transliteration === "string"
          ? metadata.title_transliteration
          : ""
      );
      const enabledLevels = getWordMeaningsEnabledLevelsFromBook(currentBook);
      const schemaLevels = Array.isArray(currentBook?.schema?.levels)
        ? currentBook.schema.levels.filter(
            (level): level is string => typeof level === "string" && level.trim().length > 0
          )
        : [];
      setPropertiesWordMeaningsEnabledLevels(
        schemaLevels.filter((level) => enabledLevels.has(level.trim().toLowerCase()))
      );
      const existingRegistry = currentBook?.variant_authors ?? {};
      const existingRegistryRows = Object.entries(existingRegistry).map(([slug, name]) => ({
        slug,
        name: name as string,
      }));
      const derivedRegistryRows = Array.from(availableVariantAuthors.entries()).map(([slug, name]) => ({
        slug,
        name,
      }));
      setVariantAuthorsRegistry(
        existingRegistryRows.length > 0 ? existingRegistryRows : derivedRegistryRows
      );
      setVariantAuthorsError(null);
      setVariantAuthorsMessage(null);
    } else {
      setPropertiesBookAuthor("");
      setPropertiesBookTitleEnglish("");
      setPropertiesBookTitleSanskrit("");
      setPropertiesBookTitleTransliteration("");
      setPropertiesWordMeaningsEnabledLevels([]);
      setVariantAuthorsRegistry([]);
    }
    setPropertiesLoading(true);
    setPropertiesSaving(false);
    setPropertiesDirty(false);
    setPropertiesError(null);
    setPropertiesMessage(null);
    resetLevelTemplateSelection();

    if (scope === "node" && nodeId) {
      void loadNodeMedia(nodeId, true);
    }

    try {
      const endpoint = propertiesEndpoint(scope, nodeId);
      const scopedMetadataSnapshot =
        scope === "node" && nodeId
          ? await loadNodeMetadataSnapshot(nodeId)
          : toRecord(currentBook?.metadata_json || currentBook?.metadata);
      const scopedDescription =
        typeof scopedMetadataSnapshot.description === "string"
          ? scopedMetadataSnapshot.description
          : "";
      setPropertiesDescription(scopedDescription);
      setPropertiesInitialDescription(scopedDescription);

      const availableCategories =
        metadataCategories.length > 0 ? metadataCategories : await loadMetadataCategories();

      const response = await fetch(endpoint, {
        credentials: "include",
        cache: "no-store",
      });

      let binding: ResolvedMetadata | null = null;
      if (response.ok) {
        binding = (await response.json()) as ResolvedMetadata;
      } else if (response.status === 404 && scope === "node" && bookId) {
        const fallbackResponse = await fetch(`/api/books/${bookId}/metadata-binding`, {
          credentials: "include",
          cache: "no-store",
        });
        if (fallbackResponse.ok) {
          binding = (await fallbackResponse.json()) as ResolvedMetadata;
        } else if (fallbackResponse.status !== 404) {
          const payload = (await fallbackResponse.json().catch(() => null)) as { detail?: string } | null;
          throw new Error(payload?.detail || "Failed to load metadata properties");
        }
      } else if (response.status !== 404) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || "Failed to load metadata properties");
      }

      let categoryId =
        binding?.category_id ?? readCategoryIdFromMetadata(scopedMetadataSnapshot, availableCategories) ?? null;
      if (!categoryId && scope === "node") {
        categoryId = await inferCategoryIdFromMetadata(scopedMetadataSnapshot, availableCategories);
      }
      if (!categoryId && scope === "book") {
        const defaultCategory =
          availableCategories.find((category) => category.name === "system_default_metadata") ||
          availableCategories[0];
        categoryId = defaultCategory?.id ?? null;
      }
      if (!categoryId) {
        setPropertiesCategoryId(null);
        setPropertiesEffectiveFields([]);
        setPropertiesValues({});
        return;
      }

      const effective = await loadEffectiveProperties(categoryId);
      const visibleEffective = filterVisibleMetadataFields(effective);
      const fieldByNormalizedKey = new Map<string, EffectivePropertyBinding>();
      visibleEffective.forEach((field) => {
        fieldByNormalizedKey.set(normalizeMetadataKey(field.property_internal_name), field);
      });
      const values: Record<string, unknown> = {};
      const bindingProvidedKeys = new Set<string>();
      visibleEffective.forEach((field) => {
        values[field.property_internal_name] = getFieldDefaultValue(field);
      });
      if (binding) {
        binding.properties.forEach((item) => {
          const field = visibleEffective.find(
            (candidate) => candidate.property_internal_name === item.property_internal_name
          );
          if (!field) {
            return;
          }
          const nextValue = item.value ?? null;
          if (!isUsableBindingValueForField(field, nextValue)) {
            return;
          }
          values[item.property_internal_name] = nextValue;
          bindingProvidedKeys.add(item.property_internal_name);
        });
        Object.entries(binding.property_overrides || {}).forEach(([key, value]) => {
          const field = visibleEffective.find((candidate) => candidate.property_internal_name === key);
          if (!field) {
            return;
          }
          if (!isUsableBindingValueForField(field, value)) {
            return;
          }
          values[key] = value;
          bindingProvidedKeys.add(key);
        });
      }

      Object.entries(scopedMetadataSnapshot).forEach(([key, value]) => {
        const field = fieldByNormalizedKey.get(normalizeMetadataKey(key));
        if (!field) {
          return;
        }
        const internalName = field.property_internal_name;
        if (bindingProvidedKeys.has(internalName) && !isEmptyMetadataValue(values[internalName])) {
          return;
        }
        if (value !== undefined && !isEmptyMetadataValue(value)) {
          values[internalName] = value;
        }
      });

      if (scope === "node") {
        const pickSnapshotText = (...candidates: string[]): string => {
          for (const candidate of candidates) {
            const value = scopedMetadataSnapshot[candidate];
            if (typeof value === "string" && value.trim()) {
              return value;
            }
          }
          return "";
        };

        const sanskritFallback = pickSnapshotText(
          "sanskrit_text",
          "verse_sanskrit",
          "shloka",
          "sanskrit"
        );
        const transliterationFallback = pickSnapshotText(
          "transliteration",
          "iast",
          "text_transliteration",
          "transliteration_text",
          "verse_transliteration"
        );
        const englishFallback = pickSnapshotText(
          "english",
          "translation",
          "text_english",
          "english_text",
          "english_translation",
          "verse_translation"
        );
        const chapterFallback = pickSnapshotText("chapter_number", "chapter");
        const verseFallback = pickSnapshotText("verse_number", "shloka_number", "sequence_number");

        visibleEffective.forEach((field) => {
          const key = field.property_internal_name;
          if (!isEmptyMetadataValue(values[key])) {
            return;
          }
          const normalized = key.toLowerCase();

          if (sanskritFallback && (normalized.includes("sanskrit") || normalized === "shloka")) {
            values[key] = sanskritFallback;
            return;
          }
          if (
            transliterationFallback &&
            (normalized.includes("transliteration") || normalized.includes("iast"))
          ) {
            values[key] = transliterationFallback;
            return;
          }
          if (
            englishFallback &&
            (normalized.includes("english") ||
              (normalized.includes("translation") && !normalized.includes("transliteration")))
          ) {
            values[key] = englishFallback;
            return;
          }
          if (chapterFallback && normalized.includes("chapter") && normalized.includes("number")) {
            values[key] = chapterFallback;
            return;
          }
          if (
            verseFallback &&
            (normalized.includes("verse") || normalized.includes("shloka")) &&
            normalized.includes("number")
          ) {
            values[key] = verseFallback;
          }
        });
      }

      setPropertiesCategoryId(categoryId);
      setPropertiesEffectiveFields(visibleEffective);
      setPropertiesValues(values);

      if (scope === "node") {
        const selectedTreeNode = nodeId ? findNodeById(treeData, nodeId) : null;
        const normalizedLevelKey = (selectedTreeNode?.level_name || nodeContent?.level_name || "")
          .trim()
          .toLowerCase();
        if (normalizedLevelKey) {
          setPropertiesLevelKey(normalizedLevelKey);
          setLevelDefaultTemplateKey(
            getDefaultTemplateKeyFromSnapshot(scopedMetadataSnapshot, normalizedLevelKey)
          );
          await loadLevelTemplateSelection(normalizedLevelKey);
        }
      }
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : "Failed to load metadata");
    } finally {
      setPropertiesLoading(false);
    }
  };

  const handlePropertiesCategoryChange = async (nextCategoryIdRaw: string) => {
    const nextCategoryId = Number(nextCategoryIdRaw);
    if (!Number.isFinite(nextCategoryId) || nextCategoryId <= 0) {
      setPropertiesCategoryId(null);
      setPropertiesEffectiveFields([]);
      setPropertiesValues({});
      setPropertiesError(null);
      setPropertiesMessage(null);
      return;
    }

    setPropertiesDirty(true);
    setPropertiesLoading(true);
    setPropertiesError(null);
    setPropertiesMessage(null);

    try {
      const effective = await loadEffectiveProperties(nextCategoryId);
      const visibleEffective = filterVisibleMetadataFields(effective);
      const values: Record<string, unknown> = {};
      visibleEffective.forEach((field) => {
        values[field.property_internal_name] = getFieldDefaultValue(field);
      });
      setPropertiesCategoryId(nextCategoryId);
      setPropertiesEffectiveFields(visibleEffective);
      setPropertiesValues(values);
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : "Failed to load category metadata properties");
    } finally {
      setPropertiesLoading(false);
    }
  };

  const handlePropertiesValueChange = (propertyName: string, value: unknown) => {
    setPropertiesValues((prev) => ({
      ...prev,
      [propertyName]: value,
    }));
    setPropertiesDirty(true);
    setPropertiesMessage(null);
    setPropertiesError(null);
  };

  const getDefaultTemplateKeyFromSnapshot = (
    metadataSnapshot: Record<string, unknown>,
    normalizedLevelKey: string
  ): string => {
    const levelSegment = normalizedLevelKey
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const candidates = [
      "render_template_key",
      `${levelSegment}_template_key`,
      `body_${levelSegment}_template_key`,
      "level_template_key",
      "content_template_key",
      "template_key",
    ];

    for (const key of candidates) {
      const value = metadataSnapshot[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return "";
  };

  const resetLevelTemplateSelection = () => {
    setPropertiesLevelKey("");
    setLevelDefaultTemplateKey("");
    setLevelTemplates([]);
    setLevelTemplateAssignmentId(null);
    setSelectedLevelTemplateId("");
    setLevelTemplatesLoading(false);
    setLevelTemplateSaving(false);
    setLevelTemplateError(null);
    setLevelTemplateMessage(null);
  };

  const loadLevelTemplateSelection = async (levelKey: string) => {
    if (!bookId || !levelKey) {
      resetLevelTemplateSelection();
      return;
    }

    setLevelTemplatesLoading(true);
    setLevelTemplateError(null);
    setLevelTemplateMessage(null);

    try {
      const [templatesRes, assignmentsRes] = await Promise.all([
        fetch("/api/templates?include_published=true&include_inactive=false", {
          credentials: "include",
        }),
        fetch(`/api/templates/assignments/my?entity_type=book&entity_id=${bookId}`, {
          credentials: "include",
        }),
      ]);

      const templatesPayload = (await templatesRes.json().catch(() => null)) as
        | LevelTemplateOption[]
        | { detail?: string }
        | null;
      if (!templatesRes.ok) {
        throw new Error((templatesPayload as { detail?: string } | null)?.detail || "Failed to load templates");
      }

      const assignmentsPayload = (await assignmentsRes.json().catch(() => null)) as
        | LevelTemplateAssignment[]
        | { detail?: string }
        | null;
      if (!assignmentsRes.ok) {
        throw new Error((assignmentsPayload as { detail?: string } | null)?.detail || "Failed to load template assignments");
      }

      const currentSchemaId = Number(currentBook?.schema?.id || 0);
      const allTemplates = Array.isArray(templatesPayload) ? templatesPayload : [];
      const templates = allTemplates.filter((template) => {
        const templateLevel = (template.target_level || "").trim().toLowerCase();
        if (!template.is_active || templateLevel !== levelKey) {
          return false;
        }
        const schemaMatch = currentSchemaId > 0 && template.target_schema_id === currentSchemaId;
        const globalSystemMatch = Boolean(template.is_system) && !template.target_schema_id;
        if (currentSchemaId > 0 && !schemaMatch && !globalSystemMatch) {
          return false;
        }
        return true;
      });

      const assignment = (Array.isArray(assignmentsPayload) ? assignmentsPayload : []).find(
        (item) =>
          item.entity_type === "book" &&
          item.entity_id === Number(bookId) &&
          item.is_active &&
          (item.level_key || "").trim().toLowerCase() === levelKey
      );

      const schemaDefaults = currentBook?.schema?.level_template_defaults || {};
      const schemaDefaultEntry = Object.entries(schemaDefaults).find(
        ([level]) => level.trim().toLowerCase() === levelKey
      );
      const schemaDefaultTemplateId = schemaDefaultEntry ? Number(schemaDefaultEntry[1]) : null;
      if (schemaDefaultTemplateId && Number.isFinite(schemaDefaultTemplateId) && schemaDefaultTemplateId > 0) {
        const schemaDefaultTemplate = allTemplates.find((item) => item.id === schemaDefaultTemplateId);
        if (schemaDefaultTemplate) {
          setLevelDefaultTemplateKey(
            `${schemaDefaultTemplate.name} (v${schemaDefaultTemplate.current_version}, ${schemaDefaultTemplate.visibility})`
          );
        } else {
          setLevelDefaultTemplateKey(`Template #${schemaDefaultTemplateId}`);
        }
      }

      setLevelTemplates(templates);
      setLevelTemplateAssignmentId(assignment?.id ?? null);
      setSelectedLevelTemplateId(assignment ? String(assignment.template_id) : "");
    } catch (err) {
      setLevelTemplates([]);
      setLevelTemplateAssignmentId(null);
      setSelectedLevelTemplateId("");
      setLevelTemplateError(err instanceof Error ? err.message : "Failed to load level templates");
    } finally {
      setLevelTemplatesLoading(false);
    }
  };

  const assignLevelTemplate = async () => {
    if (!bookId || !propertiesLevelKey) {
      setLevelTemplateError("Open a level properties dialog to assign a template");
      return;
    }
    if (!selectedLevelTemplateId) {
      setLevelTemplateError("Select a template to assign");
      return;
    }

    setLevelTemplateSaving(true);
    setLevelTemplateError(null);
    setLevelTemplateMessage(null);

    try {
      const response = await fetch("/api/templates/assignments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "book",
          entity_id: Number(bookId),
          level_key: propertiesLevelKey,
          template_id: Number(selectedLevelTemplateId),
          priority: 100,
          is_active: true,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | LevelTemplateAssignment
        | { detail?: string }
        | null;

      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to assign template");
      }

      const assignment = payload as LevelTemplateAssignment;
      setLevelTemplateAssignmentId(assignment.id);
      setLevelTemplateMessage("Template assigned for this level");
      setPropertiesMessage("Properties saved");
    } catch (err) {
      setLevelTemplateError(err instanceof Error ? err.message : "Failed to assign template");
    } finally {
      setLevelTemplateSaving(false);
    }
  };

  const handleSaveVariantAuthors = async () => {
    if (!bookId) return;
    // Validate: slugs must be non-empty and unique
    const seen = new Set<string>();
    for (const row of variantAuthorsRegistry) {
      const slug = row.slug.trim();
      if (!slug) {
        setVariantAuthorsError("All author slugs must be non-empty");
        return;
      }
      if (seen.has(slug)) {
        setVariantAuthorsError(`Duplicate slug: "${slug}"`);
        return;
      }
      seen.add(slug);
    }
    const registry: Record<string, string> = {};
    for (const row of variantAuthorsRegistry) {
      registry[row.slug.trim()] = row.name.trim();
    }
    setVariantAuthorsSaving(true);
    setVariantAuthorsError(null);
    setVariantAuthorsMessage(null);
    try {
      const response = await fetch(`/api/books/${bookId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant_authors: registry }),
      });
      const payload = (await response.json().catch(() => null)) as BookDetails | { detail?: string } | null;
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to save author registry");
      }
      const updatedBook = payload as BookDetails;
      setCurrentBook(updatedBook);
      setBooks((prev) =>
        prev.map((b) => (b.id === updatedBook.id ? { ...b, variant_authors: updatedBook.variant_authors } : b))
      );
      setVariantAuthorsMessage("Saved");
    } catch (err) {
      setVariantAuthorsError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setVariantAuthorsSaving(false);
    }
  };

  const handleSaveProperties = async () => {
    const nextName = propertiesName.trim();
    const nextDescription = propertiesDescription.trim();
    if (!nextName) {
      setPropertiesError("Name is required");
      return;
    }

    const currentName =
      propertiesScope === "book"
        ? (currentBook?.book_name || "").trim()
        : (
            nodeContent?.title_english ||
            nodeContent?.title_sanskrit ||
            nodeContent?.title_transliteration ||
            `Node ${propertiesNodeId || ""}`
          ).trim();
    const currentDescription = propertiesInitialDescription.trim();
    const shouldUpdateName = nextName !== currentName;
    const shouldSaveDescription = nextDescription !== currentDescription;
    const shouldSaveNodeDescription = propertiesScope === "node" && shouldSaveDescription;
    const shouldSaveMetadata = Boolean(propertiesCategoryId);
    const existingBookMetadata = getBookMetadataObject(currentBook) || {};
    const currentBookTitleEnglish =
      typeof existingBookMetadata.title_english === "string"
        ? existingBookMetadata.title_english.trim()
        : "";
    const currentBookAuthor =
      typeof existingBookMetadata.author === "string"
        ? existingBookMetadata.author.trim()
        : "";
    const currentBookTitleSanskrit =
      typeof existingBookMetadata.title_sanskrit === "string"
        ? existingBookMetadata.title_sanskrit.trim()
        : "";
    const currentBookTitleTransliteration =
      typeof existingBookMetadata.title_transliteration === "string"
        ? existingBookMetadata.title_transliteration.trim()
        : "";
    const nextBookTitleEnglish = propertiesBookTitleEnglish.trim();
    const nextBookAuthor = propertiesBookAuthor.trim();
    const bookTitlePair = autoFillSanskritTransliterationPair(
      propertiesBookTitleSanskrit,
      propertiesBookTitleTransliteration
    );
    const nextBookTitleSanskrit = bookTitlePair.sanskrit;
    const nextBookTitleTransliteration = bookTitlePair.transliteration;
    const shouldSaveBookTitles =
      propertiesScope === "book" &&
      (nextBookTitleEnglish !== currentBookTitleEnglish ||
        nextBookAuthor !== currentBookAuthor ||
        nextBookTitleSanskrit !== currentBookTitleSanskrit ||
        nextBookTitleTransliteration !== currentBookTitleTransliteration);

    const currentWordMeaningsEnabledLevels = Array.from(getWordMeaningsEnabledLevelsFromBook(currentBook));
    const nextWordMeaningsEnabledLevels = normalizeWordMeaningsEnabledLevels(
      propertiesWordMeaningsEnabledLevels
    );
    const shouldSaveWordMeanings =
      propertiesScope === "book" &&
      JSON.stringify([...currentWordMeaningsEnabledLevels].sort()) !==
        JSON.stringify(nextWordMeaningsEnabledLevels);
    const shouldSaveBookMetadata =
      propertiesScope === "book" &&
      (shouldSaveBookTitles || shouldSaveWordMeanings || shouldSaveDescription);

    if (!shouldUpdateName && !shouldSaveMetadata && !shouldSaveBookMetadata && !shouldSaveNodeDescription) {
      setPropertiesError("No changes to save");
      return;
    }

    const propertyOverrides: Record<string, unknown> = {};
    propertiesEffectiveFields.forEach((field) => {
      const currentValue = normalizeMetadataValue(field.property_data_type, propertiesValues[field.property_internal_name]);
      const defaultValue = normalizeMetadataValue(field.property_data_type, getFieldDefaultValue(field));
      if (!valuesEqual(currentValue, defaultValue)) {
        propertyOverrides[field.property_internal_name] = currentValue;
      }
    });

    setPropertiesSaving(true);
    setPropertiesError(null);
    setPropertiesMessage(null);

    try {
      let didUpdateName = false;
      let didSaveBookMetadata = false;
      let didSaveDescription = false;
      let didSaveMetadata = false;

      if (shouldUpdateName) {
        if (propertiesScope === "book") {
          if (!bookId) {
            throw new Error("Select a book first");
          }
          const renameResponse = await fetch(`/api/books/${bookId}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book_name: nextName }),
          });
          const renamePayload = (await renameResponse.json().catch(() => null)) as
            | BookDetails
            | { detail?: string }
            | null;
          if (!renameResponse.ok) {
            throw new Error((renamePayload as { detail?: string } | null)?.detail || "Failed to update name");
          }
          const updatedBook = renamePayload as BookDetails;
          setCurrentBook(updatedBook);
          setBooks((prev) =>
            prev.map((book) =>
              book.id === updatedBook.id
                ? {
                    ...book,
                    book_name: updatedBook.book_name,
                    level_name_overrides: updatedBook.level_name_overrides,
                    metadata_json: updatedBook.metadata_json,
                    metadata: updatedBook.metadata,
                  }
                : book
            )
          );
          didUpdateName = true;
        } else {
          if (!propertiesNodeId) {
            throw new Error("Select a node first");
          }
          const renameResponse = await fetch(contentPath(`/nodes/${propertiesNodeId}`), {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title_english: nextName }),
          });
          const renamePayload = (await renameResponse.json().catch(() => null)) as
            | { detail?: string }
            | null;
          if (!renameResponse.ok) {
            throw new Error(renamePayload?.detail || "Failed to update name");
          }
          if (bookId) {
            const treeResponse = await fetch(`/api/books/${bookId}/tree`, {
              credentials: "include",
            });
            if (treeResponse.ok) {
              const flatData = (await treeResponse.json()) as TreeNode[];
              const data = nestFlatTreeNodes(flatData);
              setTreeData(data);
              const path = findPath(data, propertiesNodeId);
              if (path) {
                setBreadcrumb(path);
                setExpandedIds((prev) => {
                  const next = new Set(prev);
                  path.forEach((node) => next.add(node.id));
                  return next;
                });
              }
            }
          }
          await loadNodeContent(propertiesNodeId, true);
          didUpdateName = true;
        }
      }

      if (shouldSaveBookMetadata) {
        const nextMetadata: Record<string, unknown> = {
          ...existingBookMetadata,
        };
        if (shouldSaveDescription) {
          if (nextDescription) {
            nextMetadata.description = nextDescription;
          } else {
            delete nextMetadata.description;
          }
        }
        if (shouldSaveBookTitles) {
          if (nextBookAuthor) {
            nextMetadata.author = nextBookAuthor;
          } else {
            delete nextMetadata.author;
          }
          if (nextBookTitleEnglish) {
            nextMetadata.title_english = nextBookTitleEnglish;
          } else {
            delete nextMetadata.title_english;
          }
          if (nextBookTitleSanskrit) {
            nextMetadata.title_sanskrit = nextBookTitleSanskrit;
          } else {
            delete nextMetadata.title_sanskrit;
          }
          if (nextBookTitleTransliteration) {
            nextMetadata.title_transliteration = nextBookTitleTransliteration;
          } else {
            delete nextMetadata.title_transliteration;
          }
        }

        if (shouldSaveWordMeanings) {
          const existingWordMeaningsConfig = getWordMeaningsMetadataConfig(existingBookMetadata);
          if (nextWordMeaningsEnabledLevels.length > 0) {
            nextMetadata.word_meanings = {
              ...(existingWordMeaningsConfig || {}),
              enabled_levels: nextWordMeaningsEnabledLevels,
            };
          } else if (existingWordMeaningsConfig) {
            const { enabled_levels: _enabledLevels, ...restWordMeaningsConfig } = existingWordMeaningsConfig;
            if (Object.keys(restWordMeaningsConfig).length > 0) {
              nextMetadata.word_meanings = restWordMeaningsConfig;
            } else {
              delete nextMetadata.word_meanings;
            }
          } else {
            delete nextMetadata.word_meanings;
          }
        }

        const saved = await saveBookMetadata(
          nextMetadata,
          "Book details saved",
          "Failed to save book details"
        );
        if (!saved) {
          throw new Error("Failed to save book details");
        }
        didSaveBookMetadata = true;
      }

      if (shouldSaveNodeDescription) {
        if (!propertiesNodeId) {
          throw new Error("Select a node first");
        }
        const existingNodeMetadata = toRecord(nodeContent?.metadata_json || nodeContent?.metadata);
        const nextNodeMetadata: Record<string, unknown> = {
          ...existingNodeMetadata,
        };
        if (nextDescription) {
          nextNodeMetadata.description = nextDescription;
        } else {
          delete nextNodeMetadata.description;
        }
        const response = await fetch(contentPath(`/nodes/${propertiesNodeId}`), {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata_json: nextNodeMetadata }),
        });
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.detail || "Failed to save description");
        }
        await loadNodeContent(propertiesNodeId, true);
        didSaveDescription = true;
      }

      if (shouldSaveMetadata) {
        const endpoint = propertiesEndpoint(propertiesScope, propertiesNodeId);
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category_id: propertiesCategoryId,
            property_overrides: propertyOverrides,
            unset_overrides: [],
          }),
        });
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.detail || "Failed to save properties");
        }
        didSaveMetadata = true;
      }

      setPropertiesMessage(
        didUpdateName && didSaveBookMetadata && didSaveDescription && didSaveMetadata
          ? "Name, book details, description, and properties saved"
          : didUpdateName && didSaveBookMetadata && didSaveMetadata
            ? "Name, book details, and properties saved"
            : didUpdateName && didSaveDescription && didSaveMetadata
              ? "Name, description, and properties saved"
              : didSaveBookMetadata && didSaveMetadata
                ? "Book details and properties saved"
                : didSaveDescription && didSaveMetadata
                  ? "Description and properties saved"
                  : didUpdateName && didSaveBookMetadata
                    ? "Name and book details saved"
                    : didUpdateName && didSaveDescription
                      ? "Name and description saved"
                      : didSaveBookMetadata
                        ? "Book details saved"
                        : didSaveDescription
                          ? "Description saved"
                          : didUpdateName
                            ? "Name saved"
                            : "Properties saved"
      );
      await openPropertiesModal(propertiesScope, propertiesNodeId);
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : "Failed to save properties");
    } finally {
      setPropertiesSaving(false);
    }
  };

  const loadBasket = async () => {
    try {
      const response = await fetch("/api/cart/me", { credentials: "include" });
      if (!response.ok) {
        setBasketItems([]);
        return;
      }
      const data = (await response.json()) as {
        items?: Array<{
          id: number;
          item_id: number;
          order: number;
          metadata?: {
            title?: string;
            book_name?: string;
            level_name?: string;
          };
        }>;
      };

      const mappedItems = (data.items || [])
        .map((item) => ({
          cart_item_id: item.id,
          node_id: item.item_id,
          title: item.metadata?.title,
          book_name: item.metadata?.book_name,
          level_name: item.metadata?.level_name,
          order: item.order,
        }))
        .sort((a, b) => a.order - b.order);

      setBasketItems(mappedItems);
    } catch {
      setBasketItems([]);
    }
  };

  const loadAuth = async (force = false) => {
    try {
      const data = await getMe(force ? { force: true } : undefined);
      if (!data) {
        setAuthEmail(null);
        setAuthUserId(null);
        setAuthStatus("Not authenticated");
        setCanView(false);
        setCanAdmin(false);
        setCanContribute(false);
        setCanEdit(false);
        setCanImport(false);
        return;
      }
      setAuthUserId(data.id ?? null);
      setAuthEmail(data.email || null);
      setAuthStatus(data.email ? `Signed in as ${data.email}` : "Authenticated");
      const canViewPermission = (data.permissions as { can_view?: boolean } | undefined)?.can_view;
      const canImportPermission = (data.permissions as { can_import?: boolean } | undefined)?.can_import;
      setCanView(Boolean(canViewPermission || data.role === "viewer" || data.role === "contributor" || data.role === "editor" || data.role === "admin"));
      setCanAdmin(Boolean(data.permissions?.can_admin || data.role === "admin"));
      setCanContribute(Boolean(data.permissions?.can_contribute || data.role === "contributor" || data.role === "editor" || data.role === "admin"));
      setCanEdit(Boolean(data.permissions?.can_edit || data.role === "editor" || data.role === "admin"));
      setCanImport(Boolean(canImportPermission || data.permissions?.can_admin || data.role === "admin"));
    } catch {
      setAuthEmail(null);
      setAuthUserId(null);
      setAuthStatus("Auth check failed");
      setCanView(false);
      setCanAdmin(false);
      setCanContribute(false);
      setCanEdit(false);
      setCanImport(false);
    } finally {
      setAuthResolved(true);
    }
  };

  useEffect(() => {
    loadAuth();
  }, []);

  const currentBookMetadata =
    currentBook?.metadata_json || currentBook?.metadata || null;
  const parsedCurrentBookOwnerId = (() => {
    const owner = currentBookMetadata?.owner_id;
    if (typeof owner === "number") return owner;
    if (typeof owner === "string") {
      const parsed = Number.parseInt(owner, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  })();
  const currentBookOwnerId =
    parsedCurrentBookOwnerId;
  const isCurrentBookOwner =
    authUserId !== null && currentBookOwnerId !== null && currentBookOwnerId === authUserId;
  const canEditCurrentBook = Boolean(currentBook) && (canEdit || canAdmin || isCurrentBookOwner);
  const canExploreStructure = Boolean(bookId) && authUserId !== null && canView;
  const isExploreVisible = canExploreStructure && showExploreStructure;
  const activeNodeLevelLabel = formatValue(nodeContent?.level_name) || "Node";
  const activeNodePropertiesLabel = `${activeNodeLevelLabel} properties`;
  const activeNodePropertiesTitle = `${activeNodeLevelLabel} Properties`;
  const activeNodePreviewLabel = `Preview ${activeNodeLevelLabel}`;
  const activeNodeEditLabel = `Edit ${activeNodeLevelLabel}`;
  const activeNodeDeleteLabel = `Delete ${activeNodeLevelLabel}`;
  useEffect(() => {
    if (!canExploreStructure && showExploreStructure) {
      setShowExploreStructure(false);
      setMobilePanel("content");
    }
  }, [canExploreStructure, showExploreStructure]);

  useEffect(() => {
    if (!authResolved) return;

    if (!authEmail) {
      setBasketItems([]);
      return;
    }
    void loadBasket();
  }, [authResolved, authEmail]);

  useEffect(() => {
    const loadPreferences = async () => {
      if (typeof window === "undefined") {
        return;
      }

      if (!authEmail) {
        // Wait until auth is fully resolved before loading preferences.
        // If we load from localStorage while auth is still pending and then load
        // from the API once auth resolves, previewSettingsInitialized fires twice —
        // once from the stale anonymous data (setting previewSettingsInitialized.current = true)
        // and a second time that bails out early, leaving preview state vars at defaults.
        if (!authResolved) return;

        const storedUiPreferences = readStoredUiPreferences();
        const storedRaw = window.localStorage.getItem(LOCAL_SCRIPTURES_PREFERENCES_KEY);
        if (storedRaw) {
          try {
            const parsed = JSON.parse(storedRaw) as StoredScripturesPreferences;
            const normalized = normalizePreferences(parsed.preferences ?? parsed);
            normalized.scriptures_book_browser_view = readStoredBrowserView(
              SCRIPTURES_BOOK_BROWSER_VIEW_KEY
            );
            normalized.scriptures_media_manager_view = readStoredBrowserView(
              SCRIPTURES_MEDIA_MANAGER_VIEW_KEY
            );
            if (storedUiPreferences) {
              normalized.ui_theme = storedUiPreferences.ui_theme;
              normalized.ui_density = storedUiPreferences.ui_density;
            }
            if (typeof parsed.show_only_preferred_script === "boolean") {
              normalized.show_only_preferred_script = parsed.show_only_preferred_script;
            }
            setPreferences(normalized);
            setBookBrowserView(normalized.scriptures_book_browser_view ?? "list");
            const storedDensity = readStoredBookBrowserDensity();
            setBookBrowserDensity(
              resolveBookBrowserDensity(
                storedDensity,
                normalized.scriptures_book_browser_density,
                normalized.scriptures_book_browser_view ?? "list"
              )
            );
            setMediaManagerView(normalized.scriptures_media_manager_view ?? "list");
            const storedMediaDensity = readStoredMediaManagerDensity(mediaManagerScope);
            setMediaManagerDensity(
              resolveBookBrowserDensity(
                storedMediaDensity,
                0,
                normalized.scriptures_media_manager_view ?? "list"
              )
            );
            return;
          } catch {
            window.localStorage.removeItem(LOCAL_SCRIPTURES_PREFERENCES_KEY);
          }
        }

        const nextPreferences = {
          ...DEFAULT_USER_PREFERENCES,
          ...(storedUiPreferences || {}),
          scriptures_book_browser_view: readStoredBrowserView(SCRIPTURES_BOOK_BROWSER_VIEW_KEY),
          scriptures_media_manager_view: readStoredBrowserView(SCRIPTURES_MEDIA_MANAGER_VIEW_KEY),
        };
        setPreferences(nextPreferences);
        setBookBrowserView(nextPreferences.scriptures_book_browser_view ?? "list");
        const storedDensity = readStoredBookBrowserDensity();
        setBookBrowserDensity(
          resolveBookBrowserDensity(
            storedDensity,
            nextPreferences.scriptures_book_browser_density,
            nextPreferences.scriptures_book_browser_view ?? "list"
          )
        );
        setMediaManagerView(nextPreferences.scriptures_media_manager_view ?? "list");
        const storedMediaDensity = readStoredMediaManagerDensity(mediaManagerScope);
        setMediaManagerDensity(
          resolveBookBrowserDensity(
            storedMediaDensity,
            0,
            nextPreferences.scriptures_media_manager_view ?? "list"
          )
        );
        return;
      }

      try {
        const response = await fetch("/api/preferences", { credentials: "include" });
        if (!response.ok) return;
        const data = (await response.json()) as UserPreferences;
        const normalized = normalizePreferences(data);
        const localBookBrowserView = readStoredBrowserView(SCRIPTURES_BOOK_BROWSER_VIEW_KEY);
        const localBookBrowserDensity = readStoredBookBrowserDensity();
        const localMediaManagerView = readStoredBrowserView(SCRIPTURES_MEDIA_MANAGER_VIEW_KEY);
        const localMediaManagerDensity = readStoredMediaManagerDensity(mediaManagerScope);
        setPreferences(normalized);
        setBookBrowserView(localBookBrowserView);
        setBookBrowserDensity(
          resolveBookBrowserDensity(
            localBookBrowserDensity,
            normalized.scriptures_book_browser_density,
            normalized.scriptures_book_browser_view ?? "list"
          )
        );
        setMediaManagerView(localMediaManagerView);
        setMediaManagerDensity(
          resolveBookBrowserDensity(
            localMediaManagerDensity,
            normalized.scriptures_media_manager_density,
            normalized.scriptures_media_manager_view ?? "list"
          )
        );
      } catch {
        const nextPreferences = {
          ...DEFAULT_USER_PREFERENCES,
        };
        setPreferences(nextPreferences);
        setBookBrowserView(nextPreferences.scriptures_book_browser_view ?? "list");
        setBookBrowserDensity(
          resolveBookBrowserDensity(
            undefined,
            nextPreferences.scriptures_book_browser_density,
            nextPreferences.scriptures_book_browser_view ?? "list"
          )
        );
        setMediaManagerView(nextPreferences.scriptures_media_manager_view ?? "list");
        setMediaManagerDensity(
          resolveBookBrowserDensity(
            undefined,
            0,
            nextPreferences.scriptures_media_manager_view ?? "list"
          )
        );
      }
    };

    loadPreferences();
  }, [authEmail, authResolved]);

  useEffect(() => {
    if (!authResolved || !authEmail) {
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await fetch("/api/preferences", {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scriptures_book_browser_view: bookBrowserView,
              scriptures_book_browser_density: bookBrowserDensity,
              scriptures_media_manager_view: mediaManagerView,
              scriptures_media_manager_density: mediaManagerDensity,
            }),
          });
        } catch {
          // no-op: best-effort background preference sync
        }
      })();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [authResolved, authEmail, bookBrowserView, bookBrowserDensity, mediaManagerView, mediaManagerDensity]);

  useEffect(() => {
    if (!selectedId) {
      activeNodeMediaAbortController.current?.abort();
      setNodeMedia([]);
      setNodeMediaError(null);
      setNodeMediaLoading(false);
      setNodeMediaUploading(false);
      setNodeMediaUpdating(false);
      setNodeMediaMessage(null);
      setNodeMediaSearchQuery("");
      if (mediaManagerScope === "node") {
        setShowMediaManagerModal(false);
      }
      activeNodeCommentaryAbortController.current?.abort();
      setNodeCommentary([]);
      setNodeCommentaryError(null);
      setNodeCommentaryLoading(false);
      activeNodeCommentsAbortController.current?.abort();
      setNodeComments([]);
      setNodeCommentsError(null);
      setNodeCommentsLoading(false);
      setNodeCommentEditorOpen(false);
      setNodeCommentEditingId(null);
      setNodeCommentFormLanguage("en");
      setNodeCommentFormText("");
      setNodeCommentMessage(null);
      setCommentaryEditorOpen(false);
      setCommentaryEditingId(null);
      setCommentaryFormAuthor("");
      setCommentaryFormWorkTitle("");
      setCommentaryFormLanguage("en");
      setCommentaryFormText("");
      setCommentaryMessage(null);
      return;
    }

    void loadNodeMedia(selectedId);
    void loadNodeCommentary(selectedId);
    void loadNodeComments(selectedId);
  }, [selectedId, mediaManagerScope]);

  useEffect(() => {
    if (!showMediaManagerModal) {
      setMediaBankViewMode("manage");
      setExternalMediaFormOpen(false);
      setExternalMediaFormSubmitting(false);
      setBookMediaActionsOpen(false);
      setNodeMediaActionsOpen(false);
      return;
    }
    setMediaManagerSearchQuery("");
    setMediaManagerTypeFilter("all");
    setMediaBankError(null);
    setMediaBankMessage(null);
    setExternalMediaFormOpen(false);
    setExternalMediaFormSubmitting(false);
    setBookMediaActionsOpen(false);
    setNodeMediaActionsOpen(false);
    void loadMediaBankAssets();
  }, [showMediaManagerModal, mediaManagerScope, selectedId, bookId]);

  useEffect(() => {
    if (!authEmail) {
      setMetadataCategories([]);
      return;
    }
    void loadMetadataCategories();
  }, [authEmail]);

  useEffect(() => {
    if (!authEmail || metadataCategories.length === 0) {
      setContentFieldLabels({ ...DEFAULT_CONTENT_FIELD_LABELS });
      return;
    }

    const loadContentFieldLabels = async () => {
      const defaultCategory = metadataCategories.find((category) => category.name === "system_default_metadata") || metadataCategories[0];
      if (!defaultCategory) {
        setContentFieldLabels({ ...DEFAULT_CONTENT_FIELD_LABELS });
        return;
      }

      try {
        const effective = await loadEffectiveProperties(defaultCategory.id);
        const nextLabels: Record<string, string> = { ...DEFAULT_CONTENT_FIELD_LABELS };
        effective.forEach((field) => {
          const internalName = field.property_internal_name;
          if (!(internalName in nextLabels)) {
            return;
          }
          if (typeof field.property_display_name === "string" && field.property_display_name.trim()) {
            nextLabels[internalName] = field.property_display_name.trim();
          }
        });
        setContentFieldLabels(nextLabels);
      } catch {
        setContentFieldLabels({ ...DEFAULT_CONTENT_FIELD_LABELS });
      }
    };

    void loadContentFieldLabels();
  }, [authEmail, metadataCategories]);

  const addCurrentToBasket = () => {
    if (!nodeContent) return;

    void (async () => {
      if (basketItems.some((item) => item.node_id === nodeContent.id)) {
        return;
      }

      const seq = formatSequenceDisplay(
        nodeContent.sequence_number ?? nodeContent.id,
        Boolean(nodeContent.has_content)
      ) || nodeContent.id;
      const title = `${formatValue(nodeContent.level_name) || "Level"} ${seq}`;

      try {
        const response = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            item_id: nodeContent.id,
            item_type: "library_node",
            metadata: {
              title,
              book_name: currentBook?.book_name,
              level_name: nodeContent.level_name,
            },
          }),
        });

        if (response.status === 409) {
          await loadBasket();
          return;
        }

        if (!response.ok) {
          return;
        }

        const item = (await response.json()) as {
          id: number;
          item_id: number;
          order: number;
          metadata?: {
            title?: string;
            book_name?: string;
            level_name?: string;
          };
        };

        setBasketItems((prev) =>
          [
            ...prev,
            {
              cart_item_id: item.id,
              node_id: item.item_id,
              title: item.metadata?.title || title,
              book_name: item.metadata?.book_name || currentBook?.book_name,
              level_name: item.metadata?.level_name || nodeContent.level_name,
              order: item.order,
            },
          ].sort((a, b) => a.order - b.order)
        );
      } catch {
        // ignore basket add failures for now
      }
    })();
  };

  const removeFromBasket = (nodeId: number) => {
    void (async () => {
      const target = basketItems.find((item) => item.node_id === nodeId);
      if (!target?.cart_item_id) {
        setBasketItems((prev) => prev.filter((item) => item.node_id !== nodeId));
        return;
      }

      try {
        const response = await fetch(`/api/cart/items/${target.cart_item_id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!response.ok && response.status !== 404) {
          return;
        }
        setBasketItems((prev) => prev.filter((item) => item.node_id !== nodeId));
      } catch {
        // ignore basket remove failures for now
      }
    })();
  };

  const moveBasketItem = (nodeId: number, direction: "up" | "down") => {
    void (async () => {
      if (isReorderingBasket) return;

      setIsReorderingBasket(true);
      const current = [...basketItems].sort((a, b) => a.order - b.order);
      const index = current.findIndex((item) => item.node_id === nodeId);
      if (index === -1) {
        setIsReorderingBasket(false);
        return;
      }

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        setIsReorderingBasket(false);
        return;
      }

      const [moved] = current.splice(index, 1);
      current.splice(targetIndex, 0, moved);

      const reordered = current.map((item, idx) => ({ ...item, order: idx }));
      setBasketItems(reordered);

      const itemOrder = reordered
        .map((item) => item.cart_item_id)
        .filter((id): id is number => typeof id === "number");

      if (itemOrder.length !== reordered.length) {
        await loadBasket();
        return;
      }

      try {
        const response = await fetch("/api/cart/items/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ item_order: itemOrder }),
        });

        if (!response.ok) {
          await loadBasket();
        }
      } catch {
        await loadBasket();
      } finally {
        setIsReorderingBasket(false);
      }
    })();
  };

  const clearBasket = () => {
    void (async () => {
      try {
        await fetch("/api/cart/me", {
          method: "DELETE",
          credentials: "include",
        });
      } finally {
        setBasketItems([]);
      }
    })();
  };

  const savePreferences = async (nextPreferences?: UserPreferences | null): Promise<boolean> => {
    const preferencesToSave = normalizePreferences(nextPreferences ?? preferences);
    if (!preferencesToSave) return false;
    try {
      setPreferencesSaving(true);
      setPreferencesMessage(null);

      if (!authEmail && typeof window !== "undefined") {
        const toStore: StoredScripturesPreferences = {
          preferences: preferencesToSave,
        };
        window.localStorage.setItem(LOCAL_SCRIPTURES_PREFERENCES_KEY, JSON.stringify(toStore));
        persistUiPreferences(preferencesToSave);
      }

      if (authEmail) {
        const response = await fetch("/api/preferences", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preferencesToSave),
        });
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.detail || "Failed to save preferences");
        }
      }

      setPreferencesMessage("Preferences saved");
      return true;
    } catch (err) {
      setPreferencesMessage(err instanceof Error ? err.message : "Failed to save preferences");
      return false;
    } finally {
      setPreferencesSaving(false);
      setTimeout(() => setPreferencesMessage(null), 2000);
    }
  };

  useEffect(() => {
    applyUiPreferencesToDocument(preferences);
  }, [preferences]);

  const sourceLanguage = normalizeSourceLanguage(preferences?.source_language);
  const transliterationScript = normalizeTransliterationScript(preferences?.transliteration_script);
  const previewTransliterationScript = normalizeTransliterationScript(
    bookPreviewTransliterationScript
  );
  const appliedPreviewTransliterationScript = normalizeTransliterationScript(
    appliedBookPreviewTransliterationScript
  );
  const scriptPrefersRoman = isRomanScript(transliterationScript);
  const transliterationEnabled = preferences?.transliteration_enabled ?? true;
  const showRomanTransliteration = preferences?.show_roman_transliteration ?? true;
  const showOnlyPreferredScript = preferences?.show_only_preferred_script ?? false;
  const showMedia = preferences?.show_media ?? true;
  const showCommentary = preferences?.show_commentary ?? true;
  const showTransliteration =
    transliterationEnabled && (!scriptPrefersRoman || showRomanTransliteration);
  const previewLoadingMessage =
    bookPreviewLoadingScope === "node" ? "Building reader view..." : "Building book preview...";
  const previewLoadingElapsedSeconds = Math.floor(bookPreviewLoadingElapsedMs / 1000);
  const previewLoadingMessageWithElapsed = `${previewLoadingMessage} ${previewLoadingElapsedSeconds}s`;
  const previewParam = searchParams.get("preview");
  const previewIntentScope =
    previewParam === "book" || previewParam === "node" ? previewParam : null;
  const previewIntentNodeId =
    previewIntentScope === "node"
      ? Number.parseInt(searchParams.get("node") || "", 10)
      : null;
  const isWaitingForPreviewNodeSelection =
    previewIntentScope === "node" &&
    Number.isFinite(previewIntentNodeId) &&
    selectedId !== previewIntentNodeId;
  const showPreviewTransitionOverlay =
    previewIntentScope !== null &&
    !showBookPreview &&
    (bookPreviewLoading ||
      isWaitingForPreviewNodeSelection ||
      treeLoading ||
      contentLoading ||
      !bookId);
  const hasEffectiveBookPreviewSummary =
    bookPreviewArtifact?.preview_scope === "book" &&
    Boolean(bookPreviewArtifact.book_template?.rendered_text?.trim());
  const previewBodyFontSizeRem = (0.875 * appliedPreviewFontSizePercent) / 100;
  const previewBodyTextStyle = useMemo(
    () => ({
      fontSize: `${previewBodyFontSizeRem.toFixed(3)}rem`,
      lineHeight: 1.75,
    }),
    [previewBodyFontSizeRem]
  );

  const renderTransliterationByPreference = (value: string): string => {
    if (!value) return "";
    if (hasDevanagariLetters(value)) {
      return transliterateFromDevanagari(value, transliterationScript);
    }
    return transliterateFromIast(value, transliterationScript);
  };

  const renderPreviewTransliteration = (value: string): string => {
    if (!value) return "";
    if (hasDevanagariLetters(value)) {
      return transliterateFromDevanagari(value, appliedPreviewTransliterationScript);
    }
    return transliterateFromIast(value, appliedPreviewTransliterationScript);
  };

  useEffect(() => {
    if (!preferences) return;

    if (previewSettingsInitialized.current) return;
    previewSettingsInitialized.current = true;

    const previewScript = normalizeTransliterationScript(
      preferences.preview_transliteration_script
    );
    const previewLanguages: BookPreviewLanguageSettings = {
      show_sanskrit: preferences.preview_show_sanskrit,
      show_transliteration: preferences.preview_show_transliteration,
      show_english: preferences.preview_show_english,
      show_commentary: preferences.preview_show_commentary,
    };

    setShowPreviewTitles(preferences.preview_show_titles);
    setShowPreviewLabels(preferences.preview_show_labels);
    setShowPreviewLevelNumbers(preferences.preview_show_level_numbers);
    setShowPreviewDetails(preferences.preview_show_details);
    setShowPreviewMedia(preferences.preview_show_media);
    setPreviewWordMeaningsDisplayMode(
      normalizePreviewWordMeaningsDisplayMode(preferences.preview_word_meanings_display_mode)
    );
    setBookPreviewLanguageSettings(previewLanguages);
    setBookPreviewTransliterationScript(previewScript);

    setAppliedShowPreviewTitles(preferences.preview_show_titles);
    setAppliedShowPreviewLabels(preferences.preview_show_labels);
    setAppliedShowPreviewLevelNumbers(preferences.preview_show_level_numbers);
    setAppliedShowPreviewDetails(preferences.preview_show_details);
    setAppliedShowPreviewMedia(preferences.preview_show_media);
    setAppliedPreviewWordMeaningsDisplayMode(
      normalizePreviewWordMeaningsDisplayMode(preferences.preview_word_meanings_display_mode)
    );
    setAppliedBookPreviewLanguageSettings(previewLanguages);
    setAppliedBookPreviewTransliterationScript(previewScript);

    const preferredSourceLanguage = preferences.source_language || sourceLanguage || "english";
    const persistedPreviewLanguages = parseStoredPreviewTranslationLanguages(
      preferences.preview_translation_languages,
      preferredSourceLanguage
    );
    setPreviewTranslationLanguages(persistedPreviewLanguages);
    setAppliedPreviewTranslationLanguages(persistedPreviewLanguages);

    const persistedHiddenLevels = parseStoredHiddenPreviewLevels(
      preferences.preview_hidden_levels
    );
    setHiddenPreviewLevels(persistedHiddenLevels);
    setAppliedHiddenPreviewLevels(persistedHiddenLevels);
  }, [preferences]);

  useEffect(() => {
    if (!bookPreviewLoading) {
      setBookPreviewLoadingElapsedMs(0);
      return;
    }

    const startedAt = Date.now();
    setBookPreviewLoadingElapsedMs(0);
    const intervalId = window.setInterval(() => {
      setBookPreviewLoadingElapsedMs(Date.now() - startedAt);
    }, 200);

    return () => window.clearInterval(intervalId);
  }, [bookPreviewLoading]);

  useEffect(() => {
    if (typeof window === "undefined" || authEmail) {
      return;
    }
    const raw = window.localStorage.getItem(PREVIEW_TRANSLATION_LANGUAGES_STORAGE_KEY);
    const normalized = parseStoredPreviewTranslationLanguages(
      raw,
      preferences?.source_language || sourceLanguage || "english"
    );
    setPreviewTranslationLanguages(normalized);
    setAppliedPreviewTranslationLanguages(normalized);
  }, [authEmail, preferences?.source_language, sourceLanguage]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem(PREVIEW_BOOK_SUMMARY_TOGGLE_STORAGE_KEY);
    if (raw === "true") {
      setShowPreviewBookSummary(true);
    } else if (raw === "false") {
      setShowPreviewBookSummary(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      PREVIEW_BOOK_SUMMARY_TOGGLE_STORAGE_KEY,
      showPreviewBookSummary ? "true" : "false"
    );
  }, [showPreviewBookSummary]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(PREVIEW_FONT_SIZE_PERCENT_STORAGE_KEY);
    const normalized = normalizePreviewFontSizePercent(stored);
    setPreviewFontSizePercent(normalized);
    setAppliedPreviewFontSizePercent(normalized);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem(BROWSE_TRANSLATION_LANGUAGES_STORAGE_KEY);
    let parsed: string[] | undefined;
    if (raw) {
      try {
        const candidate = JSON.parse(raw);
        if (Array.isArray(candidate)) {
          parsed = candidate.filter((item): item is string => typeof item === "string");
        }
      } catch {
        parsed = undefined;
      }
    }
    const normalized = normalizeSelectedEditableTranslationLanguages(
      parsed,
      preferences?.source_language || sourceLanguage || "english"
    );
    setBrowseTranslationLanguages(normalized);
  }, [preferences?.source_language, sourceLanguage]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      BROWSE_TRANSLATION_LANGUAGES_STORAGE_KEY,
      JSON.stringify(browseTranslationLanguages)
    );
  }, [browseTranslationLanguages]);

  const renderSanskritByPreference = (
    sanskritValue: string,
    transliterationValue?: string
  ): string => {
    if (!sanskritValue && !transliterationValue) {
      return "";
    }

    if (sanskritValue) {
      if (transliterationScript === "devanagari") {
        return sanskritValue;
      }
      return transliterateFromDevanagari(sanskritValue, transliterationScript);
    }

    if (!transliterationValue) {
      return "";
    }

    return renderTransliterationByPreference(transliterationValue);
  };

  const getPreferredTitle = (node: TreeNode | NodeContent): string => {
    const sanskritTitle = renderSanskritByPreference(
      formatValue(node.title_sanskrit),
      formatValue(node.title_transliteration)
    );

    if (sourceLanguage === "sanskrit") {
      return (
        sanskritTitle ||
        formatValue(node.title_english) ||
        formatValue(node.title_hindi)
      );
    }
    if (sourceLanguage === "hindi") {
      return (
        formatValue(node.title_hindi) ||
        formatValue(node.title_english) ||
        sanskritTitle
      );
    }
    return (
      formatValue(node.title_english) ||
      formatValue(node.title_hindi) ||
      sanskritTitle
    );
  };

  const getNodeBreadcrumbLabel = (node: TreeNode | NodeContent): string => {
    const preferredTitle = getPreferredTitle(node);
    if (preferredTitle) {
      return preferredTitle;
    }

    const children: TreeNode[] = Array.isArray((node as { children?: unknown }).children)
      ? ((node as { children?: TreeNode[] }).children ?? [])
      : [];
    const isLeafNode = children.length === 0;
    const displaySeq =
      formatSequenceDisplay(node.sequence_number || node.id, isLeafNode) || node.id;

    return `${formatValue(node.level_name) || "Level"} ${displaySeq}`;
  };

  const resolvePreviewTitleBySettings = (
    titleSanskrit: string,
    titleTransliteration: string,
    titleEnglish: string,
    titleHindi: string
  ): string => {
    const transliterationTitle = titleTransliteration
      ? renderPreviewTransliteration(titleTransliteration)
      : titleSanskrit
        ? transliterateFromDevanagari(titleSanskrit, appliedPreviewTransliterationScript)
        : "";
    const englishOrHindi = sourceLanguage === "hindi"
      ? titleHindi || titleEnglish
      : titleEnglish || titleHindi;

    if (appliedBookPreviewLanguageSettings.show_transliteration && transliterationTitle) {
      return transliterationTitle;
    }
    if (appliedBookPreviewLanguageSettings.show_sanskrit && titleSanskrit) {
      return titleSanskrit;
    }
    if (appliedBookPreviewLanguageSettings.show_english && englishOrHindi) {
      return englishOrHindi;
    }

    return transliterationTitle || titleSanskrit || englishOrHindi;
  };

  const getNodeTransliterationBreadcrumbLabel = (node: TreeNode | NodeContent): string => {
    const resolvedTitle = resolvePreviewTitleBySettings(
      formatValue("title_sanskrit" in node ? node.title_sanskrit : null),
      formatValue("title_transliteration" in node ? node.title_transliteration : null),
      formatValue("title_english" in node ? node.title_english : null),
      formatValue("title_hindi" in node ? node.title_hindi : null)
    );
    if (resolvedTitle) {
      return resolvedTitle;
    }

    // Final fallback to level_name + sequence_number
    const children: TreeNode[] = Array.isArray((node as { children?: unknown }).children)
      ? ((node as { children?: TreeNode[] }).children ?? [])
      : [];
    const isLeafNode = children.length === 0;
    const displaySeq =
      formatSequenceDisplay(node.sequence_number || node.id, isLeafNode) || node.id;

    return `${formatValue(node.level_name) || "Level"} ${displaySeq}`;
  };

  const getPreferredBookTitle = (fallbackBookName?: string | null): string => {
    const metadata = getBookMetadataObject(currentBook);

    const titleEnglish = formatValue(
      metadata?.title_english || metadata?.book_name_english || metadata?.title
    );
    const titleHindi = formatValue(metadata?.title_hindi || metadata?.book_name_hindi);
    const titleSanskrit = formatValue(
      metadata?.title_sanskrit || metadata?.book_name_sanskrit || metadata?.primary_title_sanskrit
    );
    const titleTransliteration = formatValue(
      metadata?.title_transliteration ||
        metadata?.book_name_transliteration ||
        metadata?.primary_title_transliteration
    );
    const resolvedBookTitle = resolvePreviewTitleBySettings(
      titleSanskrit,
      titleTransliteration,
      titleEnglish,
      titleHindi
    );
    const defaultBookName = formatValue(currentBook?.book_name) || formatValue(fallbackBookName);

    return resolvedBookTitle || defaultBookName;
  };

  const getPreviewBreadcrumbTitle = (artifact: BookPreviewArtifact): string => {
    if (artifact.preview_scope !== "node") {
      return getPreferredBookTitle(artifact.book_name);
    }

    const segments: string[] = [];
    const bookTitle = getPreferredBookTitle(artifact.book_name);
    if (bookTitle) {
      segments.push(bookTitle);
    }

    const rootNodeId =
      artifact.preview_scope === "node" && typeof artifact.root_node_id === "number"
        ? artifact.root_node_id
        : null;
    const pathNodes = rootNodeId !== null ? findPath(treeData, rootNodeId) || [] : [];

    if (pathNodes.length > 0) {
      segments.push(...pathNodes.map((node) => getNodeTransliterationBreadcrumbLabel(node)));
    } else {
      const fallbackRootTitle = formatValue(artifact.root_title);
      if (fallbackRootTitle) {
        segments.push(fallbackRootTitle);
      }
    }

    return segments.join(". ") || getPreferredBookTitle(artifact.book_name);
  };

  const getPreviewHierarchicalPath = (artifact: BookPreviewArtifact): string => {
    if (artifact.preview_scope !== "node") {
      return "";
    }
    return formatValue(artifact.reader_hierarchy_path);
  };

  const getPreviewSiblingNavigation = (artifact: BookPreviewArtifact) => {
    if (artifact.preview_scope !== "node" || typeof artifact.root_node_id !== "number") {
      return {
        previousSiblingId: null as number | null,
        nextSiblingId: null as number | null,
      };
    }

    const pathNodes = findPath(treeData, artifact.root_node_id) || [];
    if (pathNodes.length === 0) {
      return {
        previousSiblingId: null as number | null,
        nextSiblingId: null as number | null,
      };
    }

    const currentNode = pathNodes[pathNodes.length - 1];
    const parentNode = pathNodes.length > 1 ? pathNodes[pathNodes.length - 2] : null;
    const siblingNodes = parentNode?.children || treeData;
    const currentIndex = siblingNodes.findIndex((node) => node.id === currentNode.id);

    if (currentIndex < 0) {
      return {
        previousSiblingId: null as number | null,
        nextSiblingId: null as number | null,
      };
    }

    const previousSiblingId = currentIndex > 0 ? siblingNodes[currentIndex - 1].id : null;
    const nextSiblingId =
      currentIndex < siblingNodes.length - 1 ? siblingNodes[currentIndex + 1].id : null;

    return {
      previousSiblingId,
      nextSiblingId,
    };
  };

  // Sync state from URL parameters (supports back/forward navigation)
  useEffect(() => {
    const bookParam = searchParams.get("book") || "";
    const fromSearch = searchParams.get("from");
    const searchContext = searchParams.get("searchContext");
    
    // Store search return URL if came from search
    if (fromSearch === "search" && searchContext) {
      const returnUrl = `/?${searchContext}`;
      setSearchReturnUrl(returnUrl);
    } else {
      setSearchReturnUrl(null);
    }

    if (!bookParam) {
      if (bookId) setBookId("");
      if (!urlInitialized) setUrlInitialized(true);
      return;
    }

    if (bookParam !== bookId) {
      setBookId(bookParam);
    }

    if (!urlInitialized) setUrlInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("book"), searchParams.get("from"), searchParams.get("searchContext"), bookId, urlInitialized]);

  // Watch for book ID changes and load tree with optional node auto-selection
  useEffect(() => {
    if (!bookId || !urlInitialized) {
      // Reset the cached book ID so re-opening the same book after navigating
      // away (including a book that previously errored) triggers a fresh load.
      if (!bookId) {
        lastTreeBookId.current = null;
        setTreeError(null);
      }
      return;
    }

    const nodeParam = searchParams.get("node");
    const nodeIdFromUrl = nodeParam ? parseInt(nodeParam, 10) : undefined;
    const nodeId = pendingSavedNodeId.current ?? nodeIdFromUrl;

    if (lastTreeBookId.current !== bookId) {
      lastTreeBookId.current = bookId;
      lastAutoSelectNodeId.current = nodeId ?? null;
      loadTree(bookId, nodeId);
      return;
    }

    if (nodeId) {
      const path = findPath(treeData, nodeId);
      if (path) {
        const isCurrentNodeAlreadyLoading =
          activeContentNodeId.current === nodeId;
        if (
          selectedId !== nodeId ||
          (!isCurrentNodeAlreadyLoading && nodeContent?.id !== nodeId)
        ) {
          applySelection(nodeId, path);
        }
        lastAutoSelectNodeId.current = nodeId;
        if (pendingSavedNodeId.current === nodeId) {
          pendingSavedNodeId.current = null;
        }
        return;
      }

      if (lastAutoSelectNodeId.current !== nodeId) {
        lastAutoSelectNodeId.current = nodeId;
        loadTree(bookId, nodeId);
      }
      return;
    }

    lastAutoSelectNodeId.current = null;
    if (selectedId) {
      setSelectedId(null);
      setBreadcrumb([]);
      setNodeContent(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, urlInitialized, searchParams.get("node"), treeData]);

  const loadBooksPage = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      if (!reset && (!bookHasMoreRef.current || bookLoadingRef.current)) {
        return;
      }

      const query = bookQuery.trim();
      const pageSize =
        bookBrowserDensity === 0
          ? BOOKS_PAGE_SIZE_LIST
          : BOOKS_PAGE_SIZE_BY_DENSITY[bookBrowserDensity as 1 | 2 | 3 | 4 | 5];
      const offset = reset ? 0 : bookNextOffsetRef.current;

      if (reset) {
        activeBooksAbortController.current?.abort();
        setBooks([]);
        setBookHasMore(true);
        bookNextOffsetRef.current = 0;
        bookHasMoreRef.current = true;
      }

      const abortController = new AbortController();
      activeBooksAbortController.current = abortController;
      const requestId = activeBooksRequestId.current + 1;
      activeBooksRequestId.current = requestId;

      bookLoadingRef.current = true;
      setBookLoadingMore(true);
      try {
        const params = new URLSearchParams();
        if (query) {
          params.set("q", query);
        }
        params.set("limit", String(pageSize));
        params.set("offset", String(offset));

        const response = await fetch(`/api/books?${params.toString()}`, {
          credentials: "include",
          signal: abortController.signal,
        });
        if (requestId !== activeBooksRequestId.current) {
          return;
        }

        if (!response.ok) {
          if (reset) {
            setBooks([]);
          }
          setBookHasMore(false);
          bookHasMoreRef.current = false;
          return;
        }

        const data = (await response.json()) as BookOption[];
        if (requestId !== activeBooksRequestId.current) {
          return;
        }

        setBooks((prev) => (reset ? data : [...prev, ...data]));
        const nextOffset = offset + data.length;
        bookNextOffsetRef.current = nextOffset;

        const hasMore = data.length === pageSize;
        setBookHasMore(hasMore);
        bookHasMoreRef.current = hasMore;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        if (reset) {
          setBooks([]);
        }
        setBookHasMore(false);
        bookHasMoreRef.current = false;
      } finally {
        if (requestId === activeBooksRequestId.current) {
          bookLoadingRef.current = false;
          setBookLoadingMore(false);
          if (!reset) {
            if (typeof window !== "undefined") {
              window.requestAnimationFrame(() => {
                const container = booksScrollContainerRef.current;
                if (!container || !bookHasMoreRef.current || bookLoadingRef.current) {
                  return;
                }
                const distanceToBottom =
                  container.scrollHeight - (container.scrollTop + container.clientHeight);
                const threshold = Math.max(240, container.clientHeight * 0.35);
                if (distanceToBottom <= threshold) {
                  void loadBooksPage();
                }
              });
            }
          }
        }
      }
    },
    [bookQuery, bookBrowserDensity]
  );

  useEffect(() => {
    const loadBooks = async () => {
      await loadBooksPage({ reset: true });
    };
    void loadBooks();
  }, [bookQuery, loadBooksPage]);

  useEffect(() => {
    return () => {
      activeBooksAbortController.current?.abort();
    };
  }, []);

  const loadTree = async (selectedId: string, autoSelectNodeId?: number) => {
    activeTreeAbortController.current?.abort();
    const abortController = new AbortController();
    activeTreeAbortController.current = abortController;
    const requestId = activeTreeRequestId.current + 1;
    activeTreeRequestId.current = requestId;

    if (!selectedId) {
      setTreeData([]);
      setTreeError(null);
      setExpandedIds(new Set());
      setSelectedId(null);
      setBreadcrumb([]);
      setCurrentBook(null);
      setPrivateBookGate(false);
      return;
    }

    // For anonymous users, gate access to private books before API calls when visibility is known
    setPrivateBookGate(false);
    if (!authEmail) {
      const selectedBook = books.find((b) => b.id.toString() === selectedId);
      const selectedBookVisibility =
        selectedBook?.visibility ??
        selectedBook?.metadata_json?.visibility ??
        selectedBook?.metadata?.visibility;
      if (selectedBook && selectedBookVisibility === "private") {
        setPrivateBookGate(true);
        setTreeData([]);
        setCurrentBook(null);
        return;
      }
    }

    setTreeLoading(true);
    setTreeError(null);
    try {
      const detailsPromise = fetch(`/api/books/${selectedId}`, {
        credentials: "include",
        signal: abortController.signal,
      });
      const treePromise = fetch(`/api/books/${selectedId}/tree`, {
        credentials: "include",
        signal: abortController.signal,
      });

      const [detailsResponse, response] = await Promise.all([detailsPromise, treePromise]);

      if (requestId !== activeTreeRequestId.current) return;
      if (detailsResponse.ok) {
        const detailsData = (await detailsResponse.json()) as BookDetails;
        if (requestId !== activeTreeRequestId.current) return;
        setCurrentBook(detailsData);
      } else {
        setCurrentBook(null);
      }

        if (requestId !== activeTreeRequestId.current) return;
      if (!response.ok) {
          if (!authEmail && response.status === 404) {
            setTreeData([]);
            setCurrentBook(null);
            setSelectedId(null);
            setBreadcrumb([]);
            setNodeContent(null);
            setTreeError(ANONYMOUS_BOOK_NOT_FOUND_MESSAGE);
            setUrlInitialized(true);
            return;
          }
        if (!authEmail && (response.status === 401 || response.status === 403)) {
          setPrivateBookGate(true);
          setTreeData([]);
          setCurrentBook(null);
          setSelectedId(null);
          setBreadcrumb([]);
          setNodeContent(null);
          setUrlInitialized(true);
          return;
        }
        const payload = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(payload?.detail || "Tree fetch failed");
      }
      const flatData = (await response.json()) as TreeNode[];
      const data = nestFlatTreeNodes(flatData);
        if (requestId !== activeTreeRequestId.current) return;
      setTreeData(data);
      setExpandedIds(new Set(data.map((node) => node.id)));
      
      // Auto-select node if provided in params
      if (autoSelectNodeId) {
        const path = findPath(data, autoSelectNodeId);
        if (path) {
          applySelection(autoSelectNodeId, path, true, false, true);
        }
      } else {
        setSelectedId(BOOK_ROOT_NODE_ID);
        setNodeContent(null);
        setBreadcrumb([]);
      }
      
      setUrlInitialized(true);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (requestId !== activeTreeRequestId.current) return;
      setTreeError(err instanceof Error ? err.message : "Tree fetch failed");
      setUrlInitialized(true);
    } finally {
      if (requestId === activeTreeRequestId.current) {
        setTreeLoading(false);
      }
    }
  };

  const findPath = (nodes: TreeNode[], targetId: number): TreeNode[] | null => {
    for (const node of nodes) {
      if (node.id === targetId) {
        return [node];
      }
      if (node.children && node.children.length > 0) {
        const childPath = findPath(node.children, targetId);
        if (childPath) {
          return [node, ...childPath];
        }
      }
    }
    return null;
  };

  const findFirstLeafId = (nodes: TreeNode[]): number | null => {
    for (const node of nodes) {
      if (!node.children || node.children.length === 0) {
        return node.id;
      }
      const nested = findFirstLeafId(node.children);
      if (nested !== null) {
        return nested;
      }
    }
    return null;
  };

  const toggleNode = (nodeId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const loadNodeContent = async (nodeId: number, force = false) => {
    if (!force && activeContentNodeId.current === nodeId) return;
    if (!force && !contentLoading && nodeContent?.id === nodeId) return;

    activeContentAbortController.current?.abort();
    const abortController = new AbortController();
    activeContentAbortController.current = abortController;
    const requestId = activeContentRequestId.current + 1;
    activeContentRequestId.current = requestId;
    activeContentNodeId.current = nodeId;

    lastLoadedNodeId.current = nodeId;
    setContentLoading(true);
    try {
      const response = await fetch(contentPath(`/nodes/${nodeId}`), {
        credentials: "include",
        signal: abortController.signal,
      });
      if (requestId !== activeContentRequestId.current) return;
      if (response.ok) {
        const data = (await response.json()) as NodeContent;
        if (requestId !== activeContentRequestId.current) return;
        setNodeContent(data);
      } else {
        if (requestId !== activeContentRequestId.current) return;
        setNodeContent(null);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      console.error("Content load error:", err);
      if (requestId !== activeContentRequestId.current) return;
      setNodeContent(null);
    } finally {
      if (requestId === activeContentRequestId.current) {
        setContentLoading(false);
        activeContentNodeId.current = null;
      }
    }
  };

  const getNodeMediaDisplayOrder = (media: MediaFile): number => {
    const metadata =
      media.metadata && typeof media.metadata === "object"
        ? media.metadata
        : media.metadata_json && typeof media.metadata_json === "object"
          ? media.metadata_json
          : null;
    const raw = metadata?.display_order;
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

  const isNodeMediaDefault = (media: MediaFile): boolean => {
    const metadata =
      media.metadata && typeof media.metadata === "object"
        ? media.metadata
        : media.metadata_json && typeof media.metadata_json === "object"
          ? media.metadata_json
          : null;
    return Boolean(metadata?.is_default);
  };

  const sortNodeMediaItems = (items: MediaFile[]): MediaFile[] =>
    [...items].sort((a, b) => {
      const typeCompare = (a.media_type || "").localeCompare(b.media_type || "");
      if (typeCompare !== 0) {
        return typeCompare;
      }
      const defaultCompare = Number(isNodeMediaDefault(b)) - Number(isNodeMediaDefault(a));
      if (defaultCompare !== 0) {
        return defaultCompare;
      }
      const orderCompare = getNodeMediaDisplayOrder(a) - getNodeMediaDisplayOrder(b);
      if (orderCompare !== 0) {
        return orderCompare;
      }
      const aCreated = a.created_at ? Date.parse(a.created_at) : 0;
      const bCreated = b.created_at ? Date.parse(b.created_at) : 0;
      if (aCreated !== bCreated) {
        return aCreated - bCreated;
      }
      return a.id - b.id;
    });

  const mediaMatchesSearch = (media: MediaFile, query: string): boolean => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    const metadata =
      media.metadata && typeof media.metadata === "object"
        ? media.metadata
        : media.metadata_json && typeof media.metadata_json === "object"
          ? media.metadata_json
          : null;
    const originalFilename =
      typeof metadata?.original_filename === "string" ? metadata.original_filename : "";
    const haystack = [originalFilename, media.media_type, media.url]
      .map((value) => value || "")
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  };

  const bookMediaMatchesSearch = (media: BookMediaItem, query: string): boolean => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    const haystack = [media.display_name, media.media_type, media.url]
      .map((value) => value || "")
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  };

  const renderInlineMediaPreview = useCallback((
    mediaType: string,
    rawUrl: string,
    label: string,
    mode: "thumb" | "full" = "full"
  ) => {
    const mediaUrl = resolveMediaUrl(rawUrl);
    const normalizedType = (mediaType || "").trim().toLowerCase();

    if (normalizedType === "image") {
      return (
        <img
          src={mediaUrl}
          alt={label}
          className={
            mode === "thumb"
              ? "h-10 w-10 rounded-md border border-black/10 object-cover"
              : "max-h-[260px] w-full rounded-lg border border-black/10 object-contain"
          }
        />
      );
    }

    if (normalizedType === "audio") {
      return <audio controls className="w-full"><source src={mediaUrl} /></audio>;
    }

    if (normalizedType === "video") {
      const youtubeEmbedUrl = getYouTubeEmbedUrl(rawUrl);
      if (youtubeEmbedUrl) {
        return (
          <iframe
            src={youtubeEmbedUrl}
            title={label}
            className="h-[260px] w-full rounded-lg border border-black/10"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        );
      }
      return (
        <video controls className="max-h-[260px] w-full rounded-lg border border-black/10">
          <source src={mediaUrl} />
        </video>
      );
    }

    return (
      <a
        href={mediaUrl}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-[color:var(--accent)] underline decoration-transparent underline-offset-2 hover:decoration-current"
      >
        Open media: {label}
      </a>
    );
  }, [resolveMediaUrl]);

  const mediaAssetMatchesSearch = (asset: MediaAsset, query: string): boolean => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    const originalFilename =
      typeof asset.metadata?.original_filename === "string" ? asset.metadata.original_filename : "";
    const displayName = typeof asset.metadata?.display_name === "string" ? asset.metadata.display_name : "";
    const haystack = [displayName, originalFilename, asset.media_type, asset.url]
      .map((value) => value || "")
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  };

  const getNodeMediaLabel = (media: MediaFile): string => {
    const mediaType = (media.media_type || "").trim();
    const mediaLookupKey = getMediaLookupKey(mediaType, media.url);
    const metadata =
      media.metadata && typeof media.metadata === "object"
        ? media.metadata
        : media.metadata_json && typeof media.metadata_json === "object"
          ? media.metadata_json
          : null;

    const metadataAssetIdRaw = metadata?.asset_id;
    const metadataAssetId =
      typeof metadataAssetIdRaw === "number"
        ? metadataAssetIdRaw
        : typeof metadataAssetIdRaw === "string" && metadataAssetIdRaw.trim()
          ? Number.parseInt(metadataAssetIdRaw, 10)
          : null;

    const matchingAssetById =
      typeof metadataAssetId === "number" && Number.isFinite(metadataAssetId)
        ? mediaBankAssets.find((asset) => asset.id === metadataAssetId)
        : undefined;

    const matchingAssetByLookup = mediaBankAssets.find((asset) => {
      const assetType = (asset.media_type || "").trim();
      if (assetType !== mediaType) {
        return false;
      }
      const assetLookupKey = getMediaLookupKey(assetType, asset.url || "");
      if (assetLookupKey === mediaLookupKey) {
        return true;
      }
      return (asset.url || "").trim() === (media.url || "").trim();
    });

    const matchingAsset = matchingAssetById ?? matchingAssetByLookup;

    const repoDisplayName =
      typeof matchingAsset?.metadata?.display_name === "string" ? matchingAsset.metadata.display_name.trim() : "";
    if (repoDisplayName) {
      return repoDisplayName;
    }
    const repoFilename =
      typeof matchingAsset?.metadata?.original_filename === "string"
        ? matchingAsset.metadata.original_filename.trim()
        : "";
    if (repoFilename) {
      return repoFilename;
    }

    const directDisplayName = typeof metadata?.display_name === "string" ? metadata.display_name.trim() : "";
    if (directDisplayName) {
      return directDisplayName;
    }

    const directAssetDisplayName =
      typeof metadata?.asset_display_name === "string" ? metadata.asset_display_name.trim() : "";
    if (directAssetDisplayName) {
      return directAssetDisplayName;
    }

    const directFilename = typeof metadata?.original_filename === "string" ? metadata.original_filename.trim() : "";
    if (directFilename) {
      return directFilename;
    }

    return inferDisplayNameFromUrl(media.url) || `${mediaType || "media"} #${media.id}`;
  };

  const loadMediaBankAssets = async () => {
    setMediaBankLoading(true);
    setMediaBankError(null);
    try {
      const data = await listMediaBankAssets(300);
      setMediaBankAssets(Array.isArray(data) ? (data as MediaAsset[]) : []);
    } catch (err) {
      setMediaBankAssets([]);
      setMediaBankError(err instanceof Error ? err.message : "Unable to load media repo");
    } finally {
      setMediaBankLoading(false);
    }
  };

  const handleUploadMediaBankAsset = async (file: File) => {
    setMediaBankUploading(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    try {
      await uploadMediaBankAsset(file);
      setMediaBankMessage("Media asset uploaded.");
      await loadMediaBankAssets();
    } catch (err) {
      setMediaBankError(err instanceof Error ? err.message : "Failed to upload media asset");
    } finally {
      setMediaBankUploading(false);
    }
  };

  const openMediaLinkForm = (context: MediaLinkContext) => {
    setExternalMediaFormContext(context);
    setExternalMediaFormOpen(true);
  };

  const createMediaBankLinkAsset = async (
    url: string,
    displayName?: string,
    mediaType?: ExternalMediaType
  ): Promise<MediaAsset> => {
    const asset = await createMediaBankLinkAssetRequest({
      url,
      displayName,
      mediaType,
    });
    if (!asset || typeof asset.id !== "number") {
      throw new Error("Link created but no media asset was returned.");
    }
    return asset as MediaAsset;
  };

  const uploadMediaBankAssetAndReturn = async (file: File): Promise<MediaAsset> => {
    const asset = (await uploadMediaBankAsset(file)) as MediaAsset | null;
    if (!asset || typeof asset.id !== "number") {
      throw new Error("Upload succeeded but no media asset was returned.");
    }
    return asset;
  };

  const attachMediaBankAssetToNode = async (assetId: number, nodeId: number): Promise<void> => {
    const response = await fetch(contentPath(`/media-bank/assets/${assetId}/attach/nodes/${nodeId}`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: false }),
    });
    const payload = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    if (!response.ok) {
      throw new Error(getErrorMessageFromPayload(payload, "Failed to attach media asset"));
    }
  };

  const handleSubmitMediaLinkForm = async (payload: {
    url: string;
    displayName?: string;
    mediaType?: ExternalMediaType;
  }) => {
    if (!payload.url.trim()) {
      setMediaBankError("URL is required.");
      return;
    }

    setExternalMediaFormSubmitting(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    setNodeMediaError(null);
    setNodeMediaMessage(null);
    setPropertiesError(null);
    setPropertiesMessage(null);

    try {
      const createdAsset = await createMediaBankLinkAsset(
        payload.url,
        payload.displayName,
        payload.mediaType
      );

      if (externalMediaFormContext === "node") {
        if (!selectedId) {
          throw new Error("Select a node first to attach media.");
        }
        await attachMediaBankAssetToNode(createdAsset.id, selectedId);
        setNodeMediaMessage("Link added to repo and attached to node.");
        await Promise.all([loadNodeMedia(selectedId, true), loadMediaBankAssets()]);
      } else if (externalMediaFormContext === "book") {
        const attached = await handleAttachMediaBankAssetToBook(createdAsset);
        if (!attached) {
          throw new Error("Failed to attach external media to book.");
        }
        await loadMediaBankAssets();
      } else {
        setMediaBankMessage("External media link added.");
        await loadMediaBankAssets();
      }

      setExternalMediaFormOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add external media link";
      if (externalMediaFormContext === "node") {
        setNodeMediaError(message);
      } else if (externalMediaFormContext === "book") {
        setPropertiesError(message);
      } else {
        setMediaBankError(message);
      }
    } finally {
      setExternalMediaFormSubmitting(false);
    }
  };

  const getMediaBankAssetDisplayName = (asset: MediaAsset): string => {
    if (typeof asset.metadata?.display_name === "string" && asset.metadata.display_name.trim()) {
      return asset.metadata.display_name.trim();
    }
    if (typeof asset.metadata?.original_filename === "string" && asset.metadata.original_filename.trim()) {
      return asset.metadata.original_filename.trim();
    }
    return `${asset.media_type} #${asset.id}`;
  };

  const beginRenameMediaBankAsset = (asset: MediaAsset) => {
    setMediaBankError(null);
    setMediaBankMessage(null);
    setMediaBankRenameId(asset.id);
    setMediaBankRenameValue(getMediaBankAssetDisplayName(asset));
  };

  const cancelRenameMediaBankAsset = () => {
    setMediaBankRenameId(null);
    setMediaBankRenameValue("");
  };

  const handleRenameMediaBankAsset = async (assetId: number) => {
    const asset = mediaBankAssets.find((entry) => entry.id === assetId);
    if (!asset) {
      cancelRenameMediaBankAsset();
      return;
    }

    const currentName = getMediaBankAssetDisplayName(asset);
    const trimmed = mediaBankRenameValue.trim();
    if (!trimmed) {
      setMediaBankError("Name cannot be empty.");
      return;
    }

    if (trimmed === currentName) {
      cancelRenameMediaBankAsset();
      return;
    }

    setMediaBankUpdating(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    try {
      const updatedAsset = await renameMediaBankAsset(assetId, trimmed);
      setMediaBankAssets((prev) =>
        prev.map((entry) =>
          entry.id === assetId
            ? {
                ...entry,
                ...updatedAsset,
              }
            : entry
        )
      );
      cancelRenameMediaBankAsset();
      setMediaBankMessage("Media asset renamed.");
    } catch (err) {
      setMediaBankError(err instanceof Error ? err.message : "Failed to rename media asset");
    } finally {
      setMediaBankUpdating(false);
    }
  };

  const handleDeleteMediaBankAsset = async (assetId: number) => {
    setMediaBankUpdating(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    try {
      await deleteMediaBankAsset(assetId);
      setMediaBankMessage("Media asset removed from repo.");
      await loadMediaBankAssets();
    } catch (err) {
      if (err instanceof MediaBankClientError && err.status === 409) {
        setMediaBankError(
          "Cannot remove this asset yet. Detach it from all nodes first, then delete it from the multimedia repo."
        );
      } else {
        setMediaBankError(err instanceof Error ? err.message : "Failed to delete media asset");
      }
    } finally {
      setMediaBankUpdating(false);
    }
  };

  const handleReplaceMediaBankAsset = async (asset: MediaAsset, file: File) => {
    setMediaBankUpdating(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    try {
      await replaceMediaBankAssetFile(asset.id, file);
      setMediaBankMessage("Media asset file replaced. Existing links remain intact.");
      await Promise.all([
        loadMediaBankAssets(),
        mediaManagerScope === "node" && selectedId ? loadNodeMedia(selectedId, true) : Promise.resolve(),
      ]);
    } catch (err) {
      setMediaBankError(err instanceof Error ? err.message : "Failed to replace media asset");
    } finally {
      setMediaBankUpdating(false);
    }
  };

  const handleAttachMediaBankAssetToSelectedNode = async (assetId: number): Promise<boolean> => {
    if (!selectedId) {
      setMediaBankError("Select a node first to attach media.");
      return false;
    }

    setMediaBankUpdating(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    try {
      await attachMediaBankAssetToNode(assetId, selectedId);
      setMediaBankMessage("Media asset attached to node.");
      await loadNodeMedia(selectedId, true);
      return true;
    } catch (err) {
      setMediaBankError(err instanceof Error ? err.message : "Failed to attach media asset");
      return false;
    } finally {
      setMediaBankUpdating(false);
    }
  };

  const getBookMediaLabel = (media: BookMediaItem): string => {
    if (typeof media.display_name === "string" && media.display_name.trim()) {
      return media.display_name.trim();
    }
    const matchingAsset =
      typeof media.asset_id === "number"
        ? mediaBankAssets.find((asset) => asset.id === media.asset_id)
        : undefined;
    if (matchingAsset) {
      return getMediaBankAssetDisplayName(matchingAsset);
    }
    return inferDisplayNameFromUrl(media.url) || `${media.media_type || "media"}`;
  };

  const handleLevelNameOverrideChange = (canonicalLevelName: string, nextDisplayName: string) => {
    setLevelNameOverridesDraft((prev) => ({
      ...prev,
      [canonicalLevelName]: nextDisplayName,
    }));
    setLevelNameOverridesError(null);
    setLevelNameOverridesMessage(null);
  };

  const handleSaveLevelNameOverrides = async () => {
    if (!bookId || !currentBook) {
      setLevelNameOverridesError("Select a book first.");
      return;
    }

    const cleanedOverrides: Record<string, string> = {};
    currentBookSchemaLevels.forEach((canonicalLevel: string) => {
      const draftValue = (levelNameOverridesDraft[canonicalLevel] || "").trim();
      if (!draftValue || draftValue.toLowerCase() === canonicalLevel.toLowerCase()) {
        return;
      }
      cleanedOverrides[canonicalLevel] = draftValue;
    });

    setLevelNameOverridesSaving(true);
    setLevelNameOverridesError(null);
    setLevelNameOverridesMessage(null);

    try {
      const response = await fetch(`/api/books/${bookId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level_name_overrides: cleanedOverrides }),
      });
      const payload = (await response.json().catch(() => null)) as
        | BookDetails
        | { detail?: string }
        | null;

      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to save level names");
      }

      const updatedBook = payload as BookDetails;
      setCurrentBook(updatedBook);
      setBooks((prev) =>
        prev.map((book) =>
          book.id === updatedBook.id
            ? {
                ...book,
                level_name_overrides: updatedBook.level_name_overrides,
              }
            : book
        )
      );
      setLevelNameOverridesMessage("Level names updated for this book.");
    } catch (err) {
      setLevelNameOverridesError(err instanceof Error ? err.message : "Failed to save level names");
    } finally {
      setLevelNameOverridesSaving(false);
    }
  };

  const saveBookMetadata = async (
    nextMetadata: Record<string, unknown>,
    successMessage: string,
    failureMessage: string
  ): Promise<boolean> => {
    if (!bookId) {
      setPropertiesError("Select a book first.");
      return false;
    }

    setBookThumbnailUploading(true);
    setPropertiesError(null);
    setPropertiesMessage(null);

    try {
      const response = await fetch(`/api/books/${bookId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: nextMetadata }),
      });
      const payload = (await response.json().catch(() => null)) as
        | BookDetails
        | { detail?: string }
        | null;
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || failureMessage);
      }

      const updatedBook = payload as BookDetails;
      setCurrentBook(updatedBook);
      setBooks((prev) =>
        prev.map((book) =>
          book.id === updatedBook.id
            ? {
                ...book,
                level_name_overrides: updatedBook.level_name_overrides,
                metadata_json: updatedBook.metadata_json,
                metadata: updatedBook.metadata,
              }
            : book
        )
      );
      setPropertiesMessage(successMessage);
      return true;
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : failureMessage);
      return false;
    } finally {
      setBookThumbnailUploading(false);
    }
  };

  const saveBookMediaItems = async (
    items: BookMediaItem[],
    successMessage: string,
    failureMessage: string
  ): Promise<boolean> => {
    const existingMetadata = getBookMetadataObject(currentBook) || {};
    const sortedItems = sortBookMediaItems(items);
    const withOrder = sortedItems.map((item, index) => ({
      ...item,
      display_order: index,
    }));
    const imageDefault = withOrder.find((item) => item.media_type === "image" && item.is_default) ||
      withOrder.find((item) => item.media_type === "image") ||
      null;

    const nextMetadata: Record<string, unknown> = {
      ...existingMetadata,
      media_items: withOrder,
      thumbnail_url: imageDefault?.url || null,
      thumbnailUrl: imageDefault?.url || null,
    };

    return saveBookMetadata(nextMetadata, successMessage, failureMessage);
  };

  const handleAttachMediaBankAssetToBook = async (asset: MediaAsset): Promise<boolean> => {
    const currentItems = getBookMediaItems(currentBook);
    const assetDisplayName = getMediaBankAssetDisplayName(asset);
    const mediaLookupKey = getMediaLookupKey(asset.media_type, asset.url || "");

    const exists = currentItems.some((item) => {
      const itemLookupKey = getMediaLookupKey(item.media_type, item.url || "");
      if (typeof item.asset_id === "number" && item.asset_id === asset.id) {
        return true;
      }
      return itemLookupKey === mediaLookupKey;
    });
    if (exists) {
      setPropertiesMessage("Media is already attached to this book.");
      return true;
    }

    const normalizedType = normalizeBookMediaType(asset.media_type, asset.url || "");
    const sameTypeItems = currentItems.filter((item) => item.media_type === normalizedType);
    const isDefault = sameTypeItems.length === 0;

    const nextItems = [
      ...currentItems,
      {
        media_type: normalizedType,
        url: asset.url,
        display_name: assetDisplayName,
        content_type:
          typeof asset.metadata?.content_type === "string" && asset.metadata.content_type.trim()
            ? asset.metadata.content_type.trim()
            : undefined,
        asset_id: asset.id,
        is_default: isDefault,
      },
    ];
    return saveBookMediaItems(nextItems, "Media attached to book.", "Failed to attach media to book");
  };

  const handleDeleteBookMedia = async (targetMedia: BookMediaItem) => {
    const items = getBookMediaItems(currentBook);
    const targetLookup = getMediaLookupKey(targetMedia.media_type, targetMedia.url || "");
    const removedIndex = items.findIndex((item) => {
      const itemLookup = getMediaLookupKey(item.media_type, item.url || "");
      if (typeof targetMedia.asset_id === "number" && typeof item.asset_id === "number") {
        return targetMedia.asset_id === item.asset_id;
      }
      return itemLookup === targetLookup;
    });
    if (removedIndex < 0) {
      return;
    }

    const removedItem = items[removedIndex];
    const nextItems = items.filter((_, index) => index !== removedIndex);
    if (removedItem?.is_default) {
      const fallbackIndex = nextItems.findIndex((item) => item.media_type === removedItem.media_type);
      if (fallbackIndex >= 0) {
        nextItems[fallbackIndex] = {
          ...nextItems[fallbackIndex],
          is_default: true,
        };
      }
    }

    await saveBookMediaItems(nextItems, "Book media removed.", "Failed to remove book media");
  };

  const handleUploadNodeMediaViaBank = async (file: File) => {
    if (!selectedId) {
      setNodeMediaError("Select a node first to attach media.");
      return;
    }

    setNodeMediaUploading(true);
    setNodeMediaError(null);
    setNodeMediaMessage(null);
    try {
      const uploadedAsset = await uploadMediaBankAssetAndReturn(file);
      await attachMediaBankAssetToNode(uploadedAsset.id, selectedId);

      setNodeMediaMessage("Multimedia uploaded to repo and attached to node.");
      await Promise.all([loadNodeMedia(selectedId, true), loadMediaBankAssets()]);
    } catch (err) {
      setNodeMediaError(err instanceof Error ? err.message : "Failed to upload multimedia");
    } finally {
      setNodeMediaUploading(false);
    }
  };

  const handleUploadBookMediaViaBank = async (file: File) => {
    if (!bookId) {
      setPropertiesError("Select a book first.");
      return;
    }

    setBookThumbnailUploading(true);
    setPropertiesError(null);
    setPropertiesMessage(null);
    try {
      const uploadedAsset = await uploadMediaBankAssetAndReturn(file);
      const attached = await handleAttachMediaBankAssetToBook(uploadedAsset);
      if (attached) {
        await loadMediaBankAssets();
      }
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : "Failed to upload media");
    } finally {
      setBookThumbnailUploading(false);
    }
  };

  const loadNodeMedia = async (nodeId: number, force = false) => {
    if (!force && activeNodeMediaNodeId.current === nodeId) return;

    activeNodeMediaAbortController.current?.abort();
    const abortController = new AbortController();
    activeNodeMediaAbortController.current = abortController;
    const requestId = activeNodeMediaRequestId.current + 1;
    activeNodeMediaRequestId.current = requestId;
    activeNodeMediaNodeId.current = nodeId;

    setNodeMediaLoading(true);
    setNodeMediaError(null);
    try {
      const response = await fetch(contentPath(`/nodes/${nodeId}/media?limit=20`), {
        credentials: "include",
        signal: abortController.signal,
      });
      if (requestId !== activeNodeMediaRequestId.current) return;
      if (!response.ok) {
        setNodeMedia([]);
        setNodeMediaError("Unable to load multimedia for this node.");
        return;
      }
      const data = (await response.json()) as MediaFile[];
      if (requestId !== activeNodeMediaRequestId.current) return;
      setNodeMedia(sortNodeMediaItems(Array.isArray(data) ? data : []));
      setNodeMediaError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (requestId !== activeNodeMediaRequestId.current) return;
      setNodeMedia([]);
      setNodeMediaError("Unable to load multimedia for this node.");
    } finally {
      if (requestId === activeNodeMediaRequestId.current) {
        setNodeMediaLoading(false);
        activeNodeMediaNodeId.current = null;
      }
    }
  };

  const handleDeleteNodeMedia = async (media: MediaFile) => {
    const targetNodeId = typeof media.node_id === "number" ? media.node_id : selectedId;
    if (!targetNodeId) {
      return;
    }

    setNodeMediaUpdating(true);
    setNodeMediaError(null);
    setNodeMediaMessage(null);

    try {
      const response = await fetch(contentPath(`/nodes/${targetNodeId}/media/${media.id}`), {
        method: "DELETE",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessageFromPayload(payload, "Failed to delete media"));
      }

      setNodeMediaMessage("Multimedia removed.");
      if (selectedId === targetNodeId) {
        await loadNodeMedia(targetNodeId, true);
      }
    } catch (err) {
      setNodeMediaError(err instanceof Error ? err.message : "Failed to delete media");
    } finally {
      setNodeMediaUpdating(false);
    }
  };

  const handleSetDefaultNodeMedia = async (mediaId: number) => {
    if (!selectedId) {
      return;
    }

    setNodeMediaUpdating(true);
    setNodeMediaError(null);
    setNodeMediaMessage(null);

    try {
      const response = await fetch(contentPath(`/nodes/${selectedId}/media/${mediaId}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_default: true }),
      });
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to set default media");
      }

      setNodeMediaMessage("Default media updated.");
      await loadNodeMedia(selectedId, true);
    } catch (err) {
      setNodeMediaError(err instanceof Error ? err.message : "Failed to set default media");
    } finally {
      setNodeMediaUpdating(false);
    }
  };

  const handleMoveNodeMedia = async (mediaId: number, direction: "up" | "down") => {
    if (!selectedId) {
      return;
    }

    const targetMedia = nodeMedia.find((item) => item.id === mediaId);
    if (!targetMedia) {
      return;
    }

    const sameType = sortNodeMediaItems(
      nodeMedia.filter((item) => (item.media_type || "") === (targetMedia.media_type || ""))
    );
    const currentIndex = sameType.findIndex((item) => item.id === mediaId);
    if (currentIndex < 0) {
      return;
    }

    const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (swapIndex < 0 || swapIndex >= sameType.length) {
      return;
    }

    const reordered = [...sameType];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(swapIndex, 0, moved);
    const orderedIds = reordered.map((item) => item.id);

    setNodeMediaUpdating(true);
    setNodeMediaError(null);
    setNodeMediaMessage(null);

    try {
      const response = await fetch(contentPath(`/nodes/${selectedId}/media/reorder`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: targetMedia.media_type,
          media_ids: orderedIds,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to reorder media");
      }

      setNodeMediaMessage("Media order updated.");
      await loadNodeMedia(selectedId, true);
    } catch (err) {
      setNodeMediaError(err instanceof Error ? err.message : "Failed to reorder media");
    } finally {
      setNodeMediaUpdating(false);
    }
  };

  const openNodeMediaManager = (targetNodeId?: number | null) => {
    const nextNodeId =
      typeof targetNodeId === "number" && Number.isFinite(targetNodeId)
        ? targetNodeId
        : selectedId;

    if (!nextNodeId) {
      setNodeMediaError("Select a node first to manage multimedia.");
      return;
    }

    if (nextNodeId !== selectedId) {
      selectNode(nextNodeId);
    }

    void loadNodeMedia(nextNodeId, true);
    setMediaManagerScope("node");
    setShowMediaManagerModal(true);
  };

  const loadNodeCommentary = async (nodeId: number, force = false) => {
    if (!force && activeNodeCommentaryNodeId.current === nodeId) return;

    activeNodeCommentaryAbortController.current?.abort();
    const abortController = new AbortController();
    activeNodeCommentaryAbortController.current = abortController;
    const requestId = activeNodeCommentaryRequestId.current + 1;
    activeNodeCommentaryRequestId.current = requestId;
    activeNodeCommentaryNodeId.current = nodeId;

    setNodeCommentaryLoading(true);
    setNodeCommentaryError(null);
    try {
      const response = await fetch(contentPath(`/nodes/${nodeId}/commentary?limit=100`), {
        credentials: "include",
        signal: abortController.signal,
      });
      if (requestId !== activeNodeCommentaryRequestId.current) return;
      if (!response.ok) {
        setNodeCommentary([]);
        setNodeCommentaryError("Unable to load commentary for this node.");
        return;
      }
      const data = (await response.json()) as CommentaryEntry[];
      if (requestId !== activeNodeCommentaryRequestId.current) return;
      setNodeCommentary(Array.isArray(data) ? data : []);
      setNodeCommentaryError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (requestId !== activeNodeCommentaryRequestId.current) return;
      setNodeCommentary([]);
      setNodeCommentaryError("Unable to load commentary for this node.");
    } finally {
      if (requestId === activeNodeCommentaryRequestId.current) {
        setNodeCommentaryLoading(false);
        activeNodeCommentaryNodeId.current = null;
      }
    }
  };

  const loadNodeComments = async (nodeId: number, force = false) => {
    if (!force && activeNodeCommentsNodeId.current === nodeId) return;

    activeNodeCommentsAbortController.current?.abort();
    const abortController = new AbortController();
    activeNodeCommentsAbortController.current = abortController;
    const requestId = activeNodeCommentsRequestId.current + 1;
    activeNodeCommentsRequestId.current = requestId;
    activeNodeCommentsNodeId.current = nodeId;

    setNodeCommentsLoading(true);
    setNodeCommentsError(null);
    try {
      const response = await fetch(contentPath(`/nodes/${nodeId}/comments?limit=200`), {
        credentials: "include",
        signal: abortController.signal,
      });
      if (requestId !== activeNodeCommentsRequestId.current) return;
      if (!response.ok) {
        setNodeComments([]);
        setNodeCommentsError("Unable to load comments for this node.");
        return;
      }
      const data = (await response.json()) as NodeComment[];
      if (requestId !== activeNodeCommentsRequestId.current) return;
      setNodeComments(Array.isArray(data) ? data : []);
      setNodeCommentsError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (requestId !== activeNodeCommentsRequestId.current) return;
      setNodeComments([]);
      setNodeCommentsError("Unable to load comments for this node.");
    } finally {
      if (requestId === activeNodeCommentsRequestId.current) {
        setNodeCommentsLoading(false);
        activeNodeCommentsNodeId.current = null;
      }
    }
  };

  const resetNodeCommentEditor = () => {
    setNodeCommentEditingId(null);
    setNodeCommentFormLanguage("en");
    setNodeCommentFormText("");
  };

  const openCreateNodeCommentEditor = () => {
    resetNodeCommentEditor();
    setNodeCommentEditorOpen(true);
    setNodeCommentMessage(null);
  };

  const openEditNodeCommentEditor = (entry: NodeComment) => {
    setNodeCommentEditingId(entry.id);
    setNodeCommentFormLanguage((entry.language_code || "en").trim().toLowerCase() || "en");
    setNodeCommentFormText(entry.content_text || "");
    setNodeCommentEditorOpen(true);
    setNodeCommentMessage(null);
  };

  const handleSubmitNodeComment = async () => {
    if (!selectedId) return;
    const trimmedText = nodeCommentFormText.trim();
    if (!trimmedText) {
      setNodeCommentMessage("Comment text is required.");
      return;
    }

    const trimmedLanguage = nodeCommentFormLanguage.trim().toLowerCase() || "en";

    setNodeCommentSubmitting(true);
    setNodeCommentMessage(null);
    try {
      const endpoint =
        nodeCommentEditingId !== null
          ? contentPath(`/nodes/${selectedId}/comments/${nodeCommentEditingId}`)
          : contentPath(`/nodes/${selectedId}/comments`);
      const payload =
        nodeCommentEditingId !== null
          ? {
              content_text: trimmedText,
              language_code: trimmedLanguage,
            }
          : {
              node_id: selectedId,
              content_text: trimmedText,
              language_code: trimmedLanguage,
            };

      const response = await fetch(endpoint, {
        method: nodeCommentEditingId !== null ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(result?.detail || "Unable to save comment.");
      }

      await loadNodeComments(selectedId, true);
      resetNodeCommentEditor();
      setNodeCommentEditorOpen(false);
      setNodeCommentMessage("Comment saved.");
    } catch (err) {
      setNodeCommentMessage(err instanceof Error ? err.message : "Unable to save comment.");
    } finally {
      setNodeCommentSubmitting(false);
    }
  };

  const handleDeleteNodeComment = async (commentId: number) => {
    if (!selectedId) return;
    if (!window.confirm("Delete this comment?")) return;

    setNodeCommentSubmitting(true);
    setNodeCommentMessage(null);
    try {
      const response = await fetch(contentPath(`/nodes/${selectedId}/comments/${commentId}`), {
        method: "DELETE",
        credentials: "include",
      });
      const result = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(result?.detail || "Unable to delete comment.");
      }

      await loadNodeComments(selectedId, true);
      if (nodeCommentEditingId === commentId) {
        resetNodeCommentEditor();
      }
      setNodeCommentMessage("Comment deleted.");
    } catch (err) {
      setNodeCommentMessage(err instanceof Error ? err.message : "Unable to delete comment.");
    } finally {
      setNodeCommentSubmitting(false);
    }
  };

  const resetCommentaryEditor = () => {
    setCommentaryEditingId(null);
    setCommentaryFormAuthor("");
    setCommentaryFormWorkTitle("");
    setCommentaryFormLanguage("en");
    setCommentaryFormText("");
  };

  const openCreateCommentaryEditor = () => {
    resetCommentaryEditor();
    setCommentaryEditorOpen(true);
    setCommentaryMessage(null);
  };

  const openEditCommentaryEditor = (entry: CommentaryEntry) => {
    const metadata =
      entry.metadata && typeof entry.metadata === "object"
        ? (entry.metadata as Record<string, unknown>)
        : {};
    const author = typeof metadata.author === "string" ? metadata.author : "";
    const workTitle = typeof metadata.work_title === "string" ? metadata.work_title : "";

    setCommentaryEditingId(entry.id);
    setCommentaryFormAuthor(author);
    setCommentaryFormWorkTitle(workTitle);
    setCommentaryFormLanguage((entry.language_code || "en").trim().toLowerCase() || "en");
    setCommentaryFormText(entry.content_text || "");
    setCommentaryEditorOpen(true);
    setCommentaryMessage(null);
  };

  const handleSubmitCommentary = async () => {
    if (!selectedId) return;
    const trimmedText = commentaryFormText.trim();
    if (!trimmedText) {
      setCommentaryMessage("Commentary text is required.");
      return;
    }

    const trimmedLanguage = commentaryFormLanguage.trim().toLowerCase() || "en";
    const trimmedAuthor = commentaryFormAuthor.trim();
    const trimmedWorkTitle = commentaryFormWorkTitle.trim();
    const metadata: Record<string, unknown> = {};
    if (trimmedAuthor) metadata.author = trimmedAuthor;
    if (trimmedWorkTitle) metadata.work_title = trimmedWorkTitle;

    setCommentarySubmitting(true);
    setCommentaryMessage(null);
    try {
      const endpoint =
        commentaryEditingId !== null
          ? contentPath(`/nodes/${selectedId}/commentary/${commentaryEditingId}`)
          : contentPath(`/nodes/${selectedId}/commentary`);
      const payload =
        commentaryEditingId !== null
          ? {
              content_text: trimmedText,
              language_code: trimmedLanguage,
              metadata,
            }
          : {
              node_id: selectedId,
              content_text: trimmedText,
              language_code: trimmedLanguage,
              metadata,
            };

      const response = await fetch(endpoint, {
        method: commentaryEditingId !== null ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(result?.detail || "Unable to save commentary.");
      }

      await loadNodeCommentary(selectedId, true);
      resetCommentaryEditor();
      setCommentaryEditorOpen(false);
      setCommentaryMessage("Commentary saved.");
    } catch (err) {
      setCommentaryMessage(err instanceof Error ? err.message : "Unable to save commentary.");
    } finally {
      setCommentarySubmitting(false);
    }
  };

  const handleDeleteCommentary = async (entryId: number) => {
    if (!selectedId) return;
    if (!window.confirm("Delete this commentary entry?")) return;

    setCommentarySubmitting(true);
    setCommentaryMessage(null);
    try {
      const response = await fetch(contentPath(`/nodes/${selectedId}/commentary/${entryId}`), {
        method: "DELETE",
        credentials: "include",
      });
      const result = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(result?.detail || "Unable to delete commentary.");
      }

      await loadNodeCommentary(selectedId, true);
      if (commentaryEditingId === entryId) {
        resetCommentaryEditor();
      }
      setCommentaryMessage("Commentary deleted.");
    } catch (err) {
      setCommentaryMessage(err instanceof Error ? err.message : "Unable to delete commentary.");
    } finally {
      setCommentarySubmitting(false);
    }
  };

  const scrollToNode = (nodeId: number) => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`tree-node-${nodeId}`);
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  };

  const applySelection = (
    nodeId: number,
    path: TreeNode[],
    scroll = false,
    skipLoad = false,
    syncUrl = false,
    expandPath = true
  ) => {
    setSelectedId(nodeId);
    setBreadcrumb(path);
    if (expandPath) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        path.forEach((node) => next.add(node.id));
        return next;
      });
    }
    if (!skipLoad) {
      loadNodeContent(nodeId);
    }
    if (syncUrl && bookId && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const currentBook = url.searchParams.get("book") || "";
      const currentNode = url.searchParams.get("node") || "";
      if (currentBook !== bookId || currentNode !== String(nodeId)) {
        url.searchParams.set("book", bookId);
        url.searchParams.set("node", String(nodeId));
        window.history.replaceState(window.history.state, "", url.toString());
      }
    }
    if (scroll) {
      scrollToNode(nodeId);
    }
  };

  const selectNode = (nodeId: number, syncUrl = true, expandPath = true) => {
    if (nodeId !== selectedId && hasUnsavedInlineChanges()) {
      const shouldDiscard = window.confirm(
        "You have unsaved changes in Edit details. Discard changes and continue?"
      );
      if (!shouldDiscard) {
        return;
      }
    }

    if (pendingSavedNodeId.current !== null) {
      pendingSavedNodeId.current = null;
    }

    const syncSelectionUrl = (targetNodeId: number) => {
      if (typeof window === "undefined" || !bookId) return;
      const url = new URL(window.location.href);
      const currentBook = url.searchParams.get("book") || "";
      const currentNode = url.searchParams.get("node") || "";
      if (currentBook === bookId && currentNode === String(targetNodeId)) {
        return;
      }
      url.searchParams.set("book", bookId);
      url.searchParams.set("node", String(targetNodeId));
      window.history.replaceState(window.history.state, "", url.toString());
    };

    if (selectedId === nodeId && nodeContent?.id === nodeId && !contentLoading) {
      setMobilePanel("content");
      if (syncUrl && bookId) {
        syncSelectionUrl(nodeId);
      }
      return;
    }

    const path = findPath(treeData, nodeId);
    if (path) {
      applySelection(nodeId, path, false, false, syncUrl, expandPath);
    } else {
      setSelectedId(nodeId);
      setBreadcrumb([]);
      loadNodeContent(nodeId);
    }
    
    // Update URL with current selection
    if (syncUrl && bookId) {
      syncSelectionUrl(nodeId);
    }
  };

  const selectBookRoot = (syncUrl = true) => {
    if (selectedId !== BOOK_ROOT_NODE_ID && hasUnsavedInlineChanges()) {
      const shouldDiscard = window.confirm(
        "You have unsaved changes in Edit details. Discard changes and continue?"
      );
      if (!shouldDiscard) {
        return;
      }
    }

    setSelectedId(BOOK_ROOT_NODE_ID);
    setBreadcrumb([]);
    setNodeContent(null);
    setMobilePanel("content");

    if (syncUrl && bookId) {
      syncBrowseUrl(bookId, null, "replace");
    }
  };

  const loadSchemas = async () => {
    try {
      const response = await fetch(contentPath("/schemas"), {
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as SchemaOption[];
        setSchemas(data);
      }
    } catch {
      // Ignore errors
    }
  };

  const loadBooksRefresh = async () => {
    await loadBooksPage({ reset: true });
  };

  const loadBookShares = async () => {
    if (!bookId) return;
    setSharesLoading(true);
    setSharesError(null);
    try {
      const response = await fetch(`/api/books/${bookId}/shares`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | BookShare[]
        | { detail?: string }
        | null;
      if (!response.ok) {
        setBookShares([]);
        setSharesError(
          (payload as { detail?: string } | null)?.detail || "Failed to load shares"
        );
        return;
      }
      setBookShares(Array.isArray(payload) ? payload : []);
    } catch {
      setBookShares([]);
      setSharesError("Failed to load shares");
    } finally {
      setSharesLoading(false);
    }
  };

  const buildScripturesBrowsePath = (targetBookId: string, targetNodeId?: number | null) => {
    const params = new URLSearchParams();
    params.set("book", targetBookId);
    if (typeof targetNodeId === "number") {
      params.set("node", String(targetNodeId));
    }
    params.set("browse", "1");
    return `/scriptures?${params.toString()}`;
  };

  const buildScripturesPreviewPath = (
    scope: "book" | "node",
    targetBookId: string,
    targetNodeId?: number | null
  ) => {
    const params = new URLSearchParams();
    params.set("book", targetBookId);
    if (scope === "node" && typeof targetNodeId === "number") {
      params.set("node", String(targetNodeId));
    }
    params.set("preview", scope);
    return `/scriptures?${params.toString()}`;
  };

  const syncPreviewUrl = (
    scope: "book" | "node",
    targetBookId: string,
    targetNodeId?: number | null,
    historyMode: "push" | "replace" = "replace"
  ) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("book", targetBookId);
    if (scope === "node" && typeof targetNodeId === "number") {
      nextParams.set("node", String(targetNodeId));
    } else {
      nextParams.delete("node");
    }
    nextParams.delete("browse");
    nextParams.set("preview", scope);
    const currentQuery = searchParams.toString();
    const nextQuery = nextParams.toString();
    if (nextQuery === currentQuery) {
      return;
    }
    const nextPath = nextQuery ? `/scriptures?${nextQuery}` : "/scriptures";
    if (historyMode === "push") {
      router.push(nextPath, { scroll: false });
    } else {
      router.replace(nextPath);
    }
  };

  const syncBrowseUrl = (
    targetBookId: string,
    targetNodeId?: number | null,
    historyMode: "push" | "replace" = "replace"
  ) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("book", targetBookId);
    if (typeof targetNodeId === "number") {
      nextParams.set("node", String(targetNodeId));
    } else {
      nextParams.delete("node");
    }
    nextParams.delete("preview");
    nextParams.set("browse", "1");
    const currentQuery = searchParams.toString();
    const nextQuery = nextParams.toString();
    if (nextQuery === currentQuery) {
      return;
    }
    const nextPath = nextQuery ? `/scriptures?${nextQuery}` : "/scriptures";
    if (historyMode === "push") {
      router.push(nextPath, { scroll: false });
    } else {
      router.replace(nextPath);
    }
  };

  const clearPreviewUrl = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (!nextParams.has("preview")) {
      return;
    }
    nextParams.delete("preview");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/scriptures?${nextQuery}` : "/scriptures");
  };

  const clearBrowseUrl = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (!nextParams.has("browse")) {
      return;
    }
    nextParams.delete("browse");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/scriptures?${nextQuery}` : "/scriptures");
  };

  const handleClosePreview = () => {
    setShowBookPreview(false);
    setPreviewLinkMessage(null);

    const fromParam = searchParams.get("from");
    if (fromParam === "home") {
      router.push("/", { scroll: false });
      return;
    }
    if (fromParam === "search" && searchReturnUrl) {
      router.push(searchReturnUrl, { scroll: false });
      return;
    }

    clearPreviewUrl();
  };

  const handleCloseBrowseModal = () => {
    setShowBrowseBookModal(false);
    setShowExploreStructure(false);
    setMobilePanel("content");

    const fromParam = searchParams.get("from");
    if (fromParam === "home") {
      router.push("/", { scroll: false });
      return;
    }
    if (fromParam === "search" && searchReturnUrl) {
      router.push(searchReturnUrl, { scroll: false });
      return;
    }

    clearBrowseUrl();
  };

  const handleBrowseFromPreview = (targetBookId: string, targetNodeId?: number | null) => {
    setBrowseTransitioningFromPreview(true);
    setShowBookPreview(false);
    setPreviewLinkMessage(null);
    setPrivateBookGate(false);
    setShowExploreStructure(true);
    setShowBrowseBookModal(true);
    setMobilePanel("tree");
    syncBrowseUrl(targetBookId, targetNodeId, "push");
    void loadTree(targetBookId, typeof targetNodeId === "number" ? targetNodeId : undefined);
  };

  const handleClosePrivateBookGate = () => {
    setPrivateBookGate(false);
    setShowBrowseBookModal(false);
    setShowExploreStructure(false);
    setMobilePanel("content");

    const fromParam = searchParams.get("from");
    if (fromParam === "home") {
      router.push("/", { scroll: false });
      return;
    }
    if (fromParam === "search" && searchReturnUrl) {
      router.push(searchReturnUrl, { scroll: false });
      return;
    }

    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("preview");
    nextParams.delete("browse");
    nextParams.delete("book");
    nextParams.delete("node");
    nextParams.delete("from");
    nextParams.delete("searchContext");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/scriptures?${nextQuery}` : "/scriptures");
  };

  const handleCopyPreviewPath = async (relativePath: string) => {
    if (typeof window === "undefined" || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${relativePath}`);
      setPreviewLinkMessage("Link copied.");
      window.setTimeout(() => {
        setPreviewLinkMessage(null);
      }, 2000);
    } catch {
      setPreviewLinkMessage("Failed to copy link.");
      window.setTimeout(() => {
        setPreviewLinkMessage(null);
      }, 2000);
    }
  };

  const handlePreviewBook = async (
    scope: "book" | "node" = "book",
    targetBookId?: string,
    historyMode: "push" | "replace" = "push",
    pageOffset: number = 0,
    append: boolean = false,
    targetNodeId?: number | null
  ) => {
    const previewBookId = targetBookId ?? bookId;
    if (!previewBookId) return;
    const previewNodeId =
      scope === "node" ? (typeof targetNodeId === "number" ? targetNodeId : selectedId) : null;
    if (scope === "node" && !previewNodeId) {
      return;
    }

    const nextLanguageSettings = append
      ? { ...appliedBookPreviewLanguageSettings }
      : { ...bookPreviewLanguageSettings };
    const nextShowPreviewLabels = append ? appliedShowPreviewLabels : showPreviewLabels;
    const nextShowPreviewLevelNumbers = append ? appliedShowPreviewLevelNumbers : showPreviewLevelNumbers;
    const nextShowPreviewDetails = append ? appliedShowPreviewDetails : showPreviewDetails;
    const nextShowPreviewTitles = append ? appliedShowPreviewTitles : showPreviewTitles;
    const nextShowPreviewMedia = append ? appliedShowPreviewMedia : showPreviewMedia;
    const nextPreviewWordMeaningsDisplayMode = append
      ? appliedPreviewWordMeaningsDisplayMode
      : previewWordMeaningsDisplayMode;
    const nextPreviewTransliterationScript = append
      ? appliedBookPreviewTransliterationScript
      : previewTransliterationScript;
    const nextPreviewTranslationLanguages = append
      ? [...appliedPreviewTranslationLanguages]
      : [...previewTranslationLanguages];
    const nextHiddenPreviewLevels = append
      ? new Set(appliedHiddenPreviewLevels)
      : new Set(hiddenPreviewLevels);
    const resolvedPreviewTranslationLanguages = normalizeSelectedEditableTranslationLanguages(
      nextPreviewTranslationLanguages,
      sourceLanguage
    );

    setBookPreviewLoadingScope(scope);
    setBookPreviewError(null);
    if (append) {
      setBookPreviewLoadingMore(true);
    } else {
      setBookPreviewLoading(true);
    }

    try {
      const requestBody = {
        node_id: scope === "node" ? previewNodeId ?? undefined : undefined,
        metadata_bindings: {
          global: {
            word_meanings: {
              source: {
                source_display_mode: nextLanguageSettings.show_sanskrit
                    ? "script"
                  : "transliteration",
                preferred_transliteration_scheme:
                  nextPreviewTransliterationScript === "harvard_kyoto"
                    ? "hk"
                    : nextPreviewTransliterationScript === "itrans"
                      ? "itrans"
                      : "iast",
                allow_runtime_transliteration_generation: true,
              },
              meanings: {
                meaning_language: translationLanguageToCode(preferences?.source_language),
                fallback_order: ["user_preference", "en", "first_available"],
              },
              rendering: {
                show_language_badge_when_fallback_used: true,
              },
            },
            translation_language: translationLanguageToCode(
              resolvedPreviewTranslationLanguages[0] || preferences?.source_language
            ),
          },
        },
        render_settings: {
          ...nextLanguageSettings,
          show_metadata: nextShowPreviewDetails,
          show_media: nextShowPreviewMedia,
          text_order: ["sanskrit", "transliteration", "english", "text"],
        },
        offset: pageOffset,
        limit: scope === "book" ? BOOK_PREVIEW_PAGE_SIZE : 5000,
      };

      const requestPreviewArtifact = async () => {
        const response = await fetch(`/api/books/${previewBookId}/preview/render`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const payload = (await response.json().catch(() => null)) as
          | BookPreviewArtifact
          | { detail?: string }
          | null;
        return { response, payload };
      };

      let { response, payload } = await requestPreviewArtifact();

      const initialFailureDetail = (payload as { detail?: string } | null)?.detail || "";
      const shouldRetryAfterAuthRefresh =
        !append &&
        (response.status === 401 ||
          response.status === 403 ||
          (response.status === 404 &&
            currentBook?.visibility === "private" &&
            /not found/i.test(initialFailureDetail)));

      if (!response.ok && shouldRetryAfterAuthRefresh) {
        await loadAuth(true);
        const retried = await requestPreviewArtifact();
        response = retried.response;
        payload = retried.payload;
      }

      if (!response.ok) {
        const failureDetail = (payload as { detail?: string } | null)?.detail || "";
        const resolvedFailureDetail =
          !authEmail && response.status === 404
            ? ANONYMOUS_BOOK_NOT_FOUND_MESSAGE
            : failureDetail;
        const unrecoverableAuthFailure =
          response.status === 401 ||
          response.status === 403 ||
          (response.status === 404 &&
            currentBook?.visibility === "private" &&
            /not found/i.test(failureDetail));

        if (unrecoverableAuthFailure) {
          setPrivateBookGate(true);
          setBookPreviewArtifact(null);
          if (!append) {
            setShowBookPreview(false);
          }
          throw new Error("Session expired. Please sign in to continue.");
        }

        setBookPreviewArtifact(null);
        throw new Error(resolvedFailureDetail || "Failed to render book preview");
      }

      const artifact = payload as BookPreviewArtifact;
      const legacyBody = (artifact as BookPreviewArtifact & { body?: unknown }).body;
      const normalizedBody = Array.isArray(artifact.sections?.body)
        ? artifact.sections.body
        : Array.isArray(legacyBody)
          ? legacyBody
          : [];
      const normalizedArtifact: BookPreviewArtifact = {
        ...artifact,
        section_order:
          Array.isArray(artifact.section_order) && artifact.section_order.length > 0
            ? artifact.section_order
            : ["body"],
        sections: {
          body: normalizedBody,
        },
        offset: typeof artifact.offset === "number" ? artifact.offset : pageOffset,
        limit:
          typeof artifact.limit === "number"
            ? artifact.limit
            : scope === "book"
              ? BOOK_PREVIEW_PAGE_SIZE
              : 5000,
        total_blocks:
          typeof artifact.total_blocks === "number"
            ? artifact.total_blocks
            : normalizedBody.length,
        has_more: Boolean(artifact.has_more),
      };

      if (append) {
        setBookPreviewArtifact((prev) => {
          if (!prev) {
            return normalizedArtifact;
          }
          return {
            ...normalizedArtifact,
            book_template: prev.book_template || normalizedArtifact.book_template,
            book_media_items: prev.book_media_items || normalizedArtifact.book_media_items,
            warnings: Array.from(new Set([...(prev.warnings || []), ...(normalizedArtifact.warnings || [])])),
            sections: {
              body: [...prev.sections.body, ...normalizedArtifact.sections.body],
            },
            offset: 0,
            total_blocks: normalizedArtifact.total_blocks ?? prev.sections.body.length,
            has_more: Boolean(normalizedArtifact.has_more),
          };
        });
      } else {
        setBookPreviewArtifact(normalizedArtifact);
      }

      if (!append) {
        const nextPreferences = normalizePreferences({
          ...(preferences || DEFAULT_USER_PREFERENCES),
          preview_show_titles: nextShowPreviewTitles,
          preview_show_labels: nextShowPreviewLabels,
          preview_show_level_numbers: nextShowPreviewLevelNumbers,
          preview_show_details: nextShowPreviewDetails,
          preview_show_media: nextShowPreviewMedia,
          preview_show_sanskrit: nextLanguageSettings.show_sanskrit,
          preview_show_transliteration: nextLanguageSettings.show_transliteration,
          preview_show_english: nextLanguageSettings.show_english,
          preview_show_commentary: nextLanguageSettings.show_commentary,
          preview_transliteration_script: nextPreviewTransliterationScript,
          preview_word_meanings_display_mode: nextPreviewWordMeaningsDisplayMode,
          preview_translation_languages: serializePreviewTranslationLanguages(
            resolvedPreviewTranslationLanguages
          ),
          preview_hidden_levels: serializeHiddenPreviewLevels(nextHiddenPreviewLevels),
        });
        setPreferences(nextPreferences);
        const saveSucceeded = await savePreferences(nextPreferences);
        if (!saveSucceeded) {
          setBookPreviewError("Failed to save preview settings. Changes not persisted.");
        }
      }

      setAppliedBookPreviewLanguageSettings(nextLanguageSettings);
      setAppliedShowPreviewLabels(nextShowPreviewLabels);
      setAppliedShowPreviewLevelNumbers(nextShowPreviewLevelNumbers);
      setAppliedShowPreviewDetails(nextShowPreviewDetails);
      setAppliedShowPreviewTitles(nextShowPreviewTitles);
      setAppliedShowPreviewMedia(nextShowPreviewMedia);
      setAppliedPreviewWordMeaningsDisplayMode(nextPreviewWordMeaningsDisplayMode);
      setAppliedPreviewFontSizePercent(previewFontSizePercent);
      setAppliedBookPreviewTransliterationScript(nextPreviewTransliterationScript);
      setAppliedPreviewTranslationLanguages(resolvedPreviewTranslationLanguages);
      setAppliedHiddenPreviewLevels(nextHiddenPreviewLevels);
      setAppliedPreviewVariantAuthorSlugs(previewVariantAuthorSlugs);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          PREVIEW_FONT_SIZE_PERCENT_STORAGE_KEY,
          String(normalizePreviewFontSizePercent(previewFontSizePercent))
        );
      }
      if (typeof window !== "undefined" && !authEmail) {
        window.localStorage.setItem(
          PREVIEW_TRANSLATION_LANGUAGES_STORAGE_KEY,
          JSON.stringify(resolvedPreviewTranslationLanguages)
        );
      }

      if (!append) {
        const requestNodeIdPart = scope === "node" && previewNodeId ? `:${previewNodeId}` : "";
        lastHandledPreviewRequestKey.current = `${scope}:${previewBookId}${requestNodeIdPart}`;
        syncPreviewUrl(scope, previewBookId, previewNodeId, historyMode);
        setShowBookPreview(true);
      }
    } catch (err) {
      if (!append) {
        setShowBookPreview(false);
      }
      setBookPreviewError(err instanceof Error ? err.message : "Failed to render book preview");
    } finally {
      if (append) {
        setBookPreviewLoadingMore(false);
      } else {
        setBookPreviewLoading(false);
      }
    }
  };

  const handlePreviewSiblingNavigation = async (direction: "previous" | "next") => {
    if (!bookPreviewArtifact || bookPreviewArtifact.preview_scope !== "node") {
      return;
    }

    const { previousSiblingId, nextSiblingId } = getPreviewSiblingNavigation(bookPreviewArtifact);
    const targetSiblingId = direction === "previous" ? previousSiblingId : nextSiblingId;

    if (!targetSiblingId || !bookId) {
      return;
    }

    const targetPath = findPath(treeData, targetSiblingId);
    if (targetPath) {
      applySelection(targetSiblingId, targetPath, false, false, true);
    } else {
      setSelectedId(targetSiblingId);
    }

    await handlePreviewBook("node", bookId, "replace", 0, false, targetSiblingId);
  };

  const loadMoreBookPreview = async () => {
    if (
      !bookPreviewArtifact ||
      bookPreviewArtifact.preview_scope !== "book" ||
      !bookPreviewArtifact.has_more ||
      bookPreviewLoading ||
      bookPreviewLoadingMore
    ) {
      return;
    }

    const nextOffset = bookPreviewArtifact.sections.body.length;
    await handlePreviewBook("book", String(bookPreviewArtifact.book_id), "replace", nextOffset, true);
  };

  const handleBookPreviewScroll = () => {
    const container = bookPreviewScrollContainerRef.current;
    if (!container || !bookPreviewArtifact?.has_more || bookPreviewLoading || bookPreviewLoadingMore) {
      return;
    }

    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (remaining <= BOOK_PREVIEW_LOAD_MORE_THRESHOLD_PX) {
      void loadMoreBookPreview();
    }
  };

  useEffect(() => {
    if (!showBookPreview || !bookPreviewArtifact || bookPreviewArtifact.preview_scope !== "book") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      handleBookPreviewScroll();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    showBookPreview,
    bookPreviewArtifact,
    bookPreviewLoading,
    bookPreviewLoadingMore,
  ]);

  useEffect(() => {
    const previewParam = searchParams.get("preview");
    if (previewParam !== "book" && previewParam !== "node") {
      return;
    }
    if (!urlInitialized || !bookId) {
      return;
    }
    // Avoid rendering preview with default settings before persisted preview preferences hydrate.
    if (!previewSettingsInitialized.current) {
      return;
    }
    if (showBookPreview || bookPreviewLoading) {
      return;
    }

    let previewScope: "book" | "node" = "book";
    let requestNodeIdPart = "";
    if (previewParam === "node") {
      const nodeParam = searchParams.get("node");
      const requestedNodeId = nodeParam ? Number.parseInt(nodeParam, 10) : NaN;
      if (!Number.isFinite(requestedNodeId) || selectedId !== requestedNodeId) {
        return;
      }
      previewScope = "node";
      requestNodeIdPart = `:${requestedNodeId}`;
    }

    const requestKey = `${previewScope}:${bookId}${requestNodeIdPart}`;
    if (lastHandledPreviewRequestKey.current === requestKey) {
      return;
    }
    lastHandledPreviewRequestKey.current = requestKey;

    void handlePreviewBook(previewScope, bookId, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlInitialized, bookId, selectedId, searchParams, showBookPreview, bookPreviewLoading]);

  useEffect(() => {
    const browseParam = searchParams.get("browse");
    if (browseParam !== "1") {
      return;
    }
    if (!urlInitialized || !bookId || !canExploreStructure) {
      return;
    }
    const nodeParam = searchParams.get("node");
    const nodeId = nodeParam ? parseInt(nodeParam, 10) : undefined;
    setShowBookPreview(false);
    setPreviewLinkMessage(null);
    setPrivateBookGate(false);
    setShowExploreStructure(true);
    setShowBrowseBookModal(true);
    setMobilePanel("tree");
    void loadTree(bookId, Number.isFinite(nodeId ?? NaN) ? nodeId : undefined);
  }, [urlInitialized, bookId, canExploreStructure, searchParams]);

  useEffect(() => {
    if (!showBrowseBookModal || !isExploreVisible) {
      return;
    }

    if (selectedId !== null) {
      setMobilePanel((prev) => (prev === "content" ? prev : "content"));
      return;
    }

    setMobilePanel((prev) => (prev === "tree" ? prev : "tree"));
  }, [showBrowseBookModal, isExploreVisible, selectedId]);

  useEffect(() => {
    if (authEmail) {
      setPrivateBookGate(false);
    }
  }, [authEmail]);

  useEffect(() => {
    if (!browseTransitioningFromPreview) {
      return;
    }
    if (!showBrowseBookModal) {
      setBrowseTransitioningFromPreview(false);
      return;
    }
    if (privateBookGate || treeError || selectedId !== null || (!treeLoading && treeData.length === 0)) {
      setBrowseTransitioningFromPreview(false);
    }
  }, [
    browseTransitioningFromPreview,
    showBrowseBookModal,
    privateBookGate,
    treeError,
    selectedId,
    treeLoading,
    treeData,
  ]);

  const handleCreateShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookId || !shareEmail.trim()) return;

    setSharesSubmitting(true);
    setSharesError(null);
    try {
      const response = await fetch(`/api/books/${bookId}/shares`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: shareEmail.trim(),
          permission: sharePermission,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | BookShare
        | { detail?: string }
        | null;
      if (!response.ok) {
        setSharesError(
          (payload as { detail?: string } | null)?.detail || "Failed to add share"
        );
        return;
      }
      setShareEmail("");
      setSharePermission("viewer");
      await loadBookShares();
    } catch {
      setSharesError("Failed to add share");
    } finally {
      setSharesSubmitting(false);
    }
  };

  const handleUpdateSharePermission = async (
    sharedUserId: number,
    permission: SharePermission
  ) => {
    if (!bookId) return;

    setShareUpdatingUserId(sharedUserId);
    setSharesError(null);
    try {
      const response = await fetch(
        `/api/books/${bookId}/shares/${sharedUserId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permission }),
        }
      );
      const payload = (await response.json().catch(() => null)) as
        | BookShare
        | { detail?: string }
        | null;
      if (!response.ok) {
        setSharesError(
          (payload as { detail?: string } | null)?.detail || "Failed to update share"
        );
        return;
      }
      setBookShares((prev) =>
        prev.map((share) =>
          share.shared_with_user_id === sharedUserId
            ? { ...share, permission }
            : share
        )
      );
    } catch {
      setSharesError("Failed to update share");
    } finally {
      setShareUpdatingUserId(null);
    }
  };

  const handleDeleteShare = async (sharedUserId: number) => {
    if (!bookId) return;

    setShareRemovingUserId(sharedUserId);
    setSharesError(null);
    try {
      const response = await fetch(`/api/books/${bookId}/shares/${sharedUserId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; detail?: string }
        | null;
      if (!response.ok) {
        setSharesError(payload?.detail || "Failed to remove share");
        return;
      }
      setBookShares((prev) =>
        prev.filter((share) => share.shared_with_user_id !== sharedUserId)
      );
    } catch {
      setSharesError("Failed to remove share");
    } finally {
      setShareRemovingUserId(null);
    }
  };

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchema) return;

    setBookSubmitting(true);
    try {
      const titleTransliteration = bookFormData.titleTransliteration.trim();
      const titleEnglish = bookFormData.titleEnglish.trim();
      const author = bookFormData.author.trim();
      const payload = {
        schema_id: selectedSchema,
        book_name: bookFormData.bookName,
        book_code: bookFormData.bookCode || null,
        language_primary: bookFormData.languagePrimary,
        metadata: {
          ...(titleTransliteration ? { title_transliteration: titleTransliteration } : {}),
          ...(titleEnglish ? { title_english: titleEnglish } : {}),
          ...(author ? { author } : {}),
        },
      };

      const response = await fetch("/api/books", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const newBook = (await response.json()) as BookOption;
        // Close modal and reset form
        setShowCreateBook(false);
        setSelectedSchema(null);
        setCreateBookStep("schema");
        setBookFormData({
          bookName: "",
          titleTransliteration: "",
          titleEnglish: "",
          author: "",
          bookCode: "",
          languagePrimary: "sanskrit",
        });
        // Refresh books list and select the new book
        await loadBooksRefresh();
        setBookId(newBook.id.toString());
        router.push(`/scriptures?book=${newBook.id}`, { scroll: false });
        loadTree(newBook.id.toString());
      } else {
        const errData = await response.json();
        alert(errData.detail || "Failed to create book");
      }
    } catch (err) {
      console.error("Error creating book:", err);
      alert("Failed to create book");
    } finally {
      setBookSubmitting(false);
    }
  };

  const pollImportJob = useCallback(
    async (
      jobId: string,
      options?: {
        canonicalJsonUrl?: string | null;
        showResumeMessage?: boolean;
      }
    ) => {
      if (!jobId) {
        return;
      }

      importPollingRunIdRef.current += 1;
      const runId = importPollingRunIdRef.current;
      activeImportJobIdRef.current = jobId;

      const updateProgressState = (
        status: ImportJobLifecycleStatus,
        message: string | null,
        current: number | null,
        total: number | null
      ) => {
        if (importPollingRunIdRef.current !== runId) {
          return false;
        }

        setImportSubmitting(status === "queued" || status === "running");
        setImportProgressMessage(message);
        setImportProgressCurrent(current);
        setImportProgressTotal(total);
        writePersistedImportJobState({
          jobId,
          status,
          progressMessage: message,
          progressCurrent: current,
          progressTotal: total,
          canonicalJsonUrl: options?.canonicalJsonUrl ?? null,
        });
        return true;
      };

      if (options?.showResumeMessage) {
        updateProgressState("running", "Resuming import status...", null, null);
      }

      const pollIntervalMs = 2000;
      const maxPollAttempts = 900;
      let finalResult: ImportResult | null = null;

      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        if (importPollingRunIdRef.current !== runId) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        if (importPollingRunIdRef.current !== runId) {
          return;
        }

        const statusResponse = await fetch(`/api/content/import/jobs/${encodeURIComponent(jobId)}`, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        const statusRawText = await statusResponse.text();
        let statusPayload: ImportJobStatus | null = null;
        if (statusRawText) {
          try {
            const parsed = JSON.parse(statusRawText) as unknown;
            if (parsed && typeof parsed === "object") {
              statusPayload = parsed as ImportJobStatus;
            }
          } catch {
            statusPayload = null;
          }
        }

        if (!statusResponse.ok) {
          clearPersistedImportJobState();
          activeImportJobIdRef.current = null;
          setImportSubmitting(false);
          setImportProgressMessage(null);
          setImportProgressCurrent(null);
          setImportProgressTotal(null);
          const fallbackDetail =
            statusRawText.trim() || `Import status failed (${statusResponse.status} ${statusResponse.statusText})`;
          alert(statusPayload?.detail || statusPayload?.error || fallbackDetail);
          return;
        }

        const nextStatus = statusPayload?.status || "running";
        const nextMessage = statusPayload?.progress_message || nextStatus || "Importing...";
        const nextCurrent =
          typeof statusPayload?.progress_current === "number" ? statusPayload.progress_current : null;
        const nextTotal =
          typeof statusPayload?.progress_total === "number" ? statusPayload.progress_total : null;

        if (!updateProgressState(nextStatus, nextMessage, nextCurrent, nextTotal)) {
          return;
        }

        if (nextStatus === "queued" || nextStatus === "running") {
          continue;
        }

        if (nextStatus === "failed") {
          clearPersistedImportJobState();
          activeImportJobIdRef.current = null;
          setImportSubmitting(false);
          setImportProgressMessage(null);
          setImportProgressCurrent(null);
          setImportProgressTotal(null);
          alert(statusPayload?.error || statusPayload?.result?.error || "Import job failed");
          return;
        }

        finalResult = statusPayload?.result ?? null;
        break;
      }

      if (importPollingRunIdRef.current !== runId) {
        return;
      }

      if (!finalResult) {
        alert("Import is still running. Please wait and try again in a minute.");
        return;
      }

      if (finalResult.success === false) {
        clearPersistedImportJobState();
        activeImportJobIdRef.current = null;
        setImportSubmitting(false);
        setImportProgressMessage(null);
        setImportProgressCurrent(null);
        setImportProgressTotal(null);
        alert(finalResult.detail || finalResult.error || "Import failed");
        return;
      }

      await loadBooksRefresh();
      const importedBookId =
        typeof finalResult.book_id === "number" && Number.isFinite(finalResult.book_id)
          ? finalResult.book_id
          : null;
      if (importedBookId !== null) {
        setBookId(String(importedBookId));
        router.push(`/scriptures?book=${importedBookId}`, { scroll: false });
        loadTree(String(importedBookId));
      }

      clearPersistedImportJobState();
      activeImportJobIdRef.current = null;
      setImportSubmitting(false);
      setImportProgressMessage(null);
      setImportProgressCurrent(null);
      setImportProgressTotal(null);
      setShowImportUrlInput(false);
      setImportUrl("");
      alert(
        `Import completed${typeof finalResult.nodes_created === "number" ? ` (${finalResult.nodes_created} nodes)` : ""}`
      );
    },
    [loadBooksRefresh, loadTree, router]
  );

  useEffect(() => {
    return () => {
      importPollingRunIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const persistedJob = readPersistedImportJobState();
    if (!persistedJob?.jobId) {
      return;
    }
    if (persistedJob.status === "succeeded" || persistedJob.status === "failed") {
      clearPersistedImportJobState();
      return;
    }
    if (activeImportJobIdRef.current === persistedJob.jobId) {
      return;
    }

    setImportSubmitting(true);
    setShowImportUrlInput(Boolean(persistedJob.canonicalJsonUrl));
    if (typeof persistedJob.canonicalJsonUrl === "string" && persistedJob.canonicalJsonUrl) {
      setImportUrl(persistedJob.canonicalJsonUrl);
    }
    setImportProgressMessage(persistedJob.progressMessage || "Resuming import status...");
    setImportProgressCurrent(
      typeof persistedJob.progressCurrent === "number" ? persistedJob.progressCurrent : null
    );
    setImportProgressTotal(
      typeof persistedJob.progressTotal === "number" ? persistedJob.progressTotal : null
    );

    void pollImportJob(persistedJob.jobId, {
      canonicalJsonUrl: persistedJob.canonicalJsonUrl ?? null,
      showResumeMessage: true,
    });
  }, [pollImportJob]);

  const handleImportBookFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file || !canImport) return;

    setImportSubmitting(true);
    setImportProgressMessage("Preparing canonical upload...");
    setImportProgressCurrent(null);
    setImportProgressTotal(null);
    try {
      const initResponse = await fetch("/api/content/import/canonical-uploads/init", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          size_bytes: file.size,
        }),
      });

      const initRawText = await initResponse.text();
      let initResult: CanonicalUploadInit | null = null;
      if (initRawText) {
        try {
          initResult = JSON.parse(initRawText) as CanonicalUploadInit;
        } catch {
          initResult = null;
        }
      }

      if (!initResponse.ok) {
        const fallbackDetail =
          initRawText.trim() || `Canonical upload init failed (${initResponse.status} ${initResponse.statusText})`;
        alert(initResult?.detail || initResult?.error || fallbackDetail);
        return;
      }

      const uploadId = typeof initResult?.upload_id === "string" ? initResult.upload_id : "";
      if (!uploadId) {
        alert("Canonical upload did not return a valid upload ID");
        return;
      }

      const maxSizeBytes =
        typeof initResult?.max_size_bytes === "number" && initResult.max_size_bytes > 0
          ? initResult.max_size_bytes
          : null;
      if (typeof maxSizeBytes === "number" && file.size > maxSizeBytes) {
        alert(
          `This file is too large (${Math.ceil(file.size / (1024 * 1024))} MB). Max supported size is ${Math.floor(maxSizeBytes / (1024 * 1024))} MB.`
        );
        return;
      }

      const chunkSizeBytes =
        typeof initResult?.chunk_size_bytes === "number" && initResult.chunk_size_bytes > 0
          ? initResult.chunk_size_bytes
          : IMPORT_CANONICAL_CHUNK_FALLBACK_BYTES;

      const totalChunks = Math.max(1, Math.ceil(file.size / chunkSizeBytes));
      setImportProgressMessage("Uploading canonical JSON...");
      setImportProgressCurrent(0);
      setImportProgressTotal(totalChunks);

      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * chunkSizeBytes;
        const end = Math.min(start + chunkSizeBytes, file.size);
        const chunkBlob = file.slice(start, end);
        const formData = new FormData();
        formData.append("index", String(index));
        formData.append(
          "chunk",
          new File([chunkBlob], `${file.name || "canonical"}.part`, {
            type: "application/octet-stream",
          })
        );

        const chunkResponse = await fetch(
          `/api/content/import/canonical-uploads/${encodeURIComponent(uploadId)}/chunk`,
          {
            method: "POST",
            credentials: "include",
            body: formData,
          }
        );

        const chunkRawText = await chunkResponse.text();
        let chunkResult: CanonicalUploadChunk | null = null;
        if (chunkRawText) {
          try {
            chunkResult = JSON.parse(chunkRawText) as CanonicalUploadChunk;
          } catch {
            chunkResult = null;
          }
        }

        if (!chunkResponse.ok) {
          const fallbackDetail =
            chunkRawText.trim() || `Chunk upload failed (${chunkResponse.status} ${chunkResponse.statusText})`;
          alert(chunkResult?.detail || chunkResult?.error || fallbackDetail);
          return;
        }

        setImportProgressMessage(`Uploading canonical JSON... (${index + 1}/${totalChunks})`);
        setImportProgressCurrent(index + 1);
      }

      setImportProgressMessage("Finalizing canonical upload...");
      const completeResponse = await fetch(
        `/api/content/import/canonical-uploads/${encodeURIComponent(uploadId)}/complete`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const completeRawText = await completeResponse.text();
      let completeResult: CanonicalUploadComplete | null = null;
      if (completeRawText) {
        try {
          completeResult = JSON.parse(completeRawText) as CanonicalUploadComplete;
        } catch {
          completeResult = null;
        }
      }

      if (!completeResponse.ok) {
        const fallbackDetail =
          completeRawText.trim() ||
          `Canonical upload completion failed (${completeResponse.status} ${completeResponse.statusText})`;
        alert(completeResult?.detail || completeResult?.error || fallbackDetail);
        return;
      }

      const canonicalJsonUrl =
        typeof completeResult?.canonical_json_url === "string" ? completeResult.canonical_json_url.trim() : "";
      if (!canonicalJsonUrl) {
        alert("Canonical upload did not return a valid URL");
        return;
      }

      setImportProgressMessage("Starting import...");
      const response = await fetch("/api/content/import/jobs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        import_type: "json",
          schema_version: "hsp-book-json-v1",
          canonical_json_url: canonicalJsonUrl,
        }),
      });

      const rawText = await response.text();

      let startResult: ImportJobStart | null = null;
      if (rawText) {
        try {
          const parsedStart = JSON.parse(rawText) as unknown;
          if (parsedStart && typeof parsedStart === "object") {
            startResult = parsedStart as ImportJobStart;
          }
        } catch {
          startResult = null;
        }
      }

      if (!response.ok) {
        const fallbackDetail = rawText.trim() || `Import start failed (${response.status} ${response.statusText})`;
        alert(startResult?.detail || startResult?.error || fallbackDetail);
        return;
      }

      const jobId = typeof startResult?.job_id === "string" ? startResult.job_id : "";
      if (!jobId) {
        alert("Import job did not return a valid job ID");
        return;
      }

      const queuedMessage = startResult?.status === "queued" ? "Queued" : "Starting import...";
      setImportProgressMessage(queuedMessage);
      writePersistedImportJobState({
        jobId,
        status: startResult?.status || "queued",
        progressMessage: queuedMessage,
        progressCurrent: 0,
        progressTotal: null,
        canonicalJsonUrl,
      });

      await pollImportJob(jobId, { canonicalJsonUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import JSON file";
      alert(message);
    } finally {
      if (activeImportJobIdRef.current === null) {
        setImportSubmitting(false);
        setImportProgressMessage(null);
        setImportProgressCurrent(null);
        setImportProgressTotal(null);
      }
    }
  };

  const handleImportBookUrl = async () => {
    if (!canImport) return;

    const trimmedUrl = importUrl.trim();
    if (!trimmedUrl) {
      alert("Enter a public raw JSON URL");
      return;
    }

    let canonicalJsonUrl = trimmedUrl;
    let forceReimport = false;
    let allowExistingContent = false;

    try {
      const parsedUrl = new URL(trimmedUrl);
      const forceParam = parsedUrl.searchParams.get("force_reimport");
      const allowParam = parsedUrl.searchParams.get("allow_existing_content");
      forceReimport = forceParam === "true";
      allowExistingContent = allowParam === "true";

      if (forceParam !== null) {
        parsedUrl.searchParams.delete("force_reimport");
      }
      if (allowParam !== null) {
        parsedUrl.searchParams.delete("allow_existing_content");
      }
      canonicalJsonUrl = parsedUrl.toString();
    } catch {
      canonicalJsonUrl = trimmedUrl;
    }

    setImportSubmitting(true);
    setImportProgressMessage("Starting import...");
    setImportProgressCurrent(0);
    setImportProgressTotal(null);
    try {
      const response = await fetch("/api/content/import/jobs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          import_type: "json",
          schema_version: "hsp-book-json-v1",
          canonical_json_url: canonicalJsonUrl,
          ...(forceReimport ? { force_reimport: true } : {}),
          ...(allowExistingContent ? { allow_existing_content: true } : {}),
        }),
      });

      const rawText = await response.text();

      let startResult: ImportJobStart | null = null;
      if (rawText) {
        try {
          const parsed = JSON.parse(rawText) as unknown;
          if (parsed && typeof parsed === "object") {
            startResult = parsed as ImportJobStart;
          }
        } catch {
          startResult = null;
        }
      }

      if (!response.ok) {
        const fallbackDetail = rawText.trim() || `Import start failed (${response.status} ${response.statusText})`;
        alert(startResult?.detail || startResult?.error || fallbackDetail);
        return;
      }

      const jobId = typeof startResult?.job_id === "string" ? startResult.job_id : "";
      if (!jobId) {
        alert("Import job did not return a valid job ID");
        return;
      }

      const queuedMessage = startResult?.status === "queued" ? "Queued" : "Starting import...";
      setImportProgressMessage(queuedMessage);
      writePersistedImportJobState({
        jobId,
        status: startResult?.status || "queued",
        progressMessage: queuedMessage,
        progressCurrent: 0,
        progressTotal: null,
        canonicalJsonUrl,
      });

      await pollImportJob(jobId, { canonicalJsonUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import JSON from URL";
      alert(message);
    } finally {
      if (activeImportJobIdRef.current === null) {
        setImportSubmitting(false);
        setImportProgressMessage(null);
        setImportProgressCurrent(null);
        setImportProgressTotal(null);
      }
    }
  };

  const handleExportBookJson = async (targetBookId: number, targetBookName?: string) => {
    if (!canImport) {
      alert("You do not have permission to export books");
      return;
    }

    try {
      const response = await fetch(`/api/content/books/${targetBookId}/export/json`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      const payload = (await response.json().catch(() => null)) as
        | Record<string, unknown>
        | { detail?: string }
        | null;

      if (!response.ok || !payload) {
        alert((payload as { detail?: string } | null)?.detail || "Failed to export book");
        return;
      }

      const safeName = (targetBookName || `book-${targetBookId}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || `book-${targetBookId}`;
      const fileName = `${safeName}.json`;

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export book");
    }
  };

  const handleExportBookPdf = async (
    targetBookId: number,
    targetBookName?: string,
    options?: { respectCurrentPreviewScope?: boolean }
  ) => {
    try {
      const useAppliedPreviewSettings = Boolean(showBookPreview && bookPreviewArtifact);
      const activeTranslationLanguages = useAppliedPreviewSettings
        ? appliedPreviewTranslationLanguages
        : previewTranslationLanguages;
      const activePreviewLanguageSettings = useAppliedPreviewSettings
        ? appliedBookPreviewLanguageSettings
        : bookPreviewLanguageSettings;
      const activeShowPreviewDetails = useAppliedPreviewSettings
        ? appliedShowPreviewDetails
        : showPreviewDetails;
      const activeShowPreviewMedia = useAppliedPreviewSettings
        ? appliedShowPreviewMedia
        : showPreviewMedia;
      const activeTransliterationScript = useAppliedPreviewSettings
        ? appliedBookPreviewTransliterationScript
        : previewTransliterationScript;

      const resolvedPreviewTranslationLanguages = normalizeSelectedEditableTranslationLanguages(
        activeTranslationLanguages,
        sourceLanguage
      );
      const effectivePreviewLanguageSettings = {
        ...activePreviewLanguageSettings,
      };
      const exportNodeId =
        options?.respectCurrentPreviewScope &&
        bookPreviewArtifact?.preview_scope === "node" &&
        typeof bookPreviewArtifact.root_node_id === "number"
          ? bookPreviewArtifact.root_node_id
          : undefined;

      const response = await fetch(`/api/books/${targetBookId}/export/pdf`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/pdf",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          node_id: exportNodeId,
          selected_translation_languages: resolvedPreviewTranslationLanguages,
          metadata_bindings: {
            global: {
              word_meanings: {
                source: {
                  source_display_mode: effectivePreviewLanguageSettings.show_sanskrit
                    ? "script"
                    : "transliteration",
                  preferred_transliteration_scheme:
                    activeTransliterationScript === "harvard_kyoto"
                      ? "hk"
                      : activeTransliterationScript === "itrans"
                        ? "itrans"
                        : "iast",
                  allow_runtime_transliteration_generation: true,
                },
                meanings: {
                  meaning_language: translationLanguageToCode(preferences?.source_language),
                  fallback_order: ["user_preference", "en", "first_available"],
                },
                rendering: {
                  show_language_badge_when_fallback_used: true,
                },
              },
              translation_language: translationLanguageToCode(
                resolvedPreviewTranslationLanguages[0] || preferences?.source_language
              ),
            },
          },
          render_settings: {
            ...effectivePreviewLanguageSettings,
            show_metadata: activeShowPreviewDetails,
            show_media: activeShowPreviewMedia,
            text_order: ["sanskrit", "transliteration", "english", "text"],
          },
          preview_show_titles: useAppliedPreviewSettings
            ? appliedShowPreviewTitles
            : showPreviewTitles,
          preview_show_labels: useAppliedPreviewSettings
            ? appliedShowPreviewLabels
            : showPreviewLabels,
          preview_transliteration_script: activeTransliterationScript,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        alert(payload?.detail || "Failed to export book PDF");
        return;
      }

      const blob = await response.blob();
      const safeName = (targetBookName || `book-${targetBookId}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || `book-${targetBookId}`;
      const fileName = `${safeName}.pdf`;

      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export book PDF");
    }
  };

  const findNodeById = (nodes: TreeNode[], id: number): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children && node.children.length > 0) {
        const found = findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const buildFormDataFromNode = (node: NodeContent) => {
    const contentBasic = node.content_data?.basic;
    const contentTranslations = toTranslationRecord(node.content_data?.translations);
    const preferredTranslation = pickPreferredTranslationText(
      contentTranslations,
      sourceLanguage,
      contentBasic?.translation
    );
    const languageSpecificTranslation = pickTranslationTextForLanguageOnly(
      contentTranslations,
      sourceLanguage
    );
    const hasContent = Boolean(
      node.has_content ||
        contentBasic?.sanskrit ||
        contentBasic?.transliteration ||
        contentBasic?.translation ||
        preferredTranslation
    );

    return {
      levelName: node.level_name || "",
      titleSanskrit: node.title_sanskrit || "",
      titleTransliteration: node.title_transliteration || "",
      titleEnglish: node.title_english || "",
      sequenceNumber: node.sequence_number !== null && node.sequence_number !== undefined
        ? node.sequence_number.toString()
        : "",
      hasContent,
      contentSanskrit: contentBasic?.sanskrit || "",
      contentTransliteration: contentBasic?.transliteration || "",
      contentEnglish: languageSpecificTranslation,
      tags: node.tags?.join(", ") || "",
      wordMeanings: mapWordMeaningsRowsFromContent(node),
    };
  };

  const buildTranslationEditorStateFromNode = (node: NodeContent) => {
    const translations = toTranslationRecord(node.content_data?.translations);
    const drafts = buildEditableTranslationDrafts(translations);
    const selectedFromData = EDITABLE_TRANSLATION_LANGUAGES.filter(
      (language) => Boolean((drafts[language] || "").trim())
    ) as EditableTranslationLanguage[];
    const selectedLanguages = normalizeSelectedEditableTranslationLanguages(
      selectedFromData,
      sourceLanguage
    );
    return {
      drafts,
      selectedLanguages,
    };
  };

  const buildVariantEditorStateFromNode = (node: NodeContent) => {
    const translationVariants = normalizeAuthorVariantDrafts(
      node.content_data?.translation_variants,
      "translation"
    );
    const commentaryVariants = normalizeAuthorVariantDrafts(
      node.content_data?.commentary_variants,
      "commentary"
    );
    return {
      translationVariants,
      commentaryVariants,
    };
  };

  const normalizeInlineFormForCompare = (value: {
    levelName: string;
    titleSanskrit: string;
    titleTransliteration: string;
    titleEnglish: string;
    sequenceNumber: string;
    hasContent: boolean;
    contentSanskrit: string;
    contentTransliteration: string;
    contentEnglish: string;
    tags: string;
    wordMeanings: WordMeaningRow[];
  }) => {
    const normalized = {
      levelName: value.levelName.trim(),
      titleSanskrit: value.titleSanskrit.trim(),
      titleTransliteration: value.titleTransliteration.trim(),
      titleEnglish: value.titleEnglish.trim(),
      sequenceNumber: value.sequenceNumber.trim(),
      hasContent: Boolean(value.hasContent),
      contentSanskrit: value.contentSanskrit.trim(),
      contentTransliteration: value.contentTransliteration.trim(),
      contentEnglish: value.contentEnglish.trim(),
      tags: value.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .join(","),
      wordMeanings: mapWordMeaningRowsForPayload(value.wordMeanings),
    };

    if (!normalized.hasContent) {
      normalized.contentSanskrit = "";
      normalized.contentTransliteration = "";
      normalized.contentEnglish = "";
      normalized.wordMeanings = [];
    }

    return normalized;
  };

  function hasUnsavedInlineChanges() {
    if (!inlineEditMode || !nodeContent) {
      return false;
    }
    const baseline = normalizeInlineFormForCompare(buildFormDataFromNode(nodeContent));
    const current = normalizeInlineFormForCompare(inlineFormData);
    const baselineTranslationState = buildTranslationEditorStateFromNode(nodeContent);
    const baselineTranslations = normalizeTranslationDraftsForCompare(
      baselineTranslationState.drafts,
      baselineTranslationState.selectedLanguages
    );
    const baselineVariantState = buildVariantEditorStateFromNode(nodeContent);
    const baselineVariants = {
      translation: normalizeAuthorVariantDrafts(baselineVariantState.translationVariants, "translation"),
      commentary: normalizeAuthorVariantDrafts(baselineVariantState.commentaryVariants, "commentary"),
    };
    const currentTranslations = normalizeTranslationDraftsForCompare(
      inlineTranslationDrafts,
      inlineSelectedTranslationLanguages
    );
    const currentVariants = {
      translation: normalizeAuthorVariantDrafts(inlineTranslationVariants, "translation"),
      commentary: normalizeAuthorVariantDrafts(inlineCommentaryVariants, "commentary"),
    };
    return (
      JSON.stringify(baseline) !== JSON.stringify(current) ||
      JSON.stringify(baselineTranslations) !== JSON.stringify(currentTranslations) ||
      JSON.stringify(baselineVariants) !== JSON.stringify(currentVariants)
    );
  }

  const inlineHasChanges = hasUnsavedInlineChanges();

  const wordMeaningsEnabledLevels = getWordMeaningsEnabledLevelsFromBook(currentBook);
  const isWordMeaningsEnabledForLevel = (levelName: string | null | undefined) => {
    const normalizedLevel = (levelName || "").trim().toLowerCase();
    if (!normalizedLevel || wordMeaningsEnabledLevels.size === 0) {
      return false;
    }
    return wordMeaningsEnabledLevels.has(normalizedLevel);
  };

  const inlineWordMeaningsEnabled = isWordMeaningsEnabledForLevel(
    inlineFormData.levelName || nodeContent?.level_name
  );

  const inlineWordMeaningPayloadRows = inlineFormData.hasContent && inlineWordMeaningsEnabled
    ? mapWordMeaningRowsForPayload(inlineFormData.wordMeanings)
    : [];
  const inlineWordMeaningValidationErrors = inlineFormData.hasContent && inlineWordMeaningsEnabled
    ? validateWordMeaningPayloadRows(inlineWordMeaningPayloadRows)
    : [];

  const inlineWordMeaningsMissingRequired =
    inlineWordMeaningValidationErrors.some((error) =>
      error.includes(`meanings.${WORD_MEANINGS_REQUIRED_LANGUAGE}.text is required`)
    );

  const modalWordMeaningsEnabled = isWordMeaningsEnabledForLevel(
    formData.levelName || actionNode?.level_name
  );
  const modalWordMeaningPayloadRows = formData.hasContent && modalWordMeaningsEnabled
    ? mapWordMeaningRowsForPayload(formData.wordMeanings)
    : [];
  const modalWordMeaningValidationErrors = formData.hasContent && modalWordMeaningsEnabled
    ? validateWordMeaningPayloadRows(modalWordMeaningPayloadRows)
    : [];
  const modalWordMeaningsMissingRequired =
    modalWordMeaningValidationErrors.some((error) =>
      error.includes(`meanings.${WORD_MEANINGS_REQUIRED_LANGUAGE}.text is required`)
    );

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!inlineHasChanges) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [inlineHasChanges]);

  useEffect(() => {
    if (nodeContent) {
      setInlineFormData(buildFormDataFromNode(nodeContent));
      const translationState = buildTranslationEditorStateFromNode(nodeContent);
      setInlineTranslationDrafts(translationState.drafts);
      setInlineSelectedTranslationLanguages(translationState.selectedLanguages);
      const variantState = buildVariantEditorStateFromNode(nodeContent);
      setInlineTranslationVariants(variantState.translationVariants);
      setInlineCommentaryVariants(variantState.commentaryVariants);
    }
  }, [nodeContent]);

  const currentBookSchemaLevels = useMemo<string[]>(() => {
    if (!currentBook?.schema?.levels || !Array.isArray(currentBook.schema.levels)) {
      return [] as string[];
    }
    return currentBook.schema.levels.filter((level): level is string => typeof level === "string" && level.trim().length > 0);
  }, [currentBook?.schema?.levels]);

  const currentBookLevelNameOverrides = useMemo<Record<string, string>>(() => {
    const raw = currentBook?.level_name_overrides;
    if (!raw || typeof raw !== "object") {
      return {} as Record<string, string>;
    }
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof key !== "string" || typeof value !== "string") continue;
      const canonical = key.trim();
      const display = value.trim();
      if (canonical && display) {
        normalized[canonical] = display;
      }
    }
    return normalized;
  }, [currentBook?.level_name_overrides]);

  // Keep preview controls independent of preview artifact size.
  const availablePreviewLevels = useMemo<string[]>(() => {
    return currentBookSchemaLevels.filter((level, index, levels) => levels.indexOf(level) === index);
  }, [currentBookSchemaLevels]);

  const bookNodeLevelCounts = useMemo<Record<string, number>>(() => {
    if (selectedId !== BOOK_ROOT_NODE_ID || treeData.length === 0) return {};
    const levels = currentBook?.schema?.levels;
    if (!levels?.length) return {};
    const counts: Record<string, number> = {};
    const traverse = (nodes: TreeNode[], depth: number) => {
      const levelKey = levels[depth];
      if (!levelKey) return;
      for (const node of nodes) {
        counts[levelKey] = (counts[levelKey] || 0) + 1;
        if (node.children?.length) traverse(node.children, depth + 1);
      }
    };
    traverse(treeData, 0);
    return counts;
  }, [selectedId, treeData, currentBook?.schema?.levels]);

  useEffect(() => {
    if (!currentBook || currentBookSchemaLevels.length === 0) {
      setLevelNameOverridesDraft({});
      setLevelNameOverridesError(null);
      setLevelNameOverridesMessage(null);
      return;
    }
    const nextDraft: Record<string, string> = {};
    currentBookSchemaLevels.forEach((level: string) => {
      nextDraft[level] = getDisplayLevelName(level) || level;
    });
    setLevelNameOverridesDraft(nextDraft);
    setLevelNameOverridesError(null);
    setLevelNameOverridesMessage(null);
  }, [currentBook?.id, currentBookSchemaLevels, currentBookLevelNameOverrides]);

  const getDisplayLevelName = useCallback((levelName: string | null | undefined): string => {
    if (!levelName) return "";
    if (!currentBookLevelNameOverrides || Object.keys(currentBookLevelNameOverrides).length === 0) {
      return levelName;
    }

    const exact = currentBookLevelNameOverrides[levelName];
    if (exact && exact.trim() !== "") {
      return exact.trim();
    }

    const loweredLookup = levelName.trim().toLowerCase();
    if (!loweredLookup) {
      return levelName;
    }

    const caseInsensitiveKey = Object.keys(currentBookLevelNameOverrides).find(
      (canonical) => canonical.toLowerCase() === loweredLookup
    );
    if (!caseInsensitiveKey) {
      return levelName;
    }

    const mapped = currentBookLevelNameOverrides[caseInsensitiveKey];
    return mapped && mapped.trim() !== "" ? mapped.trim() : levelName;
  }, [currentBookLevelNameOverrides]);

  const normalizeLevelName = (value: string) => value.trim().toLowerCase();

  const nestFlatTreeNodes = (nodes: TreeNode[]): TreeNode[] => {
    // Check if data is already nested (has children arrays)
    const isAlreadyNested = nodes.length > 0 && nodes.some(node => 
      Array.isArray(node.children) && node.children.length > 0
    );

    if (isAlreadyNested) {
      return nodes;
    }

    // Handle flat data (with parent_node_id references)
    const nodeMap = new Map<number, TreeNode>();
    const roots: TreeNode[] = [];

    nodes.forEach((node) => {
      nodeMap.set(node.id, {
        ...node,
        children: [],
      });
    });

    nodes.forEach((node) => {
      const current = nodeMap.get(node.id);
      if (!current) {
        return;
      }

      const parentId = node.parent_node_id;
      if (typeof parentId === "number") {
        const parent = nodeMap.get(parentId);
        if (parent) {
          parent.children = [...(parent.children || []), current];
          return;
        }
      }

      roots.push(current);
    });

    return roots;
  };

  const isLeafLevelName = (levelName: string): boolean => {
    const schemaLevels = currentBook?.schema?.levels;
    if (!schemaLevels || schemaLevels.length === 0 || !levelName) {
      return false;
    }
    const lastLevel = schemaLevels[schemaLevels.length - 1];
    return normalizeLevelName(lastLevel) === normalizeLevelName(levelName);
  };

  const getLevelIndexFromName = (levelName: string, schemaLevels: string[]) => {
    if (!levelName) return -1;
    const normalized = normalizeLevelName(levelName);
    const exactMatch = schemaLevels.findIndex(
      (level) => normalizeLevelName(level) === normalized
    );
    if (exactMatch >= 0) {
      return exactMatch;
    }

    for (let i = 0; i < schemaLevels.length; i += 1) {
      const canonical = schemaLevels[i];
      const display = currentBookLevelNameOverrides[canonical];
      if (display && normalizeLevelName(display) === normalized) {
        return i;
      }
    }

    for (const [canonical, display] of Object.entries(currentBookLevelNameOverrides)) {
      const canonicalNormalized = normalizeLevelName(canonical);
      const displayNormalized = normalizeLevelName(display);
      if (normalized !== canonicalNormalized && normalized !== displayNormalized) {
        continue;
      }

      const mappedIndex = schemaLevels.findIndex((level) => {
        const levelNormalized = normalizeLevelName(level);
        return levelNormalized === canonicalNormalized || levelNormalized === displayNormalized;
      });
      if (mappedIndex >= 0) {
        return mappedIndex;
      }
    }

    return -1;
  };

  const getLevelIndexForNode = (
    node: Pick<TreeNode, "level_name" | "level_order">,
    schemaLevels: string[]
  ) => {
    if (
      typeof node.level_order === "number" &&
      node.level_order > 0 &&
      node.level_order <= schemaLevels.length
    ) {
      return node.level_order - 1;
    }

    return getLevelIndexFromName(node.level_name, schemaLevels);
  };

  const getNextLevelName = (parentNode: TreeNode): string => {
    if (!currentBook?.schema?.levels) {
      return ""; // No schema, can't determine
    }

    const schemaLevels = currentBook.schema.levels;

    // If parent is BOOK, return first level
    if (parentNode.level_name?.toUpperCase() === "BOOK") {
      return schemaLevels[0] || "";
    }

    // Prefer level_name to locate next level; fall back to level_order
    const levelIndex = getLevelIndexForNode(parentNode, schemaLevels);
    if (levelIndex >= 0 && levelIndex + 1 < schemaLevels.length) {
      return schemaLevels[levelIndex + 1];
    }

    const parentLevelOrder = parentNode.level_order || 0;
    const nextLevelIndex = parentLevelOrder; // level_order 1 = index 0

    if (nextLevelIndex < schemaLevels.length) {
      return schemaLevels[nextLevelIndex];
    }

    return ""; // Beyond defined levels
  };

  const getSchemaMatchedLevelName = (
    levelName: string,
    levelOrder?: number | null
  ): string => {
    const schemaLevels = currentBook?.schema?.levels;
    if (!schemaLevels || schemaLevels.length === 0) {
      return levelName;
    }

    const normalized = normalizeLevelName(levelName || "");
    if (normalized) {
      const exact = schemaLevels.find(
        (level) => normalizeLevelName(level) === normalized
      );
      if (exact) {
        return exact;
      }

      const overrideMatched = schemaLevels.find((level) => {
        const display = currentBookLevelNameOverrides[level];
        return display && normalizeLevelName(display) === normalized;
      });
      if (overrideMatched) {
        return overrideMatched;
      }

      const overrideEntry = Object.entries(currentBookLevelNameOverrides).find(
        ([canonical, display]) =>
          normalizeLevelName(canonical) === normalized ||
          normalizeLevelName(display) === normalized
      );
      if (overrideEntry) {
        const [canonical, display] = overrideEntry;
        const mapped = schemaLevels.find((level) => {
          const levelNormalized = normalizeLevelName(level);
          return (
            levelNormalized === normalizeLevelName(canonical) ||
            levelNormalized === normalizeLevelName(display)
          );
        });
        if (mapped) {
          return mapped;
        }
      }
    }

    if (
      typeof levelOrder === "number" &&
      levelOrder > 0 &&
      levelOrder <= schemaLevels.length
    ) {
      return schemaLevels[levelOrder - 1];
    }

    return levelName;
  };

  const canAddChild = (node: TreeNode): boolean => {
    if (!currentBook?.schema?.levels) {
      return false; // No schema, don't show add button
    }

    const schemaLevels = currentBook.schema.levels;

    // If it's a BOOK node, can add first level
    if (node.level_name?.toUpperCase() === "BOOK") {
      return schemaLevels.length > 0;
    }

    const levelIndex = getLevelIndexForNode(node, schemaLevels);
    if (levelIndex >= 0) {
      return levelIndex + 1 < schemaLevels.length;
    }

    // Fall back to level_order check
    const parentLevelOrder = node.level_order || 0;
    const nextLevelIndex = parentLevelOrder;

    return nextLevelIndex < schemaLevels.length;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getSiblings = (): TreeNode[] => {
    if (breadcrumb.length <= 1) {
      // Current node is root or no parent
      return treeData;
    }
    const parent = breadcrumb[breadcrumb.length - 2];
    const siblings = parent.children || [];
    // Sort by sequence_number for consistent ordering
    return [...siblings].sort((a, b) => {
      const seqA = getSequenceSortValue(a);
      const seqB = getSequenceSortValue(b);
      return seqA - seqB;
    });
  };

  // Get all nodes in the tree flattened in depth-first order
  const getAllNodesInOrder = (): TreeNode[] => {
    const nodes: TreeNode[] = [];
    const traverse = (node: TreeNode) => {
      nodes.push(node);
      if (node.children && node.children.length > 0) {
        // Sort children by sequence_number for consistent ordering
        const sorted = [...node.children].sort((a, b) => {
          const seqA = getSequenceSortValue(a);
          const seqB = getSequenceSortValue(b);
          return seqA - seqB;
        });
        sorted.forEach((child) => traverse(child));
      }
    };
    const sortedRoots = [...treeData].sort((a, b) => {
      const seqA = getSequenceSortValue(a);
      const seqB = getSequenceSortValue(b);
      return seqA - seqB;
    });
    sortedRoots.forEach((root) => traverse(root));
    return nodes;
  };

  const getPreviousSibling = (): TreeNode | null => {
    if (!selectedId) return null;
    const allNodes = getAllNodesInOrder();
    const currentIndex = allNodes.findIndex((n) => n.id === selectedId);
    if (currentIndex <= 0) return null;
    return allNodes[currentIndex - 1];
  };

  const getNextSibling = (): TreeNode | null => {
    if (!selectedId) return null;
    const allNodes = getAllNodesInOrder();
    const currentIndex = allNodes.findIndex((n) => n.id === selectedId);
    if (currentIndex < 0 || currentIndex >= allNodes.length - 1) return null;
    return allNodes[currentIndex + 1];
  };

  const getFirstNodeInOrder = (): TreeNode | null => {
    const allNodes = getAllNodesInOrder();
    return allNodes.length > 0 ? allNodes[0] : null;
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionNode || !action) return;

    setSubmitting(true);
    setActionMessage(null);
    try {
      const titlePair = autoFillSanskritTransliterationPair(
        formData.titleSanskrit,
        formData.titleTransliteration
      );
      const contentPair = autoFillSanskritTransliterationPair(
        formData.contentSanskrit,
        formData.contentTransliteration
      );

      const contentData: Record<string, unknown> = {};
      if (formData.hasContent) {
        const existingTranslations = toTranslationRecord(nodeContent?.content_data?.translations);
        const existingBasic =
          nodeContent?.content_data?.basic && typeof nodeContent.content_data.basic === "object"
            ? nodeContent.content_data.basic
            : undefined;

        const nextTranslations: Record<string, string> = {
          ...existingTranslations,
        };
        const selectedTranslationLanguages = normalizeSelectedEditableTranslationLanguages(
          modalSelectedTranslationLanguages,
          sourceLanguage
        );

        for (const language of selectedTranslationLanguages) {
          const translationCode = translationLanguageToCode(language);
          const value = (modalTranslationDrafts[language] || "").trim();
          if (value) {
            nextTranslations[translationCode] = value;
            if (translationCode === "en") {
              nextTranslations.english = value;
            }
          } else {
            delete nextTranslations[translationCode];
            if (translationCode === "en") {
              delete nextTranslations.english;
            }
          }
        }

        const englishFallback = pickTranslationTextForLanguageOnly(nextTranslations, "english");

        contentData.basic = {
          sanskrit: contentPair.sanskrit || undefined,
          transliteration: contentPair.transliteration || undefined,
          translation: englishFallback || undefined,
        };
        contentData.translations = Object.keys(nextTranslations).length > 0
          ? nextTranslations
          : undefined;
        const normalizedTranslationVariants = normalizeAuthorVariantDrafts(
          modalTranslationVariants,
          "translation"
        );
        const normalizedCommentaryVariants = normalizeAuthorVariantDrafts(
          modalCommentaryVariants,
          "commentary"
        );
        contentData.translation_variants =
          normalizedTranslationVariants.length > 0 ? normalizedTranslationVariants : undefined;
        contentData.commentary_variants =
          normalizedCommentaryVariants.length > 0 ? normalizedCommentaryVariants : undefined;

        const wordMeaningRows = modalWordMeaningPayloadRows;
        const validationErrors = validateWordMeaningPayloadRows(wordMeaningRows);
        if (validationErrors.length > 0) {
          setActionMessage(`Validation failed: ${validationErrors[0]}`);
          return;
        }

        if (modalWordMeaningsEnabled && wordMeaningRows.length > 0) {
          contentData.word_meanings = {
            version: WORD_MEANINGS_VERSION,
            rows: wordMeaningRows,
          };
        }
      }

      const isAddAction = action === "add";
      const resolvedParentNodeId = isAddAction
        ? createParentNodeIdOverride !== null
          ? createParentNodeIdOverride
          : actionNode.level_name === "BOOK"
            ? null
            : actionNode.id
        : null;

      const schemaLevels = currentBook?.schema?.levels || [];
      let resolvedLevelName = formData.levelName;
      if (schemaLevels.length > 0) {
        const matchedLevel = getSchemaMatchedLevelName(
          formData.levelName,
          actionNode?.level_order
        );

        if (matchedLevel && schemaLevels.includes(matchedLevel)) {
          resolvedLevelName = matchedLevel;
        } else if (isAddAction && createInsertAfterNodeId !== null) {
          resolvedLevelName = getSchemaMatchedLevelName(
            formData.levelName || getNextLevelName(actionNode),
            actionNode?.level_order
          );
        } else if (isAddAction && resolvedParentNodeId === null) {
          resolvedLevelName = schemaLevels[0];
        } else if (isAddAction) {
          const parentNode =
            resolvedParentNodeId !== null
              ? findNodeById(treeData, resolvedParentNodeId)
              : null;
          const nextLevel = parentNode ? getNextLevelName(parentNode) : "";
          resolvedLevelName = nextLevel || schemaLevels[0];
        } else {
          resolvedLevelName = getSchemaMatchedLevelName(
            formData.levelName || actionNode?.level_name || "",
            actionNode?.level_order
          );
        }
      }

      // Calculate level_order based on parent or sibling-insert context
      let levelOrder = 1;
      if (isAddAction && actionNode) {
        if (createInsertAfterNodeId !== null) {
          const insertAfterNode = findNodeById(treeData, createInsertAfterNodeId);
          levelOrder = insertAfterNode?.level_order || actionNode.level_order || 1;
        } else {
          // When adding a child node
          if (actionNode.level_name?.toUpperCase() === "BOOK") {
            // Adding to book root, this is level 1
            levelOrder = 1;
          } else if (typeof actionNode.level_order === "number") {
            // Use parent's level_order + 1
            levelOrder = actionNode.level_order + 1;
          } else {
            // Fallback based on level name
            if (actionNode.level_name?.toUpperCase() === "CHAPTER") {
              levelOrder = 2;
            } else {
              levelOrder = 3;
            }
          }
        }
      }

      const basePayload = {
        sequence_number: formData.sequenceNumber ? formData.sequenceNumber.trim() : null,
        title_sanskrit: titlePair.sanskrit || null,
        title_transliteration: titlePair.transliteration || null,
        title_english: formData.titleEnglish || null,
        has_content: formData.hasContent,
        content_data: Object.keys(contentData).length > 0 ? contentData : null,
        tags: formData.tags ? formData.tags.split(",").map((t) => t.trim()) : [],
      };

      const payload =
        isAddAction
          ? {
              ...basePayload,
              level_name: resolvedLevelName,
              book_id: parseInt(bookId, 10),
              parent_node_id: resolvedParentNodeId,
              level_order: levelOrder,
              insert_after_node_id: createInsertAfterNodeId,
            }
          : basePayload;

      const response = await fetch(
        action === "add" ? contentPath("/nodes") : contentPath(`/nodes/${actionNode.id}`),
        {
          method: action === "add" ? "POST" : "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (response.ok) {
        const savedNode = (await response.json().catch(() => null)) as { id?: number } | null;
        const savedNodeId = typeof savedNode?.id === "number" ? savedNode.id : null;
        const shouldCreateNext = action === "add" && createNextOnSubmit;
        const preservedNodeId =
          action === "edit" ? actionNode.id : savedNodeId ?? selectedId ?? actionNode.id;

        pendingSavedNodeId.current = preservedNodeId;

        if (preservedNodeId && typeof window !== "undefined" && bookId) {
          const url = new URL(window.location.href);
          url.searchParams.set("book", bookId);
          url.searchParams.set("node", String(preservedNodeId));
          window.history.replaceState(window.history.state, "", url.toString());
        }

        if (shouldCreateNext) {
          setCreateParentNodeIdOverride(resolvedParentNodeId);
          if (savedNodeId) {
            setCreateInsertAfterNodeId(savedNodeId);
          }
          setActionMessage("Created. Ready for next.");
          setFormData((prev) => ({
            ...prev,
            titleSanskrit: "",
            titleTransliteration: "",
            titleEnglish: "",
            sequenceNumber: "",
            contentSanskrit: "",
            contentTransliteration: "",
            contentEnglish: "",
            tags: "",
            wordMeanings: [],
          }));
          setModalTranslationDrafts(buildEditableTranslationDrafts({}));
          setModalSelectedTranslationLanguages(
            normalizeSelectedEditableTranslationLanguages([], sourceLanguage)
          );
          setModalTranslationVariants([]);
          setModalCommentaryVariants([]);
        } else {
          // Reset form and close modal
          setAction(null);
          setActionNode(null);
          setCreateParentNodeIdOverride(null);
          setCreateInsertAfterNodeId(null);
          setActionMessage(null);
          setFormData({
            levelName: "",
            titleSanskrit: "",
            titleTransliteration: "",
            titleEnglish: "",
            sequenceNumber: "",
            hasContent: false,
            contentSanskrit: "",
            contentTransliteration: "",
            contentEnglish: "",
            tags: "",
            wordMeanings: [],
          });
          setModalTranslationDrafts(buildEditableTranslationDrafts({}));
          setModalSelectedTranslationLanguages(
            normalizeSelectedEditableTranslationLanguages([], sourceLanguage)
          );
          setModalTranslationVariants([]);
          setModalCommentaryVariants([]);
        }
        // Refresh tree without losing context
        if (bookId) {
          try {
            const response = await fetch(`/api/books/${bookId}/tree`, {
              credentials: "include",
            });
            if (response.ok) {
              const flatData = (await response.json()) as TreeNode[];
              const data = nestFlatTreeNodes(flatData);
              setTreeData(data);
              // When adding a child, always expand the parent so the new node is visible
              console.log("[Tree Refresh] isAddAction:", isAddAction, "resolvedParentNodeId:", resolvedParentNodeId);
              setExpandedIds((prev) => {
                const next = new Set(prev);
                if (isAddAction && resolvedParentNodeId !== null) {
                  next.add(resolvedParentNodeId);
                }
                return next;
              });
              if (preservedNodeId) {
                const path = findPath(data, preservedNodeId);
                if (path) {
                  setSelectedId(preservedNodeId);
                  setBreadcrumb(path);
                  setExpandedIds((prev) => {
                    const next = new Set(prev);
                    path.forEach((node) => next.add(node.id));
                    return next;
                  });
                }
              }
            }
          } finally {
            setTreeLoading(false);
          }
        }
        if (preservedNodeId) {
          await loadNodeContent(preservedNodeId, true);
        }
      } else {
        const errorText = await response.text();
        const errData = errorText
          ? (() => {
              try {
                return JSON.parse(errorText);
              } catch {
                return errorText;
              }
            })()
          : null;
        const detail =
          typeof errData === "string"
            ? errData
            : errData?.detail || response.statusText;
        setActionMessage(`Save failed (${response.status}): ${detail}`);
        console.error("Error response:", errData || response.statusText);
      }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Save failed.");
      console.error("Error submitting form:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleInlineSave = async () => {
    if (!selectedId || !nodeContent) return;

    pendingSavedNodeId.current = selectedId;
    setInlineSubmitting(true);
    setInlineMessage(null);
    try {
      const titlePair = autoFillSanskritTransliterationPair(
        inlineFormData.titleSanskrit,
        inlineFormData.titleTransliteration
      );
      const contentPair = autoFillSanskritTransliterationPair(
        inlineFormData.contentSanskrit,
        inlineFormData.contentTransliteration
      );

      const contentData: Record<string, unknown> = {};
      if (inlineFormData.hasContent) {
        const existingTranslations = toTranslationRecord(nodeContent?.content_data?.translations);
        const existingBasic =
          nodeContent?.content_data?.basic && typeof nodeContent.content_data.basic === "object"
            ? nodeContent.content_data.basic
            : undefined;

        const nextTranslations: Record<string, string> = {
          ...existingTranslations,
        };
        const selectedTranslationLanguages = normalizeSelectedEditableTranslationLanguages(
          inlineSelectedTranslationLanguages,
          sourceLanguage
        );

        for (const language of selectedTranslationLanguages) {
          const translationCode = translationLanguageToCode(language);
          const value = (inlineTranslationDrafts[language] || "").trim();
          if (value) {
            nextTranslations[translationCode] = value;
            if (translationCode === "en") {
              nextTranslations.english = value;
            }
          } else {
            delete nextTranslations[translationCode];
            if (translationCode === "en") {
              delete nextTranslations.english;
            }
          }
        }

        const englishFallback = pickTranslationTextForLanguageOnly(nextTranslations, "english");

        contentData.basic = {
          sanskrit: contentPair.sanskrit || undefined,
          transliteration: contentPair.transliteration || undefined,
          translation: englishFallback || undefined,
        };
        contentData.translations = Object.keys(nextTranslations).length > 0
          ? nextTranslations
          : undefined;
        const normalizedTranslationVariants = normalizeAuthorVariantDrafts(
          inlineTranslationVariants,
          "translation"
        );
        const normalizedCommentaryVariants = normalizeAuthorVariantDrafts(
          inlineCommentaryVariants,
          "commentary"
        );
        contentData.translation_variants =
          normalizedTranslationVariants.length > 0 ? normalizedTranslationVariants : undefined;
        contentData.commentary_variants =
          normalizedCommentaryVariants.length > 0 ? normalizedCommentaryVariants : undefined;

        const wordMeaningRows = inlineWordMeaningPayloadRows;

        const validationErrors = validateWordMeaningPayloadRows(wordMeaningRows);
        if (validationErrors.length > 0) {
          setInlineMessage(`Validation failed: ${validationErrors[0]}`);
          return;
        }

        if (inlineWordMeaningsEnabled && wordMeaningRows.length > 0) {
          contentData.word_meanings = {
            version: WORD_MEANINGS_VERSION,
            rows: wordMeaningRows,
          };
        }
      }

      const payload = {
        sequence_number: inlineFormData.sequenceNumber
          ? inlineFormData.sequenceNumber.trim()
          : null,
        title_sanskrit: titlePair.sanskrit || null,
        title_transliteration: titlePair.transliteration || null,
        title_english: inlineFormData.titleEnglish || null,
        has_content: inlineFormData.hasContent,
        content_data: Object.keys(contentData).length > 0 ? contentData : null,
        tags: inlineFormData.tags
          ? inlineFormData.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
          : [],
      };

      const response = await fetch(contentPath(`/nodes/${selectedId}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errData = errorText
          ? (() => {
              try {
                return JSON.parse(errorText);
              } catch {
                return errorText;
              }
            })()
          : null;
        const detail =
          typeof errData === "string"
            ? errData
            : errData?.detail || response.statusText;
        setInlineMessage(`Save failed (${response.status}): ${detail}`);
        return;
      }

      if (bookId) {
        const treeResponse = await fetch(`/api/books/${bookId}/tree`, {
          credentials: "include",
        });
        if (treeResponse.ok) {
          const flatData = (await treeResponse.json()) as TreeNode[];
          const data = nestFlatTreeNodes(flatData);
          setTreeData(data);
          const path = findPath(data, selectedId);
          if (path) {
            setBreadcrumb(path);
            setExpandedIds((prev) => {
              const next = new Set(prev);
              path.forEach((node) => next.add(node.id));
              return next;
            });
          }
        }
      }

      await loadNodeContent(selectedId, true);
      setInlineMessage("Details saved.");
      setTimeout(() => setInlineMessage(null), 2000);
    } catch (err) {
      pendingSavedNodeId.current = null;
      setInlineMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setInlineSubmitting(false);
    }
  };

  const handleStartInlineEdit = () => {
    if (!nodeContent || !canEditCurrentBook) return;
    setInlineFormData(buildFormDataFromNode(nodeContent));
    const translationState = buildTranslationEditorStateFromNode(nodeContent);
    setInlineTranslationDrafts(translationState.drafts);
    setInlineSelectedTranslationLanguages(translationState.selectedLanguages);
    const variantState = buildVariantEditorStateFromNode(nodeContent);
    setInlineTranslationVariants(variantState.translationVariants);
    setInlineCommentaryVariants(variantState.commentaryVariants);
    setInlineMessage(null);
    setInlineEditMode(true);
  };

  const handleCancelInlineEdit = () => {
    if (nodeContent) {
      setInlineFormData(buildFormDataFromNode(nodeContent));
      const translationState = buildTranslationEditorStateFromNode(nodeContent);
      setInlineTranslationDrafts(translationState.drafts);
      setInlineSelectedTranslationLanguages(translationState.selectedLanguages);
      const variantState = buildVariantEditorStateFromNode(nodeContent);
      setInlineTranslationVariants(variantState.translationVariants);
      setInlineCommentaryVariants(variantState.commentaryVariants);
    }
    setInlineMessage(null);
    setInlineEditMode(false);
  };

  const handleStartBookInlineEdit = () => {
    if (!currentBook || !canEditCurrentBook) return;
    setBookInlineName(currentBook.book_name || "");
    setInlineMessage(null);
    setBookInlineEditMode(true);
    setShowBookRootActionsMenu(false);
  };

  const handleCancelBookInlineEdit = () => {
    setBookInlineName(currentBook?.book_name || "");
    setInlineMessage(null);
    setBookInlineEditMode(false);
  };

  const handleSaveBookInlineEdit = async () => {
    if (!bookId || !currentBook || !canEditCurrentBook) return;

    const nextName = bookInlineName.trim();
    if (!nextName) {
      setInlineMessage("Book name is required.");
      return;
    }

    if (nextName === (currentBook.book_name || "").trim()) {
      setInlineMessage("No changes to save.");
      return;
    }

    setBookInlineSubmitting(true);
    setInlineMessage(null);

    try {
      const response = await fetch(`/api/books/${bookId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_name: nextName }),
      });
      const payload = (await response.json().catch(() => null)) as BookDetails | { detail?: string } | null;
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to update book name");
      }

      const updatedBook = payload as BookDetails;
      setCurrentBook(updatedBook);
      setBooks((prev) =>
        prev.map((book) =>
          book.id === updatedBook.id
            ? {
                ...book,
                book_name: updatedBook.book_name,
                level_name_overrides: updatedBook.level_name_overrides,
                metadata_json: updatedBook.metadata_json,
                metadata: updatedBook.metadata,
              }
            : book
        )
      );
      setBookInlineEditMode(false);
      setInlineMessage("Book details saved.");
      setTimeout(() => setInlineMessage(null), 2000);
    } catch (err) {
      setInlineMessage(err instanceof Error ? err.message : "Failed to save book details.");
    } finally {
      setBookInlineSubmitting(false);
    }
  };

  const updateInlineWordMeaningRows = (rows: WordMeaningRow[]) => {
    setInlineFormData((prev) => ({
      ...prev,
      wordMeanings: rows.map((row, index) => ({
        ...row,
        order: index + 1,
      })),
    }));
  };

  const handleAddInlineWordMeaningRow = () => {
    setInlineFormData((prev) => ({
      ...prev,
      wordMeanings: [...prev.wordMeanings, createEmptyWordMeaningRow(prev.wordMeanings.length + 1)],
    }));
  };

  const handleImportInlineWordMeanings = (value: string): number => {
    const importedRows = mapSemicolonSeparatedWordMeaningsToRows(
      value,
      inlineFormData.wordMeanings.length + 1
    );
    if (importedRows.length === 0) {
      return 0;
    }

    updateInlineWordMeaningRows([...inlineFormData.wordMeanings, ...importedRows]);
    return importedRows.length;
  };

  const handleRemoveInlineWordMeaningRow = (rowId: string) => {
    const next = inlineFormData.wordMeanings.filter((row) => row.id !== rowId);
    updateInlineWordMeaningRows(next);
  };

  const handleMoveInlineWordMeaningRow = (rowId: string, direction: "up" | "down") => {
    const index = inlineFormData.wordMeanings.findIndex((row) => row.id === rowId);
    if (index < 0) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= inlineFormData.wordMeanings.length) return;

    const next = [...inlineFormData.wordMeanings];
    const [item] = next.splice(index, 1);
    next.splice(targetIndex, 0, item);
    updateInlineWordMeaningRows(next);
  };

  const handleInlineWordMeaningChange = (
    rowId: string,
    key: "sourceLanguage" | "sourceScriptText" | "sourceTransliterationIast",
    value: string
  ) => {
    setInlineFormData((prev) => ({
      ...prev,
      wordMeanings: prev.wordMeanings.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [key]: value,
            }
          : row
      ),
    }));
  };

  const handleSelectInlineMeaningLanguage = (rowId: string, language: string) => {
    setInlineFormData((prev) => ({
      ...prev,
      wordMeanings: prev.wordMeanings.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        return {
          ...row,
          activeMeaningLanguage: language,
          meanings: {
            ...row.meanings,
            [language]: row.meanings[language] || "",
          },
        };
      }),
    }));
  };

  const handleInlineMeaningTextChange = (rowId: string, language: string, value: string) => {
    setInlineFormData((prev) => ({
      ...prev,
      wordMeanings: prev.wordMeanings.map((row) =>
        row.id === rowId
          ? {
              ...row,
              meanings: {
                ...row.meanings,
                [language]: value,
              },
            }
          : row
      ),
    }));
  };

  const updateModalWordMeaningRows = (rows: WordMeaningRow[]) => {
    setFormData((prev) => ({
      ...prev,
      wordMeanings: rows.map((row, index) => ({
        ...row,
        order: index + 1,
      })),
    }));
  };

  const handleAddModalWordMeaningRow = () => {
    setFormData((prev) => ({
      ...prev,
      wordMeanings: [...prev.wordMeanings, createEmptyWordMeaningRow(prev.wordMeanings.length + 1)],
    }));
  };

  const handleImportModalWordMeanings = (value: string): number => {
    const importedRows = mapSemicolonSeparatedWordMeaningsToRows(
      value,
      formData.wordMeanings.length + 1
    );
    if (importedRows.length === 0) {
      return 0;
    }

    updateModalWordMeaningRows([...formData.wordMeanings, ...importedRows]);
    return importedRows.length;
  };

  const handleRemoveModalWordMeaningRow = (rowId: string) => {
    const next = formData.wordMeanings.filter((row) => row.id !== rowId);
    updateModalWordMeaningRows(next);
  };

  const handleMoveModalWordMeaningRow = (rowId: string, direction: "up" | "down") => {
    const index = formData.wordMeanings.findIndex((row) => row.id === rowId);
    if (index < 0) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= formData.wordMeanings.length) return;

    const next = [...formData.wordMeanings];
    const [item] = next.splice(index, 1);
    next.splice(targetIndex, 0, item);
    updateModalWordMeaningRows(next);
  };

  const handleModalWordMeaningChange = (
    rowId: string,
    key: "sourceLanguage" | "sourceScriptText" | "sourceTransliterationIast",
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      wordMeanings: prev.wordMeanings.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [key]: value,
            }
          : row
      ),
    }));
  };

  const handleSelectModalMeaningLanguage = (rowId: string, language: string) => {
    setFormData((prev) => ({
      ...prev,
      wordMeanings: prev.wordMeanings.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        return {
          ...row,
          activeMeaningLanguage: language,
          meanings: {
            ...row.meanings,
            [language]: row.meanings[language] || "",
          },
        };
      }),
    }));
  };

  const handleModalMeaningTextChange = (rowId: string, language: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      wordMeanings: prev.wordMeanings.map((row) =>
        row.id === rowId
          ? {
              ...row,
              meanings: {
                ...row.meanings,
                [language]: value,
              },
            }
          : row
      ),
    }));
  };

  const renderTree = (nodes: TreeNode[], depth = 0) => {
    // Sort nodes by sequence_number
    const sorted = [...nodes].sort((a, b) => {
      const seqA = parseSequenceNumber(a.sequence_number) ?? Infinity;
      const seqB = parseSequenceNumber(b.sequence_number) ?? Infinity;
      return seqA - seqB;
    });
    
    return sorted.map((node) => (
      <div key={node.id} className="mt-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {node.children && node.children.length > 0 && (
            <button
              type="button"
              onClick={() => toggleNode(node.id)}
              className="h-6 w-6 rounded-full border border-black/10 bg-white/80 text-xs text-zinc-500 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
              style={{ marginLeft: `${depth * 12}px` }}
            >
              {expandedIds.has(node.id) ? "-" : "+"}
            </button>
          )}
          <button
            type="button"
            onClick={() => selectNode(node.id, true, false)}
            title={`${formatValue(node.level_name) || "Level"} ${
              formatSequenceDisplay(
                node.sequence_number ?? node.id,
                !node.children || node.children.length === 0
              ) || node.id
            }`}
            id={`tree-node-${node.id}`}
            className={`flex items-center gap-2 px-1 text-sm font-medium transition ${
              selectedId === node.id
                ? "text-[color:var(--accent)]"
                : "text-[color:var(--deep)] hover:text-[color:var(--accent)]"
            }`}
          >
            <span>
              {(() => {
                const isLeaf = !node.children || node.children.length === 0;
                const displaySeq =
                  formatSequenceDisplay(node.sequence_number ?? node.id, isLeaf) ||
                  node.id.toString();
                const titleText =
                  formatValue(node.title_english) ||
                  formatValue(node.title_sanskrit) ||
                  formatValue(node.title_transliteration);
                if (isLeaf) {
                  return titleText
                    ? titleText
                    : `${formatValue(node.level_name) || "Level"} ${displaySeq}`;
                }
                if (titleText) {
                  return `${displaySeq}. ${titleText}`;
                }
                if (node.children && node.children.length > 0) {
                  return `${displaySeq}. ${formatValue(node.level_name) || "Untitled"}`;
                }
                return `${formatValue(node.level_name) || "Level"} ${displaySeq}`;
              })()}
            </span>
          </button>
          {(canContribute || canEditCurrentBook) && canAddChild(node) && (
            <button
              type="button"
              onClick={() => {
                const nextLevel = getNextLevelName(node);
                let insertAfterNodeId: number | null = null;

                if (selectedId) {
                  const selectedPath = findPath(treeData, selectedId);
                  const selectedNode = findNodeById(treeData, selectedId);
                  const selectedParentId =
                    selectedPath && selectedPath.length > 1
                      ? selectedPath[selectedPath.length - 2].id
                      : null;
                  const selectedLevelName = normalizeLevelName(
                    getSchemaMatchedLevelName(
                      selectedNode?.level_name || "",
                      selectedNode?.level_order
                    )
                  );
                  const nextLevelName = normalizeLevelName(
                    getSchemaMatchedLevelName(nextLevel)
                  );

                  if (selectedParentId === node.id && selectedLevelName === nextLevelName) {
                    insertAfterNodeId = selectedId;
                  }
                }

                setActionNode(node);
                setCreateParentNodeIdOverride(node.id);
                setCreateInsertAfterNodeId(insertAfterNodeId);
                setFormData({
                  levelName: nextLevel,
                  titleSanskrit: "",
                  titleTransliteration: "",
                  titleEnglish: "",
                  sequenceNumber: "",
                  hasContent: true,
                  contentSanskrit: "",
                  contentTransliteration: "",
                  contentEnglish: "",
                  tags: "",
                  wordMeanings: [],
                });
                setModalTranslationDrafts(buildEditableTranslationDrafts({}));
                setModalSelectedTranslationLanguages(
                  normalizeSelectedEditableTranslationLanguages([], sourceLanguage)
                );
                setModalTranslationVariants([]);
                setModalCommentaryVariants([]);
                setAction("add");
              }}
              title={`Add ${getDisplayLevelName(getNextLevelName(node))}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-green-500/30 bg-green-50 text-sm text-green-700 transition hover:border-green-500/60 hover:shadow-md"
            >
              +
            </button>
          )}
        </div>
        {node.children && node.children.length > 0 && expandedIds.has(node.id) && (
          <div className="ml-3 border-l border-black/10 pl-3">
            {renderTree(node.children, depth + 1)}
          </div>
        )}
      </div>
    ));
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSignOut = async () => {
    setBasketItems([]);
    invalidateMeCache();
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      router.push("/");
    } catch {
      router.push("/");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthMessage(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(async () => {
          const text = await response.text().catch(() => "");
          return text ? { detail: text } : null;
        })) as { detail?: string; message?: string } | null;
        const detail = payload?.detail || payload?.message || "Login failed";
        throw new Error(`Login failed (${response.status}): ${detail}`);
      }
      setAuthMessage("Logged in.");
      setEmail("");
      setPassword("");
      setShowLogin(false);
      invalidateMeCache();
      await loadAuth();
      // Re-initialize from URL after successful login
      setUrlInitialized(false);
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Login failed");
    }
  };

  const selectedTreeNode = selectedId ? findNodeById(treeData, selectedId) : null;
  const isBookRootSelected = selectedId === BOOK_ROOT_NODE_ID;
  const hasSelectedChildNode = selectedId !== null;
  const isLeafSelected = Boolean(
    selectedTreeNode && (!selectedTreeNode.children || selectedTreeNode.children.length === 0)
  );
  const canBrowseCurrentNode = authUserId !== null && canView;
  const canPreviewCurrentNode = Boolean(selectedId) && (Boolean(authEmail) || currentBook?.visibility === "public");
  const canCopyPreviewLink = Boolean(selectedId) && canPreviewCurrentNode;
  const canAddSelectedNodeToBasket = Boolean(selectedId && nodeContent) && isLeafSelected && Boolean(authEmail);
  const canCopyBrowseLink = Boolean(selectedId) && canBrowseCurrentNode;
  const canPreviewCurrentBook = Boolean(bookId) && (Boolean(authEmail) || currentBook?.visibility === "public");
  const canCopyBookBrowseLink = Boolean(bookId) && canBrowseCurrentNode;
  const canShowNodeActions =
    canPreviewCurrentNode ||
    canCopyPreviewLink ||
    canAddSelectedNodeToBasket ||
    canCopyBrowseLink ||
    canEditCurrentBook;
  const isCopyMessage = authMessage === "Link copied.";
  const selectedBookOption = useMemo(
    () => books.find((book) => book.id.toString() === bookId) || null,
    [books, bookId]
  );
  const canToggleCurrentBookVisibility = Boolean(
    selectedBookOption &&
      (canAdmin ||
        selectedBookOption.metadata_json?.owner_id === authUserId ||
        selectedBookOption.metadata?.owner_id === authUserId)
  );
  const canDeleteCurrentBook = Boolean(
    selectedBookOption &&
      (currentBook?.visibility || "private") === "private" &&
      (canAdmin ||
        selectedBookOption.metadata_json?.owner_id === authUserId ||
        selectedBookOption.metadata?.owner_id === authUserId)
  );
  const canShowBookRootActions =
    canEditCurrentBook ||
    canContribute ||
    canPreviewCurrentBook ||
    canCopyBookBrowseLink ||
    canImport ||
    canToggleCurrentBookVisibility ||
    canDeleteCurrentBook;
  const isBooksGridView = bookBrowserDensity > 0;
  const booksGridColumns =
    bookBrowserDensity === 1
      ? 8
      : bookBrowserDensity === 2
        ? 6
        : bookBrowserDensity === 3
          ? 4
          : bookBrowserDensity === 4
            ? 2
            : 1;
  const booksDensityLabel =
    bookBrowserDensity === 0
      ? "List"
      : bookBrowserDensity === 1
        ? "8 col"
        : bookBrowserDensity === 2
          ? "6 col"
          : bookBrowserDensity === 3
            ? "4 col"
            : bookBrowserDensity === 4
              ? "2 col"
              : "1 col";
  const mediaManagerGridColumns =
    mediaManagerDensity === 1
      ? 8
      : mediaManagerDensity === 2
        ? 6
        : mediaManagerDensity === 3
          ? 4
          : 2;
  const mediaManagerDensityLabel =
    mediaManagerDensity === 0
      ? "List"
      : mediaManagerDensity === 1
        ? "8 col"
        : mediaManagerDensity === 2
          ? "6 col"
          : mediaManagerDensity === 3
            ? "4 col"
            : "2 col";
  const filteredBooks = books;
  const hasMoreBooks = bookHasMore;
  const loadedBookCount = filteredBooks.length;
  const isInitialBooksLoad = bookLoadingMore && loadedBookCount === 0;

  // Derive unique variant authors from preview/node variants, resolved against the book registry.
  // Some imported variants only carry `author` (no `author_slug`), so infer a stable slug.
  const availableVariantAuthors = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    const registry = currentBook?.variant_authors ?? {};

    const normalizeAuthorSlug = (value: string): string =>
      value
        .trim()
        .toLowerCase()
        .replace(/["'`]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    const registerVariant = (variant: unknown) => {
      if (!variant || typeof variant !== "object") {
        return;
      }

      const v = variant as { author_slug?: unknown; author?: unknown };
      const rawAuthor = typeof v.author === "string" ? v.author.trim() : "";
      const explicitSlug = typeof v.author_slug === "string" ? v.author_slug.trim() : "";
      const baseSlug = explicitSlug || normalizeAuthorSlug(rawAuthor);
      if (!baseSlug) {
        return;
      }

      const resolvedName = (registry[baseSlug] || rawAuthor || baseSlug).trim();
      if (map.has(baseSlug)) {
        const existing = (map.get(baseSlug) || "").trim();
        if (!existing || existing === baseSlug) {
          map.set(baseSlug, resolvedName);
        }
        return;
      }
      map.set(baseSlug, resolvedName);
    };

    for (const block of bookPreviewArtifact?.sections?.body ?? []) {
      const tv = Array.isArray(block.content?.translation_variants) ? block.content.translation_variants : [];
      const cv = Array.isArray(block.content?.commentary_variants) ? block.content.commentary_variants : [];
      [...tv, ...cv].forEach(registerVariant);
    }

    const nodeVariantsSource = nodeContent?.content_data;
    if (nodeVariantsSource && typeof nodeVariantsSource === "object") {
      const tv = Array.isArray((nodeVariantsSource as { translation_variants?: unknown }).translation_variants)
        ? (nodeVariantsSource as { translation_variants: unknown[] }).translation_variants
        : [];
      const cv = Array.isArray((nodeVariantsSource as { commentary_variants?: unknown }).commentary_variants)
        ? (nodeVariantsSource as { commentary_variants: unknown[] }).commentary_variants
        : [];
      [...tv, ...cv].forEach(registerVariant);
    }
    return new Map(
      [...map.entries()].sort((left, right) =>
        left[1].localeCompare(right[1], undefined, { sensitivity: "base" })
      )
    );
  }, [bookPreviewArtifact, currentBook?.variant_authors, nodeContent?.content_data]);

  const previewBodyBlockElements = useMemo(() => {
    if (!bookPreviewArtifact) {
      return [] as ReactElement[];
    }

    const visibleBlocks = bookPreviewArtifact.sections.body.filter(
      (block) => !block.content.level_name || !appliedHiddenPreviewLevels.has(block.content.level_name)
    );

    const elements: ReactElement[] = [];
    visibleBlocks.forEach((block, blockIndex) => {
      const contentLines = resolvePreviewContentLines(block, bookPreviewArtifact.render_settings);
      // Deduplicate consecutive lines with the same value to avoid duplicate translations
      const deduplicatedLines = contentLines.filter((line, index) => {
        if (index === 0) return true;
        const prevLine = contentLines[index - 1];
        return line.value !== prevLine.value;
      });
      const nonTranslationLines = deduplicatedLines.filter((line) => line.fieldName !== "english");
      const translationLines = deduplicatedLines.filter((line) => line.fieldName === "english");
      const translationVariants = Array.isArray(block.content.translation_variants)
        ? block.content.translation_variants
            .map((entry) => ({
              author_slug: (entry?.author_slug || "").trim(),
              author: (entry?.author || "").trim(),
              language: ((entry?.language || "").trim().toLowerCase() || deriveVariantLanguageFromField(entry?.field)),
              text: (entry?.text || "").trim(),
            }))
            .filter((entry) => entry.text.length > 0)
        : [];
      const commentaryVariants = Array.isArray(block.content.commentary_variants)
        ? block.content.commentary_variants
            .map((entry) => ({
              author_slug: (entry?.author_slug || "").trim(),
              author: (entry?.author || "").trim(),
              language: ((entry?.language || "").trim().toLowerCase() || deriveVariantLanguageFromField(entry?.field)),
              text: (entry?.text || "").trim(),
            }))
            .filter((entry) => entry.text.length > 0)
        : [];
      const selectedTranslationLanguages = new Set(
        appliedPreviewTranslationLanguages.map((language) => normalizeTranslationLanguage(language))
      );
      const visibleTranslationVariants = appliedBookPreviewLanguageSettings.show_english
        ? translationVariants.filter((entry) => {
            const normalizedLanguage = normalizeTranslationLanguage(entry.language || "");
            if (!normalizedLanguage) {
              return true;
            }
            if (!selectedTranslationLanguages.has(normalizedLanguage)) return false;
            if (appliedPreviewVariantAuthorSlugs.length > 0 && entry.author_slug) {
              return appliedPreviewVariantAuthorSlugs.includes(entry.author_slug);
            }
            return true;
          })
        : [];
      const visibleCommentaryVariants = appliedBookPreviewLanguageSettings.show_commentary
        ? commentaryVariants.filter((entry) => {
            const normalizedLanguage = normalizeTranslationLanguage(entry.language || "");
            if (!normalizedLanguage) {
              return true;
            }
            if (!selectedTranslationLanguages.has(normalizedLanguage)) return false;
            if (appliedPreviewVariantAuthorSlugs.length > 0 && entry.author_slug) {
              return appliedPreviewVariantAuthorSlugs.includes(entry.author_slug);
            }
            return true;
          })
        : [];
      const wordMeaningRows = resolvePreviewWordMeanings(block);
      const wordMeaningInlineText = wordMeaningRows
        .map((row) => {
          const source = row.sourceText || "—";
          const meaning = row.meaningText || "—";
          const fallbackLabel =
            row.fallbackBadgeVisible && row.meaningLanguage ? ` (${row.meaningLanguage})` : "";
          return `${source} : ${meaning}${fallbackLabel}`;
        })
        .join("; ");
      const rawTitle = block.title || "";
      const hideNodeFallback = !appliedShowPreviewDetails && /^Node\s+\d+$/i.test(rawTitle.trim());
      const displayTitle = appliedShowPreviewTitles && !hideNodeFallback ? rawTitle : "";
      if (nonTranslationLines.length === 0 && translationLines.length === 0) {
        return;
      }

      elements.push(
        <article
          key={`${block.section}-${block.order}-${block.source_node_id ?? "none"}-${block.template_key}-${blockIndex}`}
          className="border-b border-black/10 px-1 py-4"
        >
          {appliedShowPreviewLevelNumbers && block.content.level_name && block.content.sequence_number != null && block.content.sequence_number !== "" && (
            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-zinc-400">
              {getDisplayLevelName(block.content.level_name)} {block.content.sequence_number}
            </div>
          )}
          {displayTitle && (
            <div className="text-sm font-semibold text-[color:var(--deep)]">{displayTitle}</div>
          )}
          <div className="mt-1">
            {nonTranslationLines.map((line, lineIndex) => (
              <div
                key={`${line.key}-${line.value.slice(0, 24)}`}
                className={
                  lineIndex === 0 || !line.isFieldStart
                    ? ""
                    : "mt-2 border-t border-black/10 pt-2"
                }
              >
                {line.label && (
                  <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{line.label}</div>
                )}
                <p className={line.className} style={previewBodyTextStyle}>{line.value}</p>
              </div>
            ))}
          </div>
          {wordMeaningRows.length > 0 && appliedPreviewWordMeaningsDisplayMode !== "hide" && (
            <div className="mt-2 border-t border-black/10 pt-2">
              {appliedPreviewWordMeaningsDisplayMode === "table" ? (
                <div className="overflow-x-auto rounded-lg border border-black/10 bg-white/80">
                  <table className="min-w-full border-collapse text-sm text-zinc-700">
                    <thead className="bg-zinc-50/70 text-xs uppercase tracking-[0.14em] text-zinc-500">
                      <tr>
                        <th className="border-b border-black/10 px-2 py-1.5 text-left font-medium">
                          Source
                        </th>
                        <th className="border-b border-black/10 px-2 py-1.5 text-left font-medium">
                          Meaning
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {wordMeaningRows.map((row) => (
                        <tr key={row.key} className="border-b border-black/5 last:border-b-0">
                          <td className="px-2 py-1.5 align-top text-zinc-800">
                            {row.sourceText || "—"}
                          </td>
                          <td className="px-2 py-1.5 align-top text-zinc-700">
                            {row.meaningText || "—"}
                            {row.fallbackBadgeVisible && row.meaningLanguage ? (
                              <span className="ml-1 text-xs uppercase tracking-[0.12em] text-zinc-500">
                                ({row.meaningLanguage})
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700" style={previewBodyTextStyle}>
                  {wordMeaningInlineText}
                </p>
              )}
            </div>
          )}
          {translationLines.length > 0 && (
            <div className="mt-2 border-t border-black/10 pt-2">
              {translationLines.map((line, lineIndex) => (
                <div
                  key={`${line.key}-translation-${line.value.slice(0, 24)}`}
                  className={
                    lineIndex === 0 || !line.isFieldStart
                      ? ""
                      : "mt-2 border-t border-black/10 pt-2"
                  }
                >
                  {line.label && (
                    <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{line.label}</div>
                  )}
                  <p className={line.className} style={previewBodyTextStyle}>{line.value}</p>
                </div>
              ))}
            </div>
          )}
          {visibleTranslationVariants.length > 0 && (
            <details className="mt-2 border-t border-black/10 pt-2">
              <summary className="cursor-pointer text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Translations By Authors ({visibleTranslationVariants.length})
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {visibleTranslationVariants.map((entry, idx) => (
                  <div key={`translation-variant-${idx}`} className="rounded-lg border border-black/10 bg-zinc-50/40 p-2">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                      {(entry.author_slug ? (currentBook?.variant_authors?.[entry.author_slug] || entry.author) : entry.author) || "Unknown Author"}
                      {entry.language ? ` • ${entry.language}` : ""}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700" style={previewBodyTextStyle}>{entry.text}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
          {visibleCommentaryVariants.length > 0 && (
            <details className="mt-2 border-t border-black/10 pt-2">
              <summary className="cursor-pointer text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Commentaries By Authors ({visibleCommentaryVariants.length})
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {visibleCommentaryVariants.map((entry, idx) => (
                  <div key={`commentary-variant-${idx}`} className="rounded-lg border border-black/10 bg-zinc-50/40 p-2">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                      {(entry.author_slug ? (currentBook?.variant_authors?.[entry.author_slug] || entry.author) : entry.author) || "Unknown Author"}
                      {entry.language ? ` • ${entry.language}` : ""}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700" style={previewBodyTextStyle}>{entry.text}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
          {appliedShowPreviewMedia && Array.isArray(block.content.media_items) && block.content.media_items.length > 0 && (
            <div className="mt-2 border-t border-black/10 pt-2">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Multimedia</div>
              <div className="flex flex-col gap-3">
                {block.content.media_items.map((media, mediaIndex) => {
                  const mediaType = (media?.media_type || "link").trim().toLowerCase();
                  const mediaUrl = (media?.url || "").trim();
                  if (!mediaUrl) {
                    return null;
                  }
                  const metadata =
                    media?.metadata && typeof media.metadata === "object"
                      ? media.metadata
                      : null;
                  const metadataLabel =
                    typeof metadata?.display_name === "string" && metadata.display_name.trim()
                      ? metadata.display_name.trim()
                      : typeof metadata?.original_filename === "string" && metadata.original_filename.trim()
                        ? metadata.original_filename.trim()
                        : `Media ${mediaIndex + 1}`;

                  return (
                    <div
                      key={`${mediaType}:${mediaUrl}:${media?.id || mediaIndex}`}
                      className="rounded-lg border border-black/10 bg-zinc-50/40 p-2.5"
                    >
                      {renderInlineMediaPreview(mediaType, mediaUrl, metadataLabel)}
                      <div className="mt-2 text-xs text-zinc-500">{metadataLabel}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {appliedShowPreviewDetails && bookPreviewArtifact.render_settings.show_metadata && (
            <div className="mt-2 text-xs text-zinc-500">
              template: {block.template_key}
              {typeof block.source_node_id === "number" ? ` • source node ${block.source_node_id}` : ""}
              {typeof block.content.sequence_number === "number"
                ? ` • seq ${block.content.sequence_number}`
                : ""}
            </div>
          )}
        </article>
      );
    });

    return elements;
  }, [
    bookPreviewArtifact,
    appliedHiddenPreviewLevels,
    appliedPreviewVariantAuthorSlugs,
    appliedShowPreviewDetails,
    appliedShowPreviewTitles,
    appliedShowPreviewLevelNumbers,
    appliedPreviewWordMeaningsDisplayMode,
    appliedShowPreviewMedia,
    currentBook,
    previewBodyTextStyle,
    resolvePreviewContentLines,
    resolvePreviewWordMeanings,
    getDisplayLevelName,
    renderInlineMediaPreview,
  ]);

  const anyPreviewLanguageVisible =
    bookPreviewLanguageSettings.show_sanskrit ||
    bookPreviewLanguageSettings.show_transliteration ||
    bookPreviewLanguageSettings.show_english ||
    bookPreviewLanguageSettings.show_commentary;

  const previewVariantAuthorSlugsKey = useMemo(
    () => [...previewVariantAuthorSlugs].sort().join("|"),
    [previewVariantAuthorSlugs]
  );
  const appliedPreviewVariantAuthorSlugsKey = useMemo(
    () => [...appliedPreviewVariantAuthorSlugs].sort().join("|"),
    [appliedPreviewVariantAuthorSlugs]
  );

  const hasPendingPreviewSettingChanges = useMemo(
    () =>
      bookPreviewLanguageSettings.show_sanskrit !== appliedBookPreviewLanguageSettings.show_sanskrit ||
      bookPreviewLanguageSettings.show_transliteration !==
        appliedBookPreviewLanguageSettings.show_transliteration ||
      bookPreviewLanguageSettings.show_english !== appliedBookPreviewLanguageSettings.show_english ||
      bookPreviewLanguageSettings.show_commentary !==
        appliedBookPreviewLanguageSettings.show_commentary ||
      !areEditableLanguageSelectionsEqual(
        previewTranslationLanguages,
        appliedPreviewTranslationLanguages
      ) ||
      showPreviewLabels !== appliedShowPreviewLabels ||
      showPreviewLevelNumbers !== appliedShowPreviewLevelNumbers ||
      showPreviewDetails !== appliedShowPreviewDetails ||
      showPreviewTitles !== appliedShowPreviewTitles ||
      showPreviewMedia !== appliedShowPreviewMedia ||
      previewFontSizePercent !== appliedPreviewFontSizePercent ||
      !areStringSetsEqual(hiddenPreviewLevels, appliedHiddenPreviewLevels) ||
      previewWordMeaningsDisplayMode !== appliedPreviewWordMeaningsDisplayMode ||
      previewTransliterationScript !== appliedBookPreviewTransliterationScript ||
      previewVariantAuthorSlugsKey !== appliedPreviewVariantAuthorSlugsKey,
    [
      bookPreviewLanguageSettings,
      appliedBookPreviewLanguageSettings,
      previewTranslationLanguages,
      appliedPreviewTranslationLanguages,
      showPreviewLabels,
      appliedShowPreviewLabels,
      showPreviewLevelNumbers,
      appliedShowPreviewLevelNumbers,
      showPreviewDetails,
      appliedShowPreviewDetails,
      showPreviewTitles,
      appliedShowPreviewTitles,
      showPreviewMedia,
      appliedShowPreviewMedia,
      previewFontSizePercent,
      appliedPreviewFontSizePercent,
      hiddenPreviewLevels,
      appliedHiddenPreviewLevels,
      previewWordMeaningsDisplayMode,
      appliedPreviewWordMeaningsDisplayMode,
      previewTransliterationScript,
      appliedBookPreviewTransliterationScript,
      previewVariantAuthorSlugsKey,
      appliedPreviewVariantAuthorSlugsKey,
    ]
  );

  const maybeLoadMoreBooks = useCallback(
    (container: HTMLDivElement | null) => {
      if (!container || !bookHasMoreRef.current || bookLoadingRef.current) {
        return;
      }

      const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
      const threshold = Math.max(240, container.clientHeight * 0.35);
      if (distanceToBottom <= threshold) {
        void loadBooksPage();
      }
    },
    [loadBooksPage]
  );

  const handleBooksScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      maybeLoadMoreBooks(event.currentTarget);
    },
    [maybeLoadMoreBooks]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      const container = booksScrollContainerRef.current;
      if (!container || !bookHasMoreRef.current || bookLoadingRef.current) {
        return;
      }

      const isScrollable = container.scrollHeight > container.clientHeight + 1;
      if (!isScrollable) {
        void loadBooksPage();
      }
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [filteredBooks.length, bookBrowserDensity, loadBooksPage]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const root = booksScrollContainerRef.current;
    const target = booksLoadMoreSentinelRef.current;
    if (!root || !target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) {
          return;
        }
        if (!bookHasMoreRef.current || bookLoadingRef.current) {
          return;
        }
        void loadBooksPage();
      },
      {
        root,
        rootMargin: "280px 0px",
        threshold: 0.01,
      }
    );

    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [filteredBooks.length, loadBooksPage]);

  const handleSelectBook = (value: string, options?: { syncUrl?: boolean }): boolean => {
    const syncUrl = options?.syncUrl ?? true;
    if (value !== bookId && hasUnsavedInlineChanges()) {
      const shouldDiscard = window.confirm(
        "You have unsaved changes in Edit details. Discard changes and switch books?"
      );
      if (!shouldDiscard) {
        return false;
      }
    }

    if (value && value === bookId) {
      setShowExploreStructure(false);
      setMobilePanel("content");
      if (selectedId === null && treeData.length > 0) {
        const firstLeafId = findFirstLeafId(treeData);
        if (firstLeafId) {
          selectNode(firstLeafId, true);
        }
      }
      return true;
    }

    setBookId(value);
    if (syncUrl) {
      if (value) {
        router.push(`/scriptures?book=${value}`, { scroll: false });
      } else {
        router.push("/scriptures", { scroll: false });
      }
    }
    setSelectedId(null);
    setBreadcrumb([]);
    setNodeContent(null);
    setShowExploreStructure(false);
    setMobilePanel("content");
    return true;
  };

  const openCreateFirstLevelNode = () => {
    if (!bookId || !currentBook?.schema || !canContribute) {
      return;
    }
    const firstLevel = currentBook.schema?.levels[0] || "";
    const virtualBook: TreeNode = {
      id: parseInt(bookId, 10),
      level_name: "BOOK",
      level_order: 0,
      sequence_number: undefined,
      title_english: selectedBookOption?.book_name,
    };
    setActionNode(virtualBook);
    setCreateParentNodeIdOverride(null);
    setCreateInsertAfterNodeId(null);
    setFormData({
      levelName: firstLevel,
      titleSanskrit: "",
      titleTransliteration: "",
      titleEnglish: "",
      sequenceNumber: "",
      hasContent: true,
      contentSanskrit: "",
      contentTransliteration: "",
      contentEnglish: "",
      tags: "",
      wordMeanings: [],
    });
    setModalTranslationDrafts(buildEditableTranslationDrafts({}));
    setModalSelectedTranslationLanguages(
      normalizeSelectedEditableTranslationLanguages([], sourceLanguage)
    );
    setModalTranslationVariants([]);
    setModalCommentaryVariants([]);
    setAction("add");
  };

  const handlePreviewBookFromRow = async (book: BookOption) => {
    const nextBookId = book.id.toString();
    const didSelect = handleSelectBook(nextBookId, { syncUrl: false });
    if (!didSelect) return;
    await handlePreviewBook("book", nextBookId, "push");
  };

  const handleBrowseBookFromRow = (book: BookOption) => {
    const nextBookId = book.id.toString();
    const didSelect = handleSelectBook(nextBookId, { syncUrl: false });
    if (!didSelect) return;
    syncBrowseUrl(nextBookId, undefined, "push");
    setShowExploreStructure(true);
    setMobilePanel("tree");
    setShowBrowseBookModal(true);
  };

  const handleToggleBookVisibility = async (book: BookOption) => {
    const isPublic = (book.visibility ?? "private") === "public";
    const payload = isPublic
      ? { status: "draft", visibility: "private" }
      : { status: "published", visibility: "public" };
    setBookVisibilitySubmitting(book.id);
    try {
      const response = await fetch(`/api/books/${book.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as BookDetails | { detail?: string } | null;
      if (!response.ok) {
        alert((result as { detail?: string } | null)?.detail ?? "Failed to update visibility");
        return;
      }
      const updated = result as BookDetails;
      setBooks((prev) =>
        prev.map((b) =>
          b.id === updated.id
            ? { ...b, status: updated.status, visibility: updated.visibility }
            : b
        )
      );
      if (currentBook && currentBook.id === updated.id) {
        setCurrentBook(updated);
      }
    } catch {
      alert("Failed to update visibility");
    } finally {
      setBookVisibilitySubmitting(null);
    }
  };

  const handleDeleteBook = async (book: BookOption) => {
    const normalizedVisibility =
      book.visibility ?? book.metadata_json?.visibility ?? book.metadata?.visibility ?? "private";
    const isBookOwner =
      authUserId !== null &&
      (book.metadata_json?.owner_id === authUserId || book.metadata?.owner_id === authUserId);
    const canDeleteBook = normalizedVisibility === "private" && (canAdmin || isBookOwner);

    if (!canDeleteBook) {
      return;
    }

    const shouldDelete = window.confirm(
      `Delete private book \"${book.book_name}\"? This cannot be undone.`
    );
    if (!shouldDelete) {
      return;
    }

    try {
      const response = await fetch(`/api/books/${book.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const result = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        alert(result?.detail ?? "Failed to delete book");
        return;
      }

      setOpenBookRowActionsId(null);
      setInlineMessage(`Deleted book: ${book.book_name}`);
      setTimeout(() => setInlineMessage(null), 2500);

      const deletedId = String(book.id);
      if (bookId === deletedId) {
        setBookId("");
        setSelectedId(null);
        setBreadcrumb([]);
        setNodeContent(null);
        setCurrentBook(null);
        setTreeData([]);
        router.push("/scriptures", { scroll: false });
      }

      await loadBooksRefresh();
    } catch {
      alert("Failed to delete book");
    }
  };

  const mediaManagerItemsLayoutClass = mediaManagerView === "icon" ? "grid gap-2 p-2" : "divide-y divide-black/5";
  const mediaManagerItemsLayoutStyle =
    mediaManagerView === "icon"
      ? {
          gridTemplateColumns: `repeat(${mediaManagerGridColumns}, minmax(0, 1fr))`,
        }
      : undefined;
  const bookMediaItems = sortBookMediaItems(getBookMediaItems(currentBook));
  const filteredBookMediaItems = bookMediaItems.filter((media) => {
    const mediaType = (media.media_type || "").trim();
    const matchesType = mediaManagerTypeFilter === "all" || mediaType === mediaManagerTypeFilter;
    return matchesType && bookMediaMatchesSearch(media, mediaManagerSearchQuery);
  });

  const renderMediaManagerSearchInput = (placeholder: string, ariaLabel: string) => (
    <div className="group relative min-w-0 w-full sm:min-w-[220px] sm:flex-1">
      <input
        type="text"
        value={mediaManagerSearchQuery}
        onChange={(event) => setMediaManagerSearchQuery(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
      />
      <InlineClearButton
        visible={Boolean(mediaManagerSearchQuery)}
        onClear={() => setMediaManagerSearchQuery("")}
        ariaLabel={ariaLabel}
      />
    </div>
  );

  const renderMediaManagerDensityControl = () => (
    <div ref={mediaManagerDensityMenuRef} className="relative">
      <button
        type="button"
        onClick={() => setShowMediaManagerDensityMenu((prev) => !prev)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-black/10 bg-white px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-700 transition hover:bg-zinc-50"
        aria-label="Open media density"
        title="Media density"
      >
        <SlidersHorizontal size={12} />
        {mediaManagerDensityLabel}
      </button>
      {showMediaManagerDensityMenu && (
        <div className="absolute right-0 z-50 mt-2 w-[calc(100vw-2rem)] max-w-64 rounded-xl border border-black/10 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-zinc-500">
            <span>Media density</span>
            <span className="font-semibold text-zinc-700">{mediaManagerDensityLabel}</span>
          </div>
          <input
            type="range"
            min={0}
            max={4}
            step={1}
            value={mediaManagerDensity}
            onChange={(event) => {
              setMediaManagerDensity(normalizeBookBrowserDensity(event.target.value));
            }}
            className="w-full"
            aria-label="Media manager density"
          />
          <div className="mt-2 grid grid-cols-5 text-center text-[10px] text-zinc-500">
            <span>List</span>
            <span>8 col</span>
            <span>6 col</span>
            <span>4 col</span>
            <span>2 col</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="grainy-bg flex min-h-0 flex-col">
      <main className="mx-auto flex h-[calc(100svh-7.5rem)] min-h-0 w-full max-w-none flex-col gap-2 overflow-hidden px-3 pb-2 pt-2 sm:gap-3 sm:px-4 sm:pb-3 sm:pt-3">
        {searchReturnUrl && (
          <div className="flex items-center gap-2">
            <a
              href={searchReturnUrl}
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--accent)] bg-white px-3 py-1.5 text-xs font-medium text-[color:var(--accent)] transition hover:bg-[color:var(--accent)] hover:text-white"
            >
              ← Back to Search Results
            </a>
          </div>
        )}
        <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-black/10 bg-white px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-zinc-900">Books</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="group relative">
                <input
                  type="text"
                  value={bookQuery}
                  onChange={(event) => setBookQuery(event.target.value)}
                  placeholder="Search by book name"
                  className="rounded-lg border border-black/10 px-3 py-1.5 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                />
                <InlineClearButton
                  visible={Boolean(bookQuery)}
                  onClear={() => setBookQuery("")}
                  ariaLabel="Clear book search"
                />
              </div>
              <div ref={bookBrowserDensityMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowBookBrowserDensityMenu((prev) => !prev)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-700 transition hover:bg-zinc-50"
                  aria-label="Open view density"
                  title="View density"
                >
                  <SlidersHorizontal size={12} />
                  {booksDensityLabel}
                </button>
                {showBookBrowserDensityMenu && (
                  <div className="absolute right-0 z-50 mt-2 w-[calc(100vw-2rem)] max-w-64 rounded-xl border border-black/10 bg-white p-3 shadow-xl">
                    <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                      <span>View density</span>
                      <span className="font-semibold text-zinc-700">{booksDensityLabel}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={5}
                      step={1}
                      value={bookBrowserDensity}
                      onChange={(event) => {
                        setBookBrowserDensity(normalizeBookBrowserDensity(event.target.value));
                      }}
                      className="w-full"
                      aria-label="Books view density"
                    />
                    <div className="mt-2 grid grid-cols-6 text-center text-[10px] text-zinc-500">
                      <span>List</span>
                      <span>8 col</span>
                      <span>6 col</span>
                      <span>4 col</span>
                      <span>2 col</span>
                      <span>1 col</span>
                    </div>
                  </div>
                )}
              </div>
              {canImport && (
                <>
                  <input
                    ref={importBookInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => {
                      void handleImportBookFile(event);
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      importBookInputRef.current?.click();
                    }}
                    disabled={importSubmitting}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Import JSON"
                    title="Import JSON"
                  >
                    <Upload size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowImportUrlInput((prev) => !prev)}
                    disabled={importSubmitting}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Import from URL"
                    title="Import from URL"
                  >
                    <Link2 size={14} />
                  </button>
                </>
              )}
              {canContribute && (
                <button
                  type="button"
                  onClick={() => {
                    loadSchemas();
                    setSelectedSchema(null);
                    setCreateBookStep("schema");
                    setShowCreateBook(true);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white text-zinc-700 transition hover:bg-zinc-50"
                  aria-label="Create book"
                  title="Create book"
                >
                  <Plus size={14} />
                </button>
              )}
            </div>
            {isCopyMessage && copyTarget === "book" && !showLogin && (
              <div className="rounded-full bg-blue-500 px-3 py-1 text-[10px] text-white shadow">
                {authMessage}
              </div>
            )}
          </div>
          {canImport && showImportUrlInput && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-black/10 bg-zinc-50 p-2">
              <input
                type="url"
                value={importUrl}
                onChange={(event) => setImportUrl(event.target.value)}
                placeholder="Paste public raw JSON URL"
                className="min-w-[16rem] flex-1 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700"
              />
              <button
                type="button"
                onClick={() => {
                  void handleImportBookUrl();
                }}
                disabled={importSubmitting || !importUrl.trim()}
                className="inline-flex h-9 items-center rounded-lg border border-black/10 bg-zinc-900 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importSubmitting ? "Importing..." : "Import URL"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowImportUrlInput(false);
                  setImportUrl("");
                }}
                disabled={importSubmitting}
                className="inline-flex h-9 items-center rounded-lg border border-black/10 bg-white px-3 text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              {(importSubmitting || importProgressMessage) && (
                <div className="basis-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{importProgressMessage || "Importing..."}</span>
                    {typeof importProgressCurrent === "number" && typeof importProgressTotal === "number" && importProgressTotal > 0 && (
                      <span className="text-xs text-blue-800">
                        {importProgressCurrent} / {importProgressTotal}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
                    {typeof importProgressCurrent === "number" && typeof importProgressTotal === "number" && importProgressTotal > 0 ? (
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all"
                        style={{
                          width: `${Math.max(0, Math.min(100, (importProgressCurrent / importProgressTotal) * 100))}%`,
                        }}
                      />
                    ) : (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400" />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {canImport && !showImportUrlInput && (importSubmitting || importProgressMessage) && (
            <div className="mt-2 rounded-xl border border-black/10 bg-zinc-50 p-2">
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{importProgressMessage || "Importing..."}</span>
                  {typeof importProgressCurrent === "number" && typeof importProgressTotal === "number" && importProgressTotal > 0 && (
                    <span className="text-xs text-blue-800">
                      {importProgressCurrent} / {importProgressTotal}
                    </span>
                  )}
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
                  {typeof importProgressCurrent === "number" && typeof importProgressTotal === "number" && importProgressTotal > 0 ? (
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all"
                      style={{
                        width: `${Math.max(0, Math.min(100, (importProgressCurrent / importProgressTotal) * 100))}%`,
                      }}
                    />
                  ) : (
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400" />
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-2 flex min-h-0 flex-1 flex-col rounded-xl border border-black/10 bg-white">
            <div
              ref={booksScrollContainerRef}
              className="books-scroll-pane min-h-0 flex-1 overflow-y-scroll overflow-x-hidden overscroll-contain"
              onScroll={handleBooksScroll}
            >
              {isInitialBooksLoad ? (
                <div className="flex items-center justify-center py-8 text-sm text-zinc-500">Loading books…</div>
              ) : filteredBooks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <p className="text-sm text-zinc-600">No books found.</p>
                  {bookQuery.trim().length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBookQuery("")}
                      className="rounded-lg border border-black/10 px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-50"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                <div
                  className={isBooksGridView ? "grid gap-2 p-2" : "divide-y divide-black/5"}
                  style={
                    isBooksGridView
                      ? {
                          gridTemplateColumns: `repeat(${booksGridColumns}, minmax(0, 1fr))`,
                        }
                      : undefined
                  }
                >
                  {filteredBooks.map((book, bookIndex) => {
                    const isSelected = bookId === book.id.toString();
                    const thumbnailUrl = getBookThumbnailUrl(book);
                    const bookVisibility =
                      book.visibility ??
                      book.metadata_json?.visibility ??
                      book.metadata?.visibility ??
                      "private";
                    const canPreviewBook = Boolean(authEmail) || bookVisibility === "public";
                    const canBrowseBook = authUserId !== null && canView;
                    const canCopyPreviewBookLink = canPreviewBook && !canBrowseBook;
                    const canCopyBrowseBookLink = false;
                    const isBookOwner =
                      authUserId !== null &&
                      (book.metadata_json?.owner_id === authUserId ||
                        book.metadata?.owner_id === authUserId);
                    const canToggleVisibility = canAdmin || isBookOwner;
                    const canDeletePrivateBook = bookVisibility === "private" && (canAdmin || isBookOwner);
                    const showRowMenu = canToggleVisibility || canDeletePrivateBook || canImport;
                    const showSingleBrowseAction = canBrowseBook && !showRowMenu;
                    const gridColumnIndex = isBooksGridView ? bookIndex % booksGridColumns : 0;
                    const rowMenuPositionClass =
                      isBooksGridView && booksGridColumns > 1
                        ? gridColumnIndex === 0
                          ? "left-0"
                          : gridColumnIndex === booksGridColumns - 1
                            ? "right-0"
                            : "left-1/2 -translate-x-1/2"
                        : "right-0";
                    // Anonymous users clicking a private book should still be clickable — loadTree will gate
                    const isAnonymousPrivate = !authEmail && bookVisibility === "private";
                    // For anonymous users on a private book, show the sign-in gate overlay directly
                    // (the browse modal requires isExploreVisible which needs authUserId != null)
                    const handleBookClick = isAnonymousPrivate
                      ? () => { setPrivateBookGate(true); }
                      : () => void handlePreviewBookFromRow(book);
                    return (
                      <div
                        key={book.id}
                        className={`flex items-center gap-2 text-sm transition ${
                          isBooksGridView
                            ? `relative aspect-square rounded-xl border border-black/10 ${
                                isSelected
                                  ? "bg-[color:var(--sand)]/45 text-[color:var(--accent)]"
                                  : "bg-white text-zinc-700 hover:border-black/20"
                              }`
                            : isSelected
                              ? "px-3 py-2 bg-[color:var(--sand)]/50 text-[color:var(--accent)]"
                              : "px-3 py-2 text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {isBooksGridView ? (
                          <>
                            <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
                              {(canPreviewBook || isAnonymousPrivate) ? (
                                <button
                                  type="button"
                                  onClick={handleBookClick}
                                  className="group absolute inset-0 block w-full bg-zinc-100 text-left"
                                >
                                  {thumbnailUrl ? (
                                    <img
                                      src={thumbnailUrl}
                                      alt={`${book.book_name} thumbnail`}
                                      className="h-full w-full object-contain p-2 transition group-hover:scale-[1.01]"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-zinc-100 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                                      No thumbnail
                                    </div>
                                  )}
                                </button>
                              ) : thumbnailUrl ? (
                                <img
                                  src={thumbnailUrl}
                                  alt={`${book.book_name} thumbnail`}
                                  className="absolute inset-0 h-full w-full object-contain p-2"
                                />
                              ) : (
                                <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-zinc-100 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                                  No thumbnail
                                </div>
                              )}

                              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/55 to-transparent px-3 pb-3 pt-8 text-white">
                                <div className="flex items-end justify-between gap-2">
                                  <div className="line-clamp-2 text-sm font-semibold">{book.book_name}</div>
                                  <span className="rounded-full border border-white/35 bg-black/25 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/90">
                                    {bookVisibility === "private" ? "Private" : "Public"}
                                  </span>
                              </div>
                            </div>

                            </div>
                            <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                              {showSingleBrowseAction && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleBrowseBookFromRow(book);
                                  }}
                                  title="Browse book"
                                  aria-label="Browse book"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-black/15 bg-white/90 text-zinc-700 backdrop-blur transition hover:border-black/25 hover:bg-white"
                                >
                                  <BookOpen size={14} />
                                </button>
                              )}
                              {showRowMenu && (
                                <div
                                  ref={(element) => {
                                    if (openBookRowActionsId === book.id) {
                                      bookRowActionsMenuRef.current = element;
                                    }
                                  }}
                                  className="relative"
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenBookRowActionsId((prev) => (prev === book.id ? null : book.id));
                                    }}
                                    title="Row actions"
                                    aria-label="Row actions"
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-black/15 bg-white/90 text-zinc-700 backdrop-blur transition hover:border-black/25 hover:bg-white"
                                  >
                                    ⋮
                                  </button>
                                  {openBookRowActionsId === book.id && (
                                    <div className={`absolute z-40 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-black/10 bg-white p-1 shadow-xl ${rowMenuPositionClass}`}>
                                      {canCopyPreviewBookLink && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const url = `${window.location.origin}${buildScripturesPreviewPath("book", book.id.toString())}`;
                                            navigator.clipboard.writeText(url);
                                            setOpenBookRowActionsId(null);
                                            setAuthMessage("Link copied.");
                                            setCopyTarget("book");
                                            setTimeout(() => {
                                              setAuthMessage(null);
                                              setCopyTarget(null);
                                            }, 2000);
                                          }}
                                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                        >
                                          <Link2 size={14} />
                                          Copy preview link
                                        </button>
                                      )}
                                      {canCopyBrowseBookLink && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const url = `${window.location.origin}${buildScripturesBrowsePath(book.id.toString())}`;
                                            navigator.clipboard.writeText(url);
                                            setOpenBookRowActionsId(null);
                                            setAuthMessage("Link copied.");
                                            setCopyTarget("book");
                                            setTimeout(() => {
                                              setAuthMessage(null);
                                              setCopyTarget(null);
                                            }, 2000);
                                          }}
                                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                        >
                                          <Link2 size={14} />
                                          Copy browse link
                                        </button>
                                      )}
                                      {canBrowseBook && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenBookRowActionsId(null);
                                            handleBrowseBookFromRow(book);
                                          }}
                                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                        >
                                          <BookOpen size={14} />
                                          Browse book
                                        </button>
                                      )}
                                      {canImport && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenBookRowActionsId(null);
                                            void handleExportBookJson(book.id, book.book_name);
                                          }}
                                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                        >
                                          Export JSON
                                        </button>
                                      )}
                                      {(Boolean(authEmail) || book.visibility === "public") && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenBookRowActionsId(null);
                                            void handleExportBookPdf(book.id, book.book_name);
                                          }}
                                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                        >
                                          Download PDF
                                        </button>
                                      )}
                                      {(canAdmin ||
                                        book.metadata_json?.owner_id === authUserId ||
                                        book.metadata?.owner_id === authUserId) && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenBookRowActionsId(null);
                                            void handleToggleBookVisibility(book);
                                          }}
                                          disabled={bookVisibilitySubmitting === book.id}
                                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                                        >
                                            {bookVisibility === "public" ? "Make private" : "Make public"}
                                        </button>
                                      )}
                                      {canDeletePrivateBook && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenBookRowActionsId(null);
                                            void handleDeleteBook(book);
                                          }}
                                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-700 transition hover:bg-red-50"
                                        >
                                          <Trash2 size={14} />
                                          Delete book
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex min-w-0 flex-1 items-center justify-between text-left">
                              <div className="flex min-w-0 items-center gap-2">
                                {thumbnailUrl ? (
                                  <img
                                    src={thumbnailUrl}
                                    alt={`${book.book_name} thumbnail`}
                                    className="h-8 w-8 flex-shrink-0 rounded-md border border-black/10 object-cover"
                                  />
                                ) : (
                                  <div className="h-8 w-8 flex-shrink-0 rounded-md border border-black/10 bg-zinc-100" />
                                )}
                                {(canPreviewBook || isAnonymousPrivate) ? (
                                  <button
                                    type="button"
                                    onClick={handleBookClick}
                                    className="truncate font-medium text-[color:var(--accent)] underline-offset-2 transition hover:underline"
                                  >
                                    {book.book_name}
                                  </button>
                                ) : (
                                  <span className="truncate font-medium">{book.book_name}</span>
                                )}
                              </div>
                              <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                                {bookVisibility === "private" ? "Private" : "Public"}
                              </span>
                            </div>
                            {showSingleBrowseAction && (
                              <button
                                type="button"
                                onClick={() => {
                                  handleBrowseBookFromRow(book);
                                }}
                                title="Browse book"
                                aria-label="Browse book"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-black/10 bg-white/90 text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50"
                              >
                                <BookOpen size={14} />
                              </button>
                            )}
                            {showRowMenu && (
                              <div
                                ref={(element) => {
                                  if (openBookRowActionsId === book.id) {
                                    bookRowActionsMenuRef.current = element;
                                  }
                                }}
                                className="relative"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenBookRowActionsId((prev) => (prev === book.id ? null : book.id));
                                  }}
                                  title="Row actions"
                                  aria-label="Row actions"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-black/10 bg-white/90 text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50"
                                >
                                  ⋮
                                </button>
                                {openBookRowActionsId === book.id && (
                                  <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-black/10 bg-white p-1 shadow-xl">
                                    {canCopyPreviewBookLink && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const url = `${window.location.origin}${buildScripturesPreviewPath("book", book.id.toString())}`;
                                          navigator.clipboard.writeText(url);
                                          setOpenBookRowActionsId(null);
                                          setAuthMessage("Link copied.");
                                          setCopyTarget("book");
                                          setTimeout(() => {
                                            setAuthMessage(null);
                                            setCopyTarget(null);
                                          }, 2000);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                      >
                                        <Link2 size={14} />
                                        Copy preview link
                                      </button>
                                    )}
                                    {canCopyBrowseBookLink && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const url = `${window.location.origin}${buildScripturesBrowsePath(book.id.toString())}`;
                                          navigator.clipboard.writeText(url);
                                          setOpenBookRowActionsId(null);
                                          setAuthMessage("Link copied.");
                                          setCopyTarget("book");
                                          setTimeout(() => {
                                            setAuthMessage(null);
                                            setCopyTarget(null);
                                          }, 2000);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                      >
                                        <Link2 size={14} />
                                        Copy browse link
                                      </button>
                                    )}
                                    {canBrowseBook && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenBookRowActionsId(null);
                                          handleBrowseBookFromRow(book);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                      >
                                        <BookOpen size={14} />
                                        Browse book
                                      </button>
                                    )}
                                    {canImport && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenBookRowActionsId(null);
                                          void handleExportBookJson(book.id, book.book_name);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                      >
                                        Export JSON
                                      </button>
                                    )}
                                    {(Boolean(authEmail) || book.visibility === "public") && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenBookRowActionsId(null);
                                          void handleExportBookPdf(book.id, book.book_name);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                      >
                                        Download PDF
                                      </button>
                                    )}
                                    {(canAdmin ||
                                      book.metadata_json?.owner_id === authUserId ||
                                      book.metadata?.owner_id === authUserId) && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenBookRowActionsId(null);
                                          void handleToggleBookVisibility(book);
                                        }}
                                        disabled={bookVisibilitySubmitting === book.id}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                                      >
                                        {bookVisibility === "public" ? "Make private" : "Make public"}
                                      </button>
                                    )}
                                    {canDeletePrivateBook && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenBookRowActionsId(null);
                                          void handleDeleteBook(book);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-700 transition hover:bg-red-50"
                                      >
                                        <Trash2 size={14} />
                                        Delete book
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {hasMoreBooks && !isInitialBooksLoad && (
                <div ref={booksLoadMoreSentinelRef} className="h-4 w-full" aria-hidden />
              )}
            </div>
          </div>

          {bookPreviewError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {bookPreviewError}
            </div>
          )}

          {bookPreviewLoading && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-zinc-700">
              <span
                aria-hidden
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
              />
              <span>{previewLoadingMessageWithElapsed}</span>
            </div>
          )}

            {/* Anonymous private-book gate — rendered as standalone overlay, bypasses browse-modal auth requirements */}
            {privateBookGate && !authEmail && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
                <div className="relative w-full max-w-sm rounded-2xl border border-black/10 bg-[color:var(--paper)] p-6 text-center shadow-xl">
                  <button
                    type="button"
                    onClick={handleClosePrivateBookGate}
                    aria-label="Close"
                    className="absolute right-3 top-3 text-lg leading-none text-zinc-400 transition hover:text-zinc-600"
                  >
                    ✕
                  </button>
                  <p className="text-2xl">🔒</p>
                  <p className="mt-2 text-sm font-medium text-zinc-800">Private book</p>
                  <p className="mt-1 text-xs text-zinc-500">Sign in to view this book&apos;s contents.</p>
                  <div className="mt-5 flex flex-col gap-2">
                    <a
                      href="/signin"
                      className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-xs font-medium text-white transition hover:shadow-md"
                    >
                      Sign in
                    </a>
                    <a
                      href="/signup"
                      className="rounded-lg border border-black/10 bg-white px-4 py-2 text-xs font-medium text-zinc-700 transition hover:border-black/20"
                    >
                      Create account
                    </a>
                  </div>
                </div>
              </div>
            )}

          {browseTransitioningFromPreview && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[color:var(--paper)]/96 backdrop-blur-[1px]">
              <div className="rounded-2xl border border-black/10 bg-white/90 px-5 py-4 text-center shadow-lg">
                <div className="flex items-center gap-3 text-sm text-zinc-700">
                  <span
                    aria-hidden
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
                  />
                  <span>Opening browser…</span>
                </div>
              </div>
            </div>
          )}

          {showPreviewTransitionOverlay && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[color:var(--paper)]/96 backdrop-blur-[1px]">
              <div className="rounded-2xl border border-black/10 bg-white/90 px-5 py-4 text-center shadow-lg">
                <div className="flex items-center gap-3 text-sm text-zinc-700">
                  <span
                    aria-hidden
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
                  />
                  <span>{previewLoadingMessageWithElapsed}</span>
                </div>
              </div>
            </div>
          )}

          {showBrowseBookModal && bookId && isExploreVisible && (
          <div className="fixed inset-0 z-50 bg-[color:var(--paper)]/98 backdrop-blur-[1px]">
            <div className="flex h-[100svh] w-full flex-col bg-[color:var(--paper)]">
              <div className="flex items-center justify-between border-b border-black/10 bg-[color:var(--paper)] px-3 py-2 sm:px-4 sm:py-2.5">
                <div>
                  <h2 className="font-[var(--font-display)] text-xl text-[color:var(--deep)] sm:text-2xl">
                    Browse Book
                  </h2>
                  <p className="text-xs text-zinc-600 sm:text-sm">
                    {currentBook?.book_name || books.find((b) => b.id.toString() === bookId)?.book_name || "Selected book"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {canBrowseCurrentNode && (
                    <a
                      href={buildScripturesPreviewPath("book", bookId)}
                      className="rounded-full border border-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-600 transition hover:border-black/20 sm:text-xs"
                    >
                      Preview
                    </a>
                  )}
                  <div className="inline-flex rounded-full border border-black/10 bg-white/90 p-0.5 md:hidden">
                    <button
                      type="button"
                      onClick={() => setMobilePanel("tree")}
                      className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] transition ${
                        mobilePanel === "tree"
                          ? "bg-[color:var(--accent)] text-white"
                          : "text-zinc-600 hover:text-zinc-800"
                      }`}
                    >
                      Tree
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobilePanel("content")}
                      className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] transition ${
                        mobilePanel === "content"
                          ? "bg-[color:var(--accent)] text-white"
                          : "text-zinc-600 hover:text-zinc-800"
                      }`}
                    >
                      Content
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleCloseBrowseModal();
                    }}
                    className="text-xl text-zinc-400 transition hover:text-zinc-600 sm:text-2xl"
                  >
                    ✕
                  </button>
                </div>
              </div>

                <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl overflow-hidden px-3 pb-4 pt-2 sm:px-4">
              <div className="flex h-full min-h-0 w-full flex-col gap-3 sm:gap-4 md:flex-row">
            {/* Tree Section */}
            {isExploreVisible && (
            <div
              className={`min-h-0 h-full rounded-2xl border border-black/10 bg-white/90 p-3 flex flex-col md:w-[320px] md:flex-none ${
                mobilePanel === "tree" ? "flex" : "hidden"
              } md:flex`}
              style={{ scrollbarGutter: "stable" }}
            >
              {(treeLoading || (bookId && currentBook?.schema?.levels && currentBook.schema.levels.length > 1)) && (
                <div className="sticky top-0 z-10 bg-white/90 pb-1">
                  <div className="flex items-center justify-end gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                    {treeLoading && <span>Loading</span>}
                    {bookId && currentBook?.schema?.levels && currentBook.schema.levels.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedIds(new Set(treeData.map((node) => node.id)))
                          }
                          title="Expand all"
                          aria-label="Expand all"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white/80 text-zinc-700 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                        >
                          <ChevronsDown size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedIds(new Set())}
                          title="Collapse all"
                          aria-label="Collapse all"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white/80 text-zinc-700 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                        >
                          <ChevronsUp size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                style={{ scrollbarGutter: "stable" }}
              >
                {privateBookGate ? (
                  <div className="mx-2 mt-6 rounded-2xl border border-black/10 bg-white/80 p-5 text-center">
                    <p className="text-sm font-medium text-zinc-700">🔒 Private book</p>
                    <p className="mt-1 text-xs text-zinc-500">Sign in to view this book&apos;s contents.</p>
                    <div className="mt-4 flex flex-col gap-2">
                      <a
                        href="/signin"
                        className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-xs font-medium text-white transition hover:shadow-md"
                      >
                        Sign in
                      </a>
                      <a
                        href="/signup"
                        className="rounded-lg border border-black/10 bg-white px-4 py-2 text-xs font-medium text-zinc-700 transition hover:border-black/20"
                      >
                        Create account
                      </a>
                    </div>
                  </div>
                ) : (
                  <>
                    {treeError && (
                      <p className="mt-3 text-sm text-[color:var(--accent)]">{treeError}</p>
                    )}
                    {!treeLoading && !treeError && treeData.length === 0 && bookId && (
                      <p className="mt-3 text-sm text-zinc-600">No nodes yet.</p>
                    )}
                    {!treeLoading && !treeError && treeData.length > 0 && (
                      <div className="mt-1 space-y-2">
                        <button
                          type="button"
                          onClick={() => selectBookRoot(true)}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${
                            isBookRootSelected
                              ? "border-[color:var(--accent)] bg-[color:var(--sand)] text-[color:var(--accent)]"
                              : "border-black/10 bg-white/80 text-zinc-700 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                          }`}
                        >
                          {selectedBookOption?.book_name || "Book"}
                        </button>
                        {renderTree(treeData)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            )}

            {/* Content Section */}
            <div
              className={`min-h-0 h-full rounded-2xl border border-black/10 bg-white/80 p-3 shadow-lg sm:p-4 overflow-y-auto overscroll-contain md:min-w-0 md:flex-1 ${
                mobilePanel === "content" ? "block" : "hidden"
              } md:block`}
              style={{ scrollbarGutter: "stable" }}
            >
              {breadcrumb.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
                  <div className="flex flex-wrap items-center gap-2">
                    {breadcrumb.map((node, index) => (
                      <span key={node.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => selectNode(node.id)}
                          className={`rounded-full border border-black/10 px-3 py-1 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] ${
                            selectedId === node.id
                              ? "bg-[color:var(--sand)] text-[color:var(--accent)]"
                              : "bg-white/80"
                          }`}
                        >
                          {(() => {
                            const isLeaf = !node.children || node.children.length === 0;
                            const displaySeq =
                              formatSequenceDisplay(
                                node.sequence_number || node.id,
                                isLeaf
                              ) || node.id;
                            const titleText =
                              formatValue(node.title_english) ||
                              formatValue(node.title_sanskrit) ||
                              formatValue(node.title_transliteration);
                            if (isLeaf) {
                              return titleText
                                ? titleText
                                : `${formatValue(node.level_name) || "Level"} ${displaySeq}`;
                            }
                            return titleText || `Verse ${displaySeq}`;
                          })()}
                        </button>
                        {index < breadcrumb.length - 1 && <span>/</span>}
                      </span>
                    ))}
                  </div>
                  {selectedId && !isLeafSelected && (
                    <>
                      {!canEditCurrentBook && canBrowseCurrentNode && (
                        <button
                          type="button"
                          onClick={() => {
                            const url = `${window.location.origin}/scriptures?book=${bookId}&node=${selectedId}`;
                            navigator.clipboard.writeText(url);
                            setAuthMessage("Link copied.");
                            setCopyTarget("node");
                            setTimeout(() => {
                              setAuthMessage(null);
                              setCopyTarget(null);
                            }, 2000);
                          }}
                          title="Copy shareable link"
                          className="ml-auto rounded-full border border-blue-500/30 bg-blue-50/50 p-1 text-blue-700 transition hover:border-blue-500/60 hover:bg-blue-50"
                        >
                          🔗
                        </button>
                      )}
                      {isCopyMessage && copyTarget === "node" && !showLogin && (
                        <div className="ml-2 rounded-full bg-blue-500 px-3 py-1 text-xs text-white shadow">
                          {authMessage}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {isBookRootSelected && currentBook ? (
                <>
                  <div className="mb-4 flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      {bookInlineEditMode ? (
                        <input
                          type="text"
                          value={bookInlineName}
                          onChange={(event) => setBookInlineName(event.target.value)}
                          className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-2xl font-[var(--font-display)] text-[color:var(--deep)] outline-none focus:border-[color:var(--accent)]"
                          aria-label="Book name"
                        />
                      ) : (
                        <p className="truncate font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                          {currentBook.book_name}
                        </p>
                      )}
                    </div>
                    <div className="ml-3 flex flex-wrap items-center gap-2">
                      {bookInlineEditMode && canEditCurrentBook && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleSaveBookInlineEdit()}
                            disabled={bookInlineSubmitting}
                            className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {bookInlineSubmitting ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelBookInlineEdit}
                            disabled={bookInlineSubmitting}
                            className="rounded-lg border border-black/10 bg-white/90 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      <div className="flex items-center gap-1 border-l pl-2 border-black/10">
                        <button
                          type="button"
                          disabled
                          title="Previous item"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300/30 bg-zinc-50/80 text-sm text-zinc-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const first = getFirstNodeInOrder();
                            if (first) selectNode(first.id);
                          }}
                          disabled={bookInlineEditMode || !getFirstNodeInOrder()}
                          title="Next item"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300/30 bg-zinc-50/80 text-sm text-zinc-600 transition disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:border-zinc-500/60 hover:enabled:shadow-md"
                        >
                          →
                        </button>
                      </div>
                      {canShowBookRootActions && (
                        <div ref={bookRootActionsMenuRef} className="relative">
                          <button
                            type="button"
                            onClick={() => setShowBookRootActionsMenu((prev) => !prev)}
                            title="Book tree actions"
                            aria-label="Book tree actions"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-sm text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50"
                          >
                            <MoreVertical size={16} />
                          </button>
                          {showBookRootActionsMenu && (
                            <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-black/10 bg-white p-1 shadow-xl">
                              {canEditCurrentBook && !bookInlineEditMode && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleStartBookInlineEdit();
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Pencil size={14} />
                                  Edit book name
                                </button>
                              )}
                              {canPreviewCurrentBook && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowBookRootActionsMenu(false);
                                    void handlePreviewBook("book");
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Eye size={14} />
                                  Preview book
                                </button>
                              )}
                              {canCopyBookBrowseLink && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = `${window.location.origin}${buildScripturesBrowsePath(bookId)}`;
                                    navigator.clipboard.writeText(url);
                                    setShowBookRootActionsMenu(false);
                                    setAuthMessage("Link copied.");
                                    setCopyTarget("book");
                                    setTimeout(() => {
                                      setAuthMessage(null);
                                      setCopyTarget(null);
                                    }, 2000);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Link2 size={14} />
                                  Copy browse link
                                </button>
                              )}
                              {canContribute && currentBook?.schema && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowBookRootActionsMenu(false);
                                    openCreateFirstLevelNode();
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Plus size={14} />
                                  Add {getDisplayLevelName(currentBook.schema?.levels[0]) || "Node"}
                                </button>
                              )}
                              {canEditCurrentBook && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowBookRootActionsMenu(false);
                                    setMediaManagerScope("book");
                                    setShowMediaManagerModal(true);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Plus size={14} />
                                  Manage multimedia
                                </button>
                              )}
                              {canEditCurrentBook && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowBookRootActionsMenu(false);
                                    void openPropertiesModal("book");
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <SlidersHorizontal size={14} />
                                  Book properties
                                </button>
                              )}
                              {canImport && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowBookRootActionsMenu(false);
                                    void handleExportBookJson(currentBook.id, currentBook.book_name);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Download size={14} />
                                  Export JSON
                                </button>
                              )}
                              {canPreviewCurrentBook && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowBookRootActionsMenu(false);
                                    void handleExportBookPdf(currentBook.id, currentBook.book_name);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Download size={14} />
                                  Download PDF
                                </button>
                              )}
                              {selectedBookOption && canToggleCurrentBookVisibility && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowBookRootActionsMenu(false);
                                    void handleToggleBookVisibility(selectedBookOption);
                                  }}
                                  disabled={bookVisibilitySubmitting === selectedBookOption.id}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Upload size={14} />
                                  {(currentBook.visibility || "private") === "public" ? "Make private" : "Make public"}
                                </button>
                              )}
                              {selectedBookOption && canDeleteCurrentBook && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowBookRootActionsMenu(false);
                                    void handleDeleteBook(selectedBookOption);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-700 transition hover:bg-red-50"
                                >
                                  <Trash2 size={14} />
                                  Delete book
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {(() => {
                    const thumbUrl = getBookThumbnailUrl(currentBook);
                    return thumbUrl ? (
                      <div className="overflow-hidden rounded-2xl border border-black/10">
                        <img
                          src={thumbUrl}
                          alt={currentBook.book_name}
                          className="h-48 w-full object-cover"
                        />
                      </div>
                    ) : null;
                  })()}

                  <details
                    open={bookInfoStatsOpen}
                    onToggle={(e) => setBookInfoStatsOpen((e.currentTarget as HTMLDetailsElement).open)}
                    className="rounded-2xl border border-black/10 bg-white/90"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 select-none [&::-webkit-details-marker]:hidden">
                      Book Statistics
                      <span className="text-zinc-400">{bookInfoStatsOpen ? "▾" : "▸"}</span>
                    </summary>
                    <div className="flex flex-col gap-4 px-4 pb-4">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Visibility</div>
                          <div className="mt-1 text-sm text-zinc-700">
                            {(currentBook.visibility || "private") === "public" ? "Public" : "Private"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Schema</div>
                          <div className="mt-1 text-sm text-zinc-700">{currentBook.schema?.name || "Not set"}</div>
                        </div>
                      </div>
                      {currentBook.schema?.levels?.length ? (
                        <div>
                          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-500">Level Counts</div>
                          <div className="flex flex-col gap-1">
                            {currentBook.schema.levels.map((level) => {
                              const displayName = getDisplayLevelName(level) || level;
                              const count = bookNodeLevelCounts[level] ?? 0;
                              return (
                                <div
                                  key={`stat-${level}`}
                                  className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-1.5 text-sm"
                                >
                                  <span className="text-zinc-600">{displayName}</span>
                                  <span className="font-medium tabular-nums text-zinc-900">
                                    {count.toLocaleString()}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </details>

                  {Object.keys(currentBook.variant_authors ?? {}).length > 0 ? (
                    <details
                      open={bookInfoAuthorsOpen}
                      onToggle={(e) => setBookInfoAuthorsOpen((e.currentTarget as HTMLDetailsElement).open)}
                      className="rounded-2xl border border-black/10 bg-white/90"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 select-none [&::-webkit-details-marker]:hidden">
                        Author Registry
                        <span className="text-zinc-400">{bookInfoAuthorsOpen ? "▾" : "▸"}</span>
                      </summary>
                      <div className="flex flex-col gap-1 px-4 pb-4">
                        {Object.entries(currentBook.variant_authors ?? {}).map(([slug, name]) => (
                          <div key={slug} className="flex items-baseline gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                            <span className="font-medium text-zinc-900">{name}</span>
                            <span className="font-mono text-xs text-zinc-400">{slug}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </>
              ) : selectedId && nodeContent ? (
                <>
                  <div
                    className="flex items-center justify-between mb-4"
                    onContextMenu={(event) => {
                      if (!canShowNodeActions) {
                        return;
                      }
                      event.preventDefault();
                      setShowNodeActionsMenu(true);
                    }}
                  >
                    <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                      {(() => {
                        const displaySeq =
                          formatSequenceDisplay(
                            nodeContent.sequence_number ?? nodeContent.id,
                            Boolean(nodeContent.has_content)
                          ) || nodeContent.id;
                        return `${formatValue(nodeContent.level_name) || "Level"} ${displaySeq}`;
                      })()}
                    </h2>
                    <div className="flex items-center gap-2">
                      {contentLoading && (
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                          Loading...
                        </span>
                      )}
                      {canEditCurrentBook && (
                        <>
                          {inlineEditMode ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleInlineSave()}
                                disabled={
                                  inlineSubmitting ||
                                  !inlineHasChanges ||
                                  inlineWordMeaningValidationErrors.length > 0
                                }
                                className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {inlineSubmitting ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelInlineEdit}
                                disabled={inlineSubmitting}
                                className="rounded-lg border border-black/10 bg-white/90 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={handleStartInlineEdit}
                              disabled={inlineSubmitting}
                              className="rounded-lg border border-black/10 bg-white/90 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Edit details
                            </button>
                          )}
                        </>
                      )}
                      <div className="flex items-center gap-1 border-l pl-2 border-black/10">
                        <button
                          type="button"
                          onClick={() => {
                            const prev = getPreviousSibling();
                            if (prev) selectNode(prev.id);
                          }}
                          disabled={inlineHasChanges || !getPreviousSibling()}
                          title="Previous item"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300/30 bg-zinc-50/80 text-sm text-zinc-600 transition disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:border-zinc-500/60 hover:enabled:shadow-md"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const next = getNextSibling();
                            if (next) selectNode(next.id);
                          }}
                          disabled={inlineHasChanges || !getNextSibling()}
                          title="Next item"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300/30 bg-zinc-50/80 text-sm text-zinc-600 transition disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:border-zinc-500/60 hover:enabled:shadow-md"
                        >
                          →
                        </button>
                      </div>
                      {canShowNodeActions && (
                        <div ref={nodeActionsMenuRef} className="relative">
                          <button
                            type="button"
                            onClick={() => setShowNodeActionsMenu((prev) => !prev)}
                            title="Node actions"
                            aria-label="Node actions"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-sm text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50"
                          >
                            ⋮
                          </button>
                          {showNodeActionsMenu && (
                            <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-black/10 bg-white p-1 shadow-xl">
                              {canPreviewCurrentNode && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNodeActionsMenu(false);
                                    void handlePreviewBook("node");
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Eye size={14} />
                                  {activeNodePreviewLabel}
                                </button>
                              )}
                              {canCopyPreviewLink && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = `${window.location.origin}${buildScripturesPreviewPath("node", bookId, selectedId)}`;
                                    navigator.clipboard.writeText(url);
                                    setShowNodeActionsMenu(false);
                                    setAuthMessage("Link copied.");
                                    setCopyTarget(isLeafSelected ? "leaf" : "node");
                                    setTimeout(() => {
                                      setAuthMessage(null);
                                      setCopyTarget(null);
                                    }, 2000);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Link2 size={14} />
                                  Copy preview link
                                </button>
                              )}
                              {canAddSelectedNodeToBasket && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNodeActionsMenu(false);
                                    addCurrentToBasket();
                                  }}
                                  disabled={basketItems.some((item) => item.node_id === nodeContent.id)}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <ShoppingBasket size={14} />
                                  {basketItems.some((item) => item.node_id === nodeContent.id)
                                    ? "Already in basket"
                                    : "Add to basket"}
                                </button>
                              )}
                              {isLeafSelected && canCopyBrowseLink && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = `${window.location.origin}${buildScripturesBrowsePath(bookId, selectedId)}`;
                                    navigator.clipboard.writeText(url);
                                    setShowNodeActionsMenu(false);
                                    setAuthMessage("Link copied.");
                                    setCopyTarget("leaf");
                                    setTimeout(() => {
                                      setAuthMessage(null);
                                      setCopyTarget(null);
                                    }, 2000);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Link2 size={14} />
                                  Copy browse link
                                </button>
                              )}
                              {!isLeafSelected && canCopyBrowseLink && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = `${window.location.origin}${buildScripturesBrowsePath(bookId, selectedId)}`;
                                    navigator.clipboard.writeText(url);
                                    setShowNodeActionsMenu(false);
                                    setAuthMessage("Link copied.");
                                    setCopyTarget("node");
                                    setTimeout(() => {
                                      setAuthMessage(null);
                                      setCopyTarget(null);
                                    }, 2000);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Link2 size={14} />
                                  Copy browse link
                                </button>
                              )}
                              {canEditCurrentBook && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNodeActionsMenu(false);
                                    if (!nodeContent) return;
                                    const foundNode = findNodeById(treeData, selectedId);
                                    const fallbackNode: TreeNode = foundNode || {
                                      id: nodeContent.id,
                                      level_name: nodeContent.level_name,
                                      level_order: nodeContent.level_order,
                                      sequence_number: nodeContent.sequence_number ?? null,
                                      title_english: nodeContent.title_english ?? null,
                                      title_sanskrit: nodeContent.title_sanskrit ?? null,
                                      title_transliteration: nodeContent.title_transliteration ?? null,
                                      children: [],
                                    };
                                    const siblingPath = findPath(treeData, nodeContent.id);
                                    const parentNode =
                                      siblingPath && siblingPath.length > 1
                                        ? siblingPath[siblingPath.length - 2]
                                        : breadcrumb.length > 1
                                          ? breadcrumb[breadcrumb.length - 2]
                                          : null;
                                    const siblingLevelName = getSchemaMatchedLevelName(
                                      nodeContent.level_name || "",
                                      nodeContent.level_order
                                    );
                                    setActionNode(fallbackNode);
                                    setCreateParentNodeIdOverride(parentNode ? parentNode.id : null);
                                    setCreateInsertAfterNodeId(nodeContent.id);
                                    setFormData({
                                      levelName: siblingLevelName,
                                      titleSanskrit: "",
                                      titleTransliteration: "",
                                      titleEnglish: "",
                                      sequenceNumber: "",
                                      hasContent: true,
                                      contentSanskrit: "",
                                      contentTransliteration: "",
                                      contentEnglish: "",
                                      tags: "",
                                      wordMeanings: [],
                                    });
                                    setModalTranslationDrafts(buildEditableTranslationDrafts({}));
                                    setModalSelectedTranslationLanguages(
                                      normalizeSelectedEditableTranslationLanguages([], sourceLanguage)
                                    );
                                    setModalTranslationVariants([]);
                                    setModalCommentaryVariants([]);
                                    setAction("add");
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Plus size={14} />
                                  Create next sibling
                                </button>
                              )}
                              {canEditCurrentBook && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNodeActionsMenu(false);
                                    openNodeMediaManager(selectedId);
                                  }}
                                    disabled={nodeMediaUploading || nodeMediaUpdating}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Plus size={14} />
                                    {nodeMediaUploading || nodeMediaUpdating ? "Working..." : "Manage multimedia"}
                                </button>
                              )}
                              {canEditCurrentBook && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNodeActionsMenu(false);
                                    openCreateCommentaryEditor();
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Pencil size={14} />
                                  Manage commentary
                                </button>
                              )}
                              {authEmail && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNodeActionsMenu(false);
                                    openCreateNodeCommentEditor();
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Pencil size={14} />
                                  Add comment
                                </button>
                              )}
                              {canEditCurrentBook && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNodeActionsMenu(false);
                                    void openPropertiesModal("node", nodeContent.id);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <SlidersHorizontal size={14} />
                                  {activeNodePropertiesLabel}
                                </button>
                              )}
                              {canEditCurrentBook && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNodeActionsMenu(false);
                                    if (!nodeContent) return;
                                    const foundNode = findNodeById(treeData, selectedId);
                                    const fallbackNode: TreeNode = foundNode || {
                                      id: nodeContent.id,
                                      level_name: nodeContent.level_name,
                                      level_order: nodeContent.level_order,
                                      sequence_number: nodeContent.sequence_number ?? null,
                                      title_english: nodeContent.title_english ?? null,
                                      title_sanskrit: nodeContent.title_sanskrit ?? null,
                                      title_transliteration: nodeContent.title_transliteration ?? null,
                                      children: [],
                                    };
                                    setActionNode(fallbackNode);
                                    setCreateParentNodeIdOverride(null);
                                    setCreateInsertAfterNodeId(null);
                                    setFormData(buildFormDataFromNode(nodeContent));
                                    const translationState = buildTranslationEditorStateFromNode(nodeContent);
                                    setModalTranslationDrafts(translationState.drafts);
                                    setModalSelectedTranslationLanguages(translationState.selectedLanguages);
                                    const variantState = buildVariantEditorStateFromNode(nodeContent);
                                    setModalTranslationVariants(variantState.translationVariants);
                                    setModalCommentaryVariants(variantState.commentaryVariants);
                                    setAction("edit");
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Pencil size={14} />
                                  {activeNodeEditLabel}
                                </button>
                              )}
                              {canEditCurrentBook && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    setShowNodeActionsMenu(false);
                                    if (
                                      window.confirm(
                                        `Delete this ${activeNodeLevelLabel}? This cannot be undone.`
                                      )
                                    ) {
                                      try {
                                        await fetch(contentPath(`/nodes/${selectedId}`), {
                                          method: "DELETE",
                                          credentials: "include",
                                        });
                                        setSelectedId(null);
                                        setNodeContent(null);
                                        if (bookId) loadTree(bookId);
                                      } catch {
                                        alert("Failed to delete");
                                      }
                                    }
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-700 transition hover:bg-red-50"
                                >
                                  <Trash2 size={14} />
                                  {activeNodeDeleteLabel}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {isCopyMessage && copyTarget === "leaf" && !showLogin && (
                        <div className="rounded-full bg-blue-500 px-3 py-1 text-xs text-white shadow">
                          {authMessage}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-6">
                    {preferences && (
                      <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                            Display preferences
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowPreferencesDialog(true)}
                            className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50"
                          >
                            <SlidersHorizontal size={14} />
                            Open
                          </button>
                        </div>
                      </div>
                    )}

                    {nodeContent === null && showMedia && (bookMediaItems.length > 0 || canEditCurrentBook) && (
                      <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                            Book multimedia
                          </div>
                          {canEditCurrentBook && (
                            <button
                              type="button"
                              onClick={() => {
                                setMediaManagerScope("book");
                                setShowMediaManagerModal(true);
                              }}
                              disabled={bookThumbnailUploading || mediaBankUploading || mediaBankUpdating}
                              className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {bookThumbnailUploading || mediaBankUploading || mediaBankUpdating
                                ? "Working..."
                                : "Manage multimedia"}
                            </button>
                          )}
                        </div>
                        <div className="group relative mb-2">
                          <input
                            type="text"
                            value={bookBrowseMediaSearchQuery}
                            onChange={(event) => setBookBrowseMediaSearchQuery(event.target.value)}
                            placeholder="Filter media"
                            className="w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 pr-10 text-xs outline-none focus:border-[color:var(--accent)]"
                          />
                          <InlineClearButton
                            visible={Boolean(bookBrowseMediaSearchQuery)}
                            onClear={() => setBookBrowseMediaSearchQuery("")}
                            ariaLabel="Clear book media filter"
                          />
                        </div>
                        {propertiesMessage && (
                          <p className="mb-2 text-xs text-zinc-600">{propertiesMessage}</p>
                        )}
                        {propertiesError && (
                          <p className="mb-2 text-xs text-red-600">{propertiesError}</p>
                        )}
                        {bookMediaItems.length > 0 ? (
                          <div className="flex flex-col gap-4">
                            {Object.entries(
                              bookMediaItems.reduce<Record<string, BookMediaItem[]>>((acc, item) => {
                                const key = item.media_type || "other";
                                if (!acc[key]) {
                                  acc[key] = [];
                                }
                                acc[key].push(item);
                                return acc;
                              }, {})
                            )
                              .sort(([a], [b]) => a.localeCompare(b))
                              .map(([mediaType, items]) => {
                                const filteredItems = items.filter((media) =>
                                  bookMediaMatchesSearch(media, bookBrowseMediaSearchQuery)
                                );
                                if (filteredItems.length === 0) {
                                  return null;
                                }

                                return (
                                  <div key={mediaType} className="rounded-xl border border-black/10 bg-white p-3">
                                    <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                                      {mediaType}
                                    </div>
                                    <div className="flex flex-col gap-3">
                                      {filteredItems.map((media, index) => {
                                        const label = getBookMediaLabel(media);
                                        return (
                                          <div
                                            key={`${media.media_type}:${media.url}:${media.asset_id || index}`}
                                            className="rounded-lg border border-black/10 bg-zinc-50/40 p-2.5"
                                          >
                                            {renderInlineMediaPreview(media.media_type, media.url, label)}
                                            <div className="mt-2 text-xs text-zinc-500">{label}</div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        ) : (
                          <p className="text-sm text-zinc-500">No multimedia attached to this book.</p>
                        )}
                      </div>
                    )}



                    {/* Titles (hide for verses) */}
                    {inlineMessage && (
                      <div
                        className={`rounded-lg border px-3 py-2 text-sm ${
                          inlineMessage.toLowerCase().includes("saved")
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-red-200 bg-red-50 text-red-700"
                        }`}
                      >
                        {inlineMessage}
                      </div>
                    )}

                    {inlineEditMode && canEditCurrentBook && (
                      <div className="flex flex-col gap-4 rounded-2xl border border-black/10 bg-white/90 p-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Level Name</label>
                            <select
                              value={inlineFormData.levelName}
                              onChange={(event) =>
                                setInlineFormData((prev) => ({ ...prev, levelName: event.target.value }))
                              }
                              className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                              required
                            >
                              <option value="">Select level</option>
                              {currentBook?.schema?.levels?.map((level) => (
                                <option key={level} value={level}>
                                  {getDisplayLevelName(level)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Sequence Number</label>
                            <input
                              type="text"
                              value={inlineFormData.sequenceNumber}
                              onChange={(event) =>
                                setInlineFormData((prev) => ({ ...prev, sequenceNumber: event.target.value }))
                              }
                              className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Title (English)</label>
                          <div className="group relative mt-1">
                            <input
                              type="text"
                              value={inlineFormData.titleEnglish}
                              onChange={(event) =>
                                setInlineFormData((prev) => ({ ...prev, titleEnglish: event.target.value }))
                              }
                              className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                            />
                            <InlineClearButton
                              visible={Boolean(inlineFormData.titleEnglish)}
                              onClear={() => setInlineFormData((prev) => ({ ...prev, titleEnglish: "" }))}
                              ariaLabel="Clear inline title English"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Title (Sanskrit)</label>
                            <div className="group relative mt-1">
                              <input
                                type="text"
                                value={inlineFormData.titleSanskrit}
                                onChange={(event) =>
                                  setInlineFormData((prev) => ({ ...prev, titleSanskrit: event.target.value }))
                                }
                                className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                              />
                              <InlineClearButton
                                visible={Boolean(inlineFormData.titleSanskrit)}
                                onClear={() =>
                                  setInlineFormData((prev) => ({ ...prev, titleSanskrit: "" }))
                                }
                                ariaLabel="Clear inline title Sanskrit"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Title (Transliteration)
                            </label>
                            <div className="group relative mt-1">
                              <input
                                type="text"
                                value={inlineFormData.titleTransliteration}
                                onChange={(event) =>
                                  setInlineFormData((prev) => ({
                                    ...prev,
                                    titleTransliteration: event.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                              />
                              <InlineClearButton
                                visible={Boolean(inlineFormData.titleTransliteration)}
                                onClear={() =>
                                  setInlineFormData((prev) => ({ ...prev, titleTransliteration: "" }))
                                }
                                ariaLabel="Clear inline title transliteration"
                              />
                            </div>
                          </div>
                        </div>

                        <label className="flex items-center gap-2 text-sm text-zinc-700">
                          <input
                            type="checkbox"
                            checked={inlineFormData.hasContent}
                            onChange={(event) =>
                              setInlineFormData((prev) => ({ ...prev, hasContent: event.target.checked }))
                            }
                            className="rounded border-black/10"
                          />
                          Has content
                        </label>

                        {inlineFormData.hasContent && (
                          <div className="flex flex-col gap-3 rounded-lg border border-black/10 bg-blue-50/30 p-3">
                            <div>
                              <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                                {contentFieldLabels.sanskrit || DEFAULT_CONTENT_FIELD_LABELS.sanskrit}
                              </label>
                              <div className="group relative mt-1">
                                <textarea
                                  rows={3}
                                  value={inlineFormData.contentSanskrit}
                                  onChange={(event) =>
                                    setInlineFormData((prev) => ({
                                      ...prev,
                                      contentSanskrit: event.target.value,
                                    }))
                                  }
                                  className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                                />
                                <InlineClearButton
                                  visible={Boolean(inlineFormData.contentSanskrit)}
                                  onClear={() =>
                                    setInlineFormData((prev) => ({ ...prev, contentSanskrit: "" }))
                                  }
                                  ariaLabel="Clear inline content Sanskrit"
                                  position="top"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                                {contentFieldLabels.transliteration || DEFAULT_CONTENT_FIELD_LABELS.transliteration}
                              </label>
                              <div className="group relative mt-1">
                                <textarea
                                  rows={3}
                                  value={inlineFormData.contentTransliteration}
                                  onChange={(event) =>
                                    setInlineFormData((prev) => ({
                                      ...prev,
                                      contentTransliteration: event.target.value,
                                    }))
                                  }
                                  className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                                />
                                <InlineClearButton
                                  visible={Boolean(inlineFormData.contentTransliteration)}
                                  onClear={() =>
                                    setInlineFormData((prev) => ({
                                      ...prev,
                                      contentTransliteration: "",
                                    }))
                                  }
                                  ariaLabel="Clear inline content transliteration"
                                  position="top"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Translations</label>
                              <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white/70 px-2 py-1.5">
                                {EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                                  <label key={`inline-translation-select-${language}`} className="flex items-center gap-1.5 text-xs text-zinc-700">
                                    <input
                                      type="checkbox"
                                      checked={inlineSelectedTranslationLanguages.includes(language)}
                                      onChange={(event) => {
                                        const nextValues = event.target.checked
                                          ? [...inlineSelectedTranslationLanguages, language]
                                          : inlineSelectedTranslationLanguages.filter((value) => value !== language);
                                        setInlineSelectedTranslationLanguages(
                                          normalizeSelectedEditableTranslationLanguages(nextValues, sourceLanguage)
                                        );
                                      }}
                                    />
                                    {translationLanguageLabel(language)}
                                  </label>
                                ))}
                              </div>
                              <div className="mt-2 flex flex-col gap-2">
                                {inlineSelectedTranslationLanguages.map((language) => (
                                  <div key={`inline-translation-input-${language}`}>
                                    <label className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                                      {translationLanguageLabel(language)} Translation
                                    </label>
                                    <div className="group relative mt-1">
                                      <textarea
                                        rows={3}
                                        value={inlineTranslationDrafts[language] || ""}
                                        onChange={(event) =>
                                          setInlineTranslationDrafts((prev) => ({
                                            ...prev,
                                            [language]: event.target.value,
                                          }))
                                        }
                                        className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                                      />
                                      <InlineClearButton
                                        visible={Boolean((inlineTranslationDrafts[language] || "").trim())}
                                        onClear={() =>
                                          setInlineTranslationDrafts((prev) => ({
                                            ...prev,
                                            [language]: "",
                                          }))
                                        }
                                        ariaLabel={`Clear inline ${translationLanguageLabel(language)} translation`}
                                        position="top"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>

                              <details className="mt-2 rounded-lg border border-black/10 bg-white/70 p-2">
                                <summary className="cursor-pointer text-xs uppercase tracking-[0.16em] text-zinc-600">
                                  Translation Variants By Author ({inlineTranslationVariants.length})
                                </summary>
                                <div className="mt-2 flex flex-col gap-2">
                                  {inlineTranslationVariants.map((entry, index) => (
                                    <div key={`inline-translation-variant-${index}`} className="rounded-lg border border-black/10 bg-white p-2">
                                      <label className="mb-2 flex flex-col gap-1">
                                        <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Author</span>
                                        <select
                                          value={entry.author_slug}
                                          onChange={(event) =>
                                            setInlineTranslationVariants((prev) =>
                                              prev.map((item, itemIndex) =>
                                                itemIndex === index
                                                  ? applyVariantAuthorSelection(item, event.target.value, currentBook)
                                                  : item
                                              )
                                            )
                                          }
                                          disabled={getVariantAuthorOptions(currentBook, entry).length === 0}
                                          className="w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                                        >
                                          <option value="">
                                            {getVariantAuthorOptions(currentBook, entry).length > 0
                                              ? "Select author"
                                              : "No authors in registry"}
                                          </option>
                                          {getVariantAuthorOptions(currentBook, entry).map((option) => (
                                            <option key={option.slug} value={option.slug}>{option.name}</option>
                                          ))}
                                        </select>
                                      </label>
                                      <div>
                                        <label className="flex flex-col gap-1">
                                          <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Language</span>
                                          <select
                                            value={entry.language}
                                            onChange={(event) =>
                                              setInlineTranslationVariants((prev) =>
                                                prev.map((item, itemIndex) =>
                                                  itemIndex === index
                                                    ? applyVariantLanguageSelection(item, event.target.value, "translation")
                                                    : item
                                                )
                                              )
                                            }
                                            className="rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                                          >
                                            <option value="">Select language</option>
                                            {SORTED_EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                                              <option key={language} value={language}>{translationLanguageLabel(language)}</option>
                                            ))}
                                          </select>
                                        </label>
                                      </div>
                                      <textarea
                                        value={entry.text}
                                        onChange={(event) =>
                                          setInlineTranslationVariants((prev) =>
                                            prev.map((item, itemIndex) =>
                                              itemIndex === index
                                                ? { ...item, text: event.target.value }
                                                : item
                                            )
                                          )
                                        }
                                        placeholder="Variant translation text"
                                        rows={3}
                                        className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                                      />
                                      <div className="mt-2 flex justify-end">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setInlineTranslationVariants((prev) =>
                                              prev.filter((_, itemIndex) => itemIndex !== index)
                                            )
                                          }
                                          className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs uppercase tracking-[0.14em] text-red-700"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setInlineTranslationVariants((prev) => [
                                        ...prev,
                                        buildEmptyAuthorVariantDraft(),
                                      ])
                                    }
                                    className="self-start rounded-lg border border-black/10 bg-white px-2 py-1 text-xs uppercase tracking-[0.14em] text-zinc-700"
                                  >
                                    Add Translation Variant
                                  </button>
                                </div>
                              </details>

                              <details className="mt-2 rounded-lg border border-black/10 bg-white/70 p-2">
                                <summary className="cursor-pointer text-xs uppercase tracking-[0.16em] text-zinc-600">
                                  Commentary Variants By Author ({inlineCommentaryVariants.length})
                                </summary>
                                <div className="mt-2 flex flex-col gap-2">
                                  {inlineCommentaryVariants.map((entry, index) => (
                                    <div key={`inline-commentary-variant-${index}`} className="rounded-lg border border-black/10 bg-white p-2">
                                      <label className="mb-2 flex flex-col gap-1">
                                        <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Author</span>
                                        <select
                                          value={entry.author_slug}
                                          onChange={(event) =>
                                            setInlineCommentaryVariants((prev) =>
                                              prev.map((item, itemIndex) =>
                                                itemIndex === index
                                                  ? applyVariantAuthorSelection(item, event.target.value, currentBook)
                                                  : item
                                              )
                                            )
                                          }
                                          disabled={getVariantAuthorOptions(currentBook, entry).length === 0}
                                          className="w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                                        >
                                          <option value="">
                                            {getVariantAuthorOptions(currentBook, entry).length > 0
                                              ? "Select author"
                                              : "No authors in registry"}
                                          </option>
                                          {getVariantAuthorOptions(currentBook, entry).map((option) => (
                                            <option key={option.slug} value={option.slug}>{option.name}</option>
                                          ))}
                                        </select>
                                      </label>
                                      <div>
                                        <label className="flex flex-col gap-1">
                                          <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Language</span>
                                          <select
                                            value={entry.language}
                                            onChange={(event) =>
                                              setInlineCommentaryVariants((prev) =>
                                                prev.map((item, itemIndex) =>
                                                  itemIndex === index
                                                    ? applyVariantLanguageSelection(item, event.target.value, "commentary")
                                                    : item
                                                )
                                              )
                                            }
                                            className="rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                                          >
                                            <option value="">Select language</option>
                                            {SORTED_EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                                              <option key={language} value={language}>{translationLanguageLabel(language)}</option>
                                            ))}
                                          </select>
                                        </label>
                                      </div>
                                      <textarea
                                        value={entry.text}
                                        onChange={(event) =>
                                          setInlineCommentaryVariants((prev) =>
                                            prev.map((item, itemIndex) =>
                                              itemIndex === index
                                                ? { ...item, text: event.target.value }
                                                : item
                                            )
                                          )
                                        }
                                        placeholder="Variant commentary text"
                                        rows={3}
                                        className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                                      />
                                      <div className="mt-2 flex justify-end">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setInlineCommentaryVariants((prev) =>
                                              prev.filter((_, itemIndex) => itemIndex !== index)
                                            )
                                          }
                                          className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs uppercase tracking-[0.14em] text-red-700"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setInlineCommentaryVariants((prev) => [
                                        ...prev,
                                        buildEmptyAuthorVariantDraft(),
                                      ])
                                    }
                                    className="self-start rounded-lg border border-black/10 bg-white px-2 py-1 text-xs uppercase tracking-[0.14em] text-zinc-700"
                                  >
                                    Add Commentary Variant
                                  </button>
                                </div>
                              </details>
                            </div>

                            {inlineWordMeaningsEnabled && (
                              <WordMeaningsEditor
                                rows={inlineFormData.wordMeanings}
                                validationErrors={inlineWordMeaningValidationErrors}
                                missingRequired={inlineWordMeaningsMissingRequired}
                                requiredLanguage={WORD_MEANINGS_REQUIRED_LANGUAGE}
                                allowedMeaningLanguages={WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES}
                                onAddRow={handleAddInlineWordMeaningRow}
                                onImportSemicolonSeparated={handleImportInlineWordMeanings}
                                onMoveRow={handleMoveInlineWordMeaningRow}
                                onRemoveRow={handleRemoveInlineWordMeaningRow}
                                onSourceFieldChange={handleInlineWordMeaningChange}
                                onSelectMeaningLanguage={handleSelectInlineMeaningLanguage}
                                onMeaningTextChange={handleInlineMeaningTextChange}
                              />
                            )}
                          </div>
                        )}

                        <div>
                          <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Tags</label>
                          <div className="group relative mt-1">
                            <input
                              type="text"
                              value={inlineFormData.tags}
                              onChange={(event) =>
                                setInlineFormData((prev) => ({ ...prev, tags: event.target.value }))
                              }
                              className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                              placeholder="tag1, tag2"
                            />
                            <InlineClearButton
                              visible={Boolean(inlineFormData.tags)}
                              onClear={() => setInlineFormData((prev) => ({ ...prev, tags: "" }))}
                              ariaLabel="Clear inline tags"
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 border-t border-black/10 pt-3">
                          <button
                            type="button"
                            onClick={() => void handleInlineSave()}
                            disabled={
                              inlineSubmitting ||
                              !inlineHasChanges ||
                              inlineWordMeaningValidationErrors.length > 0
                            }
                            className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {inlineSubmitting ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelInlineEdit}
                            disabled={inlineSubmitting}
                            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {!inlineEditMode && (
                      <>
                        {/* Titles (hide for verses) */}
                        {!nodeContent.has_content && (
                          <div className="flex flex-col gap-2">
                            {getPreferredTitle(nodeContent) && (
                              <div className="text-xl font-medium text-zinc-900">
                                {getPreferredTitle(nodeContent)}
                              </div>
                            )}
                            {!showOnlyPreferredScript && showTransliteration &&
                              (() => {
                                const renderedTitleTransliteration = renderTransliterationByPreference(
                                  formatValue(nodeContent.title_transliteration)
                                );
                                if (
                                  !renderedTitleTransliteration ||
                                  renderedTitleTransliteration === getPreferredTitle(nodeContent)
                                ) {
                                  return null;
                                }
                                return (
                                  <div className="text-lg italic text-zinc-700">
                                    {renderedTitleTransliteration}
                                  </div>
                                );
                              })()}
                          </div>
                        )}

                        {/* Content Data */}
                        {nodeContent.has_content && nodeContent.content_data && (
                          <div className="flex flex-col gap-4 rounded-2xl border border-black/10 bg-white/90 p-4">
                            {(() => {
                              const sanskrit = formatValue(nodeContent.content_data?.basic?.sanskrit);
                              const transliterationRaw = formatValue(
                                nodeContent.content_data?.basic?.transliteration
                              );
                              const originalSanskrit =
                                sanskrit || transliterateFromIast(transliterationRaw, "devanagari");
                              const transliteration = renderTransliterationByPreference(
                                transliterationRaw
                              );
                              const preferredSanskrit = renderSanskritByPreference(
                                sanskrit,
                                transliterationRaw
                              );
                              const translations = toTranslationRecord(
                                nodeContent.content_data?.translations
                              );
                              const selectedBrowseTranslationLanguages =
                                normalizeSelectedEditableTranslationLanguages(
                                  browseTranslationLanguages,
                                  sourceLanguage
                                );
                              const selectedBrowseTranslations = selectedBrowseTranslationLanguages
                                .map((language) => ({
                                  language,
                                  label: `${translationLanguageLabel(language)} Translation`,
                                  value: pickTranslationTextForLanguageOnly(translations, language),
                                }))
                                .filter((entry) => Boolean(entry.value));
                              const preferredTranslationLabel = translationLanguageLabel(
                                sourceLanguage
                              );
                              const translationValue = pickPreferredTranslationText(
                                translations,
                                sourceLanguage,
                                nodeContent.content_data?.basic?.translation
                              );
                              const selectedPrimaryTranslationValue =
                                selectedBrowseTranslations[0]?.value || "";
                              const resolvedTranslationValue =
                                selectedPrimaryTranslationValue || translationValue;
                              const sanskritLabel = contentFieldLabels.sanskrit || DEFAULT_CONTENT_FIELD_LABELS.sanskrit;
                              const transliterationLabel =
                                contentFieldLabels.transliteration || DEFAULT_CONTENT_FIELD_LABELS.transliteration;
                              const translationLabel =
                                selectedBrowseTranslations[0]?.label ||
                                (sourceLanguage === "english"
                                  ? contentFieldLabels.english || DEFAULT_CONTENT_FIELD_LABELS.english
                                  : `${preferredTranslationLabel} Translation`);

                              const primaryContent =
                                showOnlyPreferredScript
                                  ? sourceLanguage === "sanskrit"
                                    ? preferredSanskrit || resolvedTranslationValue
                                    : resolvedTranslationValue || originalSanskrit
                                  : originalSanskrit || resolvedTranslationValue;

                              const primaryLabel =
                                showOnlyPreferredScript
                                  ? sourceLanguage === "sanskrit"
                                    ? sanskritLabel
                                    : translationLabel
                                  : "Sanskrit (Original)";

                              const showSecondaryTransliteration =
                                !showOnlyPreferredScript &&
                                showTransliteration &&
                                Boolean(transliteration) &&
                                transliteration !== primaryContent &&
                                transliteration !== originalSanskrit;

                              return (
                                <>
                                  {Object.keys(translations).length > 0 && (
                                    <div className="rounded-lg border border-black/10 bg-white/70 p-2">
                                      <div className="mb-1 text-xs uppercase tracking-[0.18em] text-zinc-500">
                                        Translation Languages
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        {EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                                          <label key={`browse-translation-${language}`} className="flex items-center gap-1.5 text-xs text-zinc-700">
                                            <input
                                              type="checkbox"
                                              checked={browseTranslationLanguages.includes(language)}
                                              onChange={(event) => {
                                                const nextValues = event.target.checked
                                                  ? [...browseTranslationLanguages, language]
                                                  : browseTranslationLanguages.filter((value) => value !== language);
                                                setBrowseTranslationLanguages(
                                                  normalizeSelectedEditableTranslationLanguages(nextValues, sourceLanguage)
                                                );
                                              }}
                                            />
                                            {translationLanguageLabel(language)}
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {primaryContent && (
                                    <div>
                                      <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                                        {primaryLabel}
                                      </div>
                                      <div className="whitespace-pre-wrap text-base leading-relaxed text-zinc-900">
                                        {primaryContent}
                                      </div>
                                    </div>
                                  )}
                                  {showSecondaryTransliteration && (
                                    <div>
                                      <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                                        {transliterationLabel} ({transliterationScriptLabel(transliterationScript)})
                                      </div>
                                      <div className="whitespace-pre-wrap text-base italic leading-relaxed text-zinc-700">
                                        {transliteration}
                                      </div>
                                    </div>
                                  )}
                                  {!showOnlyPreferredScript && sourceLanguage !== "sanskrit" &&
                                    originalSanskrit &&
                                    originalSanskrit !== primaryContent && (
                                    <div>
                                      <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                                        Sanskrit (Original)
                                      </div>
                                      <div className="whitespace-pre-wrap text-base leading-relaxed text-zinc-700">
                                        {originalSanskrit}
                                      </div>
                                    </div>
                                  )}
                                  {!showOnlyPreferredScript &&
                                    selectedBrowseTranslations
                                      .filter((entry) => entry.value !== primaryContent)
                                      .map((entry) => (
                                        <div key={`browse-translation-line-${entry.language}`}>
                                          <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                                            {entry.label}
                                          </div>
                                          <div className="whitespace-pre-wrap text-base leading-relaxed text-zinc-700">
                                            {entry.value}
                                          </div>
                                        </div>
                                      ))}
                                  {!showOnlyPreferredScript &&
                                    selectedBrowseTranslations.length === 0 &&
                                    translationValue &&
                                    translationValue !== primaryContent && (
                                      <div>
                                        <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                                          {translationLabel}
                                        </div>
                                        <div className="whitespace-pre-wrap text-base leading-relaxed text-zinc-700">
                                          {translationValue}
                                        </div>
                                      </div>
                                    )}
                                </>
                              );
                            })()}
                          </div>
                        )}

                        {showMedia && (nodeMediaLoading || nodeMediaError || nodeMedia.length > 0 || canEditCurrentBook) && (
                          <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                                Multimedia
                              </div>
                              {canEditCurrentBook && selectedId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    openNodeMediaManager(selectedId);
                                  }}
                                  disabled={nodeMediaUploading || nodeMediaUpdating}
                                  className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {nodeMediaUploading || nodeMediaUpdating ? "Working..." : "Manage multimedia"}
                                </button>
                              )}
                            </div>
                            <div className="group relative mb-2">
                              <input
                                type="text"
                                value={nodeMediaSearchQuery}
                                onChange={(event) => setNodeMediaSearchQuery(event.target.value)}
                                placeholder="Filter media"
                                className="w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 pr-10 text-xs outline-none focus:border-[color:var(--accent)]"
                              />
                              <InlineClearButton
                                visible={Boolean(nodeMediaSearchQuery)}
                                onClear={() => setNodeMediaSearchQuery("")}
                                ariaLabel="Clear media filter"
                              />
                            </div>
                            {nodeMediaMessage && (
                              <p className="mb-2 text-xs text-zinc-600">{nodeMediaMessage}</p>
                            )}
                            {nodeMediaLoading && (
                              <p className="text-sm text-zinc-600">Loading multimedia...</p>
                            )}
                            {!nodeMediaLoading && nodeMediaError && (
                              <p className="text-sm text-red-600">{nodeMediaError}</p>
                            )}
                            {!nodeMediaLoading && !nodeMediaError && nodeMedia.length > 0 && (
                              <div className="flex flex-col gap-4">
                                {Object.entries(
                                  nodeMedia.reduce<Record<string, MediaFile[]>>((acc, item) => {
                                    const key = item.media_type || "other";
                                    if (!acc[key]) {
                                      acc[key] = [];
                                    }
                                    acc[key].push(item);
                                    return acc;
                                  }, {})
                                )
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .map(([mediaType, items]) => {
                                    const sortedItems = sortNodeMediaItems(items);
                                    const filteredItems = sortedItems.filter((media) =>
                                      mediaMatchesSearch(media, nodeMediaSearchQuery)
                                    );
                                    if (filteredItems.length === 0) {
                                      return null;
                                    }
                                    return (
                                      <div key={mediaType} className="rounded-xl border border-black/10 bg-white p-3">
                                        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                                          {mediaType}
                                        </div>
                                        <div className="flex flex-col gap-3">
                                          {filteredItems.map((media, index) => {
                                            const mediaMetadata =
                                              media.metadata && typeof media.metadata === "object"
                                                ? media.metadata
                                                : media.metadata_json && typeof media.metadata_json === "object"
                                                  ? media.metadata_json
                                                  : null;
                                            const label =
                                              typeof mediaMetadata?.original_filename === "string" && mediaMetadata.original_filename
                                                ? mediaMetadata.original_filename
                                                : `${media.media_type} #${media.id}`;
                                            const isDefault = isNodeMediaDefault(media);

                                            return (
                                              <div key={media.id} className="rounded-lg border border-black/10 bg-zinc-50/40 p-2.5">
                                                {renderInlineMediaPreview(media.media_type, media.url, label)}

                                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                                  <div className="text-xs text-zinc-500">
                                                    {label}
                                                    {isDefault ? " • Default" : ""}
                                                  </div>
                                                  {canEditCurrentBook && (
                                                    <div className="flex flex-wrap items-center gap-1">
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          void handleMoveNodeMedia(media.id, "up");
                                                        }}
                                                        disabled={nodeMediaUpdating || index === 0}
                                                        className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-700 disabled:opacity-50"
                                                      >
                                                        Up
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          void handleMoveNodeMedia(media.id, "down");
                                                        }}
                                                        disabled={nodeMediaUpdating || index === filteredItems.length - 1}
                                                        className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-700 disabled:opacity-50"
                                                      >
                                                        Down
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          void handleSetDefaultNodeMedia(media.id);
                                                        }}
                                                        disabled={nodeMediaUpdating || isDefault}
                                                        className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-700 disabled:opacity-50"
                                                      >
                                                        Set Default
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          void handleDeleteNodeMedia(media);
                                                        }}
                                                        disabled={nodeMediaUpdating}
                                                        className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-red-700 disabled:opacity-50"
                                                      >
                                                        <Trash2 size={11} />
                                                        Remove
                                                      </button>
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                              </div>
                            )}
                            {!nodeMediaLoading && !nodeMediaError && nodeMedia.length === 0 && (
                              <p className="text-sm text-zinc-500">No multimedia attached to this node.</p>
                            )}
                          </div>
                        )}

                        {showCommentary && (() => {
                          const apiEntries: CommentaryDisplayItem[] = nodeCommentary
                            .filter((entry) => typeof entry.content_text === "string" && entry.content_text.trim())
                            .map((entry) => {
                              const metadata =
                                entry.metadata && typeof entry.metadata === "object"
                                  ? entry.metadata
                                  : null;
                              const metadataAuthor =
                                metadata && typeof metadata.author === "string" && metadata.author.trim()
                                  ? metadata.author.trim()
                                  : "";
                              const metadataWork =
                                metadata && typeof metadata.work_title === "string" && metadata.work_title.trim()
                                  ? metadata.work_title.trim()
                                  : "";
                              const author = metadataAuthor || metadataWork || "Commentary";

                              return {
                                id: entry.id,
                                author,
                                text: entry.content_text,
                              };
                            });

                          const metadata =
                            (nodeContent.metadata_json && typeof nodeContent.metadata_json === "object"
                              ? nodeContent.metadata_json
                              : nodeContent.metadata && typeof nodeContent.metadata === "object"
                                ? nodeContent.metadata
                                : {}) as Record<string, unknown>;
                          const metadataCommentary = metadata.commentary;
                          const metadataEntries: CommentaryDisplayItem[] = Array.isArray(metadataCommentary)
                            ? metadataCommentary
                                .map((item, idx) => {
                                  if (!item || typeof item !== "object") return null;
                                  const entry = item as Record<string, unknown>;
                                  const author = typeof entry.author === "string" ? entry.author : "Commentary";
                                  const text = typeof entry.text === "string" ? entry.text : "";
                                  if (!text.trim()) return null;
                                  return { id: `metadata-${idx}`, author, text } as CommentaryDisplayItem;
                                })
                                .filter((item): item is CommentaryDisplayItem => Boolean(item))
                            : [];

                          const apiEditableEntries = nodeCommentary.filter(
                            (entry) => typeof entry.content_text === "string" && entry.content_text.trim()
                          );

                          const displayEntries = apiEntries.length > 0 ? apiEntries : metadataEntries;
                          if (!nodeCommentaryLoading && !nodeCommentaryError && displayEntries.length === 0) {
                            return null;
                          }

                          return (
                            <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                                  Commentary
                                </div>
                                {canEditCurrentBook && (
                                  <button
                                    type="button"
                                    onClick={openCreateCommentaryEditor}
                                    disabled={commentarySubmitting}
                                    className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Add
                                  </button>
                                )}
                              </div>
                              {nodeCommentaryLoading && (
                                <p className="text-sm text-zinc-600">Loading commentary...</p>
                              )}
                              {!nodeCommentaryLoading && nodeCommentaryError && (
                                <p className="text-sm text-red-600">{nodeCommentaryError}</p>
                              )}
                              {commentaryMessage && (
                                <p className="mb-2 text-xs text-zinc-600">{commentaryMessage}</p>
                              )}
                              {canEditCurrentBook && commentaryEditorOpen && (
                                <div className="mb-3 space-y-2 rounded-lg border border-black/10 bg-white p-3">
                                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                    <input
                                      type="text"
                                      value={commentaryFormAuthor}
                                      onChange={(event) => setCommentaryFormAuthor(event.target.value)}
                                      placeholder="Author"
                                      className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]"
                                    />
                                    <input
                                      type="text"
                                      value={commentaryFormWorkTitle}
                                      onChange={(event) => setCommentaryFormWorkTitle(event.target.value)}
                                      placeholder="Work"
                                      className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]"
                                    />
                                    <input
                                      type="text"
                                      value={commentaryFormLanguage}
                                      onChange={(event) => setCommentaryFormLanguage(event.target.value)}
                                      placeholder="Language code"
                                      className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]"
                                    />
                                  </div>
                                  <textarea
                                    rows={4}
                                    value={commentaryFormText}
                                    onChange={(event) => setCommentaryFormText(event.target.value)}
                                    placeholder="Commentary text"
                                    className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                                  />
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCommentaryEditorOpen(false);
                                        resetCommentaryEditor();
                                      }}
                                      disabled={commentarySubmitting}
                                      className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-xs uppercase tracking-[0.14em] text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void handleSubmitCommentary();
                                      }}
                                      disabled={commentarySubmitting || !commentaryFormText.trim()}
                                      className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-2.5 py-1 text-xs uppercase tracking-[0.14em] text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {commentarySubmitting
                                        ? "Saving..."
                                        : commentaryEditingId !== null
                                          ? "Update"
                                          : "Save"}
                                    </button>
                                  </div>
                                </div>
                              )}
                              {!nodeCommentaryLoading && !nodeCommentaryError && displayEntries.length > 0 && (
                                <div className="space-y-3">
                                  {apiEntries.length > 0
                                    ? apiEditableEntries.map((entry) => {
                                        const entryMetadata =
                                          entry.metadata && typeof entry.metadata === "object"
                                            ? (entry.metadata as Record<string, unknown>)
                                            : {};
                                        const author =
                                          typeof entryMetadata.author === "string" && entryMetadata.author.trim()
                                            ? entryMetadata.author.trim()
                                            : typeof entryMetadata.work_title === "string" && entryMetadata.work_title.trim()
                                              ? entryMetadata.work_title.trim()
                                              : "Commentary";
                                        return (
                                          <div key={entry.id} className="rounded-lg border border-black/10 bg-white p-2.5">
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="text-xs uppercase tracking-[0.15em] text-zinc-500">{author}</div>
                                              {canEditCurrentBook && (
                                                <div className="flex items-center gap-1">
                                                  <button
                                                    type="button"
                                                    onClick={() => openEditCommentaryEditor(entry)}
                                                    disabled={commentarySubmitting}
                                                    className="rounded border border-black/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50"
                                                  >
                                                    Edit
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      void handleDeleteCommentary(entry.id);
                                                    }}
                                                    disabled={commentarySubmitting}
                                                    className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                                                  >
                                                    Delete
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{entry.content_text}</p>
                                          </div>
                                        );
                                      })
                                    : displayEntries.map((entry) => (
                                        <div key={entry.id}>
                                          <div className="text-xs uppercase tracking-[0.15em] text-zinc-500">{entry.author}</div>
                                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{entry.text}</p>
                                        </div>
                                      ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {(nodeCommentsLoading || nodeCommentsError || nodeComments.length > 0 || Boolean(authEmail)) && (
                          <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                                Comments
                              </div>
                              {authEmail && (
                                <button
                                  type="button"
                                  onClick={openCreateNodeCommentEditor}
                                  disabled={nodeCommentSubmitting}
                                  className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Add
                                </button>
                              )}
                            </div>
                            {nodeCommentsLoading && (
                              <p className="text-sm text-zinc-600">Loading comments...</p>
                            )}
                            {!nodeCommentsLoading && nodeCommentsError && (
                              <p className="text-sm text-red-600">{nodeCommentsError}</p>
                            )}
                            {nodeCommentMessage && (
                              <p className="mb-2 text-xs text-zinc-600">{nodeCommentMessage}</p>
                            )}
                            {authEmail && nodeCommentEditorOpen && (
                              <div className="mb-3 space-y-2 rounded-lg border border-black/10 bg-white p-3">
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                  <input
                                    type="text"
                                    value={nodeCommentFormLanguage}
                                    onChange={(event) => setNodeCommentFormLanguage(event.target.value)}
                                    placeholder="Language code"
                                    className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]"
                                  />
                                </div>
                                <textarea
                                  rows={4}
                                  value={nodeCommentFormText}
                                  onChange={(event) => setNodeCommentFormText(event.target.value)}
                                  placeholder="Comment text"
                                  className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                                />
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNodeCommentEditorOpen(false);
                                      resetNodeCommentEditor();
                                    }}
                                    disabled={nodeCommentSubmitting}
                                    className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-xs uppercase tracking-[0.14em] text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleSubmitNodeComment();
                                    }}
                                    disabled={nodeCommentSubmitting || !nodeCommentFormText.trim()}
                                    className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-2.5 py-1 text-xs uppercase tracking-[0.14em] text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {nodeCommentSubmitting
                                      ? "Saving..."
                                      : nodeCommentEditingId !== null
                                        ? "Update"
                                        : "Save"}
                                  </button>
                                </div>
                              </div>
                            )}
                            {!nodeCommentsLoading && !nodeCommentsError && nodeComments.length > 0 && (
                              <div className="space-y-3">
                                {nodeComments.map((entry) => {
                                  const canManageComment =
                                    canEditCurrentBook ||
                                    (authUserId !== null && entry.created_by === authUserId);

                                  return (
                                    <div key={entry.id} className="rounded-lg border border-black/10 bg-white p-2.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-xs uppercase tracking-[0.15em] text-zinc-500">
                                          {entry.created_by ? `User ${entry.created_by}` : "Comment"}
                                        </div>
                                        {canManageComment && (
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => openEditNodeCommentEditor(entry)}
                                              disabled={nodeCommentSubmitting}
                                              className="rounded border border-black/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50"
                                            >
                                              Edit
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                void handleDeleteNodeComment(entry.id);
                                              }}
                                              disabled={nodeCommentSubmitting}
                                              className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                                            >
                                              Delete
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                                        {entry.content_text}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Tags */}
                        {nodeContent.tags && nodeContent.tags.length > 0 && (
                          <div>
                            <div className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Tags
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {nodeContent.tags.map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="rounded-full border border-black/10 bg-white/90 px-3 py-1 text-xs text-zinc-600"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                  </div>
                </>
              ) : selectedId && !contentLoading && !nodeContent ? (
                <p className="text-sm text-zinc-600">
                  Unable to load content for this node.
                </p>
              ) : !selectedId ? (
                treeLoading || browseTransitioningFromPreview || contentLoading ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <span
                      aria-hidden
                      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
                    />
                    <p className="text-sm font-medium text-zinc-700">Opening browse view…</p>
                    <p className="text-xs text-zinc-500">Loading the first available section.</p>
                  </div>
                ) : (
                privateBookGate ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <p className="text-sm font-medium text-zinc-700">🔒 This book is private</p>
                    <p className="text-xs text-zinc-500">Sign in or create an account to view private books.</p>
                    <div className="mt-2 flex gap-2">
                      <a
                        href="/signin"
                        className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-xs font-medium text-white transition hover:shadow-md"
                      >
                        Sign in
                      </a>
                      <a
                        href="/signup"
                        className="rounded-lg border border-black/10 bg-white px-4 py-2 text-xs font-medium text-zinc-700 transition hover:border-black/20"
                      >
                        Create account
                      </a>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-400">
                    Select an item in the tree
                  </p>
                ))
              ) : null}
            </div>
          </div>
              </div>
            </div>
          </div>
          )}
        </section>

        <PropertiesPanel
          open={showPropertiesModal}
          title={propertiesScope === "book" ? "Book Properties" : activeNodePropertiesTitle}
          subtitle="Base properties: Name, Description, Category. Other fields are category metadata properties."
          nameValue={propertiesName}
          onNameChange={(value) => {
            setPropertiesName(value);
            setPropertiesDirty(true);
            setPropertiesMessage(null);
            setPropertiesError(null);
          }}
          descriptionValue={propertiesDescription}
          onDescriptionChange={(value) => {
            setPropertiesDescription(value);
            setPropertiesDirty(true);
            setPropertiesMessage(null);
            setPropertiesError(null);
          }}
          categoryId={propertiesCategoryId}
          categories={metadataCategories}
          loading={propertiesLoading}
          categoriesLoading={metadataCategoriesLoading}
          error={propertiesError}
          message={propertiesMessage}
          saving={propertiesSaving}
          saveDisabled={propertiesSaving || propertiesLoading || !propertiesDirty}
          effectiveFields={propertiesEffectiveFields}
          values={propertiesValues}
          onClose={() => {
            setShowPropertiesModal(false);
            setPropertiesMessage(null);
            setPropertiesError(null);
          }}
          onCategoryChange={(value) => {
            void handlePropertiesCategoryChange(value);
          }}
          onValueChange={handlePropertiesValueChange}
          onSave={() => {
            void handleSaveProperties();
          }}
          toDisplayText={metadataObjectToDisplayText}
          toDatetimeLocalValue={toDatetimeLocalValue}
          isSingleLineTextField={isSingleLineTextMetadataField}
          isTemplateField={isTemplateMetadataField}
          extraSections={
            <>
              {propertiesScope === "book" && (
                <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
                  <div className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Book Titles
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Author
                      </span>
                      <input
                        type="text"
                        value={propertiesBookAuthor}
                        onChange={(event) => {
                          setPropertiesBookAuthor(event.target.value);
                          setPropertiesDirty(true);
                          setPropertiesMessage(null);
                          setPropertiesError(null);
                        }}
                        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        placeholder="e.g. Vedavyasa"
                      />
                    </label>
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Primary / Sanskrit
                      </span>
                      <input
                        type="text"
                        value={propertiesBookTitleSanskrit}
                        onChange={(event) => {
                          setPropertiesBookTitleSanskrit(event.target.value);
                          setPropertiesDirty(true);
                          setPropertiesMessage(null);
                          setPropertiesError(null);
                        }}
                        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        placeholder="e.g. योगवासिष्ठ"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Transliteration (IAST)</span>
                      <input
                        type="text"
                        value={propertiesBookTitleTransliteration}
                        onChange={(event) => {
                          setPropertiesBookTitleTransliteration(event.target.value);
                          setPropertiesDirty(true);
                          setPropertiesMessage(null);
                          setPropertiesError(null);
                        }}
                        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        placeholder="e.g. Yoga Vasiṣṭha"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">English</span>
                      <input
                        type="text"
                        value={propertiesBookTitleEnglish}
                        onChange={(event) => {
                          setPropertiesBookTitleEnglish(event.target.value);
                          setPropertiesDirty(true);
                          setPropertiesMessage(null);
                          setPropertiesError(null);
                        }}
                        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        placeholder="e.g. Yoga Vasistha"
                      />
                    </label>
                  </div>
                </div>
              )}

              {propertiesScope === "book" && (
                <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
                  <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Word Meanings
                  </div>
                  <p className="mb-3 text-sm text-zinc-600">
                    Enable the word-to-word meanings editor for the levels where contributors should be able to edit it.
                  </p>
                  {currentBookSchemaLevels.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {currentBookSchemaLevels.map((level) => {
                        const checked = propertiesWordMeaningsEnabledLevels.includes(level);
                        return (
                          <label
                            key={level}
                            className="flex items-center justify-between gap-3 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700"
                          >
                            <span>{level}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                setPropertiesWordMeaningsEnabledLevels((prev) => {
                                  if (event.target.checked) {
                                    return prev.includes(level) ? prev : [...prev, level];
                                  }
                                  return prev.filter((entry) => entry !== level);
                                });
                                setPropertiesDirty(true);
                                setPropertiesMessage(null);
                                setPropertiesError(null);
                              }}
                              className="rounded border-black/20"
                            />
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-500">
                      This book has no schema levels available yet, so word meanings cannot be enabled from the UI.
                    </p>
                  )}
                </div>
              )}

              {propertiesScope === "node" && (
                <NodeLevelTemplateSection
                  levelDefaultTemplateKey={levelDefaultTemplateKey}
                  propertiesLevelKey={propertiesLevelKey}
                  selectedLevelTemplateId={selectedLevelTemplateId}
                  levelTemplates={levelTemplates}
                  levelTemplatesLoading={levelTemplatesLoading}
                  levelTemplateSaving={levelTemplateSaving}
                  levelTemplateAssignmentId={levelTemplateAssignmentId}
                  levelTemplateError={levelTemplateError}
                  levelTemplateMessage={levelTemplateMessage}
                  onTemplateChange={(templateId) => {
                    setSelectedLevelTemplateId(templateId);
                    setLevelTemplateError(null);
                    setLevelTemplateMessage(null);
                  }}
                  onAssignTemplate={() => {
                    void assignLevelTemplate();
                  }}
                />
              )}

              {propertiesScope === "book" && (
                <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Variant Authors Registry
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveVariantAuthors()}
                      disabled={variantAuthorsSaving}
                      className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-white disabled:opacity-50"
                    >
                      {variantAuthorsSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                  {variantAuthorsError && (
                    <p className="mb-2 text-xs text-red-600">{variantAuthorsError}</p>
                  )}
                  {variantAuthorsMessage && (
                    <p className="mb-2 text-xs text-emerald-600">{variantAuthorsMessage}</p>
                  )}
                  <div className="flex flex-col gap-2">
                    {variantAuthorsRegistry.map((row, index) => (
                      <div key={`variant-author-${index}`} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={row.slug}
                          onChange={(event) => {
                            setVariantAuthorsRegistry((prev) =>
                              prev.map((item, i) =>
                                i === index ? { ...item, slug: event.target.value } : item
                              )
                            );
                            setVariantAuthorsMessage(null);
                            setVariantAuthorsError(null);
                          }}
                          placeholder="Slug (e.g. tej)"
                          className="w-28 flex-none rounded-lg border border-black/10 bg-white px-2 py-1.5 font-mono text-sm outline-none focus:border-[color:var(--accent)]"
                        />
                        <input
                          type="text"
                          value={row.name}
                          onChange={(event) => {
                            setVariantAuthorsRegistry((prev) =>
                              prev.map((item, i) =>
                                i === index ? { ...item, name: event.target.value } : item
                              )
                            );
                            setVariantAuthorsMessage(null);
                            setVariantAuthorsError(null);
                          }}
                          placeholder="Full name (e.g. Swami Tejomayananda)"
                          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setVariantAuthorsRegistry((prev) => prev.filter((_, i) => i !== index));
                            setVariantAuthorsMessage(null);
                            setVariantAuthorsError(null);
                          }}
                          className="flex-none rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 hover:bg-red-100"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVariantAuthorsRegistry((prev) => [...prev, { slug: "", name: "" }]);
                      setVariantAuthorsMessage(null);
                      setVariantAuthorsError(null);
                    }}
                    className="mt-2 rounded-lg border border-black/10 bg-white/90 px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-zinc-600 hover:border-black/20"
                  >
                    + Add Author
                  </button>
                </div>
              )}

              {propertiesScope === "book" && (
                <BookThumbnailSection
                  thumbnailUrl={getBookThumbnailUrl(currentBook)}
                  canEditCurrentBook={canEditCurrentBook}
                  onManageMultimedia={() => {
                    setMediaManagerScope("book");
                    setShowMediaManagerModal(true);
                  }}
                  schemaLevels={currentBookSchemaLevels}
                  levelNameOverridesDraft={levelNameOverridesDraft}
                  levelNameOverridesSaving={levelNameOverridesSaving}
                  levelNameOverridesMessage={levelNameOverridesMessage}
                  levelNameOverridesError={levelNameOverridesError}
                  onLevelNameOverrideChange={handleLevelNameOverrideChange}
                  onSaveLevelNameOverrides={() => {
                    void handleSaveLevelNameOverrides();
                  }}
                />
              )}
            </>
          }
        />

        {showMediaManagerModal && ((mediaManagerScope === "bank" && canContribute) || (canEditCurrentBook && (mediaManagerScope === "book" ? Boolean(bookId) : Boolean(selectedId)))) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3">
            <div
              className="w-full max-w-3xl min-w-[320px] max-h-[92dvh] overflow-auto rounded-3xl bg-[color:var(--paper)] p-4 shadow-2xl sm:p-5"
              style={{ resize: "both" }}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    Manage Multimedia
                  </h2>
                  <p className="text-sm text-zinc-600">
                    {mediaManagerScope === "book"
                      ? "Book media manager"
                      : mediaManagerScope === "bank"
                        ? "Multimedia repo"
                        : "Node media manager"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMediaManagerModal(false)}
                  className="text-2xl text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>

              {mediaManagerScope === "book" ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {renderMediaManagerSearchInput("Search media", "Clear media search")}
                    <select
                      value={mediaManagerTypeFilter}
                      onChange={(event) => setMediaManagerTypeFilter(event.target.value)}
                      className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    >
                      <option value="all">All types</option>
                      {Array.from(
                        new Set(
                          bookMediaItems
                            .map((item) => (item.media_type || "").trim())
                            .filter((item) => item.length > 0)
                        )
                      )
                        .sort((a, b) => a.localeCompare(b))
                        .map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                    </select>
                    {renderMediaManagerDensityControl()}
                    <input
                      ref={bookMediaUploadInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*,audio/*,video/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (!file) return;
                        void handleUploadBookMediaViaBank(file);
                      }}
                    />
                    <div ref={bookMediaActionsMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setBookMediaActionsOpen((prev) => !prev)}
                        disabled={bookThumbnailUploading || mediaBankUploading || mediaBankUpdating || externalMediaFormSubmitting || !bookId}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                        aria-label="More media actions"
                      >
                        <MoreVertical size={16} />
                      </button>
                      {bookMediaActionsOpen && (
                        <div className="absolute right-0 top-10 z-50 mt-1 w-[calc(100vw-2rem)] max-w-[260px] rounded-lg border border-black/10 bg-white p-1.5 shadow-lg">
                          <button
                            type="button"
                            onClick={() => {
                              setBookMediaActionsOpen(false);
                              bookMediaUploadInputRef.current?.click();
                            }}
                            disabled={bookThumbnailUploading || mediaBankUploading || mediaBankUpdating || externalMediaFormSubmitting || !bookId}
                            className="w-full rounded-md px-2.5 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                          >
                            Upload
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setBookMediaActionsOpen(false);
                              openMediaLinkForm("book");
                            }}
                            disabled={bookThumbnailUploading || mediaBankUploading || mediaBankUpdating || externalMediaFormSubmitting || !bookId}
                            className="w-full rounded-md px-2.5 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                          >
                            Add external
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setBookMediaActionsOpen(false);
                              setMediaBankViewMode("pick-book");
                              setMediaManagerScope("bank");
                            }}
                            disabled={mediaBankUploading || mediaBankUpdating || bookThumbnailUploading || externalMediaFormSubmitting}
                            className="w-full rounded-md px-2.5 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                          >
                            Add from repo
                          </button>
                        </div>
                      )}
                    </div>
                  </div>


                  {propertiesError && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {propertiesError}
                    </div>
                  )}
                  {propertiesMessage && (
                    <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {propertiesMessage}
                    </div>
                  )}

                  <div className="max-h-[45dvh] overflow-y-auto rounded-2xl border border-black/10 bg-white">
                    {mediaManagerView === "list" && (
                      <div className="grid grid-cols-[2fr_1fr_1fr_1.5fr] items-center gap-3 border-b border-black/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                        <span>Name</span>
                        <span>Type</span>
                        <span>Is default</span>
                        <span className="text-right">Actions</span>
                      </div>
                    )}
                    {filteredBookMediaItems.length === 0 ? (
                      <div className="px-3 py-6 text-sm text-zinc-500">
                        {bookMediaItems.length === 0
                          ? "No multimedia attached to this book."
                          : "No matching media found."}
                      </div>
                    ) : (
                      <div
                        className={mediaManagerItemsLayoutClass}
                        style={mediaManagerItemsLayoutStyle}
                      >
                        {filteredBookMediaItems.map((media, index) => {
                          const label = getBookMediaLabel(media);
                          const mediaType = (media.media_type || "other").trim() || "other";
                          const isDefault = Boolean(media.is_default);
                          return (
                            <div
                              key={`${mediaType}:${media.url}:${media.asset_id || index}`}
                              className={
                                mediaManagerView === "icon"
                                  ? "overflow-visible rounded-xl border border-black/10 bg-white text-sm text-zinc-700"
                                  : "grid grid-cols-[2fr_1fr_1fr_1.5fr] items-center gap-3 px-3 py-2.5 text-sm text-zinc-700"
                              }
                            >
                              {mediaManagerView === "icon" ? (
                                <>
                                  <div className="p-2">
                                    {renderInlineMediaPreview(mediaType, media.url, label)}
                                  </div>
                                  <div className="space-y-2 p-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="truncate font-medium">{label}</div>
                                        <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">{mediaType}</div>
                                      </div>
                                      <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                                        {isDefault ? "Default" : "Normal"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void handleDeleteBookMedia(media);
                                        }}
                                        disabled={bookThumbnailUploading}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded border border-red-300 bg-red-50 text-red-700 disabled:opacity-50"
                                        aria-label="Remove"
                                        title="Remove"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="min-w-0">
                                    <div className="truncate font-medium">{label}</div>
                                    <div className="mt-1">
                                      {renderInlineMediaPreview(mediaType, media.url, label, "thumb")}
                                    </div>
                                  </div>
                                  <span className="uppercase text-xs tracking-[0.12em] text-zinc-600">{mediaType}</span>
                                  <span className="text-xs text-zinc-600">{isDefault ? "Yes" : "No"}</span>
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void handleDeleteBookMedia(media);
                                      }}
                                      disabled={bookThumbnailUploading}
                                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-red-300 bg-red-50 text-red-700 disabled:opacity-50"
                                      aria-label="Remove"
                                      title="Remove"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : mediaManagerScope === "bank" ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {renderMediaManagerSearchInput("Search media repo", "Clear media repo search")}
                    {mediaBankViewMode === "manage" ? (
                      <>
                        {renderMediaManagerDensityControl()}
                        <input
                          ref={mediaBankUploadInputRef}
                          type="file"
                          accept="image/*,audio/*,video/*"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.currentTarget.value = "";
                            if (!file) return;
                            void handleUploadMediaBankAsset(file);
                          }}
                        />
                        <input
                          ref={mediaBankReplaceInputRef}
                          type="file"
                          accept="image/*,audio/*,video/*"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.currentTarget.value = "";
                            const targetId = mediaBankReplaceTargetIdRef.current;
                            mediaBankReplaceTargetIdRef.current = null;
                            if (!file || !targetId) return;
                            const target = mediaBankAssets.find((item) => item.id === targetId);
                            if (!target) {
                              setMediaBankError("Asset not found for replacement.");
                              return;
                            }
                            void handleReplaceMediaBankAsset(target, file);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => mediaBankUploadInputRef.current?.click()}
                          disabled={mediaBankUploading || mediaBankUpdating}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition disabled:opacity-50"
                        >
                          {mediaBankUploading ? "Uploading..." : "Upload"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            openMediaLinkForm("bank");
                          }}
                          disabled={mediaBankUploading || mediaBankUpdating || externalMediaFormSubmitting}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition disabled:opacity-50"
                        >
                          Add Link
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          const nextScope = mediaBankViewMode === "pick-book" ? "book" : "node";
                          setMediaBankViewMode("manage");
                          setMediaManagerScope(nextScope);
                        }}
                        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                      >
                        Back
                      </button>
                    )}
                  </div>


                  {(mediaBankViewMode === "pick-node" || mediaBankViewMode === "pick-book") && (
                    <div className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                      {mediaBankViewMode === "pick-book"
                        ? "Pick an item to attach to this book, or use Back to return."
                        : "Pick an item to attach to the selected node, or use Back to return."}
                    </div>
                  )}

                  {mediaBankError && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {mediaBankError}
                    </div>
                  )}
                  {mediaBankMessage && (
                    <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {mediaBankMessage}
                    </div>
                  )}

                  <div className="max-h-[45dvh] overflow-y-auto rounded-2xl border border-black/10 bg-white">
                    {mediaBankLoading ? (
                      <div className="px-3 py-6 text-sm text-zinc-600">Loading multimedia repo...</div>
                    ) : mediaBankAssets.length === 0 ? (
                      <div className="px-3 py-6 text-sm text-zinc-500">No media assets in repo.</div>
                    ) : (
                      <>
                        {mediaManagerView === "list" && (
                          <div className="grid grid-cols-[2fr_1fr_1.5fr] items-center gap-3 border-b border-black/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                            <span>Name</span>
                            <span>Type</span>
                            <span className="text-right">{mediaBankViewMode === "manage" ? "Actions" : "Pick"}</span>
                          </div>
                        )}
                        <div
                          className={mediaManagerItemsLayoutClass}
                          style={mediaManagerItemsLayoutStyle}
                        >
                          {(() => {
                            const filteredAssets = mediaBankAssets.filter((asset) =>
                              mediaAssetMatchesSearch(asset, mediaManagerSearchQuery)
                            );
                            if (filteredAssets.length === 0) {
                              return <div className="px-3 py-6 text-sm text-zinc-500">No matching media found.</div>;
                            }

                            return filteredAssets.map((asset) => {
                              const label = getMediaBankAssetDisplayName(asset);
                              const isRenaming = mediaBankRenameId === asset.id;
                              return (
                                <div
                                  key={asset.id}
                                  className={
                                    mediaManagerView === "icon"
                                      ? "overflow-visible rounded-xl border border-black/10 bg-white text-sm text-zinc-700"
                                      : "grid grid-cols-[2fr_1fr_1.5fr] items-center gap-3 px-3 py-2.5 text-sm text-zinc-700"
                                  }
                                >
                                  {mediaManagerView === "icon" ? (
                                    <>
                                      {asset.media_type === "image" ? (
                                        <img
                                          src={resolveMediaUrl(asset.url)}
                                          alt={label}
                                          className="aspect-square w-full object-cover"
                                        />
                                      ) : (
                                        <div className="flex aspect-square w-full items-center justify-center bg-zinc-100 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                                          {asset.media_type}
                                        </div>
                                      )}
                                      <div className="space-y-2 p-3">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0">
                                            {isRenaming ? (
                                              <input
                                                autoFocus
                                                value={mediaBankRenameValue}
                                                onChange={(event) => setMediaBankRenameValue(event.target.value)}
                                                onBlur={() => {
                                                  if (mediaBankSuppressRenameBlurRef.current) {
                                                    mediaBankSuppressRenameBlurRef.current = false;
                                                    return;
                                                  }
                                                  void handleRenameMediaBankAsset(asset.id);
                                                }}
                                                onKeyDown={(event) => {
                                                  if (event.key === "Enter") {
                                                    event.preventDefault();
                                                    event.currentTarget.blur();
                                                    return;
                                                  }
                                                  if (event.key === "Escape") {
                                                    event.preventDefault();
                                                    cancelRenameMediaBankAsset();
                                                  }
                                                }}
                                                className="w-full rounded border border-black/10 bg-white px-2 py-1 text-sm"
                                              />
                                            ) : (
                                              <div className="truncate font-medium">{label}</div>
                                            )}
                                            <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">{asset.media_type}</div>
                                          </div>
                                        </div>
                                        <div className="flex items-center justify-end gap-1">
                                          {mediaBankViewMode === "pick-node" || mediaBankViewMode === "pick-book" ? (
                                            <button
                                              type="button"
                                              onClick={async () => {
                                                if (mediaBankViewMode === "pick-book") {
                                                  const picked = await handleAttachMediaBankAssetToBook(asset);
                                                  if (picked) {
                                                    setMediaBankViewMode("manage");
                                                    setMediaManagerScope("book");
                                                  }
                                                  return;
                                                }

                                                const attached = await handleAttachMediaBankAssetToSelectedNode(asset.id);
                                                if (attached) {
                                                  setMediaBankViewMode("manage");
                                                  setMediaManagerScope("node");
                                                }
                                              }}
                                              disabled={
                                                mediaBankUpdating ||
                                                mediaBankUploading ||
                                                bookThumbnailUploading ||
                                                (mediaBankViewMode === "pick-node" && !selectedId)
                                              }
                                              className="rounded border border-black/10 bg-white px-2 py-1 text-xs text-zinc-700 disabled:opacity-50"
                                            >
                                              Pick
                                            </button>
                                          ) : isRenaming ? (
                                            <>
                                              <button
                                                type="button"
                                                onMouseDown={() => {
                                                  mediaBankSuppressRenameBlurRef.current = true;
                                                }}
                                                onClick={() => {
                                                  void handleRenameMediaBankAsset(asset.id);
                                                }}
                                                disabled={mediaBankUpdating || mediaBankUploading}
                                                className="rounded border border-black/10 bg-white px-2 py-1 text-xs text-zinc-700 disabled:opacity-50"
                                              >
                                                Save
                                              </button>
                                              <button
                                                type="button"
                                                onMouseDown={() => {
                                                  mediaBankSuppressRenameBlurRef.current = true;
                                                }}
                                                onClick={() => {
                                                  cancelRenameMediaBankAsset();
                                                }}
                                                className="rounded border border-black/10 bg-white px-2 py-1 text-xs text-zinc-700"
                                              >
                                                Cancel
                                              </button>
                                            </>
                                          ) : (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  mediaBankReplaceTargetIdRef.current = asset.id;
                                                  mediaBankReplaceInputRef.current?.click();
                                                }}
                                                disabled={mediaBankUpdating || mediaBankUploading || asset.url.startsWith("http")}
                                                className="rounded border border-black/10 bg-white px-2 py-1 text-xs text-zinc-700 disabled:opacity-50"
                                              >
                                                Replace
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  beginRenameMediaBankAsset(asset);
                                                }}
                                                disabled={mediaBankUpdating || mediaBankUploading}
                                                className="rounded border border-black/10 bg-white px-2 py-1 text-xs text-zinc-700 disabled:opacity-50"
                                              >
                                                Rename
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  void handleAttachMediaBankAssetToSelectedNode(asset.id);
                                                }}
                                                disabled={mediaBankUpdating || mediaBankUploading || !selectedId}
                                                className="rounded border border-black/10 bg-white px-2 py-1 text-xs text-zinc-700 disabled:opacity-50"
                                              >
                                                Attach
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  void handleDeleteMediaBankAsset(asset.id);
                                                }}
                                                disabled={mediaBankUpdating || mediaBankUploading}
                                                className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                                              >
                                                Remove
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div className="min-w-0">
                                        {isRenaming ? (
                                          <input
                                            autoFocus
                                            value={mediaBankRenameValue}
                                            onChange={(event) => setMediaBankRenameValue(event.target.value)}
                                            onBlur={() => {
                                              if (mediaBankSuppressRenameBlurRef.current) {
                                                mediaBankSuppressRenameBlurRef.current = false;
                                                return;
                                              }
                                              void handleRenameMediaBankAsset(asset.id);
                                            }}
                                            onKeyDown={(event) => {
                                              if (event.key === "Enter") {
                                                event.preventDefault();
                                                event.currentTarget.blur();
                                                return;
                                              }
                                              if (event.key === "Escape") {
                                                event.preventDefault();
                                                cancelRenameMediaBankAsset();
                                              }
                                            }}
                                            className="w-full rounded border border-black/10 bg-white px-2 py-1 text-sm"
                                          />
                                        ) : (
                                          <div className="truncate font-medium">{label}</div>
                                        )}
                                        {asset.media_type === "image" ? (
                                          <img
                                            src={resolveMediaUrl(asset.url)}
                                            alt={label}
                                            className="mt-1 h-10 w-10 rounded-md border border-black/10 object-cover"
                                          />
                                        ) : (
                                          <div className="mt-1 truncate text-xs text-zinc-500">{asset.url}</div>
                                        )}
                                      </div>
                                      <span className="uppercase text-xs tracking-[0.12em] text-zinc-600">{asset.media_type}</span>
                                      <div className="flex items-center justify-end gap-1">
                                        {mediaBankViewMode === "pick-node" || mediaBankViewMode === "pick-book" ? (
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              if (mediaBankViewMode === "pick-book") {
                                                const picked = await handleAttachMediaBankAssetToBook(asset);
                                                if (picked) {
                                                  setMediaBankViewMode("manage");
                                                  setMediaManagerScope("book");
                                                }
                                                return;
                                              }

                                              const attached = await handleAttachMediaBankAssetToSelectedNode(asset.id);
                                              if (attached) {
                                                setMediaBankViewMode("manage");
                                                setMediaManagerScope("node");
                                              }
                                            }}
                                            disabled={
                                              mediaBankUpdating ||
                                              mediaBankUploading ||
                                              bookThumbnailUploading ||
                                              (mediaBankViewMode === "pick-node" && !selectedId)
                                            }
                                            className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 disabled:opacity-50"
                                          >
                                            Pick
                                          </button>
                                        ) : (
                                          isRenaming ? (
                                            <>
                                              <button
                                                type="button"
                                                onMouseDown={() => {
                                                  mediaBankSuppressRenameBlurRef.current = true;
                                                }}
                                                onClick={() => {
                                                  void handleRenameMediaBankAsset(asset.id);
                                                }}
                                                disabled={mediaBankUpdating || mediaBankUploading}
                                                className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 disabled:opacity-50"
                                              >
                                                Save
                                              </button>
                                              <button
                                                type="button"
                                                onMouseDown={() => {
                                                  mediaBankSuppressRenameBlurRef.current = true;
                                                }}
                                                onClick={() => {
                                                  cancelRenameMediaBankAsset();
                                                }}
                                                className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700"
                                              >
                                                Cancel
                                              </button>
                                            </>
                                          ) : (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  mediaBankReplaceTargetIdRef.current = asset.id;
                                                  mediaBankReplaceInputRef.current?.click();
                                                }}
                                                disabled={mediaBankUpdating || mediaBankUploading || asset.url.startsWith("http")}
                                                className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 disabled:opacity-50"
                                              >
                                                Replace
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  beginRenameMediaBankAsset(asset);
                                                }}
                                                disabled={mediaBankUpdating || mediaBankUploading}
                                                className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 disabled:opacity-50"
                                              >
                                                Rename
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  void handleAttachMediaBankAssetToSelectedNode(asset.id);
                                                }}
                                                disabled={mediaBankUpdating || mediaBankUploading || !selectedId}
                                                className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 disabled:opacity-50"
                                              >
                                                Attach
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  void handleDeleteMediaBankAsset(asset.id);
                                                }}
                                                disabled={mediaBankUpdating || mediaBankUploading}
                                                className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700 disabled:opacity-50"
                                              >
                                                Remove
                                              </button>
                                            </>
                                          )
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {renderMediaManagerSearchInput("Search media", "Clear media search")}
                    <select
                      value={mediaManagerTypeFilter}
                      onChange={(event) => setMediaManagerTypeFilter(event.target.value)}
                      className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    >
                      <option value="all">All types</option>
                      {Array.from(
                        new Set(
                          nodeMedia
                            .map((item) => (item.media_type || "").trim())
                            .filter((item) => item.length > 0)
                        )
                      )
                        .sort((a, b) => a.localeCompare(b))
                        .map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                    </select>
                    {renderMediaManagerDensityControl()}
                    <input
                      ref={nodeMediaUploadInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*,audio/*,video/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (!file) return;
                        void handleUploadNodeMediaViaBank(file);
                      }}
                    />
                    <div ref={nodeMediaActionsMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setNodeMediaActionsOpen((prev) => !prev)}
                        disabled={nodeMediaUploading || nodeMediaUpdating || mediaBankUploading || mediaBankUpdating || externalMediaFormSubmitting || !selectedId}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                        aria-label="More media actions"
                      >
                        <MoreVertical size={16} />
                      </button>
                      {nodeMediaActionsOpen && (
                        <div className="absolute right-0 top-10 z-50 mt-1 w-[calc(100vw-2rem)] max-w-[250px] rounded-lg border border-black/10 bg-white p-1.5 shadow-lg">
                          <button
                            type="button"
                            onClick={() => {
                              setNodeMediaActionsOpen(false);
                              nodeMediaUploadInputRef.current?.click();
                            }}
                            disabled={nodeMediaUploading || nodeMediaUpdating || mediaBankUploading || mediaBankUpdating || externalMediaFormSubmitting || !selectedId}
                            className="w-full rounded-md px-2.5 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                          >
                            Upload
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNodeMediaActionsOpen(false);
                              openMediaLinkForm("node");
                            }}
                            disabled={nodeMediaUploading || nodeMediaUpdating || mediaBankUploading || mediaBankUpdating || externalMediaFormSubmitting || !selectedId}
                            className="w-full rounded-md px-2.5 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                          >
                            Add external
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNodeMediaActionsOpen(false);
                              setMediaBankViewMode("pick-node");
                              setMediaManagerScope("bank");
                            }}
                            disabled={mediaBankUploading || mediaBankUpdating}
                            className="w-full rounded-md px-2.5 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                          >
                            Add from repo
                          </button>
                        </div>
                      )}
                    </div>
                  </div>


                  {nodeMediaError && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {nodeMediaError}
                    </div>
                  )}
                  {nodeMediaMessage && (
                    <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {nodeMediaMessage}
                    </div>
                  )}

                  <div className="max-h-[45dvh] overflow-y-auto rounded-2xl border border-black/10 bg-white">
                    {nodeMediaLoading ? (
                      <div className="px-3 py-6 text-sm text-zinc-600">Loading multimedia...</div>
                    ) : nodeMedia.length === 0 ? (
                      <div className="px-3 py-6 text-sm text-zinc-500">No multimedia attached to this node.</div>
                    ) : (
                      <>
                        {mediaManagerView === "list" && (
                          <div className="grid grid-cols-[2fr_1fr_1fr_1.5fr] items-center gap-3 border-b border-black/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                            <span>Name</span>
                            <span>Type</span>
                            <span>Is default</span>
                            <span className="text-right">Actions</span>
                          </div>
                        )}
                        <div
                          className={mediaManagerItemsLayoutClass}
                          style={mediaManagerItemsLayoutStyle}
                        >
                          {(() => {
                            const filteredItems = sortNodeMediaItems(nodeMedia).filter((media) => {
                              const mediaType = (media.media_type || "").trim();
                              const matchesType =
                                mediaManagerTypeFilter === "all" || mediaType === mediaManagerTypeFilter;
                              return matchesType && mediaMatchesSearch(media, mediaManagerSearchQuery);
                            });

                            if (filteredItems.length === 0) {
                              return <div className="px-3 py-6 text-sm text-zinc-500">No matching media found.</div>;
                            }

                            return filteredItems.map((media) => {
                              const mediaType = media.media_type || "other";
                              const label = getNodeMediaLabel(media);
                              const isDefault = isNodeMediaDefault(media);
                              const sameType = sortNodeMediaItems(
                                nodeMedia.filter((item) => (item.media_type || "") === mediaType)
                              );
                              const sameTypeIndex = sameType.findIndex((item) => item.id === media.id);

                              return (
                                <div
                                  key={media.id}
                                  className={
                                    mediaManagerView === "icon"
                                      ? "overflow-visible rounded-xl border border-black/10 bg-white text-sm text-zinc-700"
                                      : "grid grid-cols-[2fr_1fr_1fr_1.5fr] items-center gap-3 px-3 py-2.5 text-sm text-zinc-700"
                                  }
                                >
                                  {mediaManagerView === "icon" ? (
                                    <>
                                      {mediaType === "image" ? (
                                        <img
                                          src={resolveMediaUrl(media.url)}
                                          alt={label}
                                          className="aspect-square w-full object-cover"
                                        />
                                      ) : (
                                        <div className="flex aspect-square w-full items-center justify-center bg-zinc-100 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                                          {mediaType}
                                        </div>
                                      )}
                                      <div className="space-y-2 p-3">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0">
                                            <div className="truncate font-medium">{label}</div>
                                            <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">{mediaType}</div>
                                          </div>
                                          <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                                            {isDefault ? "Default" : "Normal"}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-end gap-1">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              void handleMoveNodeMedia(media.id, "up");
                                            }}
                                            disabled={nodeMediaUpdating || sameTypeIndex <= 0}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                            aria-label="Move up"
                                            title="Move up"
                                          >
                                            <ChevronsUp size={12} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              void handleMoveNodeMedia(media.id, "down");
                                            }}
                                            disabled={nodeMediaUpdating || sameTypeIndex === sameType.length - 1}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                            aria-label="Move down"
                                            title="Move down"
                                          >
                                            <ChevronsDown size={12} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              void handleSetDefaultNodeMedia(media.id);
                                            }}
                                            disabled={nodeMediaUpdating || isDefault}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                            aria-label="Set default"
                                            title="Set default"
                                          >
                                            <SlidersHorizontal size={12} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              void handleDeleteNodeMedia(media);
                                            }}
                                            disabled={nodeMediaUpdating}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-red-300 bg-red-50 text-red-700 disabled:opacity-50"
                                            aria-label="Remove"
                                            title="Remove"
                                          >
                                            <Trash2 size={12} />
                                          </button>
                                        </div>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div className="min-w-0">
                                        <div className="truncate font-medium">{label}</div>
                                        {mediaType === "image" ? (
                                          <img
                                            src={resolveMediaUrl(media.url)}
                                            alt={label}
                                            className="mt-1 h-10 w-10 rounded-md border border-black/10 object-cover"
                                          />
                                        ) : (
                                          <div className="mt-1 truncate text-xs text-zinc-500">{media.url}</div>
                                        )}
                                      </div>
                                      <span className="uppercase text-xs tracking-[0.12em] text-zinc-600">{mediaType}</span>
                                      <span className="text-xs text-zinc-600">
                                        {isDefault ? "Yes" : "No"}
                                      </span>
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            void handleMoveNodeMedia(media.id, "up");
                                          }}
                                          disabled={nodeMediaUpdating || sameTypeIndex <= 0}
                                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                          aria-label="Move up"
                                          title="Move up"
                                        >
                                          <ChevronsUp size={12} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            void handleMoveNodeMedia(media.id, "down");
                                          }}
                                          disabled={nodeMediaUpdating || sameTypeIndex === sameType.length - 1}
                                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                          aria-label="Move down"
                                          title="Move down"
                                        >
                                          <ChevronsDown size={12} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            void handleSetDefaultNodeMedia(media.id);
                                          }}
                                          disabled={nodeMediaUpdating || isDefault}
                                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                          aria-label="Set default"
                                          title="Set default"
                                        >
                                          <SlidersHorizontal size={12} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            void handleDeleteNodeMedia(media);
                                          }}
                                          disabled={nodeMediaUpdating}
                                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-red-300 bg-red-50 text-red-700 disabled:opacity-50"
                                          aria-label="Remove"
                                          title="Remove"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}

              <ExternalMediaFormModal
                open={externalMediaFormOpen}
                submitting={externalMediaFormSubmitting}
                description={
                  externalMediaFormContext === "book"
                    ? "Add an external media link to repo and attach to this book."
                    : externalMediaFormContext === "node"
                      ? "Add an external media link to repo and attach to this node."
                      : "Add an external media link to repo."
                }
                onClose={() => {
                  if (!externalMediaFormSubmitting) {
                    setExternalMediaFormOpen(false);
                  }
                }}
                onSubmit={async (payload) => {
                  await handleSubmitMediaLinkForm(payload);
                }}
              />
            </div>
          </div>
        )}

        {showBookPreview && bookPreviewArtifact && (
          <div className="fixed inset-0 z-50 bg-[color:var(--paper)]/98 backdrop-blur-[1px]">
            <div className="flex h-[100svh] w-full flex-col bg-[color:var(--paper)]">
              <div className="flex flex-col gap-2 border-b border-black/10 bg-[color:var(--paper)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-0 sm:px-4 sm:py-2.5">
                <div className="flex-1">
                  <h2 className="font-[var(--font-display)] text-xl text-[color:var(--deep)] sm:text-2xl">
                    {bookPreviewArtifact.preview_scope === "node"
                      ? (() => {
                          const hierarchicalPath = getPreviewHierarchicalPath(bookPreviewArtifact);
                          return hierarchicalPath ? `Reader View (${hierarchicalPath})` : "Reader View";
                        })()
                      : "Book Preview"}
                  </h2>
                  <p className="text-xs text-zinc-600 sm:text-sm">
                    {getPreviewBreadcrumbTitle(bookPreviewArtifact)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const previewScope = bookPreviewArtifact.preview_scope === "node" ? "node" : "book";
                    const targetNodeId =
                      previewScope === "node" && typeof bookPreviewArtifact.root_node_id === "number"
                        ? bookPreviewArtifact.root_node_id
                        : previewScope === "node"
                          ? selectedId
                          : null;
                    const previewPath = buildScripturesPreviewPath(previewScope, bookId, targetNodeId);
                    const { previousSiblingId, nextSiblingId } = getPreviewSiblingNavigation(
                      bookPreviewArtifact
                    );
                    return (
                      <>
                        {previewScope === "node" && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                void handlePreviewSiblingNavigation("previous");
                              }}
                              disabled={showPreviewControls || !previousSiblingId}
                              title="Previous sibling"
                              aria-label="Previous sibling"
                              className="rounded-full border border-black/10 p-2 text-zinc-600 transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void handlePreviewSiblingNavigation("next");
                              }}
                              disabled={showPreviewControls || !nextSiblingId}
                              title="Next sibling"
                              aria-label="Next sibling"
                              className="rounded-full border border-black/10 p-2 text-zinc-600 transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            void handleCopyPreviewPath(previewPath);
                          }}
                          disabled={showPreviewControls}
                          title="Copy link"
                          aria-label="Copy link"
                          className="rounded-full border border-black/10 p-2 text-zinc-600 transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Link2 className="h-4 w-4" />
                        </button>
                        {canBrowseCurrentNode && (
                          <button
                            type="button"
                            onClick={() => {
                              handleBrowseFromPreview(bookId, targetNodeId);
                            }}
                            disabled={showPreviewControls}
                            title="Browse"
                            aria-label="Browse"
                            className="rounded-full border border-black/10 p-2 text-zinc-600 transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <BookOpen className="h-4 w-4" />
                          </button>
                        )}
                        {previewScope === "book" && hasEffectiveBookPreviewSummary && (
                          <label className="ml-1 flex items-center gap-1.5 rounded-full border border-black/10 bg-[color:var(--paper)] px-2.5 py-1 text-xs text-zinc-700">
                            <input
                              type="checkbox"
                              checked={showPreviewBookSummary}
                              onChange={(event) => setShowPreviewBookSummary(event.target.checked)}
                              disabled={bookPreviewLoading || showPreviewControls}
                            />
                            <span>Summary</span>
                          </label>
                        )}
                      </>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => setShowPreviewControls((prev) => !prev)}
                    title={showPreviewControls ? "Hide controls" : "Show controls"}
                    aria-label={showPreviewControls ? "Hide controls" : "Show controls"}
                    className={`rounded-full border p-2 transition ${
                      showPreviewControls
                        ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-white shadow-sm"
                        : "border-black/10 text-zinc-600 hover:border-black/20"
                    }`}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleExportBookPdf(bookPreviewArtifact.book_id, bookPreviewArtifact.book_name, {
                        respectCurrentPreviewScope: true,
                      });
                    }}
                    disabled={showPreviewControls}
                    title="Download PDF"
                    aria-label="Download PDF"
                    className="rounded-full border border-black/10 p-2 text-zinc-600 transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleClosePreview}
                    disabled={showPreviewControls}
                    title="Close preview"
                    aria-label="Close preview"
                    className="rounded-full p-1 text-zinc-400 transition hover:bg-black/5 hover:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X className="h-6 w-6 sm:h-7 sm:w-7" />
                  </button>
                </div>
              </div>

              {showPreviewControls && (
                <div className="border-b border-black/10 bg-[color:var(--paper)] px-3 py-2 sm:px-4 sm:py-2.5">
                  <div className="w-full rounded-lg border border-black/10 bg-white/90 p-2.5">
                    <div className="mb-2 flex items-center gap-2 border-b border-black/10 pb-2">
                      <button
                        type="button"
                        onClick={() => setPreviewControlsTab("content")}
                        className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] transition ${
                          previewControlsTab === "content"
                            ? "bg-[color:var(--accent)] text-white"
                            : "border border-black/10 bg-white text-zinc-600 hover:border-black/20"
                        }`}
                      >
                        Content
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewControlsTab("translations")}
                        className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] transition ${
                          previewControlsTab === "translations"
                            ? "bg-[color:var(--accent)] text-white"
                            : "border border-black/10 bg-white text-zinc-600 hover:border-black/20"
                        }`}
                      >
                        Translations & Commentaries
                      </button>
                    </div>

                    {/* Scrollable options area — capped on mobile so Apply is never buried */}
                    <div className="max-h-[40vh] space-y-2 overflow-y-auto sm:max-h-none">
                      {previewControlsTab === "content" && (
                        <>
                          <div>
                            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Preview Options</div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-zinc-700">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={showPreviewTitles}
                                  onChange={(event) => setShowPreviewTitles(event.target.checked)}
                                  disabled={bookPreviewLoading}
                                />
                                Show titles
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={showPreviewLabels}
                                  onChange={(event) => setShowPreviewLabels(event.target.checked)}
                                  disabled={bookPreviewLoading}
                                />
                                Show labels
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={showPreviewLevelNumbers}
                                  onChange={(event) => setShowPreviewLevelNumbers(event.target.checked)}
                                  disabled={bookPreviewLoading}
                                />
                                Show level numbers
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={showPreviewDetails}
                                  onChange={(event) => setShowPreviewDetails(event.target.checked)}
                                  disabled={bookPreviewLoading}
                                />
                                Show template details
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={showPreviewMedia}
                                  onChange={(event) => setShowPreviewMedia(event.target.checked)}
                                  disabled={bookPreviewLoading}
                                />
                                Show multimedia
                              </label>
                              <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-500">
                                Word meanings
                                <select
                                  value={previewWordMeaningsDisplayMode}
                                  onChange={(event) =>
                                    setPreviewWordMeaningsDisplayMode(
                                      normalizePreviewWordMeaningsDisplayMode(event.target.value)
                                    )
                                  }
                                  disabled={bookPreviewLoading}
                                  className="rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-xs normal-case tracking-normal text-zinc-700 outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <option value="hide">Hide</option>
                                  <option value="inline">Inline</option>
                                  <option value="table">Table</option>
                                </select>
                              </label>
                            </div>
                          </div>

                          <div className="rounded-lg border border-black/10 bg-white/70 px-2 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs uppercase tracking-[0.14em] text-zinc-600">
                                Reader Font Size
                              </span>
                              <span className="text-xs font-semibold text-zinc-700">{previewFontSizePercent}%</span>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewFontSizePercent((prev) =>
                                    normalizePreviewFontSizePercent(prev - PREVIEW_FONT_SIZE_PERCENT_STEP)
                                  )
                                }
                                disabled={bookPreviewLoading}
                                className="min-h-9 min-w-9 rounded-lg border border-black/10 bg-white px-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
                                aria-label="Decrease reader font size"
                              >
                                A-
                              </button>
                              <input
                                type="range"
                                min={PREVIEW_FONT_SIZE_PERCENT_MIN}
                                max={PREVIEW_FONT_SIZE_PERCENT_MAX}
                                step={PREVIEW_FONT_SIZE_PERCENT_STEP}
                                value={previewFontSizePercent}
                                onChange={(event) =>
                                  setPreviewFontSizePercent(
                                    normalizePreviewFontSizePercent(event.target.value)
                                  )
                                }
                                disabled={bookPreviewLoading}
                                className="h-9 w-full"
                                aria-label="Reader font size"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewFontSizePercent((prev) =>
                                    normalizePreviewFontSizePercent(prev + PREVIEW_FONT_SIZE_PERCENT_STEP)
                                  )
                                }
                                disabled={bookPreviewLoading}
                                className="min-h-9 min-w-9 rounded-lg border border-black/10 bg-white px-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
                                aria-label="Increase reader font size"
                              >
                                A+
                              </button>
                            </div>
                          </div>

                          {availablePreviewLevels.length > 1 && (
                            <div>
                              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Show Levels</div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-zinc-700">
                                {availablePreviewLevels.map((level) => (
                                  <label key={`preview-level-${level}`} className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={!hiddenPreviewLevels.has(level)}
                                      onChange={(event) => {
                                        setHiddenPreviewLevels((prev) => {
                                          const next = new Set(prev);
                                          if (event.target.checked) {
                                            next.delete(level);
                                          } else {
                                            next.add(level);
                                          }
                                          return next;
                                        });
                                      }}
                                      disabled={bookPreviewLoading}
                                    />
                                    {getDisplayLevelName(level)}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {previewControlsTab === "translations" && (
                        <div>
                          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Preview Languages</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-zinc-700">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={bookPreviewLanguageSettings.show_sanskrit}
                                onChange={(event) =>
                                  setBookPreviewLanguageSettings((prev) => ({
                                    ...prev,
                                    show_sanskrit: event.target.checked,
                                  }))
                                }
                                disabled={bookPreviewLoading}
                              />
                              Sanskrit
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={bookPreviewLanguageSettings.show_transliteration}
                                onChange={(event) =>
                                  setBookPreviewLanguageSettings((prev) => ({
                                    ...prev,
                                    show_transliteration: event.target.checked,
                                  }))
                                }
                                disabled={bookPreviewLoading}
                              />
                              Transliteration
                            </label>
                            <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-500">
                              Script
                              <select
                                value={previewTransliterationScript}
                                onChange={(event) =>
                                  setBookPreviewTransliterationScript(
                                    normalizeTransliterationScript(event.target.value)
                                  )
                                }
                                disabled={bookPreviewLoading || !bookPreviewLanguageSettings.show_transliteration}
                                className="rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-xs normal-case tracking-normal text-zinc-700 outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {TRANSLITERATION_SCRIPT_OPTIONS.map((scriptOption) => (
                                  <option key={scriptOption} value={scriptOption}>
                                    {transliterationScriptLabel(scriptOption)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={bookPreviewLanguageSettings.show_english}
                                onChange={(event) =>
                                  setBookPreviewLanguageSettings((prev) => ({
                                    ...prev,
                                    show_english: event.target.checked,
                                  }))
                                }
                                disabled={bookPreviewLoading}
                              />
                              Translations
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={bookPreviewLanguageSettings.show_commentary}
                                onChange={(event) =>
                                  setBookPreviewLanguageSettings((prev) => ({
                                    ...prev,
                                    show_commentary: event.target.checked,
                                  }))
                                }
                                disabled={bookPreviewLoading}
                              />
                              Commentaries
                            </label>
                            <details className="rounded-lg border border-black/10 bg-white/70 px-2 py-1.5">
                              <summary className="cursor-pointer list-none text-xs uppercase tracking-[0.14em] text-zinc-600">
                                Languages ({previewTranslationLanguages.length} selected)
                              </summary>
                              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-700 sm:grid-cols-3">
                                {EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                                  <label key={`preview-translation-${language}`} className="flex items-center gap-1.5">
                                    <input
                                      type="checkbox"
                                      checked={previewTranslationLanguages.includes(language)}
                                      onChange={(event) => {
                                        const nextValues = event.target.checked
                                          ? [...previewTranslationLanguages, language]
                                          : previewTranslationLanguages.filter((value) => value !== language);
                                        setPreviewTranslationLanguages(
                                          normalizeSelectedEditableTranslationLanguages(nextValues, sourceLanguage)
                                        );
                                      }}
                                      disabled={bookPreviewLoading}
                                    />
                                    {translationLanguageLabel(language)}
                                  </label>
                                ))}
                              </div>
                            </details>
                            {availableVariantAuthors.size > 0 && (
                              <details className="rounded-lg border border-black/10 bg-white/70 px-2 py-1.5">
                                <summary className="cursor-pointer list-none text-xs uppercase tracking-[0.14em] text-zinc-600">
                                  Authors ({previewVariantAuthorSlugs.length === 0 ? "all" : `${previewVariantAuthorSlugs.length} selected`})
                                </summary>
                                <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-zinc-700">
                                  {Array.from(availableVariantAuthors.entries()).map(([slug, name]) => {
                                    const allSlugs = Array.from(availableVariantAuthors.keys());
                                    const isChecked = previewVariantAuthorSlugs.length === 0 || previewVariantAuthorSlugs.includes(slug);
                                    return (
                                      <label key={`author-filter-${slug}`} className="flex items-center gap-1.5">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(event) => {
                                            setPreviewVariantAuthorSlugs((prev) => {
                                              const currentSet = new Set(prev.length === 0 ? allSlugs : prev);
                                              if (event.target.checked) {
                                                currentSet.add(slug);
                                              } else {
                                                currentSet.delete(slug);
                                              }
                                              // Empty array means "all selected"
                                              if (currentSet.size >= allSlugs.length) return [];
                                              return Array.from(currentSet);
                                            });
                                          }}
                                          disabled={bookPreviewLoading}
                                        />
                                        {name}
                                        <span className="text-zinc-400">({slug})</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </details>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Apply button — always visible outside the scrollable area */}
                    <div className="mt-2.5 flex justify-end border-t border-black/[0.06] pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          const currentScope =
                            bookPreviewArtifact.preview_scope === "node" ? "node" : "book";
                          void handlePreviewBook(currentScope);
                        }}
                        disabled={
                          bookPreviewLoading || !anyPreviewLanguageVisible || !hasPendingPreviewSettingChanges
                        }
                        className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {bookPreviewLoading ? "Applying..." : "Apply"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div
                ref={bookPreviewScrollContainerRef}
                onScroll={handleBookPreviewScroll}
                className="flex-1 w-full overflow-y-auto px-4 pb-4 pt-2 sm:px-6"
              >
                {previewLinkMessage && (
                  <div className="mb-2 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-xs text-zinc-700">
                    {previewLinkMessage}
                  </div>
                )}
                {bookPreviewLoading && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-700">
                    <span
                      aria-hidden
                      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
                    />
                    <span>{previewLoadingMessageWithElapsed}</span>
                  </div>
                )}

                {bookPreviewArtifact.warnings && bookPreviewArtifact.warnings.length > 0 && (
                  <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    {bookPreviewArtifact.warnings.join(" ")}
                  </div>
                )}

                {showPreviewBookSummary && hasEffectiveBookPreviewSummary && (
                  <div className="mb-2 rounded-lg border border-black/10 bg-[color:var(--paper)] p-3">
                    <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-700" style={previewBodyTextStyle}>
                      {bookPreviewArtifact.book_template?.rendered_text?.trim() || ""}
                    </p>
                  </div>
                )}

                {appliedShowPreviewDetails && bookPreviewArtifact.book_template && (
                  <div className="mb-2 rounded-lg border border-black/10 bg-white/90 p-2.5">
                    <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      {bookPreviewArtifact.preview_scope === "node" ? "Level Template" : "Book Template"}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--deep)]">
                      {bookPreviewArtifact.book_template.template_key}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Children rendered: {bookPreviewArtifact.book_template.child_count}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700" style={previewBodyTextStyle}>
                      {bookPreviewArtifact.book_template.rendered_text ||
                        (bookPreviewArtifact.preview_scope === "node"
                          ? "No rendered level summary."
                          : "No rendered book-level summary.")}
                    </p>
                  </div>
                )}

                {bookPreviewArtifact.preview_scope === "book" && appliedShowPreviewMedia && (bookPreviewArtifact.book_media_items || []).length > 0 && (
                  <div className="mb-2 rounded-lg border border-black/10 bg-white/90 p-2.5">
                    <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Book Multimedia</div>
                    <div className="mt-2 flex flex-col gap-3">
                      {(bookPreviewArtifact.book_media_items || []).map((media, index) => {
                        const label = getBookMediaLabel(media);
                        const mediaType = (media.media_type || "link").trim().toLowerCase();
                        return (
                          <div
                            key={`${mediaType}:${media.url}:${media.asset_id || index}`}
                            className="rounded-lg border border-black/10 bg-zinc-50/40 p-2.5"
                          >
                            {renderInlineMediaPreview(mediaType, media.url, label)}
                            <div className="mt-2 text-xs text-zinc-500">{label}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {previewBodyBlockElements.length === 0 ? (
                    <p className="rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-sm text-zinc-500">
                      {bookPreviewArtifact.preview_scope === "node"
                        ? "No previewable content found under this level."
                        : "No previewable content found for this book."}
                    </p>
                  ) : (
                    previewBodyBlockElements
                  )}

                  {(bookPreviewLoadingMore || (bookPreviewArtifact.preview_scope === "book" && bookPreviewArtifact.has_more)) && (
                    <div className="py-3 text-center text-xs text-zinc-500">
                      {bookPreviewLoadingMore ? "Loading more…" : "Scroll to load more"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <UserPreferencesDialog
          open={showPreferencesDialog}
          onClose={() => setShowPreferencesDialog(false)}
          preferences={preferences}
          onChange={(next) => setPreferences(next)}
          onSave={savePreferences}
          saving={preferencesSaving}
          message={preferencesMessage}
        />

        {/* Share Manager Modal */}
        {showShareManager && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3">
            <div className="w-full max-w-2xl rounded-3xl bg-[color:var(--paper)] p-4 shadow-2xl sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                  Manage Book Shares
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowShareManager(false);
                    setSharesError(null);
                  }}
                  className="text-2xl text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateShare} className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="sm:col-span-2 flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Invite user email</span>
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={(event) => setShareEmail(event.target.value)}
                    required
                    className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    placeholder="user@example.com"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Permission</span>
                  <select
                    value={sharePermission}
                    onChange={(event) =>
                      setSharePermission(event.target.value as SharePermission)
                    }
                    className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="contributor">Contributor</option>
                    <option value="editor">Editor</option>
                  </select>
                </label>
                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    disabled={sharesSubmitting}
                    className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
                  >
                    {sharesSubmitting ? "Adding..." : "Add Share"}
                  </button>
                </div>
              </form>

              {sharesError && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {sharesError}
                </div>
              )}

              <div className="max-h-[45dvh] overflow-y-auto rounded-2xl border border-black/10">
                {sharesLoading ? (
                  <div className="p-4 text-sm text-zinc-600">Loading shares...</div>
                ) : bookShares.length === 0 ? (
                  <div className="p-4 text-sm text-zinc-500">No shared users yet.</div>
                ) : (
                  <div className="divide-y divide-black/10">
                    {bookShares.map((share) => (
                      <div key={share.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-[color:var(--deep)]">
                            {share.shared_with_email}
                          </p>
                          {share.shared_with_username && (
                            <p className="text-xs text-zinc-500">{share.shared_with_username}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={share.permission}
                            onChange={(event) =>
                              void handleUpdateSharePermission(
                                share.shared_with_user_id,
                                event.target.value as SharePermission
                              )
                            }
                            disabled={shareUpdatingUserId === share.shared_with_user_id}
                            className="rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-xs uppercase tracking-[0.15em] outline-none focus:border-[color:var(--accent)] disabled:opacity-50"
                          >
                            <option value="viewer">Viewer</option>
                            <option value="contributor">Contributor</option>
                            <option value="editor">Editor</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              void handleDeleteShare(share.shared_with_user_id);
                            }}
                            disabled={shareRemovingUserId === share.shared_with_user_id}
                            className="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs uppercase tracking-[0.15em] text-red-700 transition hover:border-red-400 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Create Book Modal */}
        {showCreateBook && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-3 sm:items-center">
            <div className="my-3 flex max-h-[calc(100svh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-[color:var(--paper)] p-4 shadow-2xl sm:my-6 sm:max-h-[calc(100svh-3rem)] sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                  Create New Book
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateBook(false);
                    setSelectedSchema(null);
                    setCreateBookStep("schema");
                    setBookFormData({
                      bookName: "",
                      titleTransliteration: "",
                      titleEnglish: "",
                      author: "",
                      bookCode: "",
                      languagePrimary: "sanskrit",
                    });
                  }}
                  className="rounded-md border border-black/10 px-2.5 py-1 text-sm text-zinc-700"
                >
                  X
                </button>
              </div>

              {createBookStep === "schema" ? (
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                  <p className="text-sm text-zinc-600">
                    Select a schema that defines the structure of your scripture:
                  </p>
                  <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    <div className="grid gap-3">
                      {schemas.map((schema) => {
                        const isSelected = selectedSchema === schema.id;
                        return (
                          <button
                            key={schema.id}
                            type="button"
                            onClick={() => setSelectedSchema(schema.id)}
                            className={`rounded-2xl border bg-white/90 p-4 text-left transition hover:border-[color:var(--accent)] hover:shadow-md ${
                              isSelected
                                ? "border-[color:var(--accent)] ring-1 ring-[color:var(--accent)]/40"
                                : "border-black/10"
                            }`}
                          >
                            <div className="font-semibold text-[color:var(--deep)]">
                              {schema.name}
                            </div>
                            {schema.description && (
                              <div className="mt-1 text-xs text-zinc-600">
                                {schema.description}
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap gap-2">
                              {schema.levels.map((level, idx) => (
                                <span
                                  key={idx}
                                  className="rounded-full border border-black/10 bg-white/80 px-2 py-1 text-xs text-zinc-600"
                                >
                                  {level}
                                </span>
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {schemas.length === 0 && (
                      <p className="text-sm text-zinc-500">No schemas available</p>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-black/10 pt-3">
                    <button
                      type="button"
                      onClick={() => setCreateBookStep("details")}
                      disabled={!selectedSchema}
                      className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleCreateBook} className="flex min-h-0 flex-1 flex-col">
                  <div className="flex-1 space-y-4 overflow-y-auto pr-1">
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-blue-700">
                      Selected Schema
                    </div>
                    <div className="mt-1 font-semibold text-blue-900">
                      {schemas.find((s) => s.id === selectedSchema)?.name}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Title (Primary) *
                    </label>
                    <input
                      type="text"
                      value={bookFormData.bookName}
                      onChange={(e) =>
                        setBookFormData({ ...bookFormData, bookName: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-base outline-none focus:border-[color:var(--accent)] sm:text-sm"
                      placeholder="e.g., Bhagavad Gita"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Title (Transliteration)
                    </label>
                    <input
                      type="text"
                      value={bookFormData.titleTransliteration}
                      onChange={(e) =>
                        setBookFormData({ ...bookFormData, titleTransliteration: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-base outline-none focus:border-[color:var(--accent)] sm:text-sm"
                      placeholder="e.g., Bhagavad Gītā"
                    />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Title (English)
                    </label>
                    <input
                      type="text"
                      value={bookFormData.titleEnglish}
                      onChange={(e) =>
                        setBookFormData({ ...bookFormData, titleEnglish: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-base outline-none focus:border-[color:var(--accent)] sm:text-sm"
                      placeholder="e.g., Song of the Lord"
                    />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Author
                    </label>
                    <input
                      type="text"
                      value={bookFormData.author}
                      onChange={(e) =>
                        setBookFormData({ ...bookFormData, author: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-base outline-none focus:border-[color:var(--accent)] sm:text-sm"
                      placeholder="e.g., Vedavyasa"
                    />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Book Code
                    </label>
                    <input
                      type="text"
                      value={bookFormData.bookCode}
                      onChange={(e) =>
                        setBookFormData({ ...bookFormData, bookCode: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-base outline-none focus:border-[color:var(--accent)] sm:text-sm"
                      placeholder="e.g., GITA_V1"
                    />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Primary Language
                    </label>
                    <select
                      value={bookFormData.languagePrimary}
                      onChange={(e) =>
                        setBookFormData({ ...bookFormData, languagePrimary: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-base outline-none focus:border-[color:var(--accent)] sm:text-sm"
                    >
                      <option value="sanskrit">Sanskrit</option>
                      <option value="english">English</option>
                    </select>
                  </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-black/10 pt-3">
                    <button
                      type="button"
                      onClick={() => setCreateBookStep("schema")}
                      className="rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-600 transition hover:border-black/20"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={bookSubmitting}
                      className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 font-medium text-white transition disabled:opacity-50"
                    >
                      {bookSubmitting ? "Creating..." : "Create Book"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Action Modal */}
        {action && actionNode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3 overflow-y-auto">
            <div className="my-6 flex max-h-[calc(100svh-3rem)] w-full max-w-2xl flex-col rounded-3xl bg-[color:var(--paper)] shadow-2xl">
              <div className="flex-shrink-0 border-b border-black/10 p-4 pb-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    {action === "add" 
                      ? `Add ${getDisplayLevelName(formData.levelName) || "New Node"}` 
                      : `Edit ${getDisplayLevelName(formatValue(formData.levelName || actionNode?.level_name)) || "Node"}`}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setAction(null);
                      setActionNode(null);
                      setCreateParentNodeIdOverride(null);
                      setCreateInsertAfterNodeId(null);
                      setActionMessage(null);
                    }}
                    className="rounded-md border border-black/10 px-2.5 py-1 text-sm text-zinc-700"
                  >
                    X
                  </button>
                </div>
              </div>

              <form onSubmit={handleModalSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Level Name
                      {action === "add" && <span className="ml-1 text-[10px]">(from schema)</span>}
                    </label>
                    {action === "add" ? (
                      <input
                        type="text"
                        value={getDisplayLevelName(formData.levelName)}
                        className="mt-1 w-full rounded-lg border border-black/10 bg-gray-100 px-3 py-2 text-sm text-gray-700 cursor-not-allowed outline-none"
                        placeholder="e.g., Kanda, Sarga, Shloka"
                        required
                        readOnly
                      />
                    ) : (
                      <select
                        value={formData.levelName}
                        onChange={(e) =>
                          setFormData({ ...formData, levelName: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                        required
                      >
                        <option value="">Select level</option>
                        {currentBook?.schema?.levels?.map((level) => (
                          <option key={level} value={level}>
                            {getDisplayLevelName(level)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Sequence Number
                    </label>
                    <input
                      type="number"
                      value={formData.sequenceNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, sequenceNumber: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder="Auto-calculated if empty"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Title (English)
                  </label>
                  <div className="group relative mt-1">
                    <input
                      type="text"
                      value={formData.titleEnglish}
                      onChange={(e) =>
                        setFormData({ ...formData, titleEnglish: e.target.value })
                      }
                      className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder="English title"
                    />
                    <InlineClearButton
                      visible={Boolean(formData.titleEnglish)}
                      onClear={() => setFormData((prev) => ({ ...prev, titleEnglish: "" }))}
                      ariaLabel="Clear title English"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Title (Sanskrit)
                    </label>
                    <div className="group relative mt-1">
                      <input
                        type="text"
                        value={formData.titleSanskrit}
                        onChange={(e) =>
                          setFormData({ ...formData, titleSanskrit: e.target.value })
                        }
                        className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                        placeholder="Sanskrit title"
                      />
                      <InlineClearButton
                        visible={Boolean(formData.titleSanskrit)}
                        onClear={() => setFormData((prev) => ({ ...prev, titleSanskrit: "" }))}
                        ariaLabel="Clear title Sanskrit"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Title (Transliteration)
                    </label>
                    <div className="group relative mt-1">
                      <input
                        type="text"
                        value={formData.titleTransliteration}
                        onChange={(e) =>
                          setFormData({ ...formData, titleTransliteration: e.target.value })
                        }
                        className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                        placeholder="Transliteration"
                      />
                      <InlineClearButton
                        visible={Boolean(formData.titleTransliteration)}
                        onClear={() =>
                          setFormData((prev) => ({ ...prev, titleTransliteration: "" }))
                        }
                        ariaLabel="Clear title transliteration"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.hasContent}
                      onChange={(e) =>
                        setFormData({ ...formData, hasContent: e.target.checked })
                      }
                      className="rounded border-black/10"
                    />
                    <span className="text-sm text-zinc-600">Add content now</span>
                  </label>
                </div>

                {formData.hasContent && (
                  <div className="flex flex-col gap-3 rounded-lg border border-black/10 bg-blue-50/30 p-3">
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        {contentFieldLabels.sanskrit || DEFAULT_CONTENT_FIELD_LABELS.sanskrit}
                      </label>
                      <div className="group relative mt-1">
                        <textarea
                          value={formData.contentSanskrit}
                          onChange={(e) =>
                            setFormData({ ...formData, contentSanskrit: e.target.value })
                          }
                          className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                          placeholder={contentFieldLabels.sanskrit || DEFAULT_CONTENT_FIELD_LABELS.sanskrit}
                          rows={3}
                        />
                        <InlineClearButton
                          visible={Boolean(formData.contentSanskrit)}
                          onClear={() => setFormData((prev) => ({ ...prev, contentSanskrit: "" }))}
                          ariaLabel="Clear content Sanskrit"
                          position="top"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        {contentFieldLabels.transliteration || DEFAULT_CONTENT_FIELD_LABELS.transliteration}
                      </label>
                      <div className="group relative mt-1">
                        <textarea
                          value={formData.contentTransliteration}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              contentTransliteration: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                          placeholder={contentFieldLabels.transliteration || DEFAULT_CONTENT_FIELD_LABELS.transliteration}
                          rows={3}
                        />
                        <InlineClearButton
                          visible={Boolean(formData.contentTransliteration)}
                          onClear={() =>
                            setFormData((prev) => ({ ...prev, contentTransliteration: "" }))
                          }
                          ariaLabel="Clear content transliteration"
                          position="top"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Translations</label>
                      <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white/70 px-2 py-1.5">
                        {EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                          <label key={`modal-translation-select-${language}`} className="flex items-center gap-1.5 text-xs text-zinc-700">
                            <input
                              type="checkbox"
                              checked={modalSelectedTranslationLanguages.includes(language)}
                              onChange={(event) => {
                                const nextValues = event.target.checked
                                  ? [...modalSelectedTranslationLanguages, language]
                                  : modalSelectedTranslationLanguages.filter((value) => value !== language);
                                setModalSelectedTranslationLanguages(
                                  normalizeSelectedEditableTranslationLanguages(nextValues, sourceLanguage)
                                );
                              }}
                            />
                            {translationLanguageLabel(language)}
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-col gap-2">
                        {modalSelectedTranslationLanguages.map((language) => (
                          <div key={`modal-translation-input-${language}`}>
                            <label className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                              {translationLanguageLabel(language)} Translation
                            </label>
                            <div className="group relative mt-1">
                              <textarea
                                value={modalTranslationDrafts[language] || ""}
                                onChange={(e) =>
                                  setModalTranslationDrafts((prev) => ({
                                    ...prev,
                                    [language]: e.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                                rows={3}
                              />
                              <InlineClearButton
                                visible={Boolean((modalTranslationDrafts[language] || "").trim())}
                                onClear={() =>
                                  setModalTranslationDrafts((prev) => ({
                                    ...prev,
                                    [language]: "",
                                  }))
                                }
                                ariaLabel={`Clear ${translationLanguageLabel(language)} translation`}
                                position="top"
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      <details className="mt-2 rounded-lg border border-black/10 bg-white/70 p-2">
                        <summary className="cursor-pointer text-xs uppercase tracking-[0.16em] text-zinc-600">
                          Translation Variants By Author ({modalTranslationVariants.length})
                        </summary>
                        <div className="mt-2 flex flex-col gap-2">
                          {modalTranslationVariants.map((entry, index) => (
                            <div key={`modal-translation-variant-${index}`} className="rounded-lg border border-black/10 bg-white p-2">
                              <label className="mb-2 flex flex-col gap-1">
                                <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Author</span>
                                <select
                                  value={entry.author_slug}
                                  onChange={(event) =>
                                    setModalTranslationVariants((prev) =>
                                      prev.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? applyVariantAuthorSelection(item, event.target.value, currentBook)
                                          : item
                                      )
                                    )
                                  }
                                  disabled={getVariantAuthorOptions(currentBook, entry).length === 0}
                                  className="w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                                >
                                  <option value="">
                                    {getVariantAuthorOptions(currentBook, entry).length > 0
                                      ? "Select author"
                                      : "No authors in registry"}
                                  </option>
                                  {getVariantAuthorOptions(currentBook, entry).map((option) => (
                                    <option key={option.slug} value={option.slug}>{option.name}</option>
                                  ))}
                                </select>
                              </label>
                              <div>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Language</span>
                                  <select
                                    value={entry.language}
                                    onChange={(event) =>
                                      setModalTranslationVariants((prev) =>
                                        prev.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? applyVariantLanguageSelection(item, event.target.value, "translation")
                                            : item
                                        )
                                      )
                                    }
                                    className="rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                                  >
                                    <option value="">Select language</option>
                                    {SORTED_EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                                      <option key={language} value={language}>{translationLanguageLabel(language)}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                              <textarea
                                value={entry.text}
                                onChange={(event) =>
                                  setModalTranslationVariants((prev) =>
                                    prev.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, text: event.target.value }
                                        : item
                                    )
                                  )
                                }
                                placeholder="Variant translation text"
                                rows={3}
                                className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                              />
                              <div className="mt-2 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setModalTranslationVariants((prev) =>
                                      prev.filter((_, itemIndex) => itemIndex !== index)
                                    )
                                  }
                                  className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs uppercase tracking-[0.14em] text-red-700"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setModalTranslationVariants((prev) => [
                                ...prev,
                                buildEmptyAuthorVariantDraft(),
                              ])
                            }
                            className="self-start rounded-lg border border-black/10 bg-white px-2 py-1 text-xs uppercase tracking-[0.14em] text-zinc-700"
                          >
                            Add Translation Variant
                          </button>
                        </div>
                      </details>

                      <details className="mt-2 rounded-lg border border-black/10 bg-white/70 p-2">
                        <summary className="cursor-pointer text-xs uppercase tracking-[0.16em] text-zinc-600">
                          Commentary Variants By Author ({modalCommentaryVariants.length})
                        </summary>
                        <div className="mt-2 flex flex-col gap-2">
                          {modalCommentaryVariants.map((entry, index) => (
                            <div key={`modal-commentary-variant-${index}`} className="rounded-lg border border-black/10 bg-white p-2">
                              <label className="mb-2 flex flex-col gap-1">
                                <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Author</span>
                                <select
                                  value={entry.author_slug}
                                  onChange={(event) =>
                                    setModalCommentaryVariants((prev) =>
                                      prev.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? applyVariantAuthorSelection(item, event.target.value, currentBook)
                                          : item
                                      )
                                    )
                                  }
                                  disabled={getVariantAuthorOptions(currentBook, entry).length === 0}
                                  className="w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                                >
                                  <option value="">
                                    {getVariantAuthorOptions(currentBook, entry).length > 0
                                      ? "Select author"
                                      : "No authors in registry"}
                                  </option>
                                  {getVariantAuthorOptions(currentBook, entry).map((option) => (
                                    <option key={option.slug} value={option.slug}>{option.name}</option>
                                  ))}
                                </select>
                              </label>
                              <div>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Language</span>
                                  <select
                                    value={entry.language}
                                    onChange={(event) =>
                                      setModalCommentaryVariants((prev) =>
                                        prev.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? applyVariantLanguageSelection(item, event.target.value, "commentary")
                                            : item
                                        )
                                      )
                                    }
                                    className="rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                                  >
                                    <option value="">Select language</option>
                                    {SORTED_EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                                      <option key={language} value={language}>{translationLanguageLabel(language)}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                              <textarea
                                value={entry.text}
                                onChange={(event) =>
                                  setModalCommentaryVariants((prev) =>
                                    prev.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, text: event.target.value }
                                        : item
                                    )
                                  )
                                }
                                placeholder="Variant commentary text"
                                rows={3}
                                className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                              />
                              <div className="mt-2 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setModalCommentaryVariants((prev) =>
                                      prev.filter((_, itemIndex) => itemIndex !== index)
                                    )
                                  }
                                  className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs uppercase tracking-[0.14em] text-red-700"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setModalCommentaryVariants((prev) => [
                                ...prev,
                                buildEmptyAuthorVariantDraft(),
                              ])
                            }
                            className="self-start rounded-lg border border-black/10 bg-white px-2 py-1 text-xs uppercase tracking-[0.14em] text-zinc-700"
                          >
                            Add Commentary Variant
                          </button>
                        </div>
                      </details>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Tags (comma-separated)
                      </label>
                      <div className="group relative mt-1">
                        <input
                          type="text"
                          value={formData.tags}
                          onChange={(e) =>
                            setFormData({ ...formData, tags: e.target.value })
                          }
                          className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                          placeholder="tag1, tag2, tag3"
                        />
                        <InlineClearButton
                          visible={Boolean(formData.tags)}
                          onClear={() => setFormData((prev) => ({ ...prev, tags: "" }))}
                          ariaLabel="Clear tags"
                        />
                      </div>
                    </div>

                    {modalWordMeaningsEnabled && (
                      <WordMeaningsEditor
                        rows={formData.wordMeanings}
                        validationErrors={modalWordMeaningValidationErrors}
                        missingRequired={modalWordMeaningsMissingRequired}
                        requiredLanguage={WORD_MEANINGS_REQUIRED_LANGUAGE}
                        allowedMeaningLanguages={WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES}
                        onAddRow={handleAddModalWordMeaningRow}
                        onImportSemicolonSeparated={handleImportModalWordMeanings}
                        onMoveRow={handleMoveModalWordMeaningRow}
                        onRemoveRow={handleRemoveModalWordMeaningRow}
                        onSourceFieldChange={handleModalWordMeaningChange}
                        onSelectMeaningLanguage={handleSelectModalMeaningLanguage}
                        onMeaningTextChange={handleModalMeaningTextChange}
                      />
                    )}
                  </div>
                )}
                </div>

                <div className="sticky bottom-0 z-10 flex-shrink-0 border-t border-black/10 bg-[color:var(--paper)] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
                  {actionMessage && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {actionMessage}
                    </div>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    {action === "add" ? (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={createNextOnSubmit}
                          onChange={(e) => setCreateNextOnSubmit(e.target.checked)}
                          className="rounded border-black/10"
                        />
                        <span className="text-sm text-zinc-600">Create next after save</span>
                      </label>
                    ) : null}
                    <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAction(null);
                        setActionNode(null);
                        setCreateParentNodeIdOverride(null);
                        setCreateInsertAfterNodeId(null);
                        setActionMessage(null);
                      }}
                      className="rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-600 transition hover:border-black/20"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || modalWordMeaningValidationErrors.length > 0}
                      className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 font-medium text-white transition disabled:opacity-50"
                    >
                      {submitting ? "Submitting..." : action === "add" ? "Create" : "Save"}
                    </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* Floating Basket Panel */}
      {authEmail ? (
        <BasketPanel
          items={basketItems.map(item => ({
            node_id: item.node_id,
            order: item.order,
            title: item.title,
            book_name: item.book_name,
            level_name: item.level_name,
          }))}
          onRemoveItem={removeFromBasket}
          onMoveItem={moveBasketItem}
          reorderLoading={isReorderingBasket}
          onClearBasket={clearBasket}
          onItemsAdded={() => {
            if (bookId) {
              void loadTree(bookId);
            }
          }}
        />
      ) : null}
    </div>
  );
}

export default function ScripturesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ScripturesContent />
    </Suspense>
  );
}
