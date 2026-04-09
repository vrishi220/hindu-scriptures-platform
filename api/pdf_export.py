"""PDF font resolution and text processing utilities for the export pipeline.

This module contains the pure PDF rendering helpers extracted from draft_books.py:
  - Runtime and vendored font discovery / registration
  - Per-script (Devanagari, Telugu, Kannada, Tamil, Malayalam) font resolution
  - Indic-script detection
  - PDF text normalisation, verse-separator expansion, and line-wrapping

These functions have no database or model dependencies and can be imported by any
module that needs to produce PDF output.
"""

import re
import unicodedata
import urllib.request
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ---------------------------------------------------------------------------
# Font cache and lookup tables
# ---------------------------------------------------------------------------

_RUNTIME_FONT_CACHE: dict[str, str | None] = {}
_RUNTIME_FONT_DIR = Path("/tmp/hsp_pdf_fonts")
_VENDORED_PDF_FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "pdf-fonts"
_RUNTIME_FONT_SOURCES: dict[str, list[str]] = {
    "NotoSans-Regular.ttf": [
        "https://raw.githubusercontent.com/notofonts/latin-greek-cyrillic/main/fonts/ttf/NotoSans/NotoSans-Regular.ttf",
    ],
    "NotoSansDevanagari-Regular.ttf": [
        "https://raw.githubusercontent.com/notofonts/devanagari/main/fonts/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf",
    ],
    "NotoSansTelugu-Regular.ttf": [
        "https://raw.githubusercontent.com/notofonts/telugu/main/fonts/ttf/NotoSansTelugu/NotoSansTelugu-Regular.ttf",
    ],
    "NotoSansKannada-Regular.ttf": [
        "https://raw.githubusercontent.com/notofonts/kannada/main/fonts/ttf/NotoSansKannada/NotoSansKannada-Regular.ttf",
    ],
    "NotoSansTamil-Regular.ttf": [
        "https://raw.githubusercontent.com/notofonts/tamil/main/fonts/ttf/NotoSansTamil/NotoSansTamil-Regular.ttf",
    ],
    "NotoSansMalayalam-Regular.ttf": [
        "https://raw.githubusercontent.com/notofonts/malayalam/main/fonts/ttf/NotoSansMalayalam/NotoSansMalayalam-Regular.ttf",
    ],
}

# ---------------------------------------------------------------------------
# Font registration helpers
# ---------------------------------------------------------------------------


def _register_pdf_font_from_candidates(candidates: list[str], prefix: str) -> str | None:
    for index, candidate in enumerate(candidates):
        font_path = Path(candidate)
        if not font_path.exists():
            continue

        font_name = f"{prefix}{index}"
        try:
            if font_name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(font_name, str(font_path)))
            return font_name
        except Exception:
            continue

    return None


def _ensure_runtime_font(font_filename: str) -> str | None:
    cached = _RUNTIME_FONT_CACHE.get(font_filename)
    if cached is not None:
        return cached

    sources = _RUNTIME_FONT_SOURCES.get(font_filename, [])
    if not sources:
        _RUNTIME_FONT_CACHE[font_filename] = None
        return None

    try:
        _RUNTIME_FONT_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        _RUNTIME_FONT_CACHE[font_filename] = None
        return None

    target_path = _RUNTIME_FONT_DIR / font_filename
    if target_path.exists() and target_path.stat().st_size > 1024:
        resolved_path = str(target_path)
        _RUNTIME_FONT_CACHE[font_filename] = resolved_path
        return resolved_path

    for source_url in sources:
        try:
            with urllib.request.urlopen(source_url, timeout=4) as response:
                payload = response.read()
            if not payload or len(payload) <= 1024:
                continue
            target_path.write_bytes(payload)
            resolved_path = str(target_path)
            _RUNTIME_FONT_CACHE[font_filename] = resolved_path
            return resolved_path
        except Exception:
            continue

    _RUNTIME_FONT_CACHE[font_filename] = None
    return None


def _vendored_pdf_font(font_filename: str) -> str | None:
    font_path = _VENDORED_PDF_FONT_DIR / font_filename
    if font_path.exists() and font_path.stat().st_size > 1024:
        return str(font_path)
    return None


# ---------------------------------------------------------------------------
# Per-script font resolution
# ---------------------------------------------------------------------------


def _resolve_pdf_font_name() -> str:
    vendored_noto = _vendored_pdf_font("NotoSans-Regular.ttf")
    runtime_noto = _ensure_runtime_font("NotoSans-Regular.ttf")
    unicode_candidates = [
        vendored_noto,
        runtime_noto,
        "/app/fonts/NotoSans-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "C:/Windows/Fonts/arialuni.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]

    resolved = _register_pdf_font_from_candidates(
        [candidate for candidate in unicode_candidates if isinstance(candidate, str) and candidate.strip()],
        "SnapshotUnicode",
    )
    return resolved or "Helvetica"


