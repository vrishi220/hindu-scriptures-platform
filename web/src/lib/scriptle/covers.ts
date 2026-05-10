// Per-book gradient backgrounds for the redesign Library covers.
// Falls back to charcoal for unknown books. When book.cover_image_url
// is present, the BookCover uses that as background-image instead and
// this gradient becomes a fallback only.

const COVER_GRADIENTS: Record<string, string> = {
  "bhagavad-gita-vedicscriptures": "linear-gradient(160deg, #1C3A2E, #3B7A5A)",
  "ashtavakra-gita": "linear-gradient(160deg, #3B2A1A, #8B6A3A)",
  "avadhuta-gita": "linear-gradient(160deg, #1A2A3B, #3A6A8B)",
  "ribhu-gita": "linear-gradient(160deg, #3B1A2A, #8B3A6A)",
  "valmiki-ramayana": "linear-gradient(160deg, #2A1A0A, #8B5A2A)",
  "bhagavata-purana": "linear-gradient(160deg, #1A1A3B, #3A3A8B)",
  "yoga-vasishtha": "linear-gradient(160deg, #0A2A1A, #2A7A5A)",
  mahabharata: "linear-gradient(160deg, #1A0A0A, #6A2A2A)",
  rigveda: "linear-gradient(160deg, #1A2A1A, #5A7A3A)",
  vishnu_sahasranama: "linear-gradient(160deg, #0A1A2A, #2A5A7A)",
  "lalita-sahasranama": "linear-gradient(160deg, #2A0A1A, #7A2A5A)",
};

export const DEFAULT_COVER_GRADIENT = "linear-gradient(160deg, #1A1A1A, #3A3A3A)";

export function coverGradientForBook(bookCode: string | null | undefined): string {
  if (!bookCode) return DEFAULT_COVER_GRADIENT;
  return COVER_GRADIENTS[bookCode] ?? DEFAULT_COVER_GRADIENT;
}
