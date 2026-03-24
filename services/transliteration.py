import re
import unicodedata

try:
    from indic_transliteration import sanscript
except Exception:  # pragma: no cover - optional dependency
    sanscript = None


DEVANAGARI_PATTERN = re.compile(r"[\u0900-\u097F]")
IAST_DIACRITIC_PATTERN = re.compile(r"[āīūṛṝḷḹṅñṭḍṇśṣṃṁḥ]", re.IGNORECASE)


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


def _preferred_latin_schemes(text: str) -> list[str]:
    source = (text or "").strip()
    if not source or sanscript is None:
        return []

    if IAST_DIACRITIC_PATTERN.search(source):
        return [sanscript.IAST, sanscript.ITRANS, sanscript.HK]

    return [sanscript.ITRANS, sanscript.HK, sanscript.IAST]


def latin_to_devanagari(query: str) -> str | None:
    text = (query or "").strip()
    if not text or contains_devanagari(text) or sanscript is None:
        return None

    for scheme in _preferred_latin_schemes(text):
        try:
            converted = sanscript.transliterate(text, scheme, sanscript.DEVANAGARI)
            if converted and contains_devanagari(converted):
                return converted
        except Exception:
            continue

    return None


def latin_to_iast(text: str) -> str | None:
    source = (text or "").strip()
    if not source:
        return None
    if contains_devanagari(source):
        return devanagari_to_iast(source) or source
    if sanscript is None:
        return source

    for scheme in _preferred_latin_schemes(source):
        try:
            devanagari = sanscript.transliterate(source, scheme, sanscript.DEVANAGARI)
            if not devanagari or not contains_devanagari(devanagari):
                continue
            normalized = sanscript.transliterate(devanagari, sanscript.DEVANAGARI, sanscript.IAST)
            if normalized:
                normalized = normalized.strip()
                if normalized:
                    return normalized
        except Exception:
            continue

    return source


def devanagari_to_iast(text: str) -> str | None:
    source = (text or "").strip()
    if not source or not contains_devanagari(source) or sanscript is None:
        return None

    try:
        converted = sanscript.transliterate(source, sanscript.DEVANAGARI, sanscript.IAST)
    except Exception:
        return None

    normalized = (converted or "").strip()
    return normalized or None