def _resolve_pdf_devanagari_font_name() -> str:
    vendored_devanagari = _vendored_pdf_font("NotoSansDevanagari-Regular.ttf")
    vendored_telugu = _vendored_pdf_font("NotoSansTelugu-Regular.ttf")
    vendored_kannada = _vendored_pdf_font("NotoSansKannada-Regular.ttf")
    vendored_tamil = _vendored_pdf_font("NotoSansTamil-Regular.ttf")
    vendored_malayalam = _vendored_pdf_font("NotoSansMalayalam-Regular.ttf")
    runtime_devanagari = _ensure_runtime_font("NotoSansDevanagari-Regular.ttf")
    runtime_telugu = _ensure_runtime_font("NotoSansTelugu-Regular.ttf")
    runtime_kannada = _ensure_runtime_font("NotoSansKannada-Regular.ttf")
    runtime_tamil = _ensure_runtime_font("NotoSansTamil-Regular.ttf")
    runtime_malayalam = _ensure_runtime_font("NotoSansMalayalam-Regular.ttf")
    devanagari_candidates = [
        vendored_devanagari,
        vendored_telugu,
        vendored_kannada,
        vendored_tamil,
        vendored_malayalam,
        runtime_devanagari,
        runtime_telugu,
        runtime_kannada,
        runtime_tamil,
        runtime_malayalam,
        "/app/fonts/NotoSansDevanagari-Regular.ttf",
        "/app/fonts/NotoSansTelugu-Regular.ttf",
        "/app/fonts/NotoSansKannada-Regular.ttf",
        "/app/fonts/NotoSansTamil-Regular.ttf",
        "/app/fonts/NotoSansMalayalam-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansTelugu-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansKannada-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansMalayalam-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansDevanagari-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansTelugu-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansKannada-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansTamil-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansMalayalam-Regular.ttf",
        "/System/Library/Fonts/Supplemental/DevanagariMT.ttc",
        "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc",
        "/System/Library/Fonts/Supplemental/ITFDevanagari.ttc",
        "/System/Library/Fonts/Supplemental/Telugu MN.ttc",
        "/System/Library/Fonts/Supplemental/Telugu Sangam MN.ttc",
        "/System/Library/Fonts/Supplemental/Kannada MN.ttc",
        "/System/Library/Fonts/Supplemental/Kannada Sangam MN.ttc",
        "/System/Library/Fonts/Supplemental/Tamil MN.ttc",
        "/System/Library/Fonts/Supplemental/Tamil Sangam MN.ttc",
        "/System/Library/Fonts/Supplemental/Malayalam MN.ttc",
        "/System/Library/Fonts/Supplemental/Malayalam Sangam MN.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "C:/Windows/Fonts/arialuni.ttf",
        "C:/Windows/Fonts/mangal.ttf",
        "C:/Windows/Fonts/gautami.ttf",
        "C:/Windows/Fonts/vrinda.ttf",
    ]
    resolved = _register_pdf_font_from_candidates(
        [candidate for candidate in devanagari_candidates if isinstance(candidate, str) and candidate.strip()],
        "SnapshotDevanagari",
    )
    return resolved or _resolve_pdf_font_name()


def _resolve_pdf_telugu_font_name(fallback_font: str) -> str:
    vendored_telugu = _vendored_pdf_font("NotoSansTelugu-Regular.ttf")
    runtime_telugu = _ensure_runtime_font("NotoSansTelugu-Regular.ttf")
    telugu_candidates = [
        vendored_telugu,
        runtime_telugu,
        "/app/fonts/NotoSansTelugu-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansTelugu-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansTelugu-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Telugu MN.ttc",
        "/System/Library/Fonts/Supplemental/Telugu Sangam MN.ttc",
        "C:/Windows/Fonts/gautami.ttf",
        "C:/Windows/Fonts/Nirmala.ttf",
    ]
    resolved = _register_pdf_font_from_candidates(
        [candidate for candidate in telugu_candidates if isinstance(candidate, str) and candidate.strip()],
        "SnapshotTelugu",
    )
    return resolved or fallback_font


def _resolve_pdf_kannada_font_name(fallback_font: str) -> str:
    vendored_kannada = _vendored_pdf_font("NotoSansKannada-Regular.ttf")
    runtime_kannada = _ensure_runtime_font("NotoSansKannada-Regular.ttf")
    kannada_candidates = [
        vendored_kannada,
        runtime_kannada,
        "/app/fonts/NotoSansKannada-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansKannada-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansKannada-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Kannada MN.ttc",
        "/System/Library/Fonts/Supplemental/Kannada Sangam MN.ttc",
        "C:/Windows/Fonts/tunga.ttf",
        "C:/Windows/Fonts/Nirmala.ttf",
    ]
    resolved = _register_pdf_font_from_candidates(
        [candidate for candidate in kannada_candidates if isinstance(candidate, str) and candidate.strip()],
        "SnapshotKannada",
    )
    return resolved or fallback_font


