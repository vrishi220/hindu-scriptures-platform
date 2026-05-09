// Language metadata for the Scriptle redesign — display names plus the
// CSS variables for each language's accent dot. These mirror the
// --lang-* tokens defined in globals.css.

export type ScriptleLanguageCode = "sa" | "en" | "hi" | "te" | "ta";

export const ALL_LANGUAGE_CODES: ScriptleLanguageCode[] = ["sa", "en", "hi", "te", "ta"];

export const LANGUAGE_NAMES: Record<ScriptleLanguageCode, string> = {
  sa: "Sanskrit",
  en: "English",
  hi: "Hindi",
  te: "Telugu",
  ta: "Tamil",
};

export const LANGUAGE_DOT_VAR: Record<ScriptleLanguageCode, string> = {
  sa: "var(--lang-sa)",
  en: "var(--lang-en)",
  hi: "var(--lang-hi)",
  te: "var(--lang-te)",
  ta: "var(--lang-ta)",
};
