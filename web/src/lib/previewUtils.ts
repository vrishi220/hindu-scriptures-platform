import type { EditableTranslationLanguage } from "./translationUtils";
import type { MetadataCategory, EffectivePropertyBinding } from "./scriptureTypes";
import {
  PREVIEW_FONT_SIZE_PERCENT_MIN,
  PREVIEW_FONT_SIZE_PERCENT_MAX,
  PREVIEW_FONT_SIZE_PERCENT_STEP,
  normalizeTranslationLanguage,
} from "./translationUtils";
import {
  WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES,
  WORD_MEANINGS_DEFAULT_SOURCE_LANGUAGE,
  WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES,
  WORD_MEANINGS_DEFAULT_MEANING_LANGUAGE,
} from "./wordMeanings";

export const parseStoredHiddenPreviewLevels = (value: unknown): Set<string> => {
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

export const normalizePreviewFontSizePercent = (value: unknown): number => {
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

export const serializeHiddenPreviewLevels = (values: Set<string>): string =>
  [...values].map((item) => item.trim()).filter(Boolean).join(",");

export const normalizeTranslationDraftsForCompare = (
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

export const areEditableLanguageSelectionsEqual = (
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

export const areStringSetsEqual = (left: Set<string>, right: Set<string>) => {
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

export const normalizeSourceLanguage = (value?: string | null): string =>
  normalizeTranslationLanguage(value);

export const normalizeWordMeaningSourceLanguage = (value?: string | null): string => {
  const normalized = (value || "").trim().toLowerCase();
  return WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES.includes(
    normalized as (typeof WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES)[number]
  )
    ? normalized
    : WORD_MEANINGS_DEFAULT_SOURCE_LANGUAGE;
};

export const normalizeWordMeaningMeaningLanguage = (value?: string | null): string => {
  const normalized = (value || "").trim().toLowerCase();
  return WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES.includes(
    normalized as (typeof WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES)[number]
  )
    ? normalized
    : WORD_MEANINGS_DEFAULT_MEANING_LANGUAGE;
};

export const normalizePreviewWordMeaningsDisplayMode = (
  value?: string | null
): "inline" | "table" | "hide" => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "table") return "table";
  if (normalized === "hide") return "hide";
  return "inline";
};

export const isBookScopedCategory = (category: MetadataCategory): boolean => {
  const scopes = category.applicable_scopes || [];
  return scopes.includes("book") || scopes.includes("all") || scopes.includes("node");
};

export const metadataObjectToDisplayText = (rawValue: unknown): string => {
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

export const normalizeMetadataValue = (dataType: string, rawValue: unknown): unknown => {
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

export const valuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

export const isSingleLineTextMetadataField = (field: EffectivePropertyBinding): boolean => {
  const name = field.property_internal_name.toLowerCase();
  if (name.includes("template") || name.endsWith("_key") || name.includes("render_key")) {
    return true;
  }
  if (name.includes("language") || name.includes("slug") || name.includes("code")) {
    return true;
  }
  return false;
};

export const isTemplateMetadataField = (field: EffectivePropertyBinding): boolean => {
  const name = field.property_internal_name.toLowerCase();
  return name.includes("template") && name.endsWith("_key");
};

export const filterVisibleMetadataFields = (fields: EffectivePropertyBinding[]): EffectivePropertyBinding[] =>
  fields.filter((field) => field.property_internal_name !== "text");

export const getFieldDefaultValue = (field: EffectivePropertyBinding): unknown => {
  return field.default_value ?? null;
};

export const isEmptyMetadataValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  return false;
};

export const normalizeMetadataKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_");

export const isUsableBindingValueForField = (
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

export const toDatetimeLocalValue = (value: unknown): string => {
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
