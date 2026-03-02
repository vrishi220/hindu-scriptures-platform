"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Eye,
  Link2,
  Pencil,
  Plus,
  Share2,
  ShoppingBasket,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { contentPath } from "../../lib/apiPaths";
import BasketPanel from "../../components/BasketPanel";
import InlineClearButton from "../../components/InlineClearButton";
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

type BookOption = {
  id: number;
  book_name: string;
  schema_id?: number | null;
  status?: "draft" | "published";
  visibility?: "private" | "public";
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
const DEFAULT_CONTENT_FIELD_LABELS = {
  sanskrit: "Sanskrit",
  transliteration: "Transliteration",
  english: "English",
} as const;

const WORD_MEANINGS_VERSION = "1.0";
const WORD_MEANINGS_REQUIRED_LANGUAGE = "en";
const WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES = ["sa", "pi", "hi", "ta"] as const;
const WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES = ["en", "hi", "ta", "te", "kn", "ml"] as const;
const WORD_MEANINGS_ALLOWED_TRANSLITERATION_SCHEMES = ["iast", "hk", "itrans"] as const;
const WORD_MEANINGS_ALLOWED_FALLBACK_STRATEGIES = ["user_preference", "en", "first_available"] as const;
const WORD_MEANINGS_MAX_ROWS = 400;
const WORD_MEANINGS_MAX_SOURCE_CHARS = 120;
const WORD_MEANINGS_MAX_MEANING_CHARS = 400;
const WORD_MEANINGS_HTML_TAG_PATTERN = /<[^>]+>/;
const WORD_MEANINGS_FALLBACK_ORDER_DEFAULT = [...WORD_MEANINGS_ALLOWED_FALLBACK_STRATEGIES];

type WordMeaningsSourceDisplayMode = "script" | "transliteration";
type WordMeaningsTransliterationScheme =
  (typeof WORD_MEANINGS_ALLOWED_TRANSLITERATION_SCHEMES)[number];
type WordMeaningsMeaningLanguage = (typeof WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES)[number];

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

const getWordMeaningsRenderingSettingsFromBook = (
  book: BookDetails | null
): {
  sourceDisplayMode: WordMeaningsSourceDisplayMode;
  preferredScheme: WordMeaningsTransliterationScheme;
  allowRuntimeGeneration: boolean;
  meaningLanguage: WordMeaningsMeaningLanguage;
  fallbackOrder: string[];
} => {
  const metadata =
    book?.metadata_json && typeof book.metadata_json === "object"
      ? book.metadata_json
      : book?.metadata && typeof book.metadata === "object"
        ? book.metadata
        : null;

  const wordMeaningsConfig =
    metadata &&
    typeof metadata.word_meanings === "object" &&
    metadata.word_meanings !== null
      ? (metadata.word_meanings as Record<string, unknown>)
      : null;

  const sourceConfig =
    wordMeaningsConfig &&
    typeof wordMeaningsConfig.source === "object" &&
    wordMeaningsConfig.source !== null
      ? (wordMeaningsConfig.source as Record<string, unknown>)
      : {};

  const meaningsConfig =
    wordMeaningsConfig &&
    typeof wordMeaningsConfig.meanings === "object" &&
    wordMeaningsConfig.meanings !== null
      ? (wordMeaningsConfig.meanings as Record<string, unknown>)
      : {};

  const rawMode =
    typeof sourceConfig.source_display_mode === "string"
      ? sourceConfig.source_display_mode.trim().toLowerCase()
      : "";
  const sourceDisplayMode = rawMode === "transliteration" ? "transliteration" : "script";

  const rawScheme =
    typeof sourceConfig.preferred_transliteration_scheme === "string"
      ? sourceConfig.preferred_transliteration_scheme.trim().toLowerCase()
      : "";
  const preferredScheme =
    WORD_MEANINGS_ALLOWED_TRANSLITERATION_SCHEMES.find((option) => option === rawScheme) || "iast";

  const allowRuntimeGeneration =
    typeof sourceConfig.allow_runtime_transliteration_generation === "boolean"
      ? sourceConfig.allow_runtime_transliteration_generation
      : true;

  const rawMeaningLanguage =
    typeof meaningsConfig.meaning_language === "string"
      ? meaningsConfig.meaning_language.trim().toLowerCase()
      : "";
  const meaningLanguage =
    WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES.find((option) => option === rawMeaningLanguage) || "en";

  const fallbackOrder = Array.isArray(meaningsConfig.fallback_order)
    ? meaningsConfig.fallback_order
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim().toLowerCase())
    : [...WORD_MEANINGS_FALLBACK_ORDER_DEFAULT];

  return {
    sourceDisplayMode,
    preferredScheme,
    allowRuntimeGeneration,
    meaningLanguage,
    fallbackOrder,
  };
};

