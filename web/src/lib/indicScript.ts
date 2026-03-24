import Sanscript from "sanscript";

export const ROMAN_SCRIPT_OPTIONS = ["iast", "harvard_kyoto", "itrans"] as const;
export const INDIC_SCRIPT_OPTIONS = [
  "devanagari",
  "bengali",
  "gujarati",
  "gurmukhi",
  "kannada",
  "malayalam",
  "oriya",
  "tamil",
  "telugu",
] as const;

export const TRANSLITERATION_SCRIPT_OPTIONS = [
  ...ROMAN_SCRIPT_OPTIONS,
  ...INDIC_SCRIPT_OPTIONS,
] as const;

export type TransliterationScriptOption = (typeof TRANSLITERATION_SCRIPT_OPTIONS)[number];

const SCHEME_BY_OPTION: Record<TransliterationScriptOption, string> = {
  iast: "iast",
  harvard_kyoto: "hk",
  itrans: "itrans",
  devanagari: "devanagari",
  bengali: "bengali",
  gujarati: "gujarati",
  gurmukhi: "gurmukhi",
  kannada: "kannada",
  malayalam: "malayalam",
  oriya: "oriya",
  tamil: "tamil",
  telugu: "telugu",
};

const SCRIPT_SET = new Set<string>(TRANSLITERATION_SCRIPT_OPTIONS);
const DEVANAGARI_LETTER_PATTERN = /[\u0904-\u0939\u0958-\u0961\u0971-\u097F]/;
const IAST_DIACRITIC_PATTERN = /[āīūṛṝḷḹṅñṭḍṇśṣṃṁḥ]/i;

export const normalizeTransliterationScript = (
  value?: string | null
): TransliterationScriptOption => {
  const normalized = (value || "").trim().toLowerCase();
  if (SCRIPT_SET.has(normalized)) {
    return normalized as TransliterationScriptOption;
  }
  if (normalized === "dev" || normalized === "deva") {
    return "devanagari";
  }
  if (normalized === "hk") {
    return "harvard_kyoto";
  }
  return "iast";
};

export const isRomanScript = (script: TransliterationScriptOption): boolean =>
  ROMAN_SCRIPT_OPTIONS.includes(script as (typeof ROMAN_SCRIPT_OPTIONS)[number]);

export const hasDevanagariLetters = (text: string): boolean => {
  if (!text) return false;
  return DEVANAGARI_LETTER_PATTERN.test(text);
};

const transliterate = (text: string, from: string, to: string): string => {
  if (!text) return "";
  try {
    return Sanscript.t(text, from, to);
  } catch {
    return text;
  }
};

const normalizeLegacyIastInput = (text: string): string => {
  if (!text) return "";

  return text
    .replace(/kṣh/gi, "kṣ")
    .replace(/śh/gi, "ś")
    .replace(/ṣh/gi, "ṣ")
    .replace(/ṛi/gi, "ṛ")
    .replace(/ṝi/gi, "ṝ")
    .replace(/ḷi/gi, "ḷ");
};

const getPreferredLatinSourceSchemes = (text: string): string[] => {
  if (IAST_DIACRITIC_PATTERN.test(text)) {
    return ["iast", "itrans", "hk"];
  }
  return ["itrans", "hk", "iast"];
};

const transliterateLatinToScript = (
  text: string,
  script: TransliterationScriptOption
): string => {
  const source = text.trim();
  if (!source) {
    return "";
  }

  const targetScheme = SCHEME_BY_OPTION[script];
  if (!targetScheme) {
    return source;
  }

  for (const sourceScheme of getPreferredLatinSourceSchemes(source)) {
    try {
      const devanagari = Sanscript.t(source, sourceScheme, "devanagari");
      if (!hasDevanagariLetters(devanagari)) {
        continue;
      }
      if (targetScheme === "devanagari") {
        return devanagari;
      }
      return Sanscript.t(devanagari, "devanagari", targetScheme);
    } catch {
      continue;
    }
  }

  return script === "iast" ? normalizeLegacyIastInput(source) : source;
};

export const transliterateFromIast = (
  text: string,
  script: TransliterationScriptOption
): string => {
  const targetScheme = SCHEME_BY_OPTION[script];
  const normalizedInput = normalizeLegacyIastInput(text);
  if (!targetScheme || targetScheme === "iast") {
    return normalizedInput;
  }
  return transliterate(normalizedInput, "iast", targetScheme);
};

export const transliterateLatinToIast = (text: string): string =>
  transliterateLatinToScript(text, "iast");

export const transliterateLatinToDevanagari = (text: string): string =>
  transliterateLatinToScript(text, "devanagari");

export const transliterateFromDevanagari = (
  text: string,
  script: TransliterationScriptOption
): string => {
  const targetScheme = SCHEME_BY_OPTION[script];
  if (!targetScheme || targetScheme === "devanagari") {
    return text;
  }
  return transliterate(text, "devanagari", targetScheme);
};

export const transliterationScriptLabel = (script: TransliterationScriptOption): string => {
  switch (script) {
    case "iast":
      return "IAST";
    case "harvard_kyoto":
      return "Harvard-Kyoto";
    case "itrans":
      return "ITRANS";
    case "devanagari":
      return "Devanagari";
    case "bengali":
      return "Bengali";
    case "gujarati":
      return "Gujarati";
    case "gurmukhi":
      return "Gurmukhi";
    case "kannada":
      return "Kannada";
    case "malayalam":
      return "Malayalam";
    case "oriya":
      return "Odia";
    case "tamil":
      return "Tamil";
    case "telugu":
      return "Telugu";
    default:
      return script;
  }
};
