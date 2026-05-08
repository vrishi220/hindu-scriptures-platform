import {
  hasDevanagariLetters,
  INDIC_SCRIPT_OPTIONS,
  inferIndicScriptFromText,
  normalizeTransliterationScript,
  transliterateBetweenScripts,
  transliterateLatinToDevanagari,
  transliterateLatinToIast,
  transliterateFromDevanagari,
  transliterateFromIast,
} from "./indicScript";
import type { NodeContent } from "./scriptureTypes";

export const WORD_MEANINGS_VERSION = "1.0";
export const WORD_MEANINGS_REQUIRED_LANGUAGE = "en";
export const WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES = ["sa", "pi", "hi", "ta"] as const;
export const WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES = ["en", "hi", "ta", "te", "kn", "ml"] as const;
export const WORD_MEANINGS_DEFAULT_SOURCE_LANGUAGE = "sa";
export const WORD_MEANINGS_DEFAULT_MEANING_LANGUAGE = "en";
export const WORD_MEANINGS_MAX_ROWS = 400;
export const WORD_MEANINGS_MAX_SOURCE_CHARS = 120;
export const WORD_MEANINGS_MAX_MEANING_CHARS = 400;
export const WORD_MEANINGS_HTML_TAG_PATTERN = /<[^>]+>/;

export type WordMeaningPayloadRow = {
  id: string;
  order: number;
  source: {
    language: string;
    script_text?: string;
    transliteration?: Record<string, string>;
  };
  meanings: Record<string, { text: string }>;
};

export type WordMeaningRow = {
  id: string;
  order: number;
  sourceLanguage: string;
  sourceScriptText: string;
  sourceTransliterationIast: string;
  meanings: Record<string, string>;
  activeMeaningLanguage: string;
};

