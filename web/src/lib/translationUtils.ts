import type { NodeContent, AuthorVariantDraft, BookDetails } from "./scriptureTypes";
import { WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES } from "./wordMeanings";

export const TRANSLATION_LANGUAGE_ALIAS_TO_CANONICAL: Record<string, string> = {
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

export const TRANSLATION_CANONICAL_TO_CODE: Record<string, string> = {
  english: "en",
  hindi: "hi",
  telugu: "te",
  kannada: "kn",
  tamil: "ta",
  malayalam: "ml",
  sanskrit: "sa",
};

export const TRANSLATION_LANGUAGE_LABELS: Record<string, string> = {
  english: "English",
  hindi: "Hindi",
  telugu: "Telugu",
  kannada: "Kannada",
  tamil: "Tamil",
  malayalam: "Malayalam",
  sanskrit: "Sanskrit",
};

export const PREVIEW_TRANSLATION_LANGUAGES_STORAGE_KEY = "scriptures.preview.translationLanguages";
export const PREVIEW_FONT_SIZE_PERCENT_STORAGE_KEY = "scriptures.preview.fontSizePercent";
export const PREVIEW_EDIT_MODE_SESSION_STORAGE_KEY = "scriptures.preview.editMode";
export const BROWSE_TRANSLATION_LANGUAGES_STORAGE_KEY = "scriptures.browse.translationLanguages";
export const IMPORT_CANONICAL_CHUNK_FALLBACK_BYTES = 512 * 1024;
export const PREVIEW_FONT_SIZE_PERCENT_MIN = 75;
export const PREVIEW_FONT_SIZE_PERCENT_MAX = 200;
export const PREVIEW_FONT_SIZE_PERCENT_STEP = 5;

export const EDITABLE_TRANSLATION_LANGUAGES = [
  "english",
  "hindi",
  "kannada",
  "malayalam",
  "sanskrit",
  "tamil",
  "telugu",
] as const;

export type EditableTranslationLanguage = (typeof EDITABLE_TRANSLATION_LANGUAGES)[number];

export type AuthorVariantKind = "translation" | "commentary";

export const normalizeTranslationLanguage = (value?: string | null): string => {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) {
    return "english";
  }
  return TRANSLATION_LANGUAGE_ALIAS_TO_CANONICAL[normalized] || normalized;
};

export const translationLanguageToCode = (value?: string | null): string => {
  const canonical = normalizeTranslationLanguage(value);
  return TRANSLATION_CANONICAL_TO_CODE[canonical] || canonical;
};

export const translationLanguageLabel = (value?: string | null): string => {
  const canonical = normalizeTranslationLanguage(value);
  return TRANSLATION_LANGUAGE_LABELS[canonical] || canonical.toUpperCase();
};

export const sortEditableTranslationLanguages = (
  values: EditableTranslationLanguage[]
): EditableTranslationLanguage[] =>
  [...values].sort((left, right) =>
    translationLanguageLabel(left).localeCompare(translationLanguageLabel(right))
  );

export const getWordMeaningLanguageFromNodeTranslation = (node: NodeContent | null): string | null => {
  if (!node) {
    return null;
  }

  const metadata =
    node.metadata_json && typeof node.metadata_json === "object"
      ? node.metadata_json
      : node.metadata && typeof node.metadata === "object"
        ? node.metadata
        : null;

  const candidates: unknown[] = [
    metadata?.translation_language,
    metadata?.preferred_translation_language,
    metadata?.meaning_language,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) {
      continue;
    }
    const normalized = normalizeTranslationLanguage(candidate);
    const languageCode = translationLanguageToCode(normalized);
    if (
      WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES.includes(
        languageCode as (typeof WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES)[number]
      )
    ) {
      return languageCode;
    }
  }

  return null;
};

export const SORTED_EDITABLE_TRANSLATION_LANGUAGES: EditableTranslationLanguage[] =
  sortEditableTranslationLanguages([...EDITABLE_TRANSLATION_LANGUAGES]);

export const LEGACY_VARIANT_LANGUAGE_PREFIX_TO_CANONICAL: Record<string, string> = {
  e: "english",
  h: "hindi",
  k: "kannada",
  m: "malayalam",
  s: "sanskrit",
  t: "tamil",
};

export const getVariantKindSuffix = (kind: AuthorVariantKind): string =>
  kind === "translation" ? "t" : "c";

export const deriveVariantLanguageFromField = (field?: string | null): string => {
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

export const buildVariantFieldCode = (language: string, kind: AuthorVariantKind): string => {
  const normalizedLanguage = normalizeTranslationLanguage(language || "");
  if (!normalizedLanguage) {
    return "";
  }
  return `${translationLanguageToCode(normalizedLanguage)}${getVariantKindSuffix(kind)}`;
};

export const toTranslationRecord = (value: unknown): Record<string, string> => {
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

export const normalizeAuthorVariantDrafts = (
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
      const text = typeof objectEntry.text === "string" ? objectEntry.text.replace(/\r\n/g, "\n") : "";
      if (!text.trim()) {
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

export const buildEmptyAuthorVariantDraft = (): AuthorVariantDraft => ({
  author_slug: "",
  author: "",
  language: "",
  field: "",
  text: "",
});

export const getVariantAuthorOptions = (
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

export const applyVariantAuthorSelection = (
  entry: AuthorVariantDraft,
  slug: string,
  book: BookDetails | null | undefined,
): AuthorVariantDraft => ({
  ...entry,
  author_slug: slug,
  author: slug ? book?.variant_authors?.[slug] || entry.author || "" : "",
});

export const applyVariantLanguageSelection = (
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

export const getTranslationLookupKeys = (language: string): string[] => {
  const canonical = normalizeTranslationLanguage(language);
  const code = translationLanguageToCode(canonical);
  const keys = [canonical, code];
  if (canonical === "english") {
    keys.push("english", "en");
  }
  return Array.from(new Set(keys.filter(Boolean)));
};

export const pickPreferredTranslationText = (
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
      return value;
    }
  }
  // Last resort: return any available translation value (e.g. translations.te
  // when preferred language is English but only Telugu is stored).
  for (const v of Object.values(translations)) {
    if (typeof v === "string" && v.trim()) {
      return v;
    }
  }
  return "";
};

export const pickTranslationTextForLanguageOnly = (
  translations: Record<string, string>,
  language: string
): string => {
  const keys = getTranslationLookupKeys(language);
  for (const key of keys) {
    const value = translations[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
};

export const applyTranslationDraftValue = (
  translations: Record<string, string>,
  language: string,
  rawValue: string
) => {
  const canonical = normalizeTranslationLanguage(language);
  const code = translationLanguageToCode(canonical);
  const keys = getTranslationLookupKeys(canonical);

  for (const key of keys) {
    delete translations[key];
  }

  const value = rawValue.replace(/\r\n/g, "\n");
  if (!value.trim()) {
    return;
  }

  if (code) {
    translations[code] = value;
  }
  if (canonical) {
    translations[canonical] = value;
  }
};

export const buildEditableTranslationDrafts = (
  translations: Record<string, string>
): Record<EditableTranslationLanguage, string> => {
  const drafts = {} as Record<EditableTranslationLanguage, string>;
  for (const language of EDITABLE_TRANSLATION_LANGUAGES) {
    drafts[language] = pickTranslationTextForLanguageOnly(translations, language);
  }
  return drafts;
};

export const normalizeSelectedEditableTranslationLanguages = (
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

export const parseStoredPreviewTranslationLanguages = (
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

export const serializePreviewTranslationLanguages = (
  values: EditableTranslationLanguage[]
): string => values.join(",");