const DEFAULT_USER_PREFERENCES: UserPreferences = {
  source_language: "english",
  transliteration_enabled: true,
  transliteration_script: "iast",
  show_roman_transliteration: true,
  show_only_preferred_script: false,
  preview_show_titles: false,
  preview_show_labels: false,
  preview_show_details: false,
  preview_show_sanskrit: true,
  preview_show_transliteration: true,
  preview_show_english: true,
  preview_transliteration_script: "iast",
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
  preview_show_titles: value?.preview_show_titles ?? false,
  preview_show_labels: value?.preview_show_labels ?? false,
  preview_show_details: value?.preview_show_details ?? false,
  preview_show_sanskrit: value?.preview_show_sanskrit ?? true,
  preview_show_transliteration: value?.preview_show_transliteration ?? true,
  preview_show_english: value?.preview_show_english ?? true,
  preview_transliteration_script: normalizeTransliterationScript(
    value?.preview_transliteration_script
  ),
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [books, setBooks] = useState<BookOption[]>([]);
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
  const [canAdmin, setCanAdmin] = useState(false);
  const [canContribute, setCanContribute] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [bookVisibilitySubmitting, setBookVisibilitySubmitting] = useState(false);
  const [nodeContent, setNodeContent] = useState<NodeContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [actionNode, setActionNode] = useState<TreeNode | null>(null);
  const [action, setAction] = useState<"add" | "edit" | null>(null);
  const [searchReturnUrl, setSearchReturnUrl] = useState<string | null>(null);
  const lastTreeBookId = useRef<string | null>(null);
  const lastAutoSelectNodeId = useRef<number | null>(null);
  const lastLoadedNodeId = useRef<number | null>(null);
  const activeTreeRequestId = useRef(0);
  const activeTreeAbortController = useRef<AbortController | null>(null);
  const activeContentRequestId = useRef(0);
  const activeContentAbortController = useRef<AbortController | null>(null);
  const activeContentNodeId = useRef<number | null>(null);
  const pendingSavedNodeId = useRef<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"tree" | "content">("tree");
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
  const [bookPreviewLoading, setBookPreviewLoading] = useState(false);
  const [bookPreviewError, setBookPreviewError] = useState<string | null>(null);
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
  const [bookBodyAddLoading, setBookBodyAddLoading] = useState(false);
  const [bookBodyCreateDraftLoading, setBookBodyCreateDraftLoading] = useState(false);
  const [bookBodyAddMessage, setBookBodyAddMessage] = useState<string | null>(null);
  const [showShareManager, setShowShareManager] = useState(false);
  const [schemas, setSchemas] = useState<SchemaOption[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<number | null>(null);
  const [bookFormData, setBookFormData] = useState({
    bookName: "",
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
  const [wordMeaningsEnabledLevelSelection, setWordMeaningsEnabledLevelSelection] = useState<Set<string>>(new Set());
  const [wordMeaningsSourceDisplayModeSelection, setWordMeaningsSourceDisplayModeSelection] =
    useState<WordMeaningsSourceDisplayMode>("script");
  const [wordMeaningsPreferredSchemeSelection, setWordMeaningsPreferredSchemeSelection] =
    useState<WordMeaningsTransliterationScheme>("iast");
  const [wordMeaningsAllowRuntimeGenerationSelection, setWordMeaningsAllowRuntimeGenerationSelection] =
    useState(true);
  const [wordMeaningsMeaningLanguageSelection, setWordMeaningsMeaningLanguageSelection] =
    useState<WordMeaningsMeaningLanguage>("en");
  const [wordMeaningsFallbackOrderInput, setWordMeaningsFallbackOrderInput] = useState(
    WORD_MEANINGS_FALLBACK_ORDER_DEFAULT.join(", ")
  );
  const [propertiesCategoryId, setPropertiesCategoryId] = useState<number | null>(null);
  const [propertiesEffectiveFields, setPropertiesEffectiveFields] = useState<EffectivePropertyBinding[]>([]);
  const [propertiesValues, setPropertiesValues] = useState<Record<string, unknown>>({});
  const [showBookActionsMenu, setShowBookActionsMenu] = useState(false);
  const [showNodeActionsMenu, setShowNodeActionsMenu] = useState(false);
  const bookActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const nodeActionsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (bookActionsMenuRef.current && !bookActionsMenuRef.current.contains(target)) {
        setShowBookActionsMenu(false);
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
    setShowBookActionsMenu(false);
  }, [bookId]);

  useEffect(() => {
    setShowNodeActionsMenu(false);
  }, [selectedId]);

  useEffect(() => {
    setInlineMessage(null);
  }, [selectedId]);

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
        ? "text-base text-[color:var(--deep)]"
        : fieldName === "transliteration"
          ? "text-sm italic text-zinc-700"
          : "text-sm text-zinc-700";

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

    const lines: Array<{ key: string; label: string; value: string; className: string }> = [];
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
        const label = appliedShowPreviewLabels && fieldName !== previousFieldName ? computedLabel : "";

        lines.push({
          key: `${fieldName || "line"}-${index}`,
          label,
          value,
          className: lineClassNameForField(fieldName),
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

      lines.push({ key, label, value, className });
    }

    if (lines.length === 0) {
      const fallback = (block.content.text || "").trim();
      if (fallback) {
        lines.push({ key: "text", label: "Text", value: fallback, className: "text-sm text-zinc-700" });
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

  const readCategoryIdFromMetadata = (metadata: Record<string, unknown>): number | null => {
    const categoryCandidate = metadata.category_id;
    if (typeof categoryCandidate === "number" && Number.isFinite(categoryCandidate) && categoryCandidate > 0) {
      return categoryCandidate;
    }
    if (typeof categoryCandidate === "string") {
      const parsed = Number(categoryCandidate);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return null;
  };

  const inferCategoryIdFromMetadata = async (metadata: Record<string, unknown>): Promise<number | null> => {
    const ignoredKeys = new Set(["owner_id", "status", "visibility", "category_id"]);
    const metadataKeys = Object.keys(metadata).filter((key) => !ignoredKeys.has(key));
    const candidateCategories = metadataCategories.filter((category) => !category.is_deprecated);
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
        const effectiveKeys = new Set(effective.map((field) => field.property_internal_name));
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

      let categoryId = binding?.category_id ?? readCategoryIdFromMetadata(scopedMetadataSnapshot) ?? null;
      if (!categoryId && scope === "node") {
        categoryId = await inferCategoryIdFromMetadata(scopedMetadataSnapshot);
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
        if (!(key in values)) {
          return;
        }
        if (bindingProvidedKeys.has(key) && !isEmptyMetadataValue(values[key])) {
          return;
        }
        if (value !== undefined && !isEmptyMetadataValue(value)) {
          values[key] = value;
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

  const handleToggleWordMeaningsRolloutLevel = (levelName: string) => {
    const normalized = levelName.trim().toLowerCase();
    if (!normalized) return;

    setWordMeaningsEnabledLevelSelection((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) {
        next.delete(normalized);
      } else {
        next.add(normalized);
      }
      return next;
    });
  };

  const handleSaveProperties = async () => {
    if (!propertiesCategoryId) {
      setPropertiesError("Select a category before saving");
      return;
    }

    const fallbackOrderFromInput = wordMeaningsFallbackOrderInput
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    const invalidFallbackStrategies = fallbackOrderFromInput.filter(
      (item) =>
        !WORD_MEANINGS_ALLOWED_FALLBACK_STRATEGIES.includes(
          item as (typeof WORD_MEANINGS_ALLOWED_FALLBACK_STRATEGIES)[number]
        )
    );

    if (propertiesScope === "book" && invalidFallbackStrategies.length > 0) {
      setPropertiesError(
        `Fallback order contains invalid values: ${Array.from(new Set(invalidFallbackStrategies)).join(", "
        )}. Allowed values: ${WORD_MEANINGS_ALLOWED_FALLBACK_STRATEGIES.join(", ")}`
      );
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
      if (propertiesScope === "book" && bookId && currentBook) {
        const existingMetadata =
          currentBook.metadata_json && typeof currentBook.metadata_json === "object"
            ? { ...currentBook.metadata_json }
            : currentBook.metadata && typeof currentBook.metadata === "object"
              ? { ...currentBook.metadata }
              : {};

        const existingWordMeanings =
          existingMetadata.word_meanings && typeof existingMetadata.word_meanings === "object"
            ? { ...(existingMetadata.word_meanings as Record<string, unknown>) }
            : {};

        const schemaLevels = Array.isArray(currentBook.schema?.levels)
          ? currentBook.schema.levels
          : [];

        const selectedLevels =
          schemaLevels.length > 0
            ? schemaLevels.filter((level) =>
                wordMeaningsEnabledLevelSelection.has(level.trim().toLowerCase())
              )
            : Array.from(wordMeaningsEnabledLevelSelection);

        const selectedFallbackOrder =
          fallbackOrderFromInput.length > 0
            ? Array.from(new Set(fallbackOrderFromInput))
            : [...WORD_MEANINGS_FALLBACK_ORDER_DEFAULT];

        const existingSourceConfig =
          existingWordMeanings.source && typeof existingWordMeanings.source === "object"
            ? { ...(existingWordMeanings.source as Record<string, unknown>) }
            : {};

        const existingMeaningsConfig =
          existingWordMeanings.meanings && typeof existingWordMeanings.meanings === "object"
            ? { ...(existingWordMeanings.meanings as Record<string, unknown>) }
            : {};

        existingWordMeanings.enabled_levels = selectedLevels;
        existingWordMeanings.source = {
          ...existingSourceConfig,
          source_display_mode: wordMeaningsSourceDisplayModeSelection,
          preferred_transliteration_scheme: wordMeaningsPreferredSchemeSelection,
          allow_runtime_transliteration_generation: wordMeaningsAllowRuntimeGenerationSelection,
        };
        existingWordMeanings.meanings = {
          ...existingMeaningsConfig,
          meaning_language: wordMeaningsMeaningLanguageSelection,
          fallback_order: selectedFallbackOrder,
        };
        existingMetadata.word_meanings = existingWordMeanings;

        const bookResponse = await fetch(`/api/books/${bookId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: existingMetadata }),
        });

        const bookPayload = (await bookResponse.json().catch(() => null)) as
          | BookDetails
          | { detail?: string }
          | null;

        if (!bookResponse.ok) {
          throw new Error(
            (bookPayload as { detail?: string } | null)?.detail ||
              "Failed to save word meanings rollout"
          );
        }

        const updatedBook = bookPayload as BookDetails;
        setCurrentBook(updatedBook);
        setWordMeaningsEnabledLevelSelection(getWordMeaningsEnabledLevelsFromBook(updatedBook));
      }

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
        setCanAdmin(false);
        setCanContribute(false);
        setCanEdit(false);
        return;
      }
      setAuthUserId(data.id ?? null);
      setAuthEmail(data.email || null);
      setAuthStatus(data.email ? `Signed in as ${data.email}` : "Authenticated");
      setCanAdmin(Boolean(data.permissions?.can_admin || data.role === "admin"));
      setCanContribute(Boolean(data.permissions?.can_contribute || data.role === "contributor" || data.role === "editor" || data.role === "admin"));
      setCanEdit(Boolean(data.permissions?.can_edit || data.role === "editor" || data.role === "admin"));
    } catch {
      setAuthEmail(null);
      setAuthUserId(null);
      setAuthStatus("Auth check failed");
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
  const canDeleteCurrentBook =
    Boolean(currentBook) &&
    (canAdmin ||
      (isCurrentBookOwner && (currentBook?.visibility || "private") !== "public"));
  const canTogglePublish =
    Boolean(bookId) &&
    Boolean(currentBook) &&
    (canAdmin || isCurrentBookOwner);
  const canManageShares = canTogglePublish;
  const isCurrentBookPublic = (currentBook?.visibility || "private") === "public";
  const canUseBookDraftActions = Boolean(authEmail) && Boolean(bookId);
  const canPreviewCurrentBook =
    Boolean(bookId) && (Boolean(authEmail) || isCurrentBookPublic);
  const activeNodeLevelLabel = formatValue(nodeContent?.level_name) || "Node";
  const activeNodePropertiesLabel = `${activeNodeLevelLabel} properties`;
  const activeNodePropertiesTitle = `${activeNodeLevelLabel} Properties`;
  const activeNodeEditLabel = `Edit ${activeNodeLevelLabel}`;
  const activeNodeDeleteLabel = `Delete ${activeNodeLevelLabel}`;
  const currentBookSchemaLevels = Array.isArray(currentBook?.schema?.levels)
    ? currentBook.schema.levels
    : [];

  useEffect(() => {
    if (!showPropertiesModal || propertiesScope !== "book" || !currentBook) return;

    setWordMeaningsEnabledLevelSelection(getWordMeaningsEnabledLevelsFromBook(currentBook));
    const renderingSettings = getWordMeaningsRenderingSettingsFromBook(currentBook);
    setWordMeaningsSourceDisplayModeSelection(renderingSettings.sourceDisplayMode);
    setWordMeaningsPreferredSchemeSelection(renderingSettings.preferredScheme);
    setWordMeaningsAllowRuntimeGenerationSelection(renderingSettings.allowRuntimeGeneration);
    setWordMeaningsMeaningLanguageSelection(renderingSettings.meaningLanguage);
    setWordMeaningsFallbackOrderInput(renderingSettings.fallbackOrder.join(", "));
  }, [showPropertiesModal, propertiesScope, currentBook]);

  const handleTogglePublish = async () => {
    if (!bookId || !currentBook) return;
    const isPublic = (currentBook.visibility || "private") === "public";
    const payload = isPublic
      ? { status: "draft", visibility: "private" }
      : { status: "published", visibility: "public" };

    try {
      setBookVisibilitySubmitting(true);
      const response = await fetch(`/api/books/${bookId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => null)) as
        | BookDetails
        | { detail?: string }
        | null;

      if (!response.ok) {
        alert(
          (result as { detail?: string } | null)?.detail ||
            "Failed to update publish state"
        );
        return;
      }

      const updatedBook = result as BookDetails;
      setCurrentBook(updatedBook);
      setBooks((prev) =>
        prev.map((book) =>
          book.id.toString() === bookId
            ? {
                ...book,
                status: updatedBook.status,
                visibility: updatedBook.visibility,
              }
            : book
        )
      );
    } catch {
      alert("Failed to update publish state");
    } finally {
      setBookVisibilitySubmitting(false);
    }
  };

  const handleDeleteCurrentBook = async () => {
    if (!bookId || !currentBook) return;

    const isPublic = (currentBook.visibility || "private") === "public";
    if (isPublic && !canAdmin) {
      alert("Public books cannot be deleted. Unpublish the book first.");
      return;
    }

    if (
      !window.confirm(
        `Delete "${currentBook.book_name}"? This will permanently remove all nested content.`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/books/${bookId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as
        | { detail?: string }
        | null;

      if (!response.ok) {
        alert(payload?.detail || "Failed to delete book");
        return;
      }

      setShowBookActionsMenu(false);
      setShowShareManager(false);
      setSelectedId(null);
      setNodeContent(null);
      setTreeData([]);
      setExpandedIds(new Set());
      setBreadcrumb([]);
      setCurrentBook(null);
      setBookId("");
      await loadBooksRefresh();
      router.replace("/scriptures");
    } catch {
      alert("Failed to delete book");
    }
  };

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
        const storedRaw = window.localStorage.getItem(LOCAL_SCRIPTURES_PREFERENCES_KEY);
        if (storedRaw) {
          try {
            const parsed = JSON.parse(storedRaw) as StoredScripturesPreferences;
            const normalized = normalizePreferences(parsed.preferences ?? parsed);
            if (typeof parsed.show_only_preferred_script === "boolean") {
              normalized.show_only_preferred_script = parsed.show_only_preferred_script;
            }
            setPreferences(normalized);
            return;
          } catch {
            window.localStorage.removeItem(LOCAL_SCRIPTURES_PREFERENCES_KEY);
          }
        }

        setPreferences(DEFAULT_USER_PREFERENCES);
        return;
      }

      try {
        const response = await fetch("/api/preferences", { credentials: "include" });
        if (!response.ok) return;
        const data = (await response.json()) as UserPreferences;
        setPreferences(normalizePreferences(data));
      } catch {
        setPreferences(DEFAULT_USER_PREFERENCES);
      }
    };

    loadPreferences();
  }, [authEmail]);

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
  const showTransliteration =
    transliterationEnabled && (!scriptPrefersRoman || showRomanTransliteration);

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

  useEffect(() => {
    const loadBooks = async () => {
      try {
        const response = await fetch("/api/books", {
          credentials: "include",
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as BookOption[];
        setBooks(data);
      } catch {
        setBooks([]);
      }
    };
    loadBooks();
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
          applySelection(autoSelectNodeId, path, true);
        }
      } else {
        setSelectedId(null);
        setBreadcrumb([]);
        setExpandedIds(new Set());
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
    skipLoad = false
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
      applySelection(nodeId, path, false, false);
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
    try {
      const response = await fetch("/api/books", {
        credentials: "include",
      });
      if (response.ok) {
        const data = (await response.json()) as BookOption[];
        setBooks(data);
      }
    } catch {
      // Ignore errors
    }
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

  const handleOpenShareManager = async () => {
    setShowShareManager(true);
    await loadBookShares();
  };

  const handlePreviewBook = async (scope: "book" | "node" = "book") => {
    if (!bookId) return;

    const nextLanguageSettings = {
      ...bookPreviewLanguageSettings,
    };
    const nextShowPreviewLabels = showPreviewLabels;
    const nextShowPreviewDetails = showPreviewDetails;
    const nextShowPreviewTitles = showPreviewTitles;
    const nextPreviewTransliterationScript = previewTransliterationScript;

    setBookPreviewLoading(true);
    setBookPreviewError(null);

    try {
      const response = await fetch(`/api/books/${bookId}/preview/render`, {
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

      setShowBookPreview(true);
    } catch (err) {
      setShowBookPreview(false);
      setBookPreviewError(err instanceof Error ? err.message : "Failed to render book preview");
    } finally {
      setBookPreviewLoading(false);
    }
  };

  const handleAddBookAsDraftBody = async () => {
    if (!bookId || bookBodyAddLoading) return;

    setBookBodyAddLoading(true);
    setBookBodyAddMessage(null);

    try {
      const selectedBookId = Number(bookId);
      const response = await fetch("/api/cart/items", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: -selectedBookId,
          item_type: "library_node",
          source_book_id: selectedBookId,
          metadata: {
            title: currentBook?.book_name || `Book ${selectedBookId}`,
            book_name: currentBook?.book_name || `Book ${selectedBookId}`,
            level_name: "book",
          },
        }),
      });

      if (response.status !== 409 && !response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || "Failed to add book to draft body cart");
      }

      await loadBasket();
      setBookBodyAddMessage("Book added as body source. Use Create Draft in Basket.");
      setTimeout(() => setBookBodyAddMessage(null), 2500);
    } catch (err) {
      setBookBodyAddMessage(err instanceof Error ? err.message : "Failed to add book to draft body cart");
    } finally {
      setBookBodyAddLoading(false);
    }
  };

  const handleCreateDraftFromBookBody = async () => {
    if (!bookId || bookBodyCreateDraftLoading) return;

    setBookBodyCreateDraftLoading(true);
    setBookBodyAddMessage(null);

    try {
      const selectedBookId = Number(bookId);
      const addResponse = await fetch("/api/cart/items", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: -selectedBookId,
          item_type: "library_node",
          source_book_id: selectedBookId,
          metadata: {
            title: currentBook?.book_name || `Book ${selectedBookId}`,
            book_name: currentBook?.book_name || `Book ${selectedBookId}`,
            level_name: "book",
          },
        }),
      });

      if (addResponse.status !== 409 && !addResponse.ok) {
        const addPayload = (await addResponse.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(addPayload?.detail || "Failed to add book to draft body cart");
      }

      const draftTitle = currentBook?.book_name
        ? `Draft from ${currentBook.book_name}`
        : "Draft from Book";
      const createResponse = await fetch("/api/cart/me/create-draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle,
          clear_cart_after_create: true,
        }),
      });

      const createPayload = (await createResponse.json().catch(() => null)) as
        | { id?: number; detail?: string }
        | null;

      if (!createResponse.ok) {
        throw new Error(createPayload?.detail || "Failed to create draft from book body");
      }

      if (typeof createPayload?.id === "number") {
        window.location.href = `/drafts?draftId=${createPayload.id}`;
        return;
      }

      throw new Error("Draft created, but response did not include an id");
    } catch (err) {
      setBookBodyAddMessage(err instanceof Error ? err.message : "Failed to create draft from book body");
    } finally {
      setBookBodyCreateDraftLoading(false);
    }
  };

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
      const payload = {
        schema_id: selectedSchema,
        book_name: bookFormData.bookName,
        book_code: bookFormData.bookCode || null,
        language_primary: bookFormData.languagePrimary,
        metadata: {},
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
        setBookFormData({
          bookName: "",
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

      // Calculate level_order based on parent node
      let levelOrder = 1;
      if (action === "add" && actionNode) {
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
        action === "add"
          ? {
              ...basePayload,
              book_id: parseInt(bookId, 10),
              parent_node_id: actionNode.level_name === "BOOK" ? null : actionNode.id,
              level_order: levelOrder,
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
        const preservedNodeId =
          action === "edit" ? actionNode.id : selectedId ?? actionNode.id;

        pendingSavedNodeId.current = preservedNodeId;

        if (preservedNodeId && typeof window !== "undefined" && bookId) {
          const url = new URL(window.location.href);
          url.searchParams.set("book", bookId);
          url.searchParams.set("node", String(preservedNodeId));
          window.history.replaceState(window.history.state, "", url.toString());
        }

        // Reset form and close modal
        setAction(null);
        setActionNode(null);
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
        // Refresh tree without losing context
        if (bookId) {
          setTreeLoading(true);
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
  const isCopyMessage = authMessage === "Link copied.";

  return (
    <div className="grainy-bg min-h-screen">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-12 pt-8 sm:gap-10 sm:px-6 sm:pb-20 sm:pt-12">
        {searchReturnUrl && (
          <div className="flex items-center gap-2">
            <a
              href={searchReturnUrl}
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--accent)] bg-white px-4 py-2 text-sm font-medium text-[color:var(--accent)] transition hover:bg-[color:var(--accent)] hover:text-white"
            >
              ← Back to Search Results
            </a>
          </div>
        )}
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Library</p>
          <h1 className="font-[var(--font-display)] text-4xl text-[color:var(--deep)]">
            Scripture browser
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            Explore the canon by book. Select a scripture to see its nested structure.
          </p>
        </header>

        <section className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-lg sm:rounded-[32px] sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Book
              </span>
              <select
                value={bookId}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value !== bookId && hasUnsavedInlineChanges()) {
                    const shouldDiscard = window.confirm(
                      "You have unsaved changes in Edit details. Discard changes and switch books?"
                    );
                    if (!shouldDiscard) {
                      return;
                    }
                  }
                  setBookId(value);
                  // Update URL without node param when changing books
                  if (value) {
                    router.push(`/scriptures?book=${value}`, { scroll: false });
                  } else {
                    router.push("/scriptures", { scroll: false });
                  }
                  setSelectedId(null);
                  setBreadcrumb([]);
                }}
                className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
              >
                <option value="">Select a book</option>
                {books.map((book) => (
                  <option key={book.id} value={book.id.toString()}>
                    {book.book_name}
                    {book.visibility === "private" ? " (Private draft)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {(bookId || canContribute) && (
              <div ref={bookActionsMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowBookActionsMenu((prev) => !prev)}
                  title="Book actions"
                  aria-label="Book actions"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-lg text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50"
                >
                  ⋮
                </button>
                {showBookActionsMenu && (
                  <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-black/10 bg-white p-1 shadow-xl">
                    {bookId && (
                      <>
                        {canUseBookDraftActions && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setShowBookActionsMenu(false);
                                void handleAddBookAsDraftBody();
                              }}
                              disabled={bookBodyAddLoading || bookBodyCreateDraftLoading}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <ShoppingBasket size={14} />
                              {bookBodyAddLoading ? "Adding to basket..." : "Add book as body to basket"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowBookActionsMenu(false);
                                void handleCreateDraftFromBookBody();
                              }}
                              disabled={bookBodyCreateDraftLoading || bookBodyAddLoading}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Plus size={14} />
                              {bookBodyCreateDraftLoading ? "Creating draft..." : "Create draft from book"}
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setShowBookActionsMenu(false);
                            void handlePreviewBook("book");
                          }}
                          disabled={bookPreviewLoading || !canPreviewCurrentBook}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Eye size={14} />
                          {!canPreviewCurrentBook
                            ? "Preview unavailable"
                            : bookPreviewLoading
                            ? "Loading preview..."
                            : "Preview book"}
                        </button>
                        {selectedId && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowBookActionsMenu(false);
                              void handlePreviewBook("node");
                            }}
                            disabled={bookPreviewLoading || !canPreviewCurrentBook}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Eye size={14} />
                            {bookPreviewLoading ? "Loading preview..." : "Preview selected level"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const url = `${window.location.origin}/scriptures?book=${bookId}`;
                            navigator.clipboard.writeText(url);
                            setShowBookActionsMenu(false);
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
                          Copy book link
                        </button>
                      </>
                    )}
                    {canContribute && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowBookActionsMenu(false);
                          loadSchemas();
                          setShowCreateBook(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                      >
                        <Plus size={14} />
                        Create book
                      </button>
                    )}
                    {canTogglePublish && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowBookActionsMenu(false);
                          void handleTogglePublish();
                        }}
                        disabled={bookVisibilitySubmitting}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Upload size={14} />
                        {bookVisibilitySubmitting
                          ? "Updating visibility..."
                          : currentBook?.visibility === "public"
                          ? "Unpublish book"
                          : "Publish book"}
                      </button>
                    )}
                    {canManageShares && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowBookActionsMenu(false);
                          void handleOpenShareManager();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                      >
                        <Share2 size={14} />
                        Manage sharing
                      </button>
                    )}
                    {canEditCurrentBook && bookId && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowBookActionsMenu(false);
                          void openPropertiesModal("book");
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                      >
                        <SlidersHorizontal size={14} />
                        Book properties
                      </button>
                    )}
                    {canDeleteCurrentBook && bookId && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowBookActionsMenu(false);
                          void handleDeleteCurrentBook();
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
            {isCopyMessage && copyTarget === "book" && !showLogin && (
              <div className="rounded-full bg-blue-500 px-3 py-1 text-[10px] text-white shadow">
                {authMessage}
              </div>
            )}
            {bookId && currentBook && (
              <span
                title={
                  (currentBook.visibility || "private") === "public"
                    ? "Visible to all users"
                    : "Private draft: only you and users you explicitly share this book with can view it"
                }
                aria-label={
                  (currentBook.visibility || "private") === "public"
                    ? "Public visibility"
                    : "Private draft visibility: only you and explicitly shared users can view"
                }
                className="inline-flex h-9 items-center rounded-full border border-black/10 bg-white/80 px-3 text-[10px] uppercase tracking-[0.2em] text-zinc-600"
              >
                {(currentBook.visibility || "private") === "public"
                  ? "Public"
                  : "Private draft"}
              </span>
            )}
          </div>

          {bookPreviewError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {bookPreviewError}
            </div>
          )}

          {bookBodyAddMessage && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {bookBodyAddMessage}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500 lg:hidden">
            <button
              type="button"
              onClick={() => setMobilePanel("tree")}
              aria-pressed={mobilePanel === "tree"}
              className={`rounded-full border px-3 py-1 transition ${
                mobilePanel === "tree"
                  ? "border-[color:var(--accent)] text-[color:var(--accent)]"
                  : "border-black/10 bg-white/80"
              }`}
            >
              Tree
            </button>
            <button
              type="button"
              onClick={() => setMobilePanel("content")}
              aria-pressed={mobilePanel === "content"}
              className={`rounded-full border px-3 py-1 transition ${
                mobilePanel === "content"
                  ? "border-[color:var(--accent)] text-[color:var(--accent)]"
                  : "border-black/10 bg-white/80"
              }`}
            >
              Details
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-6 sm:gap-6 lg:grid-cols-3 lg:h-[calc(100vh-280px)]">
            {/* Tree Section */}
            <div
              className={`lg:col-span-1 min-h-0 rounded-2xl border border-black/10 bg-white/90 p-4 lg:flex lg:h-full lg:flex-col ${
                mobilePanel === "tree" ? "block" : "hidden"
              } lg:block`}
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
                    {canContribute && currentBook?.schema && (
                      <button
                        type="button"
                        onClick={() => {
                          // Create a virtual "book" node to use as parent
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
                        title={`Add ${currentBook.schema?.levels[0] || "Node"}`}
                        className="rounded-full border border-green-500/30 bg-green-50 px-2 py-1 text-xs text-green-700 transition hover:border-green-500/60 hover:shadow-md"
                      >
                        + Add
                      </button>
                    )}
                    {currentBook?.schema?.levels && currentBook.schema.levels.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedIds(new Set(treeData.map((node) => node.id)))
                          }
                          className="rounded-full border border-black/10 bg-white/80 px-2 py-1 text-xs transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                        >
                          Expand all
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedIds(new Set())}
                          className="rounded-full border border-black/10 bg-white/80 px-2 py-1 text-xs transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                        >
                          Collapse all
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

            {/* Content Section */}
            <div
              className={`lg:col-span-2 min-h-0 rounded-2xl border border-black/10 bg-white/80 p-4 shadow-lg sm:p-6 lg:h-full lg:overflow-y-auto lg:overscroll-contain ${
                mobilePanel === "content" ? "block" : "hidden"
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
                      {!canEditCurrentBook && (
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
                      setShowBookActionsMenu(false);
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
                          <button
                            type="button"
                            onClick={inlineEditMode ? handleCancelInlineEdit : handleStartInlineEdit}
                            disabled={inlineSubmitting}
                            className="rounded-lg border border-black/10 bg-white/90 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {inlineEditMode ? "Cancel edit" : "Edit details"}
                          </button>
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
                              {isLeafSelected && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = `${window.location.origin}/scriptures?book=${bookId}&node=${selectedId}`;
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
                                  Copy node link
                                </button>
                              )}
                              {!isLeafSelected && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = `${window.location.origin}/scriptures?book=${bookId}&node=${selectedId}`;
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
                                  Copy node link
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
                            {inlineSubmitting ? "Saving..." : "Save details"}
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
        </section>

        {showPropertiesModal && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 md:items-center">
            <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    {propertiesScope === "book" ? "Book Properties" : activeNodePropertiesTitle}
                  </h2>
                  <p className="text-sm text-zinc-600">
                    Base properties: Name, Description, Category. Other fields are category metadata properties.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowPropertiesModal(false);
                    setPropertiesMessage(null);
                    setPropertiesError(null);
                  }}
                  className="text-2xl text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 overflow-y-auto pr-1">
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Name</span>
                  <input
                    type="text"
                    readOnly
                    value={
                      propertiesScope === "book"
                        ? currentBook?.book_name || ""
                        : nodeContent?.title_english || nodeContent?.title_sanskrit || nodeContent?.title_transliteration || `Node ${propertiesNodeId || ""}`
                    }
                    className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Description</span>
                  <textarea
                    readOnly
                    value={
                      propertiesScope === "book"
                        ? (typeof (currentBook?.metadata_json || currentBook?.metadata || {})?.description === "string"
                            ? String((currentBook?.metadata_json || currentBook?.metadata || {}).description)
                            : "")
                        : `${nodeContent?.level_name || "Node"} ${formatSequenceDisplay(nodeContent?.sequence_number, Boolean(nodeContent?.has_content)) || propertiesNodeId || ""}`
                    }
                    rows={2}
                    className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Category</span>
                  <select
                    value={propertiesCategoryId?.toString() || ""}
                    onChange={(event) => {
                      void handlePropertiesCategoryChange(event.target.value);
                    }}
                    disabled={propertiesLoading || metadataCategoriesLoading}
                    className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)] disabled:opacity-60"
                  >
                    <option value="">Select category</option>
                    {metadataCategories.map((category) => (
                      <option key={category.id} value={category.id.toString()}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>

                {propertiesLoading && (
                  <p className="text-xs text-zinc-500">Loading metadata properties...</p>
                )}

                {propertiesError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {propertiesError}
                  </div>
                )}

                {!propertiesLoading && propertiesCategoryId && propertiesEffectiveFields.length === 0 && (
                  <p className="text-xs text-zinc-500">Selected category has no metadata properties.</p>
                )}

                {propertiesScope === "book" && (
                  <div className="rounded-lg border border-black/10 bg-white p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Word Meanings Rollout
                    </div>
                    <p className="mt-1 text-xs text-zinc-600">
                      Enable word-to-word meanings for selected levels in this book.
                    </p>
                    {currentBookSchemaLevels.length === 0 ? (
                      <p className="mt-2 text-xs text-zinc-500">
                        No schema levels available for this book.
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {currentBookSchemaLevels.map((level) => {
                          const normalized = level.trim().toLowerCase();
                          const checked = wordMeaningsEnabledLevelSelection.has(normalized);
                          return (
                            <label
                              key={level}
                              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs text-zinc-700"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggleWordMeaningsRolloutLevel(level)}
                                disabled={propertiesSaving || propertiesLoading}
                              />
                              <span>{level}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-zinc-500">
                      Changes are saved with Save Properties.
                    </p>

                    <div className="mt-4 border-t border-black/10 pt-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Word Meanings Rendering
                      </div>
                      <p className="mt-1 text-xs text-zinc-600">
                        Controls how W2W source and meaning are rendered in preview/export.
                      </p>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Source Display Mode</span>
                          <select
                            value={wordMeaningsSourceDisplayModeSelection}
                            onChange={(event) => {
                              setWordMeaningsSourceDisplayModeSelection(
                                event.target.value === "transliteration" ? "transliteration" : "script"
                              );
                              setPropertiesMessage(null);
                              setPropertiesError(null);
                            }}
                            disabled={propertiesSaving || propertiesLoading}
                            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                          >
                            <option value="script">Script</option>
                            <option value="transliteration">Transliteration</option>
                          </select>
                        </label>

                        <label className="flex flex-col gap-1">
                          <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Preferred Transliteration Scheme</span>
                          <select
                            value={wordMeaningsPreferredSchemeSelection}
                            onChange={(event) => {
                              const nextValue = event.target.value as (typeof WORD_MEANINGS_ALLOWED_TRANSLITERATION_SCHEMES)[number];
                              setWordMeaningsPreferredSchemeSelection(
                                WORD_MEANINGS_ALLOWED_TRANSLITERATION_SCHEMES.includes(nextValue)
                                  ? nextValue
                                  : "iast"
                              );
                              setPropertiesMessage(null);
                              setPropertiesError(null);
                            }}
                            disabled={propertiesSaving || propertiesLoading}
                            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                          >
                            {WORD_MEANINGS_ALLOWED_TRANSLITERATION_SCHEMES.map((scheme) => (
                              <option key={scheme} value={scheme}>{scheme}</option>
                            ))}
                          </select>
                        </label>

                        <label className="flex flex-col gap-1">
                          <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Meaning Language</span>
                          <select
                            value={wordMeaningsMeaningLanguageSelection}
                            onChange={(event) => {
                              const nextValue = event.target.value as (typeof WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES)[number];
                              setWordMeaningsMeaningLanguageSelection(
                                WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES.includes(nextValue)
                                  ? nextValue
                                  : "en"
                              );
                              setPropertiesMessage(null);
                              setPropertiesError(null);
                            }}
                            disabled={propertiesSaving || propertiesLoading}
                            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                          >
                            {WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES.map((language) => (
                              <option key={language} value={language}>{language}</option>
                            ))}
                          </select>
                        </label>

                        <label className="flex flex-col gap-1">
                          <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Fallback Order</span>
                          <input
                            type="text"
                            value={wordMeaningsFallbackOrderInput}
                            onChange={(event) => {
                              setWordMeaningsFallbackOrderInput(event.target.value);
                              setPropertiesMessage(null);
                              setPropertiesError(null);
                            }}
                            disabled={propertiesSaving || propertiesLoading}
                            placeholder="user_preference, en, first_available"
                            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                          />
                          <span className="text-[11px] text-zinc-500">
                            Allowed: {WORD_MEANINGS_ALLOWED_FALLBACK_STRATEGIES.join(", ")}
                          </span>
                        </label>
                      </div>

                      <label className="mt-3 inline-flex items-center gap-2 text-xs text-zinc-700">
                        <input
                          type="checkbox"
                          checked={wordMeaningsAllowRuntimeGenerationSelection}
                          onChange={(event) => {
                            setWordMeaningsAllowRuntimeGenerationSelection(event.target.checked);
                            setPropertiesMessage(null);
                            setPropertiesError(null);
                          }}
                          disabled={propertiesSaving || propertiesLoading}
                        />
                        <span>Allow runtime transliteration generation</span>
                      </label>
                    </div>
                  </div>
                )}

                {propertiesEffectiveFields.map((field) => {
                  const key = field.property_internal_name;
                  const value = propertiesValues[key];
                  const required = Boolean(field.is_required);

                  if (field.property_data_type === "boolean") {
                    return (
                      <label key={key} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700">
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.checked)}
                          className="rounded border-black/20"
                        />
                        <span>{field.property_display_name}{required ? " *" : ""}</span>
                      </label>
                    );
                  }

                  if (field.property_data_type === "dropdown") {
                    const dropdownValue = metadataObjectToDisplayText(value);
                    return (
                      <label key={key} className="flex flex-col gap-1">
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{field.property_display_name}{required ? " *" : ""}</span>
                        <select
                          value={dropdownValue}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.value)}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">Select value</option>
                          {(field.dropdown_options || []).map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </label>
                    );
                  }

                  if (field.property_data_type === "number") {
                    return (
                      <label key={key} className="flex flex-col gap-1">
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{field.property_display_name}{required ? " *" : ""}</span>
                        <input
                          type="number"
                          value={value === null || value === undefined ? "" : String(value)}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.value)}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                    );
                  }

                  if (field.property_data_type === "date") {
                    return (
                      <label key={key} className="flex flex-col gap-1">
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{field.property_display_name}{required ? " *" : ""}</span>
                        <input
                          type="date"
                          value={typeof value === "string" ? value : ""}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.value)}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                    );
                  }

                  if (field.property_data_type === "datetime") {
                    return (
                      <label key={key} className="flex flex-col gap-1">
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{field.property_display_name}{required ? " *" : ""}</span>
                        <input
                          type="datetime-local"
                          value={toDatetimeLocalValue(value)}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.value)}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                    );
                  }

                  const singleLine = isSingleLineTextMetadataField(field);
                  const isTemplateField = isTemplateMetadataField(field);
                  const textValue = metadataObjectToDisplayText(value);

                  return (
                    <label key={key} className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{field.property_display_name}{required ? " *" : ""}</span>
                      {isTemplateField ? (
                        <select
                          value={textValue}
                          disabled
                          className="rounded-lg border border-black/10 bg-zinc-100 px-3 py-2 text-sm text-zinc-700"
                        >
                          <option value={textValue}>{textValue || "Not configured"}</option>
                        </select>
                      ) : singleLine ? (
                        <input
                          type="text"
                          value={textValue}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.value)}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        />
                      ) : (
                        <textarea
                          value={textValue}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.value)}
                          rows={4}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        />
                      )}
                    </label>
                  );
                })}

                <div className="sticky bottom-0 flex items-center gap-2 border-t border-black/5 bg-white/95 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      void handleSaveProperties();
                    }}
                    disabled={propertiesSaving || propertiesLoading || !propertiesCategoryId}
                    className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
                  >
                    {propertiesSaving ? "Saving..." : "Save Properties"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void openPropertiesModal(propertiesScope, propertiesNodeId);
                    }}
                    disabled={propertiesLoading || propertiesSaving}
                    className="rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-600 transition hover:border-black/20 disabled:opacity-50"
                  >
                    Refresh
                  </button>
                  {propertiesMessage && <span className="text-xs text-emerald-700">{propertiesMessage}</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {showBookPreview && bookPreviewArtifact && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 sm:p-6">
            <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-black/10 bg-white/95 shadow-2xl">
              <div className="flex items-center justify-between border-b border-black/10 bg-white/95 px-6 py-4">
                <div>
                  <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    {bookPreviewArtifact.preview_scope === "node" ? "Level Preview" : "Book Preview"}
                  </h2>
                  <p className="text-sm text-zinc-600">
                    {bookPreviewArtifact.preview_scope === "node"
                      ? `${bookPreviewArtifact.root_title || "Selected level"} • ${bookPreviewArtifact.book_name}`
                      : bookPreviewArtifact.book_name}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowPreviewControls((prev) => !prev)}
                    className="rounded-full border border-black/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-zinc-600 transition hover:border-black/20"
                  >
                    {showPreviewControls ? "Hide Controls" : "Show Controls"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBookPreview(false)}
                    className="text-2xl text-zinc-400 hover:text-zinc-600"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
                {bookPreviewArtifact.warnings && bookPreviewArtifact.warnings.length > 0 && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    {bookPreviewArtifact.warnings.join(" ")}
                  </div>
                )}

                {showPreviewControls && (
                  <div className="mb-3 rounded-xl border border-black/10 bg-white/90 p-3">
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Preview Options</div>
                        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-zinc-700">
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
                        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-zinc-700">
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
                  <div className="mb-3 rounded-xl border border-black/10 bg-white/90 p-3">
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

                <div className="space-y-2 rounded-2xl border border-black/10 bg-white/80 p-3">
                  {bookPreviewArtifact.sections.body.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      {bookPreviewArtifact.preview_scope === "node"
                        ? "No previewable content found under this level."
                        : "No previewable content found for this book."}
                    </p>
                  ) : (
                    bookPreviewArtifact.sections.body.map((block) => {
                      const contentLines = resolvePreviewContentLines(block, bookPreviewArtifact.render_settings);
                      const wordMeaningRows = resolvePreviewWordMeanings(block);
                      const rawTitle = block.title || "";
                      const hideNodeFallback = !appliedShowPreviewDetails && /^Node\s+\d+$/i.test(rawTitle.trim());
                      const displayTitle = appliedShowPreviewTitles && !hideNodeFallback ? rawTitle : "";
                      return (
                        <article
                          key={`${block.section}-${block.order}-${block.source_node_id ?? block.title}`}
                          className="rounded-xl border border-black/10 bg-white p-3"
                        >
                          {displayTitle && (
                            <div className="text-sm font-semibold text-[color:var(--deep)]">{displayTitle}</div>
                          )}
                          <div className="mt-2 space-y-1">
                            {contentLines.length === 0 ? (
                              <p className="text-sm text-zinc-500">No textual content in this block.</p>
                            ) : (
                              contentLines.map((line) => (
                                <div key={`${line.key}-${line.value.slice(0, 24)}`}>
                                  {line.label && (
                                    <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{line.label}</div>
                                  )}
                                  <p className={line.className}>{line.value}</p>
                                </div>
                              ))
                            )}
                          </div>
                          {wordMeaningRows.length > 0 && (
                            <div className="mt-3 rounded-lg border border-black/10 bg-zinc-50/70 p-2.5">
                              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                                Word Meanings
                              </div>
                              <div className="space-y-1.5">
                                {wordMeaningRows.map((row) => (
                                  <div key={row.key} className="grid grid-cols-1 gap-1.5 text-sm md:grid-cols-2 md:gap-3">
                                    <div className="font-medium text-[color:var(--deep)]">{row.sourceText || "—"}</div>
                                    <div className="text-zinc-700">
                                      <span>{row.meaningText || "—"}</span>
                                      {row.fallbackBadgeVisible && row.meaningLanguage && (
                                        <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-700">
                                          {row.meaningLanguage}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-2xl rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl">
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

              <div className="max-h-[45vh] overflow-y-auto rounded-2xl border border-black/10">
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-2xl rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                  Create New Book
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateBook(false);
                    setSelectedSchema(null);
                    setBookFormData({
                      bookName: "",
                      bookCode: "",
                      languagePrimary: "sanskrit",
                    });
                  }}
                  className="text-2xl text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>
                            wordMeanings: [],

              {!selectedSchema ? (
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-zinc-600">
                    Select a schema that defines the structure of your scripture:
                  </p>
                  <div className="grid gap-3">
                    {schemas.map((schema) => (
                      <button
                        key={schema.id}
                        type="button"
                        onClick={() => setSelectedSchema(schema.id)}
                        className="rounded-2xl border border-black/10 bg-white/90 p-4 text-left transition hover:border-[color:var(--accent)] hover:shadow-md"
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
                    ))}
                  </div>
                  {schemas.length === 0 && (
                    <p className="text-sm text-zinc-500">No schemas available</p>
                  )}
                </div>
              ) : (
                <form onSubmit={handleCreateBook} className="flex flex-col gap-4">
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
                      Book Name *
                    </label>
                    <input
                      type="text"
                      value={bookFormData.bookName}
                      onChange={(e) =>
                        setBookFormData({ ...bookFormData, bookName: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder="e.g., Bhagavad Gita"
                      required
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
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
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
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    >
                      <option value="sanskrit">Sanskrit</option>
                      <option value="english">English</option>
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedSchema(null)}
                      className="rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-600 transition hover:border-black/20"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={bookSubmitting}
                      className="flex-1 rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 font-medium text-white transition disabled:opacity-50"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 overflow-y-auto">
            <div className="w-full max-w-2xl rounded-3xl border border-black/10 bg-white/95 shadow-2xl my-8 flex flex-col max-h-[calc(100vh-4rem)]">
              <div className="flex-shrink-0 p-6 pb-4 border-b border-black/10">
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
                      setActionMessage(null);
                    }}
                    className="text-2xl text-zinc-400 hover:text-zinc-600"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <form onSubmit={handleModalSubmit} className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
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
                  <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={submitting || modalWordMeaningValidationErrors.length > 0}
                    className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 font-medium text-white transition disabled:opacity-50"
                  >
                    {submitting ? "Submitting..." : action === "add" ? "Create" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAction(null);
                      setActionNode(null);
                      setActionMessage(null);
                    }}
                    className="rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-600 transition hover:border-black/20"
                  >
                    Cancel
                  </button>
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
