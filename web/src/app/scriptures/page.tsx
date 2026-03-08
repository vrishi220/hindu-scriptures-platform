"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  ChevronsDown,
  ChevronsUp,
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
  type ExternalMediaType,
} from "../../lib/externalMedia";
import {
  createMediaBankLinkAsset as createMediaBankLinkAssetRequest,
  deleteMediaBankAsset,
  listMediaBankAssets,
  MediaBankClientError,
  renameMediaBankAsset,
  uploadMediaBankAsset,
} from "../../lib/mediaBankClient";
import { resolveMediaUrl } from "../../lib/mediaUrl";

type BookOption = {
  id: number;
  book_name: string;
  schema_id?: number | null;
  status?: "draft" | "published";
  visibility?: "private" | "public";
  metadata_json?: {
    owner_id?: number;
    [key: string]: unknown;
  } | null;
  metadata?: {
    owner_id?: number;
    [key: string]: unknown;
  } | null;
};

type BookDetails = {
  id: number;
  book_name: string;
  schema_id: number | null;
  status?: "draft" | "published";
  visibility?: "private" | "public";
  metadata_json?: {
    owner_id?: number;
    status?: "draft" | "published";
    visibility?: "private" | "public";
    [key: string]: unknown;
  } | null;
  metadata?: {
    owner_id?: number;
    status?: "draft" | "published";
    visibility?: "private" | "public";
    [key: string]: unknown;
  } | null;
  schema?: {
    id: number;
    name: string;
    levels: string[];
    level_template_defaults?: Record<string, number>;
  } | null;
};

type SharePermission = "viewer" | "contributor" | "editor";

type BookShare = {
  id: number;
  book_id: number;
  shared_with_user_id: number;
  permission: SharePermission;
  shared_by_user_id: number | null;
  shared_with_email: string;
  shared_with_username: string | null;
};

type SchemaOption = {
  id: number;
  name: string;
  description: string | null;
  levels: string[];
  level_template_defaults?: Record<string, number>;
};

type TreeNode = {
  id: number;
  level_name: string;
  level_order?: number;
  sequence_number?: string | null;
  title_english?: string | null;
  title_hindi?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  children?: TreeNode[];
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

type NodeContent = {
  id: number;
  level_name: string;
  level_order?: number;
  sequence_number?: string | null;
  title_english?: string | null;
  title_hindi?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  has_content: boolean;
  content_data?: {
    basic?: {
      sanskrit?: string;
      transliteration?: string;
      translation?: string;
    };
    translations?: {
      english?: string;
    };
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
            [scheme: string]: string | undefined;
          };
        };
        meanings?: {
          en?: {
            text?: string;
          };
          [language: string]: {
            text?: string;
          } | undefined;
        };
      }>;
    };
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
  metadata_json?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  tags?: string[] | null;
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
    sequence_number?: number | null;
    sanskrit?: string;
    transliteration?: string;
    english?: string;
    text?: string;
    rendered_lines?: Array<{
      field?: string;
      label?: string;
      value?: string;
    }>;
    word_meanings_rows?: Array<{
      id?: string;
      order?: number;
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
  };
};

type BookPreviewRenderSettings = {
  show_sanskrit: boolean;
  show_transliteration: boolean;
  show_english: boolean;
  show_metadata: boolean;
  text_order: Array<"sanskrit" | "transliteration" | "english" | "text">;
};

type BookPreviewLanguageSettings = {
  show_sanskrit: boolean;
  show_transliteration: boolean;
  show_english: boolean;
};

type BookPreviewArtifact = {
  book_id: number;
  book_name: string;
  preview_scope?: "book" | "node";
  root_node_id?: number | null;
  root_title?: string | null;
  section_order: Array<"body">;
  sections: {
    body: BookPreviewBlock[];
  };
  book_template?: {
    template_key: string;
    resolved_template_source: string;
    rendered_text: string;
    child_count: number;
  };
  render_settings: BookPreviewRenderSettings;
  warnings?: string[];
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
const SCRIPTURES_BOOK_BROWSER_VIEW_KEY = "scriptures_book_browser_view";
const SCRIPTURES_BOOK_BROWSER_DENSITY_KEY = "scriptures_book_browser_density";
const SCRIPTURES_MEDIA_MANAGER_VIEW_KEY = "scriptures_media_manager_view";
const SCRIPTURES_MEDIA_MANAGER_DENSITY_KEY = "scriptures_media_manager_density";
const SCRIPTURES_MEDIA_MANAGER_DENSITY_NODE_KEY = "scriptures_media_manager_density_node";
const SCRIPTURES_MEDIA_MANAGER_DENSITY_BOOK_KEY = "scriptures_media_manager_density_book";
const SCRIPTURES_MEDIA_MANAGER_DENSITY_BANK_KEY = "scriptures_media_manager_density_bank";
const DEFAULT_CONTENT_FIELD_LABELS = {
  sanskrit: "Sanskrit",
  transliteration: "Transliteration",
  english: "English",
} as const;

const readStoredBrowserView = (storageKey: string): "list" | "icon" => {
  if (typeof window === "undefined") {
    return "list";
  }
  return window.localStorage.getItem(storageKey) === "icon" ? "icon" : "list";
};

const normalizeBookBrowserDensity = (value: unknown): 0 | 1 | 2 | 3 | 4 => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.min(4, Math.max(0, Math.round(value)));
    return normalized as 0 | 1 | 2 | 3 | 4;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      const normalized = Math.min(4, Math.max(0, Math.round(parsed)));
      return normalized as 0 | 1 | 2 | 3 | 4;
    }
  }
  return 0;
};

const readStoredBookBrowserDensity = (): 0 | 1 | 2 | 3 | 4 => {
  if (typeof window === "undefined") {
    return 0;
  }
  return normalizeBookBrowserDensity(window.localStorage.getItem(SCRIPTURES_BOOK_BROWSER_DENSITY_KEY));
};

const mediaManagerDensityStorageKey = (scope: "node" | "book" | "bank"): string => {
  if (scope === "book") return SCRIPTURES_MEDIA_MANAGER_DENSITY_BOOK_KEY;
  if (scope === "bank") return SCRIPTURES_MEDIA_MANAGER_DENSITY_BANK_KEY;
  return SCRIPTURES_MEDIA_MANAGER_DENSITY_NODE_KEY;
};

const readStoredMediaManagerDensity = (scope: "node" | "book" | "bank"): 0 | 1 | 2 | 3 | 4 => {
  if (typeof window === "undefined") {
    return 0;
  }
  const scopedValue = window.localStorage.getItem(mediaManagerDensityStorageKey(scope));
  if (scopedValue !== null) {
    return normalizeBookBrowserDensity(scopedValue);
  }
  return normalizeBookBrowserDensity(window.localStorage.getItem(SCRIPTURES_MEDIA_MANAGER_DENSITY_KEY));
};

