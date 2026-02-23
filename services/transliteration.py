import re
import unicodedata

try:
    from indic_transliteration import sanscript
except Exception:  # pragma: no cover - optional dependency
    sanscript = None


DEVANAGARI_PATTERN = re.compile(r"[\u0900-\u097F]")


def contains_devanagari(text: str) -> bool:
    return bool(text and DEVANAGARI_PATTERN.search(text))


def strip_diacritics(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def get_latin_query_variants(query: str) -> list[str]:
    source = (query or "").strip()
    if not source:
        return []

    variants: list[str] = []
    for candidate in [source, strip_diacritics(source)]:
        candidate = candidate.strip()
        if candidate and candidate not in variants:
            variants.append(candidate)
    return variants


def latin_to_devanagari(query: str) -> str | None:
    text = (query or "").strip()
    if not text or contains_devanagari(text) or sanscript is None:
        return None

    schemes = [sanscript.IAST, sanscript.ITRANS, sanscript.HK]
    for scheme in schemes:
        try:
            converted = sanscript.transliterate(text, scheme, sanscript.DEVANAGARI)
            if converted and contains_devanagari(converted):
                return converted
        except Exception:
            continue

    return None
