// Book code → category mapping for the redesign Library page.
// Mirrors the SQL in Step 8 of SCRIPTLE_REDESIGN_PROMPT.md (Step 5 of deployment).
// Once the books table has a category column populated, this client-side map
// can be retired in favor of book.category.

export type ScriptleCategory = "gita" | "veda" | "purana" | "stotra" | "upanishad";

const BOOK_CODE_TO_CATEGORY: Record<string, ScriptleCategory> = {
  "bhagavad-gita-vedicscriptures": "gita",
  "ashtavakra-gita": "gita",
  "avadhuta-gita": "gita",
  "ribhu-gita": "gita",

  rigveda: "veda",
  "purusha-sukta": "veda",
  "nasadiya-sukta": "veda",

  "valmiki-ramayana": "purana",
  "bhagavata-purana": "purana",
  "yoga-vasishtha": "purana",
  mahabharata: "purana",

  vishnu_sahasranama: "stotra",
  "lalita-sahasranama": "stotra",
  "nirvana-shatkam": "stotra",
  "bhaja-govindam": "stotra",
  "dasa-sloki": "stotra",
  krishnashtakam: "stotra",
};

export function categoryForBook(bookCode: string | null | undefined): ScriptleCategory {
  if (!bookCode) return "upanishad";
  return BOOK_CODE_TO_CATEGORY[bookCode] ?? "upanishad";
}

export const CATEGORY_ORDER: ScriptleCategory[] = [
  "gita",
  "veda",
  "purana",
  "stotra",
  "upanishad",
];

export const CATEGORY_LABEL: Record<ScriptleCategory, string> = {
  gita: "Gitas",
  veda: "Vedas",
  purana: "Puranas",
  stotra: "Stotras",
  upanishad: "Upanishads",
};