const resolveBookBrowserDensity = (
  storedDensity: 0 | 1 | 2 | 3 | 4,
  preferenceDensity: unknown,
  preferenceView: "list" | "icon"
): 0 | 1 | 2 | 3 | 4 => {
  if (storedDensity !== 0) {
    return storedDensity;
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

const mapWordMeaningsRowsFromContent = (node: NodeContent): WordMeaningRow[] => {
  const rows = node.content_data?.word_meanings?.rows;
  if (!Array.isArray(rows)) {
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
  preview_show_details: false,
  preview_show_sanskrit: true,
  preview_show_transliteration: true,
  preview_show_english: true,
  preview_transliteration_script: "iast",
  ui_theme: "classic",
  ui_density: "comfortable",
  scriptures_book_browser_view: "list",
  scriptures_book_browser_density: 0,
  scriptures_media_manager_view: "list",
  admin_media_bank_browser_view: "list",
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
  preview_show_details: value?.preview_show_details ?? false,
  preview_show_sanskrit: value?.preview_show_sanskrit ?? true,
  preview_show_transliteration: value?.preview_show_transliteration ?? true,
  preview_show_english: value?.preview_show_english ?? true,
  preview_transliteration_script: normalizeTransliterationScript(
    value?.preview_transliteration_script
  ),
  ui_theme: normalizeUiTheme(value?.ui_theme),
  ui_density: normalizeUiDensity(value?.ui_density),
  scriptures_book_browser_view: normalizeBrowserView(value?.scriptures_book_browser_view),
  scriptures_book_browser_density: normalizeBookBrowserDensity(value?.scriptures_book_browser_density),
  scriptures_media_manager_view: normalizeBrowserView(value?.scriptures_media_manager_view),
  admin_media_bank_browser_view: normalizeBrowserView(value?.admin_media_bank_browser_view),
});

const normalizeSourceLanguage = (value?: string | null): "english" | "sanskrit" | "hindi" => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "en" || normalized === "eng" || normalized === "english") {
    return "english";
  }
  if (normalized === "sa" || normalized === "sanskrit") {
    return "sanskrit";
  }
  if (normalized === "hi" || normalized === "hindi") {
    return "hindi";
  }
  return "english";
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
      sanskrit: transliterateFromIast(transliteration, "devanagari"),
      transliteration,
    };
  }

  if (hasDevanagariLetters(sanskrit)) {
    return {
      sanskrit,
      transliteration: transliterateFromDevanagari(sanskrit, "iast"),
    };
  }

  return {
    sanskrit: transliterateFromIast(sanskrit, "devanagari"),
    transliteration: transliterateFromIast(sanskrit, "iast"),
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
  const BOOKS_PAGE_SIZE_BY_DENSITY: Record<1 | 2 | 3 | 4, number> = {
    1: 25,
    2: 16,
    3: 9,
    4: 4,
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
  const [canView, setCanView] = useState(false);
  const [canAdmin, setCanAdmin] = useState(false);
  const [canContribute, setCanContribute] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
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
  const [externalMediaFormOpen, setExternalMediaFormOpen] = useState(false);
  const [externalMediaFormContext, setExternalMediaFormContext] = useState<MediaLinkContext>("bank");
  const [externalMediaFormSubmitting, setExternalMediaFormSubmitting] = useState(false);
  const [bookMediaActionsOpen, setBookMediaActionsOpen] = useState(false);
  const [nodeMediaActionsOpen, setNodeMediaActionsOpen] = useState(false);
  const [mediaManagerSearchQuery, setMediaManagerSearchQuery] = useState("");
  const [mediaManagerTypeFilter, setMediaManagerTypeFilter] = useState("all");
  const [bookBrowserView, setBookBrowserView] = useState<"list" | "icon">("list");
  const [bookBrowserDensity, setBookBrowserDensity] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [bookBrowserDensityHydrated, setBookBrowserDensityHydrated] = useState(false);
  const [showBookBrowserDensityMenu, setShowBookBrowserDensityMenu] = useState(false);
  const [mediaManagerView, setMediaManagerView] = useState<"list" | "icon">("list");
  const [mediaManagerDensity, setMediaManagerDensity] = useState<0 | 1 | 2 | 3 | 4>(0);
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
  const nodeMediaUploadInputRef = useRef<HTMLInputElement | null>(null);
  const bookMediaUploadInputRef = useRef<HTMLInputElement | null>(null);
  const bookThumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const activeNodeCommentaryRequestId = useRef(0);
  const activeNodeCommentaryAbortController = useRef<AbortController | null>(null);
  const activeNodeCommentaryNodeId = useRef<number | null>(null);
  const activeNodeCommentsRequestId = useRef(0);
  const activeNodeCommentsAbortController = useRef<AbortController | null>(null);
  const activeNodeCommentsNodeId = useRef<number | null>(null);
  const pendingSavedNodeId = useRef<number | null>(null);
  const lastHandledPreviewRequestKey = useRef<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"tree" | "content">("content");
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
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateBook, setShowCreateBook] = useState(false);
  const [showBookPreview, setShowBookPreview] = useState(false);
  const [bookThumbnailUploading, setBookThumbnailUploading] = useState(false);
  const [showBrowseBookModal, setShowBrowseBookModal] = useState(false);
  const [bookPreviewLoading, setBookPreviewLoading] = useState(false);
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
    });
  // Track the last applied settings to enable/disable Apply button
  const [appliedBookPreviewLanguageSettings, setAppliedBookPreviewLanguageSettings] =
    useState<BookPreviewLanguageSettings>({
      show_sanskrit: true,
      show_transliteration: true,
      show_english: true,
    });
  const [showPreviewLabels, setShowPreviewLabels] = useState(false);
  const [showPreviewDetails, setShowPreviewDetails] = useState(false);
  const [showPreviewTitles, setShowPreviewTitles] = useState(false);
  // Track the last applied preview options
  const [appliedShowPreviewLabels, setAppliedShowPreviewLabels] = useState(false);
  const [appliedShowPreviewDetails, setAppliedShowPreviewDetails] = useState(false);
  const [appliedShowPreviewTitles, setAppliedShowPreviewTitles] = useState(false);
  const [appliedBookPreviewTransliterationScript, setAppliedBookPreviewTransliterationScript] =
    useState<TransliterationScriptOption>("iast");
  const [showPreviewControls, setShowPreviewControls] = useState(false);
  const [bookPreviewTransliterationScript, setBookPreviewTransliterationScript] =
    useState<TransliterationScriptOption>("iast");
  const [showShareManager, setShowShareManager] = useState(false);
  const [schemas, setSchemas] = useState<SchemaOption[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<number | null>(null);
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
  const bookRowActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const bookBrowserDensityMenuRef = useRef<HTMLDivElement | null>(null);
  const mediaManagerDensityMenuRef = useRef<HTMLDivElement | null>(null);
  const booksScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const booksLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const activeBooksAbortController = useRef<AbortController | null>(null);
  const activeBooksRequestId = useRef(0);
  const bookNextOffsetRef = useRef(0);
  const bookHasMoreRef = useRef(true);
  const bookLoadingRef = useRef(false);
  const bookTreeActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const nodeActionsMenuRef = useRef<HTMLDivElement | null>(null);

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
      if (bookTreeActionsMenuRef.current && !bookTreeActionsMenuRef.current.contains(target)) {
        setShowBookTreeActionsMenu(false);
      }
      if (nodeActionsMenuRef.current && !nodeActionsMenuRef.current.contains(target)) {
        setShowNodeActionsMenu(false);
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
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SCRIPTURES_BOOK_BROWSER_VIEW_KEY, bookBrowserView);
  }, [bookBrowserView]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setBookBrowserDensity(readStoredBookBrowserDensity());
    setBookBrowserDensityHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setMediaManagerDensity(readStoredMediaManagerDensity(mediaManagerScope));
    setMediaManagerDensityHydrated(true);
  }, [mediaManagerScope]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!bookBrowserDensityHydrated) {
      return;
    }
    window.localStorage.setItem(SCRIPTURES_BOOK_BROWSER_DENSITY_KEY, String(bookBrowserDensity));
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
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SCRIPTURES_MEDIA_MANAGER_VIEW_KEY, mediaManagerView);
  }, [mediaManagerView]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!mediaManagerDensityHydrated) {
      return;
    }
    const value = String(mediaManagerDensity);
    window.localStorage.setItem(mediaManagerDensityStorageKey(mediaManagerScope), value);
    window.localStorage.setItem(SCRIPTURES_MEDIA_MANAGER_DENSITY_KEY, value);
  }, [mediaManagerDensity, mediaManagerDensityHydrated, mediaManagerScope]);

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

  const resolvePreviewContentLines = (
    block: BookPreviewBlock,
    settings?: BookPreviewRenderSettings
  ) => {
    const resolvedSettings: BookPreviewRenderSettings =
      settings || {
        show_sanskrit: true,
        show_transliteration: true,
        show_english: true,
        show_metadata: true,
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
            ? renderPreviewTransliteration(rawValue)
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

      if (lines.length > 0) {
        return lines;
      }
    }

    for (const key of resolvedSettings.text_order) {
      const rawValue = (block.content[key] || "").trim();
      const value =
        key === "transliteration"
          ? renderPreviewTransliteration(rawValue)
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
  };

  const resolvePreviewWordMeanings = (block: BookPreviewBlock) => {
    const rows = Array.isArray(block.content.word_meanings_rows)
      ? block.content.word_meanings_rows
      : [];

    return rows
      .map((row, index) => {
        const sourceText = (row?.resolved_source?.text || "").trim();
        const meaningText = (row?.resolved_meaning?.text || "").trim();
        if (!sourceText && !meaningText) {
          return null;
        }

        return {
          key: `${row?.id || "wm"}_${row?.order || index + 1}_${index}`,
          sourceText,
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
  };

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
    sequence_number?: string | null;
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
  }): Record<string, unknown> => {
    const fallback: Record<string, unknown> = {};
    const contentData = toRecord(nodePayload.content_data);
    const summaryData = toRecord(nodePayload.summary_data);
    const basic = toRecord(contentData.basic);
    const summaryBasic = toRecord(summaryData.basic);
    const translations = toRecord(contentData.translations);
    const summaryTranslations = toRecord(summaryData.translations);
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
      basic.text_sanskrit,
      contentData.sanskrit,
      contentData.text_sanskrit,
      summaryBasic.sanskrit,
      summaryBasic.text_sanskrit,
      summaryData.sanskrit,
      summaryData.text_sanskrit,
      nodePayload.title_sanskrit
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
      summaryData.text_transliteration,
      nodePayload.title_transliteration
    );
    const englishText = pickFirstNonEmptyString(
      translations.english,
      translations.en,
      basic.translation,
      basic.english,
      contentData.english,
      contentData.en,
      contentData.translation,
      contentData.text_english,
      summaryTranslations.english,
      summaryTranslations.en,
      summaryBasic.translation,
      summaryBasic.english,
      summaryData.english,
      summaryData.en,
      summaryData.translation,
      summaryData.text_english,
      nodePayload.title_english
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
    if (englishText) {
      fallback.translation = englishText;
      fallback.english = englishText;
      fallback.text_english = englishText;
      fallback.english_text = englishText;
      fallback.english_translation = englishText;
      fallback.verse_translation = englishText;
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
            sequence_number?: string | null;
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
    setPropertiesLoading(true);
    setPropertiesSaving(false);
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
          "sanskrit",
          "text_sanskrit",
          "sanskrit_text",
          "verse_sanskrit",
          "shloka",
          "title_sanskrit"
        );
        const transliterationFallback = pickSnapshotText(
          "transliteration",
          "iast",
          "text_transliteration",
          "transliteration_text",
          "verse_transliteration",
          "title_transliteration"
        );
        const englishFallback = pickSnapshotText(
          "english",
          "translation",
          "text_english",
          "english_text",
          "english_translation",
          "verse_translation",
          "title_english"
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

  const handleSaveProperties = async () => {
    if (!propertiesCategoryId) {
      setPropertiesError("Select a category before saving");
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

      setPropertiesMessage("Properties saved");
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

  const loadAuth = async () => {
    try {
      const data = await getMe();
      if (!data) {
        setAuthEmail(null);
        setAuthUserId(null);
        setAuthStatus("Not authenticated");
        setCanView(false);
        setCanAdmin(false);
        setCanContribute(false);
        setCanEdit(false);
        return;
      }
      setAuthUserId(data.id ?? null);
      setAuthEmail(data.email || null);
      setAuthStatus(data.email ? `Signed in as ${data.email}` : "Authenticated");
      const canViewPermission = (data.permissions as { can_view?: boolean } | undefined)?.can_view;
      setCanView(Boolean(canViewPermission || data.role === "viewer" || data.role === "contributor" || data.role === "editor" || data.role === "admin"));
      setCanAdmin(Boolean(data.permissions?.can_admin || data.role === "admin"));
      setCanContribute(Boolean(data.permissions?.can_contribute || data.role === "contributor" || data.role === "editor" || data.role === "admin"));
      setCanEdit(Boolean(data.permissions?.can_edit || data.role === "editor" || data.role === "admin"));
    } catch {
      setAuthEmail(null);
      setAuthUserId(null);
      setAuthStatus("Auth check failed");
      setCanView(false);
      setCanAdmin(false);
      setCanContribute(false);
      setCanEdit(false);
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
        const storedUiPreferences = readStoredUiPreferences();
        const response = await fetch("/api/preferences", { credentials: "include" });
        if (!response.ok) return;
        const data = (await response.json()) as UserPreferences;
        const normalized = normalizePreferences(data);
        if (storedUiPreferences) {
          normalized.ui_theme = storedUiPreferences.ui_theme;
          normalized.ui_density = storedUiPreferences.ui_density;
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
      } catch {
        const storedUiPreferences = readStoredUiPreferences();
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
      }
    };

    loadPreferences();
  }, [authEmail]);

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
              scriptures_media_manager_view: mediaManagerView,
            }),
          });
        } catch {
          // no-op: local persistence already applied
        }
      })();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [authResolved, authEmail, bookBrowserView, mediaManagerView]);

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

  const savePreferences = async (nextPreferences?: UserPreferences | null) => {
    const preferencesToSave = normalizePreferences(nextPreferences ?? preferences);
    if (!preferencesToSave) return;
    try {
      setPreferencesSaving(true);
      setPreferencesMessage(null);

      if (typeof window !== "undefined") {
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
    } catch (err) {
      setPreferencesMessage(err instanceof Error ? err.message : "Failed to save preferences");
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
    bookPreviewLoadingScope === "node" ? "Building level preview..." : "Building book preview...";
  const previewLoadingElapsedSeconds = Math.floor(bookPreviewLoadingElapsedMs / 1000);
  const previewLoadingMessageWithElapsed = `${previewLoadingMessage} ${previewLoadingElapsedSeconds}s`;

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

    const previewScript = normalizeTransliterationScript(
      preferences.preview_transliteration_script
    );
    const previewLanguages: BookPreviewLanguageSettings = {
      show_sanskrit: preferences.preview_show_sanskrit,
      show_transliteration: preferences.preview_show_transliteration,
      show_english: preferences.preview_show_english,
    };

    setShowPreviewTitles(preferences.preview_show_titles);
    setShowPreviewLabels(preferences.preview_show_labels);
    setShowPreviewDetails(preferences.preview_show_details);
    setBookPreviewLanguageSettings(previewLanguages);
    setBookPreviewTransliterationScript(previewScript);

    setAppliedShowPreviewTitles(preferences.preview_show_titles);
    setAppliedShowPreviewLabels(preferences.preview_show_labels);
    setAppliedShowPreviewDetails(preferences.preview_show_details);
    setAppliedBookPreviewLanguageSettings(previewLanguages);
    setAppliedBookPreviewTransliterationScript(previewScript);
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

  useEffect(() => {
    if (selectedId) {
      setMobilePanel("content");
    }
  }, [selectedId]);

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
    if (!bookId || !urlInitialized) return;

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
          : BOOKS_PAGE_SIZE_BY_DENSITY[bookBrowserDensity as 1 | 2 | 3 | 4];
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
      return;
    }

    setTreeLoading(true);
    setTreeError(null);
    try {
        const detailsResponse = await fetch(`/api/books/${selectedId}`, {
          credentials: "include",
          signal: abortController.signal,
        });
        if (requestId !== activeTreeRequestId.current) return;
        if (detailsResponse.ok) {
          const detailsData = (await detailsResponse.json()) as BookDetails;
          if (requestId !== activeTreeRequestId.current) return;
          setCurrentBook(detailsData);
        } else {
          setCurrentBook(null);
        }

      const response = await fetch(`/api/books/${selectedId}/tree`, {
        credentials: "include",
          signal: abortController.signal,
      });
        if (requestId !== activeTreeRequestId.current) return;
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(payload?.detail || "Tree fetch failed");
      }
      const data = (await response.json()) as TreeNode[];
        if (requestId !== activeTreeRequestId.current) return;
      setTreeData(data);
      setExpandedIds(new Set());
      
      // Auto-select node if provided in params
      if (autoSelectNodeId) {
        const path = findPath(data, autoSelectNodeId);
        if (path) {
          applySelection(autoSelectNodeId, path, true, false, true);
        }
      } else {
        const firstLeafId = findFirstLeafId(data);
        if (firstLeafId) {
          const firstLeafPath = findPath(data, firstLeafId);
          if (firstLeafPath) {
            applySelection(firstLeafId, firstLeafPath, false, false, true);
          }
        } else {
          setSelectedId(null);
          setBreadcrumb([]);
          setExpandedIds(new Set());
        }
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
        setPropertiesMessage("External media added to repo.");
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

  const handleRenameMediaBankAsset = async (asset: MediaAsset) => {
    const currentName =
      typeof asset.metadata?.display_name === "string" && asset.metadata.display_name.trim()
        ? asset.metadata.display_name
        : typeof asset.metadata?.original_filename === "string" && asset.metadata.original_filename.trim()
          ? asset.metadata.original_filename
          : `${asset.media_type} #${asset.id}`;
    const nextName = window.prompt("Rename media asset", currentName);
    if (nextName === null) {
      return;
    }
    const trimmed = nextName.trim();
    if (!trimmed) {
      setMediaBankError("Name cannot be empty.");
      return;
    }

    setMediaBankUpdating(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    try {
      await renameMediaBankAsset(asset.id, trimmed);
      setMediaBankMessage("Media asset renamed.");
      await loadMediaBankAssets();
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
      await uploadMediaBankAssetAndReturn(file);
      setPropertiesMessage("Media uploaded to repo.");
      await loadMediaBankAssets();
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

  const handleUploadBookThumbnail = async (file: File) => {
    if (!bookId) {
      setPropertiesError("Select a book first.");
      return;
    }

    setBookThumbnailUploading(true);
    setPropertiesError(null);
    setPropertiesMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(contentPath(`/books/${bookId}/thumbnail`), {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | BookDetails
        | { detail?: string }
        | null;
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to upload thumbnail");
      }

      const updatedBook = payload as BookDetails;
      setCurrentBook(updatedBook);
      setBooks((prev) =>
        prev.map((book) =>
          book.id === updatedBook.id
            ? {
                ...book,
                metadata_json: updatedBook.metadata_json,
                metadata: updatedBook.metadata,
              }
            : book
        )
      );
      setPropertiesMessage("Book thumbnail saved.");
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : "Failed to upload thumbnail");
    } finally {
      setBookThumbnailUploading(false);
    }
  };

  const handleDeleteBookThumbnail = async () => {
    if (!bookId) {
      setPropertiesError("Select a book first.");
      return;
    }

    setBookThumbnailUploading(true);
    setPropertiesError(null);
    setPropertiesMessage(null);

    try {
      const response = await fetch(contentPath(`/books/${bookId}/thumbnail`), {
        method: "DELETE",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as
        | BookDetails
        | { detail?: string }
        | null;
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to remove thumbnail");
      }

      const updatedBook = payload as BookDetails;
      setCurrentBook(updatedBook);
      setBooks((prev) =>
        prev.map((book) =>
          book.id === updatedBook.id
            ? {
                ...book,
                metadata_json: updatedBook.metadata_json,
                metadata: updatedBook.metadata,
              }
            : book
        )
      );
      setPropertiesMessage("Book thumbnail removed.");
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : "Failed to remove thumbnail");
    } finally {
      setBookThumbnailUploading(false);
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

  const handleSetBookThumbnailFromMediaBankAsset = async (asset: MediaAsset): Promise<boolean> => {
    if (!bookId) {
      setPropertiesError("Select a book first.");
      return false;
    }

    setBookThumbnailUploading(true);
    setPropertiesError(null);
    setPropertiesMessage(null);

    try {
      const existingMetadata =
        currentBook?.metadata_json && typeof currentBook.metadata_json === "object"
          ? { ...currentBook.metadata_json }
          : currentBook?.metadata && typeof currentBook.metadata === "object"
            ? { ...currentBook.metadata }
            : {};

      const nextMetadata = {
        ...existingMetadata,
        thumbnail_url: asset.url,
        thumbnailUrl: asset.url,
      };

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
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to set book thumbnail");
      }

      const updatedBook = payload as BookDetails;
      setCurrentBook(updatedBook);
      setBooks((prev) =>
        prev.map((book) =>
          book.id === updatedBook.id
            ? {
                ...book,
                metadata_json: updatedBook.metadata_json,
                metadata: updatedBook.metadata,
              }
            : book
        )
      );
      setPropertiesMessage("Book thumbnail set from repo.");
      return true;
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : "Failed to set book thumbnail");
      return false;
    } finally {
      setBookThumbnailUploading(false);
    }
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
    syncUrl = false
  ) => {
    setSelectedId(nodeId);
    setBreadcrumb(path);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      path.forEach((node) => next.add(node.id));
      return next;
    });
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

  const selectNode = (nodeId: number, syncUrl = true) => {
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
      if (syncUrl && bookId) {
        syncSelectionUrl(nodeId);
      }
      return;
    }

    const path = findPath(treeData, nodeId);
    if (path) {
      applySelection(nodeId, path, false, false, syncUrl);
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
    targetNodeId?: number | null
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
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/scriptures?${nextQuery}` : "/scriptures");
  };

  const syncBrowseUrl = (targetBookId: string, targetNodeId?: number | null) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("book", targetBookId);
    if (typeof targetNodeId === "number") {
      nextParams.set("node", String(targetNodeId));
    } else {
      nextParams.delete("node");
    }
    nextParams.delete("preview");
    nextParams.set("browse", "1");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/scriptures?${nextQuery}` : "/scriptures");
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
    clearPreviewUrl();
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

  const handlePreviewBook = async (scope: "book" | "node" = "book", targetBookId?: string) => {
    const previewBookId = targetBookId ?? bookId;
    if (!previewBookId) return;
    const previewNodeId = scope === "node" ? selectedId : null;
    if (scope === "node" && !previewNodeId) {
      return;
    }

    const nextLanguageSettings = {
      ...bookPreviewLanguageSettings,
    };
    const nextShowPreviewLabels = showPreviewLabels;
    const nextShowPreviewDetails = showPreviewDetails;
    const nextShowPreviewTitles = showPreviewTitles;
    const nextPreviewTransliterationScript = previewTransliterationScript;

    setBookPreviewLoadingScope(scope);
    setBookPreviewLoading(true);
    setBookPreviewError(null);

    try {
      const response = await fetch(`/api/books/${previewBookId}/preview/render`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_id: scope === "node" ? selectedId ?? undefined : undefined,
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
                  meaning_language: preferences?.source_language === "hindi" ? "hi" : "en",
                  fallback_order: ["user_preference", "en", "first_available"],
                },
                rendering: {
                  show_language_badge_when_fallback_used: true,
                },
              },
            },
          },
          render_settings: {
            ...nextLanguageSettings,
            show_metadata: nextShowPreviewDetails,
            text_order: ["sanskrit", "transliteration", "english", "text"],
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | BookPreviewArtifact
        | { detail?: string }
        | null;

      if (!response.ok) {
        setBookPreviewArtifact(null);
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to render book preview");
      }

      const artifact = payload as BookPreviewArtifact;
      setBookPreviewArtifact(artifact);
      setAppliedBookPreviewLanguageSettings(nextLanguageSettings);
      setAppliedShowPreviewLabels(nextShowPreviewLabels);
      setAppliedShowPreviewDetails(nextShowPreviewDetails);
      setAppliedShowPreviewTitles(nextShowPreviewTitles);
      setAppliedBookPreviewTransliterationScript(nextPreviewTransliterationScript);

      const nextPreferences = normalizePreferences({
        ...(preferences || DEFAULT_USER_PREFERENCES),
        preview_show_titles: nextShowPreviewTitles,
        preview_show_labels: nextShowPreviewLabels,
        preview_show_details: nextShowPreviewDetails,
        preview_show_sanskrit: nextLanguageSettings.show_sanskrit,
        preview_show_transliteration: nextLanguageSettings.show_transliteration,
        preview_show_english: nextLanguageSettings.show_english,
        preview_transliteration_script: nextPreviewTransliterationScript,
      });
      setPreferences(nextPreferences);
      await savePreferences(nextPreferences);

      const requestNodeIdPart = scope === "node" && previewNodeId ? `:${previewNodeId}` : "";
      lastHandledPreviewRequestKey.current = `${scope}:${previewBookId}${requestNodeIdPart}`;
      syncPreviewUrl(scope, previewBookId, previewNodeId);
      setShowBookPreview(true);
    } catch (err) {
      setShowBookPreview(false);
      setBookPreviewError(err instanceof Error ? err.message : "Failed to render book preview");
    } finally {
      setBookPreviewLoading(false);
    }
  };

  useEffect(() => {
    const previewParam = searchParams.get("preview");
    if (previewParam !== "book" && previewParam !== "node") {
      return;
    }
    if (!urlInitialized || !bookId) {
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

    void handlePreviewBook(previewScope, bookId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlInitialized, bookId, selectedId, searchParams]);

  useEffect(() => {
    const browseParam = searchParams.get("browse");
    if (browseParam !== "1") {
      return;
    }
    if (!urlInitialized || !bookId || !canExploreStructure) {
      return;
    }
    setShowExploreStructure(true);
    setShowBrowseBookModal(true);
    setMobilePanel("tree");
  }, [urlInitialized, bookId, canExploreStructure, searchParams]);

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
    const contentTranslations = node.content_data?.translations;
    const englishTranslation =
      contentTranslations?.english || contentBasic?.translation || "";
    const hasContent = Boolean(
      node.has_content ||
        contentBasic?.sanskrit ||
        contentBasic?.transliteration ||
        contentBasic?.translation ||
        contentTranslations?.english
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
      contentEnglish: englishTranslation,
      tags: node.tags?.join(", ") || "",
      wordMeanings: mapWordMeaningsRowsFromContent(node),
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
    return JSON.stringify(baseline) !== JSON.stringify(current);
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
    }
  }, [nodeContent]);

  const normalizeLevelName = (value: string) => value.trim().toLowerCase();

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
    return schemaLevels.findIndex(
      (level) => normalizeLevelName(level) === normalized
    );
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
    const levelIndex = getLevelIndexFromName(parentNode.level_name, schemaLevels);
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

  const canAddChild = (node: TreeNode): boolean => {
    if (!currentBook?.schema?.levels) {
      return false; // No schema, don't show add button
    }

    const schemaLevels = currentBook.schema.levels;

    // If it's a BOOK node, can add first level
    if (node.level_name?.toUpperCase() === "BOOK") {
      return schemaLevels.length > 0;
    }

    const levelIndex = getLevelIndexFromName(node.level_name, schemaLevels);
    if (levelIndex >= 0) {
      return levelIndex + 1 < schemaLevels.length;
    }

    // Fall back to level_order check
    const parentLevelOrder = node.level_order || 0;
    const nextLevelIndex = parentLevelOrder + 1;

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
        contentData.basic = {
          sanskrit: contentPair.sanskrit || undefined,
          transliteration: contentPair.transliteration || undefined,
          translation: formData.contentEnglish || undefined,
        };
        contentData.translations = {
          english: formData.contentEnglish || undefined,
        };

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

      // Calculate level_order based on parent or sibling-insert context
      let levelOrder = 1;
      if (isAddAction && actionNode) {
        if (createInsertAfterNodeId !== null) {
          levelOrder = actionNode.level_order || 1;
        } else {
          // When adding a child node
          if (actionNode.level_name?.toUpperCase() === "BOOK") {
            // Adding to book root, this is level 1
            levelOrder = 1;
          } else if (actionNode.level_order !== undefined) {
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
        level_name: formData.levelName,
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
        }
        // Refresh tree without losing context
        if (bookId) {
          try {
            const response = await fetch(`/api/books/${bookId}/tree`, {
              credentials: "include",
            });
            if (response.ok) {
              const data = (await response.json()) as TreeNode[];
              setTreeData(data);
              setExpandedIds((prev) => new Set(prev));
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
        contentData.basic = {
          sanskrit: contentPair.sanskrit || undefined,
          transliteration: contentPair.transliteration || undefined,
          translation: inlineFormData.contentEnglish || undefined,
        };
        contentData.translations = {
          english: inlineFormData.contentEnglish || undefined,
        };

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
        level_name: inlineFormData.levelName,
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
          const data = (await treeResponse.json()) as TreeNode[];
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
    setInlineMessage(null);
    setInlineEditMode(true);
  };

  const handleCancelInlineEdit = () => {
    if (nodeContent) {
      setInlineFormData(buildFormDataFromNode(nodeContent));
    }
    setInlineMessage(null);
    setInlineEditMode(false);
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
            onClick={() => selectNode(node.id)}
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
                  return `${displaySeq}. Untitled`;
                }
                return `${formatValue(node.level_name) || "Level"} ${displaySeq}`;
              })()}
            </span>
          </button>
          {canContribute && canAddChild(node) && (
            <button
              type="button"
              onClick={() => {
                const nextLevel = getNextLevelName(node);
                const defaultHasContent = isLeafLevelName(nextLevel);
                setActionNode(node);
                setCreateParentNodeIdOverride(null);
                setCreateInsertAfterNodeId(null);
                setFormData({
                  levelName: nextLevel,
                  titleSanskrit: "",
                  titleTransliteration: "",
                  titleEnglish: "",
                  sequenceNumber: "",
                  hasContent: defaultHasContent,
                  contentSanskrit: "",
                  contentTransliteration: "",
                  contentEnglish: "",
                  tags: "",
                  wordMeanings: [],
                });
                setAction("add");
              }}
              title={`Add ${getNextLevelName(node)}`}
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
  const isLeafSelected = Boolean(
    selectedTreeNode && (!selectedTreeNode.children || selectedTreeNode.children.length === 0)
  );
  const canBrowseCurrentNode = authUserId !== null && canView;
  const isCopyMessage = authMessage === "Link copied.";
  const isBooksGridView = bookBrowserDensity > 0;
  const booksGridColumns =
    bookBrowserDensity === 1
      ? 8
      : bookBrowserDensity === 2
        ? 6
        : bookBrowserDensity === 3
          ? 4
          : 2;
  const booksDensityLabel =
    bookBrowserDensity === 0
      ? "List"
      : bookBrowserDensity === 1
        ? "8 col"
        : bookBrowserDensity === 2
          ? "6 col"
          : bookBrowserDensity === 3
            ? "4 col"
            : "2 col";
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

  const handleSelectBook = (value: string): boolean => {
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
      if (!selectedId && treeData.length > 0) {
        const firstLeafId = findFirstLeafId(treeData);
        if (firstLeafId) {
          selectNode(firstLeafId, true);
        }
      }
      return true;
    }

    setBookId(value);
    if (value) {
      router.push(`/scriptures?book=${value}`, { scroll: false });
    } else {
      router.push("/scriptures", { scroll: false });
    }
    setSelectedId(null);
    setBreadcrumb([]);
    setShowExploreStructure(false);
    setMobilePanel("content");
    return true;
  };

  const handlePreviewBookFromRow = async (book: BookOption) => {
    const nextBookId = book.id.toString();
    const didSelect = handleSelectBook(nextBookId);
    if (!didSelect) return;
    await handlePreviewBook("book", nextBookId);
  };

  const handleBrowseBookFromRow = (book: BookOption) => {
    const nextBookId = book.id.toString();
    const didSelect = handleSelectBook(nextBookId);
    if (!didSelect) return;
    syncBrowseUrl(nextBookId);
    setShowExploreStructure(true);
    setMobilePanel("tree");
    setShowBrowseBookModal(true);
  };

  const mediaManagerItemsLayoutClass = mediaManagerView === "icon" ? "grid gap-2 p-2" : "divide-y divide-black/5";
  const mediaManagerItemsLayoutStyle =
    mediaManagerView === "icon"
      ? {
          gridTemplateColumns: `repeat(${mediaManagerGridColumns}, minmax(0, 1fr))`,
        }
      : undefined;

  const renderMediaManagerSearchInput = (placeholder: string, ariaLabel: string) => (
    <div className="group relative min-w-[220px] flex-1">
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
        <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-black/10 bg-white p-3 shadow-xl">
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
    <div className="grainy-bg flex h-full min-h-0 flex-col overflow-hidden overscroll-none">
      <main className="mx-auto flex h-full min-h-0 w-full max-w-none flex-col gap-2 overflow-hidden overscroll-none px-3 pb-2 pt-2 sm:gap-3 sm:px-4 sm:pb-3 sm:pt-3">
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
        <section className="flex h-0 min-h-0 flex-1 flex-col rounded-xl border border-black/10 bg-white px-3 py-2 sm:px-4 sm:py-3">
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
                  <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-black/10 bg-white p-3 shadow-xl">
                    <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                      <span>View density</span>
                      <span className="font-semibold text-zinc-700">{booksDensityLabel}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={4}
                      step={1}
                      value={bookBrowserDensity}
                      onChange={(event) => {
                        setBookBrowserDensity(normalizeBookBrowserDensity(event.target.value));
                      }}
                      className="w-full"
                      aria-label="Books view density"
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

          <div className="mt-2 flex h-0 min-h-0 flex-1 flex-col rounded-xl border border-black/10 bg-white">
            <div
              ref={booksScrollContainerRef}
              className="books-scroll-pane h-0 min-h-0 flex-1 overflow-y-scroll overflow-x-hidden overscroll-contain"
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
                  {filteredBooks.map((book) => {
                    const isSelected = bookId === book.id.toString();
                    const thumbnailUrl = getBookThumbnailUrl(book);
                    const canPreviewBook = Boolean(authEmail) || book.visibility === "public";
                    const canBrowseBook = authUserId !== null && canView;
                    const canCopyPreviewBookLink = canPreviewBook && !canBrowseBook;
                    const canCopyBrowseBookLink = false;
                    const showRowMenu = canCopyPreviewBookLink;
                    const showSingleBrowseAction = canBrowseBook;
                    return (
                      <div
                        key={book.id}
                        className={`flex items-center gap-2 text-sm transition ${
                          isBooksGridView
                            ? `relative aspect-square overflow-hidden rounded-xl border border-black/10 ${
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
                            {canPreviewBook ? (
                              <button
                                type="button"
                                onClick={() => {
                                  void handlePreviewBookFromRow(book);
                                }}
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
                                  {book.visibility === "private" ? "Private" : "Public"}
                                </span>
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
                                {canPreviewBook ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handlePreviewBookFromRow(book);
                                    }}
                                    className="truncate font-medium text-[color:var(--accent)] underline-offset-2 transition hover:underline"
                                  >
                                    {book.book_name}
                                  </button>
                                ) : (
                                  <span className="truncate font-medium">{book.book_name}</span>
                                )}
                              </div>
                              <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                                {book.visibility === "private" ? "Private" : "Public"}
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
                  <div className="inline-flex rounded-full border border-black/10 bg-white/90 p-0.5 lg:hidden">
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
                      setShowBrowseBookModal(false);
                      setShowExploreStructure(false);
                      setMobilePanel("content");
                      clearBrowseUrl();
                    }}
                    className="text-xl text-zinc-400 transition hover:text-zinc-600 sm:text-2xl"
                  >
                    ✕
                  </button>
                </div>
              </div>

                <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl overflow-hidden px-3 pb-4 pt-2 sm:px-4">
              <div className="grid h-full min-h-0 grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3">
            {/* Tree Section */}
            {isExploreVisible && (
            <div
              className={`lg:col-span-1 min-h-0 h-full rounded-2xl border border-black/10 bg-white/90 p-3 flex flex-col ${
                mobilePanel === "tree" ? "flex" : "hidden"
              } lg:flex`}
            >
              <div className="sticky top-0 z-10 bg-white/90 pb-3">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-zinc-500">
                  <span>
                    {books.find(b => b.id.toString() === bookId)?.book_name || "Nested tree"}
                  </span>
                  <div className="flex items-center gap-2">
                    {treeLoading && <span>Loading</span>}
                  </div>
                </div>
                {bookId && (
                  <div className="mt-2 flex items-center gap-2">
                    <div ref={bookTreeActionsMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setShowBookTreeActionsMenu((prev) => !prev)}
                        title="Book tree actions"
                        aria-label="Book tree actions"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white/80 text-zinc-700 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                      >
                        ⋮
                      </button>
                      {showBookTreeActionsMenu && (
                        <div className="absolute left-0 z-40 mt-2 w-56 rounded-xl border border-black/10 bg-white p-1 shadow-xl">
                          {(Boolean(authEmail) || currentBook?.visibility === "public") && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowBookTreeActionsMenu(false);
                                void handlePreviewBook("book");
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                            >
                              <Eye size={14} />
                              Preview book
                            </button>
                          )}
                          {canContribute && currentBook?.schema && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowBookTreeActionsMenu(false);
                                const virtualBook: TreeNode = {
                                  id: parseInt(bookId, 10),
                                  level_name: "BOOK",
                                  level_order: 0,
                                  sequence_number: undefined,
                                  title_english: books.find((b) => b.id.toString() === bookId)?.book_name,
                                };
                                const firstLevel = currentBook.schema?.levels[0] || "";
                                const defaultHasContent = isLeafLevelName(firstLevel);
                                setActionNode(virtualBook);
                                setCreateParentNodeIdOverride(null);
                                setCreateInsertAfterNodeId(null);
                                setFormData({
                                  levelName: firstLevel,
                                  titleSanskrit: "",
                                  titleTransliteration: "",
                                  titleEnglish: "",
                                  sequenceNumber: "",
                                  hasContent: defaultHasContent,
                                  contentSanskrit: "",
                                  contentTransliteration: "",
                                  contentEnglish: "",
                                  tags: "",
                                  wordMeanings: [],
                                });
                                setAction("add");
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                            >
                              <Plus size={14} />
                              Add {currentBook.schema?.levels[0] || "Node"}
                            </button>
                          )}
                          {canEditCurrentBook && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowBookTreeActionsMenu(false);
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
                                setShowBookTreeActionsMenu(false);
                                void openPropertiesModal("book");
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                            >
                              <SlidersHorizontal size={14} />
                              Book Properties
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {currentBook?.schema?.levels && currentBook.schema.levels.length > 1 && (
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
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {treeError && (
                  <p className="mt-3 text-sm text-[color:var(--accent)]">{treeError}</p>
                )}
                {!treeLoading && !treeError && treeData.length === 0 && bookId && (
                  <p className="mt-3 text-sm text-zinc-600">No nodes yet.</p>
                )}
                {!treeLoading && !treeError && treeData.length > 0 && (
                  <div className="mt-4">{renderTree(treeData)}</div>
                )}
              </div>
            </div>
            )}

            {/* Content Section */}
            <div
              className={`${isExploreVisible ? "lg:col-span-2" : "lg:col-span-1"} min-h-0 h-full rounded-2xl border border-black/10 bg-white/80 p-3 shadow-lg sm:p-4 overflow-y-auto overscroll-contain ${
                !isExploreVisible || mobilePanel === "content" ? "block" : "hidden"
              } lg:block`}
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
              {selectedId && nodeContent ? (
                <>
                  <div
                    className="flex items-center justify-between mb-4"
                    onContextMenu={(event) => {
                      if (!(isLeafSelected || canEditCurrentBook)) {
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
                      {(isLeafSelected || canEditCurrentBook) && (
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
                              {(Boolean(authEmail) || currentBook?.visibility === "public") && (
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
                              {(Boolean(authEmail) || currentBook?.visibility === "public") && selectedId && (
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
                              {isLeafSelected && authEmail && (
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
                              {isLeafSelected && canBrowseCurrentNode && (
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
                              {!isLeafSelected && canBrowseCurrentNode && (
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
                                    const parentNode = breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2] : null;
                                    const defaultHasContent = isLeafLevelName(nodeContent.level_name || "");
                                    setActionNode(fallbackNode);
                                    setCreateParentNodeIdOverride(parentNode ? parentNode.id : null);
                                    setCreateInsertAfterNodeId(nodeContent.id);
                                    setFormData({
                                      levelName: nodeContent.level_name || "",
                                      titleSanskrit: "",
                                      titleTransliteration: "",
                                      titleEnglish: "",
                                      sequenceNumber: "",
                                      hasContent: defaultHasContent,
                                      contentSanskrit: "",
                                      contentTransliteration: "",
                                      contentEnglish: "",
                                      tags: "",
                                      wordMeanings: [],
                                    });
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
                                  {level}
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
                              <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                                {contentFieldLabels.english || DEFAULT_CONTENT_FIELD_LABELS.english}
                              </label>
                              <div className="group relative mt-1">
                                <textarea
                                  rows={3}
                                  value={inlineFormData.contentEnglish}
                                  onChange={(event) =>
                                    setInlineFormData((prev) => ({
                                      ...prev,
                                      contentEnglish: event.target.value,
                                    }))
                                  }
                                  className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                                />
                                <InlineClearButton
                                  visible={Boolean(inlineFormData.contentEnglish)}
                                  onClear={() =>
                                    setInlineFormData((prev) => ({ ...prev, contentEnglish: "" }))
                                  }
                                  ariaLabel="Clear inline content English"
                                  position="top"
                                />
                              </div>
                            </div>

                            {inlineWordMeaningsEnabled && (
                              <WordMeaningsEditor
                                rows={inlineFormData.wordMeanings}
                                validationErrors={inlineWordMeaningValidationErrors}
                                missingRequired={inlineWordMeaningsMissingRequired}
                                requiredLanguage={WORD_MEANINGS_REQUIRED_LANGUAGE}
                                allowedMeaningLanguages={WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES}
                                onAddRow={handleAddInlineWordMeaningRow}
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
                              const english = formatValue(
                                nodeContent.content_data?.translations?.english ||
                                  nodeContent.content_data?.basic?.translation
                              );
                              const sanskritLabel = contentFieldLabels.sanskrit || DEFAULT_CONTENT_FIELD_LABELS.sanskrit;
                              const transliterationLabel =
                                contentFieldLabels.transliteration || DEFAULT_CONTENT_FIELD_LABELS.transliteration;
                              const englishLabel = contentFieldLabels.english || DEFAULT_CONTENT_FIELD_LABELS.english;

                              const primaryContent =
                                showOnlyPreferredScript
                                  ? sourceLanguage === "sanskrit"
                                    ? preferredSanskrit || english
                                    : sourceLanguage === "hindi"
                                    ? english || originalSanskrit
                                    : english || originalSanskrit
                                  : originalSanskrit || english;

                              const primaryLabel =
                                showOnlyPreferredScript
                                  ? sourceLanguage === "sanskrit"
                                    ? sanskritLabel
                                    : sourceLanguage === "hindi"
                                    ? "Hindi/Translation"
                                    : englishLabel
                                  : "Sanskrit (Original)";

                              const showSecondaryTransliteration =
                                !showOnlyPreferredScript &&
                                showTransliteration &&
                                Boolean(transliteration) &&
                                transliteration !== primaryContent &&
                                transliteration !== originalSanskrit;

                              return (
                                <>
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
                                  {!showOnlyPreferredScript && english && english !== primaryContent && (
                                    <div>
                                      <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                                        {englishLabel}
                                      </div>
                                      <div className="whitespace-pre-wrap text-base leading-relaxed text-zinc-700">
                                        {english}
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
                                            const mediaUrl = resolveMediaUrl(media.url);
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
                                                {media.media_type === "image" ? (
                                                  <img
                                                    src={mediaUrl}
                                                    alt={label}
                                                    className="max-h-[260px] w-full rounded-lg border border-black/10 object-contain"
                                                  />
                                                ) : media.media_type === "audio" ? (
                                                  <audio controls className="w-full">
                                                    <source src={mediaUrl} />
                                                  </audio>
                                                ) : media.media_type === "video" ? (
                                                  (() => {
                                                    const youtubeEmbedUrl = getYouTubeEmbedUrl(media.url);
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
                                                  })()
                                                ) : (
                                                  <a
                                                    href={mediaUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-sm text-[color:var(--accent)] underline decoration-transparent underline-offset-2 hover:decoration-current"
                                                  >
                                                    Open media: {label}
                                                  </a>
                                                )}

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
                <p className="text-sm text-zinc-400">
                  Select a node to view details
                </p>
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
          nameValue={
            propertiesScope === "book"
              ? currentBook?.book_name || ""
              : nodeContent?.title_english ||
                nodeContent?.title_sanskrit ||
                nodeContent?.title_transliteration ||
                `Node ${propertiesNodeId || ""}`
          }
          descriptionValue={
            propertiesScope === "book"
              ? typeof (currentBook?.metadata_json || currentBook?.metadata || {})?.description === "string"
                ? String((currentBook?.metadata_json || currentBook?.metadata || {}).description)
                : ""
              : `${nodeContent?.level_name || "Node"} ${formatSequenceDisplay(
                  nodeContent?.sequence_number,
                  Boolean(nodeContent?.has_content)
                ) || propertiesNodeId || ""}`
          }
          categoryId={propertiesCategoryId}
          categories={metadataCategories}
          loading={propertiesLoading}
          categoriesLoading={metadataCategoriesLoading}
          error={propertiesError}
          message={propertiesMessage}
          saving={propertiesSaving}
          saveDisabled={propertiesSaving || propertiesLoading || !propertiesCategoryId}
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
                <BookThumbnailSection
                  thumbnailUrl={getBookThumbnailUrl(currentBook)}
                  canEditCurrentBook={canEditCurrentBook}
                  onManageMultimedia={() => {
                    setMediaManagerScope("book");
                    setShowMediaManagerModal(true);
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
                      <option value="image">image</option>
                    </select>
                    {renderMediaManagerDensityControl()}
                    <input
                      ref={bookMediaUploadInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (!file) return;
                        void handleUploadBookMediaViaBank(file);
                      }}
                    />
                    <div className="relative">
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
                        <div className="absolute right-0 top-10 z-20 min-w-[260px] rounded-lg border border-black/10 bg-white p-1.5 shadow-lg">
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
                    {(() => {
                      const thumbnailUrl = getBookThumbnailUrl(currentBook);
                      if (!thumbnailUrl) {
                        return <div className="px-3 py-6 text-sm text-zinc-500">No multimedia attached to this book.</div>;
                      }
                      const query = mediaManagerSearchQuery.trim().toLowerCase();
                      const rowLabel = "Book Thumbnail";
                      const haystack = `${rowLabel} image ${thumbnailUrl}`.toLowerCase();
                      const matchesType = mediaManagerTypeFilter === "all" || mediaManagerTypeFilter === "image";
                      if (!matchesType || (query && !haystack.includes(query))) {
                        return <div className="px-3 py-6 text-sm text-zinc-500">No matching media found.</div>;
                      }
                      return (
                        <div
                          className={mediaManagerItemsLayoutClass}
                          style={mediaManagerItemsLayoutStyle}
                        >
                          <div
                            className={
                              mediaManagerView === "icon"
                                ? "overflow-hidden rounded-xl border border-black/10 bg-white text-sm text-zinc-700"
                                : "grid grid-cols-[2fr_1fr_1fr_1.5fr] items-center gap-3 px-3 py-2.5 text-sm text-zinc-700"
                            }
                          >
                            {mediaManagerView === "icon" ? (
                              <>
                                <img
                                  src={thumbnailUrl}
                                  alt="Book thumbnail"
                                  className="aspect-square w-full object-cover"
                                />
                                <div className="space-y-2 p-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="truncate font-medium">{rowLabel}</div>
                                      <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">image</div>
                                    </div>
                                    <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-600">Default</span>
                                  </div>
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      disabled
                                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                      aria-label="Move up"
                                      title="Move up"
                                    >
                                      <ChevronsUp size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      disabled
                                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                      aria-label="Move down"
                                      title="Move down"
                                    >
                                      <ChevronsDown size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      disabled
                                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                      aria-label="Set default"
                                      title="Set default"
                                    >
                                      <SlidersHorizontal size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void handleDeleteBookThumbnail();
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
                                  <div className="truncate font-medium">{rowLabel}</div>
                                  <div className="mt-1">
                                    <img
                                      src={thumbnailUrl}
                                      alt="Book thumbnail"
                                      className="h-12 w-12 rounded-md border border-black/10 object-cover"
                                    />
                                  </div>
                                </div>
                                <span className="uppercase text-xs tracking-[0.12em] text-zinc-600">image</span>
                                <span className="text-xs text-zinc-600">Yes</span>
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    disabled
                                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                    aria-label="Move up"
                                    title="Move up"
                                  >
                                    <ChevronsUp size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    disabled
                                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                    aria-label="Move down"
                                    title="Move down"
                                  >
                                    <ChevronsDown size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    disabled
                                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-700 disabled:opacity-50"
                                    aria-label="Set default"
                                    title="Set default"
                                  >
                                    <SlidersHorizontal size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleDeleteBookThumbnail();
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
                        </div>
                      );
                    })()}
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
                        ? "Pick an image item for the book default image, or use Back to return."
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
                              const label =
                                typeof asset.metadata?.display_name === "string" && asset.metadata.display_name
                                  ? asset.metadata.display_name
                                  : typeof asset.metadata?.original_filename === "string" && asset.metadata.original_filename
                                    ? asset.metadata.original_filename
                                    : `${asset.media_type} #${asset.id}`;
                              return (
                                <div
                                  key={asset.id}
                                  className={
                                    mediaManagerView === "icon"
                                      ? "overflow-hidden rounded-xl border border-black/10 bg-white text-sm text-zinc-700"
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
                                            <div className="truncate font-medium">{label}</div>
                                            <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">{asset.media_type}</div>
                                          </div>
                                        </div>
                                        <div className="flex items-center justify-end gap-1">
                                          {mediaBankViewMode === "pick-node" || mediaBankViewMode === "pick-book" ? (
                                            <button
                                              type="button"
                                              onClick={async () => {
                                                if (mediaBankViewMode === "pick-book") {
                                                  const picked = await handleSetBookThumbnailFromMediaBankAsset(asset);
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
                                                (mediaBankViewMode === "pick-book" && asset.media_type !== "image") ||
                                                (mediaBankViewMode === "pick-node" && !selectedId)
                                              }
                                              className="rounded border border-black/10 bg-white px-2 py-1 text-xs text-zinc-700 disabled:opacity-50"
                                            >
                                              Pick
                                            </button>
                                          ) : (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  void handleRenameMediaBankAsset(asset);
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
                                        <div className="truncate font-medium">{label}</div>
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
                                                const picked = await handleSetBookThumbnailFromMediaBankAsset(asset);
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
                                              (mediaBankViewMode === "pick-book" && asset.media_type !== "image") ||
                                              (mediaBankViewMode === "pick-node" && !selectedId)
                                            }
                                            className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 disabled:opacity-50"
                                          >
                                            Pick
                                          </button>
                                        ) : (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                void handleRenameMediaBankAsset(asset);
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
                    <div className="relative">
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
                        <div className="absolute right-0 top-10 z-20 min-w-[250px] rounded-lg border border-black/10 bg-white p-1.5 shadow-lg">
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
                                      ? "overflow-hidden rounded-xl border border-black/10 bg-white text-sm text-zinc-700"
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
                    ? "Add an external media link to repo for this book."
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
              <div className="flex items-center justify-between border-b border-black/10 bg-[color:var(--paper)] px-3 py-2 sm:px-4 sm:py-2.5">
                <div>
                  <h2 className="font-[var(--font-display)] text-xl text-[color:var(--deep)] sm:text-2xl">
                    {bookPreviewArtifact.preview_scope === "node" ? "Level Preview" : "Book Preview"}
                  </h2>
                  <p className="text-xs text-zinc-600 sm:text-sm">
                    {bookPreviewArtifact.preview_scope === "node"
                      ? `${bookPreviewArtifact.root_title || "Selected level"} • ${bookPreviewArtifact.book_name}`
                      : bookPreviewArtifact.book_name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {(() => {
                    const previewScope = bookPreviewArtifact.preview_scope === "node" ? "node" : "book";
                    const targetNodeId = previewScope === "node" ? selectedId : null;
                    const previewPath = buildScripturesPreviewPath(previewScope, bookId, targetNodeId);
                    const browsePath = buildScripturesBrowsePath(bookId, targetNodeId);
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            void handleCopyPreviewPath(previewPath);
                          }}
                          className="rounded-full border border-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-600 transition hover:border-black/20 sm:text-xs"
                        >
                          Copy Link
                        </button>
                        {canBrowseCurrentNode && (
                          <a
                            href={browsePath}
                            className="rounded-full border border-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-600 transition hover:border-black/20 sm:text-xs"
                          >
                            Browse
                          </a>
                        )}
                      </>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => setShowPreviewControls((prev) => !prev)}
                    className="rounded-full border border-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-600 transition hover:border-black/20 sm:text-xs"
                  >
                    {showPreviewControls ? "Hide Controls" : "Show Controls"}
                  </button>
                  <button
                    type="button"
                    onClick={handleClosePreview}
                    className="text-xl text-zinc-400 transition hover:text-zinc-600 sm:text-2xl"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="mx-auto flex-1 w-full max-w-5xl overflow-y-auto px-3 pb-4 pt-2 sm:px-4">
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

                {showPreviewControls && (
                  <div className="mb-2 rounded-lg border border-black/10 bg-white/90 p-2.5">
                    <div className="space-y-2">
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
                              checked={showPreviewDetails}
                              onChange={(event) => setShowPreviewDetails(event.target.checked)}
                              disabled={bookPreviewLoading}
                            />
                            Show template details
                          </label>
                        </div>
                      </div>

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
                            English
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              const currentScope =
                                bookPreviewArtifact.preview_scope === "node" ? "node" : "book";
                              void handlePreviewBook(currentScope);
                            }}
                            disabled={
                              bookPreviewLoading ||
                              (!bookPreviewLanguageSettings.show_sanskrit &&
                                !bookPreviewLanguageSettings.show_transliteration &&
                                !bookPreviewLanguageSettings.show_english) ||
                              (bookPreviewLanguageSettings.show_sanskrit === appliedBookPreviewLanguageSettings.show_sanskrit &&
                                bookPreviewLanguageSettings.show_transliteration === appliedBookPreviewLanguageSettings.show_transliteration &&
                                bookPreviewLanguageSettings.show_english === appliedBookPreviewLanguageSettings.show_english &&
                                showPreviewLabels === appliedShowPreviewLabels &&
                                showPreviewDetails === appliedShowPreviewDetails &&
                                showPreviewTitles === appliedShowPreviewTitles &&
                                previewTransliterationScript === appliedBookPreviewTransliterationScript)
                            }
                            className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {bookPreviewLoading ? "Applying..." : "Apply"}
                          </button>
                        </div>
                      </div>
                    </div>
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
                    <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
                      {bookPreviewArtifact.book_template.rendered_text ||
                        (bookPreviewArtifact.preview_scope === "node"
                          ? "No rendered level summary."
                          : "No rendered book-level summary.")}
                    </p>
                  </div>
                )}

                <div className="space-y-3">
                  {bookPreviewArtifact.sections.body.length === 0 ? (
                    <p className="rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-sm text-zinc-500">
                      {bookPreviewArtifact.preview_scope === "node"
                        ? "No previewable content found under this level."
                        : "No previewable content found for this book."}
                    </p>
                  ) : (
                    bookPreviewArtifact.sections.body.map((block) => {
                      const contentLines = resolvePreviewContentLines(block, bookPreviewArtifact.render_settings);
                      const wordMeaningRows = resolvePreviewWordMeanings(block);
                      const wordMeaningInlineText = wordMeaningRows
                        .map((row) => {
                          const source = row.sourceText || "—";
                          const meaning = row.meaningText || "—";
                          const fallbackLabel =
                            row.fallbackBadgeVisible && row.meaningLanguage
                              ? ` (${row.meaningLanguage})`
                              : "";
                          return `${source} : ${meaning}${fallbackLabel}`;
                        })
                        .join("; ");
                      const rawTitle = block.title || "";
                      const hideNodeFallback = !appliedShowPreviewDetails && /^Node\s+\d+$/i.test(rawTitle.trim());
                      const displayTitle = appliedShowPreviewTitles && !hideNodeFallback ? rawTitle : "";
                      return (
                        <article
                          key={`${block.section}-${block.order}-${block.source_node_id ?? block.title}`}
                          className="border-b border-black/10 px-1 py-4"
                        >
                          {displayTitle && (
                            <div className="text-sm font-semibold text-[color:var(--deep)]">{displayTitle}</div>
                          )}
                          <div className="mt-1">
                            {contentLines.length === 0 ? (
                              <p className="text-sm text-zinc-500">No textual content in this block.</p>
                            ) : (
                              contentLines.map((line, lineIndex) => (
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
                                  <p className={line.className}>{line.value}</p>
                                </div>
                              ))
                            )}
                          </div>
                          {wordMeaningRows.length > 0 && (
                            <div className="mt-2 border-t border-black/10 pt-2">
                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                                {wordMeaningInlineText}
                              </p>
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
                    })
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
                      ? `Add ${formData.levelName || "New Node"}` 
                      : `Edit ${formatValue(formData.levelName || actionNode?.level_name) || "Node"}`}
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
                        value={formData.levelName}
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
                            {level}
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
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        {contentFieldLabels.english || DEFAULT_CONTENT_FIELD_LABELS.english}
                      </label>
                      <div className="group relative mt-1">
                        <textarea
                          value={formData.contentEnglish}
                          onChange={(e) =>
                            setFormData({ ...formData, contentEnglish: e.target.value })
                          }
                          className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                          placeholder={contentFieldLabels.english || DEFAULT_CONTENT_FIELD_LABELS.english}
                          rows={3}
                        />
                        <InlineClearButton
                          visible={Boolean(formData.contentEnglish)}
                          onClear={() => setFormData((prev) => ({ ...prev, contentEnglish: "" }))}
                          ariaLabel="Clear content English"
                          position="top"
                        />
                      </div>
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

                <div className="flex-shrink-0 p-6 pt-4 border-t border-black/10">
                  {actionMessage && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {actionMessage}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
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
                    ) : (
                      <div />
                    )}
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