def _resolve_pdf_tamil_font_name(fallback_font: str) -> str:
    vendored_tamil = _vendored_pdf_font("NotoSansTamil-Regular.ttf")
    runtime_tamil = _ensure_runtime_font("NotoSansTamil-Regular.ttf")
    tamil_candidates = [
        vendored_tamil,
        runtime_tamil,
        "/app/fonts/NotoSansTamil-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansTamil-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Tamil MN.ttc",
        "/System/Library/Fonts/Supplemental/Tamil Sangam MN.ttc",
        "C:/Windows/Fonts/latha.ttf",
        "C:/Windows/Fonts/Nirmala.ttf",
    ]
    resolved = _register_pdf_font_from_candidates(
        [candidate for candidate in tamil_candidates if isinstance(candidate, str) and candidate.strip()],
        "SnapshotTamil",
    )
    return resolved or fallback_font


def _resolve_pdf_malayalam_font_name(fallback_font: str) -> str:
    vendored_malayalam = _vendored_pdf_font("NotoSansMalayalam-Regular.ttf")
    runtime_malayalam = _ensure_runtime_font("NotoSansMalayalam-Regular.ttf")
    malayalam_candidates = [
        vendored_malayalam,
        runtime_malayalam,
        "/app/fonts/NotoSansMalayalam-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansMalayalam-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansMalayalam-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Malayalam MN.ttc",
        "/System/Library/Fonts/Supplemental/Malayalam Sangam MN.ttc",
        "C:/Windows/Fonts/kartika.ttf",
        "C:/Windows/Fonts/Nirmala.ttf",
    ]
    resolved = _register_pdf_font_from_candidates(
        [candidate for candidate in malayalam_candidates if isinstance(candidate, str) and candidate.strip()],
        "SnapshotMalayalam",
    )
    return resolved or fallback_font


# ---------------------------------------------------------------------------
# Indic script detection
# ---------------------------------------------------------------------------


def _detect_indic_script(text: str) -> str | None:
    if not text:
        return None
    if re.search(r"[\u0C00-\u0C7F]", text):
        return "telugu"
    if re.search(r"[\u0C80-\u0CFF]", text):
        return "kannada"
    if re.search(r"[\u0B80-\u0BFF]", text):
        return "tamil"
    if re.search(r"[\u0D00-\u0D7F]", text):
        return "malayalam"
    if re.search(r"[\u0900-\u097F]", text):
        return "devanagari"
    return None


# ---------------------------------------------------------------------------
# PDF text normalisation and wrapping
# ---------------------------------------------------------------------------


def _normalize_pdf_text(value: object) -> str:
    if not isinstance(value, str):
        return ""

    normalized = unicodedata.normalize("NFC", value)
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    return normalized


def _expand_verse_separators_for_pdf(value: str) -> str:
    normalized = _normalize_pdf_text(value)
    if not normalized:
        return ""

    expanded = normalized.replace("॥", "\n॥\n").replace("||", "\n||\n")
    expanded = expanded.replace("।", "\n।\n")
    expanded = re.sub(r"(?<!\|)\|(?!\|)", "\n|\n", expanded)
    expanded = re.sub(r"[ \t]*\n[ \t]*", "\n", expanded)
    expanded = re.sub(r"\n{3,}", "\n\n", expanded)
    return expanded.strip()


def _split_long_pdf_token(token: str, font_name: str, font_size: int, max_width: float) -> list[str]:
    normalized_token = _normalize_pdf_text(token)
    if not normalized_token:
        return [""]

    chunks: list[str] = []
    current = ""
    for character in normalized_token:
        candidate = current + character
        if current and pdfmetrics.stringWidth(candidate, font_name, font_size) > max_width:
            chunks.append(current)
            current = character
        else:
            current = candidate

    if current:
        chunks.append(current)
    return chunks or [normalized_token]


def _wrap_pdf_text_to_width(text: str, font_name: str, font_size: int, max_width: float) -> list[str]:
    normalized_text = _normalize_pdf_text(text)
    if not normalized_text:
        return [""]

    wrapped_lines: list[str] = []
    for raw_paragraph in normalized_text.split("\n"):
        paragraph = raw_paragraph.strip()
        if not paragraph:
            wrapped_lines.append("")
            continue

        current_line = ""
        for token in paragraph.split():
            candidate = token if not current_line else f"{current_line} {token}"
            if pdfmetrics.stringWidth(candidate, font_name, font_size) <= max_width:
                current_line = candidate
                continue

            if current_line:
                wrapped_lines.append(current_line)
                current_line = ""

            if pdfmetrics.stringWidth(token, font_name, font_size) <= max_width:
                current_line = token
                continue

            token_chunks = _split_long_pdf_token(token, font_name, font_size, max_width)
            wrapped_lines.extend(token_chunks[:-1])
            current_line = token_chunks[-1]

        if current_line:
            wrapped_lines.append(current_line)

    return wrapped_lines or [""]