export const autoFillSanskritTransliterationPair = (
  sanskritRaw: string,
  transliterationRaw: string,
  preserveWhitespace: boolean = false
): { sanskrit: string; transliteration: string } => {
  const sanskrit = preserveWhitespace ? sanskritRaw.replace(/\r\n/g, "\n") : sanskritRaw.trim();
  const transliteration = preserveWhitespace
    ? transliterationRaw.replace(/\r\n/g, "\n")
    : transliterationRaw.trim();
  const hasSanskrit = Boolean(sanskrit.trim());
  const hasTransliteration = Boolean(transliteration.trim());

  if (!hasSanskrit && !hasTransliteration) {
    return { sanskrit: "", transliteration: "" };
  }

  if (hasSanskrit && hasTransliteration) {
    return { sanskrit, transliteration };
  }

  if (!hasSanskrit && hasTransliteration) {
    if (hasDevanagariLetters(transliteration)) {
      return {
        sanskrit: transliteration,
        transliteration: transliterateFromDevanagari(transliteration, "iast"),
      };
    }

    const inferredScript = inferIndicScriptFromText(transliteration);
    if (inferredScript && inferredScript !== "devanagari") {
      const devanagariCandidate = transliterateBetweenScripts(
        transliteration,
        inferredScript,
        "devanagari"
      );
      if (hasDevanagariLetters(devanagariCandidate)) {
        return {
          sanskrit: devanagariCandidate,
          transliteration: transliterateFromDevanagari(devanagariCandidate, "iast"),
        };
      }
    }

    for (const scriptOption of INDIC_SCRIPT_OPTIONS) {
      if (scriptOption === "devanagari") continue;
      const devanagariCandidate = transliterateBetweenScripts(
        transliteration,
        scriptOption,
        "devanagari"
      );
      if (!hasDevanagariLetters(devanagariCandidate)) {
        continue;
      }
      return {
        sanskrit: devanagariCandidate,
        transliteration: transliterateFromDevanagari(devanagariCandidate, "iast"),
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

  const inferredScript = inferIndicScriptFromText(sanskrit);
  if (inferredScript && inferredScript !== "devanagari") {
    const devanagariCandidate = transliterateBetweenScripts(
      sanskrit,
      inferredScript,
      "devanagari"
    );
    if (hasDevanagariLetters(devanagariCandidate)) {
      return {
        sanskrit: devanagariCandidate,
        transliteration: transliterateFromDevanagari(devanagariCandidate, "iast"),
      };
    }
  }

  for (const scriptOption of INDIC_SCRIPT_OPTIONS) {
    if (scriptOption === "devanagari") continue;
    const devanagariCandidate = transliterateBetweenScripts(
      sanskrit,
      scriptOption,
      "devanagari"
    );
    if (!hasDevanagariLetters(devanagariCandidate)) {
      continue;
    }
    return {
      sanskrit: devanagariCandidate,
      transliteration: transliterateFromDevanagari(devanagariCandidate, "iast"),
    };
  }

  return {
    sanskrit: transliterateLatinToDevanagari(sanskrit),
    transliteration: transliterateLatinToIast(sanskrit),
  };
};

export const validateWordMeaningsPlainText = (value: unknown, path: string, maxChars: number): string[] => {
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

export const mapWordMeaningRowsForPayload = (rows: WordMeaningRow[]): WordMeaningPayloadRow[] =>
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

export const validateWordMeaningPayloadRows = (rows: WordMeaningPayloadRow[]): string[] => {
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

export const createWordMeaningRowId = () => `wm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createEmptyWordMeaningRow = (
  order: number,
  sourceLanguage: string = WORD_MEANINGS_DEFAULT_SOURCE_LANGUAGE,
  meaningLanguage: string = WORD_MEANINGS_DEFAULT_MEANING_LANGUAGE
): WordMeaningRow => ({
  id: createWordMeaningRowId(),
  order,
  sourceLanguage,
  sourceScriptText: "",
  sourceTransliterationIast: "",
  meanings: {
    [WORD_MEANINGS_REQUIRED_LANGUAGE]: "",
    ...(meaningLanguage === WORD_MEANINGS_REQUIRED_LANGUAGE ? {} : { [meaningLanguage]: "" }),
  },
  activeMeaningLanguage: meaningLanguage,
});

export const splitLegacyWordMeaningEntries = (value: unknown): string[] => {
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

// Separators tried in precedence order. Only the first match wins; combinations are not allowed.
// `:` and `-` are treated as delimiters only when separated from the key by whitespace,
// so embedded forms like `nama:` or `dharma-kshetre` do not split accidentally.
export const WORD_MEANING_SEPARATOR_PATTERNS: RegExp[] = [
  /^(.*?)\s+:\s*(.+)$/,
  /^(.*?)\s*=\s*(.+)$/,
  /^(.*?)\s*\?\s*(.+)$/,
  /^(.*?)\s+-\s*(.+)$/,
];

export const parseWordMeaningEntry = (entry: string): { sourceText: string; meaningText: string } | null => {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }

  for (const pattern of WORD_MEANING_SEPARATOR_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const sourceText = match[1].trim();
      const meaningText = match[2].trim();
      if (!sourceText) {
        return null;
      }
      return { sourceText, meaningText };
    }
  }

  return {
    sourceText: trimmed,
    meaningText: "",
  };
};

export const normalizeWordMeaningSourceForms = (
  source:
    | { script_text?: string; transliteration?: Record<string, string | undefined> }
    | undefined
): { sourceScriptText: string; sourceTransliterationIast: string } => {
  const rawScriptText =
    typeof source?.script_text === "string" ? source.script_text.trim() : "";
  const rawTransliteration =
    source?.transliteration && typeof source.transliteration === "object"
      ? source.transliteration
      : undefined;

  let sourceTransliterationIast = "";

  if (rawTransliteration) {
    const directIast = rawTransliteration.iast;
    if (typeof directIast === "string" && directIast.trim()) {
      // IAST is a Latin-based scheme. If the stored value contains Indic script characters
      // it is corrupt data (e.g. Telugu stored verbatim in the iast field). Discard it and
      // fall through to re-derive from script_text below.
      if (!inferIndicScriptFromText(directIast.trim())) {
        sourceTransliterationIast = directIast.trim();
      }
    } else {
      for (const [scheme, value] of Object.entries(rawTransliteration)) {
        if (typeof value !== "string" || !value.trim()) {
          continue;
        }
        const sourceScheme = normalizeTransliterationScript(scheme);
        const converted = transliterateBetweenScripts(value, sourceScheme, "iast").trim();
        if (converted) {
          sourceTransliterationIast = converted;
          break;
        }
      }
    }
  }

  if (!sourceTransliterationIast && rawScriptText) {
    if (hasDevanagariLetters(rawScriptText)) {
      sourceTransliterationIast = transliterateFromDevanagari(rawScriptText, "iast").trim();
    } else {
      const inferredScript = inferIndicScriptFromText(rawScriptText);
      if (inferredScript && inferredScript !== "devanagari") {
        const devanagariCandidate = transliterateBetweenScripts(
          rawScriptText,
          inferredScript,
          "devanagari"
        ).trim();
        if (hasDevanagariLetters(devanagariCandidate)) {
          sourceTransliterationIast = transliterateFromDevanagari(
            devanagariCandidate,
            "iast"
          ).trim();
        }
      }
      if (!sourceTransliterationIast) {
        for (const scriptOption of INDIC_SCRIPT_OPTIONS) {
          if (scriptOption === "devanagari") continue;
          const devanagariCandidate = transliterateBetweenScripts(
            rawScriptText,
            scriptOption,
            "devanagari"
          ).trim();
          if (!hasDevanagariLetters(devanagariCandidate)) {
            continue;
          }
          sourceTransliterationIast = transliterateFromDevanagari(
            devanagariCandidate,
            "iast"
          ).trim();
          break;
        }
      }
      if (!sourceTransliterationIast) {
        sourceTransliterationIast = transliterateLatinToIast(rawScriptText).trim();
      }
    }
  }

  const sourceScriptText = rawScriptText
    ? hasDevanagariLetters(rawScriptText)
      ? rawScriptText
      : sourceTransliterationIast
        ? transliterateFromIast(sourceTransliterationIast, "devanagari").trim()
        : rawScriptText
    : sourceTransliterationIast
      ? transliterateFromIast(sourceTransliterationIast, "devanagari").trim()
      : "";

  return {
    sourceScriptText,
    sourceTransliterationIast,
  };
};

export const mapLegacyWordMeaningsRowsFromContent = (wordMeanings: Record<string, unknown>): WordMeaningRow[] => {
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
      sourceScriptText: /[ऀ-ॿ]/.test(sourceText)
        ? sourceText
        : transliterateLatinToDevanagari(sourceText),
      sourceTransliterationIast: /[ऀ-ॿ]/.test(sourceText)
        ? ""
        : transliterateLatinToIast(sourceText),
      meanings,
      activeMeaningLanguage,
    };
  });
};

export const mapWordMeaningsRowsFromContent = (node: NodeContent): WordMeaningRow[] => {
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
      const normalizedSource = normalizeWordMeaningSourceForms(row?.source);
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
        sourceScriptText: normalizedSource.sourceScriptText,
        sourceTransliterationIast: normalizedSource.sourceTransliterationIast,
        meanings: mapped,
        activeMeaningLanguage: firstNonEmptyLanguage,
      };
    })(),
  }));
};
