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
const BENGALI_LETTER_PATTERN = /[\u0980-\u09FF]/;
const GURMUKHI_LETTER_PATTERN = /[\u0A00-\u0A7F]/;
const GUJARATI_LETTER_PATTERN = /[\u0A80-\u0AFF]/;
const ORIYA_LETTER_PATTERN = /[\u0B00-\u0B7F]/;
const TAMIL_LETTER_PATTERN = /[\u0B80-\u0BFF]/;
const TELUGU_LETTER_PATTERN = /[\u0C00-\u0C7F]/;
const KANNADA_LETTER_PATTERN = /[\u0C80-\u0CFF]/;
const MALAYALAM_LETTER_PATTERN = /[\u0D00-\u0D7F]/;

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

export const inferIndicScriptFromText = (
  text: string
): Extract<TransliterationScriptOption, (typeof INDIC_SCRIPT_OPTIONS)[number]> | null => {
  if (!text) return null;
  if (DEVANAGARI_LETTER_PATTERN.test(text)) return "devanagari";
  if (BENGALI_LETTER_PATTERN.test(text)) return "bengali";
  if (GURMUKHI_LETTER_PATTERN.test(text)) return "gurmukhi";
  if (GUJARATI_LETTER_PATTERN.test(text)) return "gujarati";
  if (ORIYA_LETTER_PATTERN.test(text)) return "oriya";
  if (TAMIL_LETTER_PATTERN.test(text)) return "tamil";
  if (TELUGU_LETTER_PATTERN.test(text)) return "telugu";
  if (KANNADA_LETTER_PATTERN.test(text)) return "kannada";
  if (MALAYALAM_LETTER_PATTERN.test(text)) return "malayalam";
  return null;
};

const transliterate = (text: string, from: string, to: string): string => {
  if (!text) return "";
  try {
    return Sanscript.t(text, from, to).normalize("NFC");
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

  const normalizedSource = normalizeLegacyIastInput(source);
  const scriptSource = isRomanScript(script) ? normalizedSource : normalizedSource.toLowerCase();

  for (const sourceScheme of getPreferredLatinSourceSchemes(scriptSource)) {
    try {
      const devanagari = Sanscript.t(scriptSource, sourceScheme, "devanagari");
      if (!hasDevanagariLetters(devanagari)) {
        continue;
      }
      if (targetScheme === "devanagari") {
        return devanagari.normalize("NFC");
      }
      return Sanscript.t(devanagari, "devanagari", targetScheme).normalize("NFC");
    } catch {
      continue;
    }
  }

  return script === "iast" ? normalizedSource : source;
};

export const transliterateFromIast = (
  text: string,
  script: TransliterationScriptOption
): string => {
  const targetScheme = SCHEME_BY_OPTION[script];
  const normalizedInput = normalizeLegacyIastInput(text);
  if (!targetScheme || targetScheme === "iast") {
    return normalizedInput.normalize("NFC");
  }
  const scriptInput = isRomanScript(script) ? normalizedInput : normalizedInput.toLowerCase();
  return transliterate(scriptInput, "iast", targetScheme).normalize("NFC");
};

export const transliterateBetweenScripts = (
  text: string,
  fromScript: TransliterationScriptOption,
  toScript: TransliterationScriptOption
): string => {
  const input = text.trim();
  if (!input) {
    return "";
  }
  if (fromScript === toScript) {
    return input.normalize("NFC");
  }

  const fromScheme = SCHEME_BY_OPTION[fromScript];
  const toScheme = SCHEME_BY_OPTION[toScript];
  if (!fromScheme || !toScheme) {
    return input;
  }

  const normalizedInput = isRomanScript(fromScript)
    ? normalizeLegacyIastInput(input)
    : input;

  // Sanscript can no-op for some direct cross-script pairs; route through
  // Devanagari as a stable bridge when neither side is Devanagari.
  if (fromScheme !== "devanagari" && toScheme !== "devanagari") {
    const viaDevanagari = transliterate(normalizedInput, fromScheme, "devanagari").normalize("NFC");
    if (hasDevanagariLetters(viaDevanagari)) {
      return transliterate(viaDevanagari, "devanagari", toScheme).normalize("NFC");
    }
  }

  return transliterate(normalizedInput, fromScheme, toScheme).normalize("NFC");
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
    return text.normalize("NFC");
  }
  return transliterate(text, "devanagari", targetScheme).normalize("NFC");
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
