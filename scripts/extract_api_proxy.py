#!/usr/bin/env python3
"""
Extract Next.js auth boilerplate from API route files and replace with
imports from @/lib/apiProxy.

Run from the repo root:
  python3 scripts/extract_api_proxy.py [--dry-run]
"""

import re
import sys
from pathlib import Path

DRY_RUN = "--dry-run" in sys.argv

# Files that use NEXT_PUBLIC_API_URL or a different auth style — skip entirely
SKIP_FILES = {
    "nodes/[id]/route.ts",
    "email/send/route.ts",
    "compilations/[id]/publish/route.ts",
}

# Files with a CUSTOM BACKEND_UNAVAILABLE message — don't import BACKEND_UNAVAILABLE from proxy
CUSTOM_UNAVAILABLE_FILES = {
    "me/route.ts",
}

STANDARD_BACKEND_UNAVAILABLE = (
    '"Auth/content service unavailable. Please try again shortly."'
)

# ── Patterns to strip ────────────────────────────────────────────────────────

# Single-line const declarations
CONST_API_BASE_URL = re.compile(
    r'^const API_BASE_URL = process\.env\.API_BASE_URL \|\| "http://127\.0\.0\.1:8000";\n',
    re.MULTILINE,
)
CONST_ACCESS_TOKEN_COOKIE = re.compile(
    r'^const ACCESS_TOKEN_COOKIE = process\.env\.ACCESS_TOKEN_COOKIE \|\| "access_token";\n',
    re.MULTILINE,
)
CONST_REFRESH_TOKEN_COOKIE = re.compile(
    r'^const REFRESH_TOKEN_COOKIE = process\.env\.REFRESH_TOKEN_COOKIE \|\| "refresh_token";\n',
    re.MULTILINE,
)
CONST_BACKEND_UNAVAILABLE = re.compile(
    r'^const BACKEND_UNAVAILABLE = "Auth/content service unavailable\. Please try again shortly\.";\n',
    re.MULTILINE,
)

# buildAuthHeader — always 2 lines
BUILD_AUTH_HEADER = re.compile(
    r'^const buildAuthHeader = \(token\?: string\): Record<string, string> =>\n'
    r'  token \? \{ Authorization: `Bearer \$\{token\}` \} : \{\};\n',
    re.MULTILINE,
)

# refreshAccessToken — multi-line, ends with };\n
REFRESH_ACCESS_TOKEN = re.compile(
    r'^const refreshAccessToken = async \(refreshToken: string\) => \{.*?\n\};\n',
    re.MULTILINE | re.DOTALL,
)

# setAuthCookies — multi-line, ends with };\n
SET_AUTH_COOKIES = re.compile(
    r'^const setAuthCookies = async \(accessToken: string, refreshToken: string\) => \{.*?\n\};\n',
    re.MULTILINE | re.DOTALL,
)


def relative_key(path: Path) -> str:
    """Return path relative to the api/ directory for skip-list matching."""
    parts = path.parts
    try:
        idx = parts.index("api")
        return "/".join(parts[idx + 1:])
    except ValueError:
        return str(path)


def build_import(has_refresh: bool, has_set_cookies: bool, has_refresh_token: bool,
                 has_unavailable: bool) -> str:
    symbols = ["API_BASE_URL", "ACCESS_TOKEN_COOKIE"]
    if has_refresh_token:
        symbols.append("REFRESH_TOKEN_COOKIE")
    if has_unavailable:
        symbols.append("BACKEND_UNAVAILABLE")
    symbols.append("buildAuthHeader")
    if has_refresh:
        symbols.append("refreshAccessToken")
    if has_set_cookies:
        symbols.append("setAuthCookies")
    return f'import {{ {", ".join(symbols)} }} from "@/lib/apiProxy";\n'


def transform(source: str, key: str) -> tuple[str, bool]:
    """Return (transformed_source, was_changed)."""
    original = source

    has_api_base = bool(CONST_API_BASE_URL.search(source))
    if not has_api_base:
        return source, False

    is_custom_unavailable = key in CUSTOM_UNAVAILABLE_FILES
    has_refresh = bool(REFRESH_ACCESS_TOKEN.search(source))
    has_set_cookies = bool(SET_AUTH_COOKIES.search(source))
    has_refresh_token = bool(CONST_REFRESH_TOKEN_COOKIE.search(source))
    has_std_unavailable = bool(CONST_BACKEND_UNAVAILABLE.search(source)) and not is_custom_unavailable

    # Strip boilerplate
    source = CONST_API_BASE_URL.sub("", source)
    source = CONST_ACCESS_TOKEN_COOKIE.sub("", source)
    if has_refresh_token:
        source = CONST_REFRESH_TOKEN_COOKIE.sub("", source)
    if has_std_unavailable:
        source = CONST_BACKEND_UNAVAILABLE.sub("", source)
    source = BUILD_AUTH_HEADER.sub("", source)
    if has_refresh:
        source = REFRESH_ACCESS_TOKEN.sub("", source)
    if has_set_cookies:
        source = SET_AUTH_COOKIES.sub("", source)

    # Collapse runs of 3+ blank lines down to 2
    source = re.sub(r'\n{4,}', '\n\n\n', source)

    # Build import line
    import_line = build_import(
        has_refresh=has_refresh,
        has_set_cookies=has_set_cookies,
        has_refresh_token=has_refresh_token,
        has_unavailable=has_std_unavailable,
    )

    # Insert after the last existing import statement
    # Match any import line (static or dynamic)
    last_import_match = None
    for m in re.finditer(r'^import .+;\n', source, re.MULTILINE):
        last_import_match = m
    if last_import_match:
        insert_at = last_import_match.end()
        source = source[:insert_at] + import_line + source[insert_at:]
    else:
        # No existing imports — prepend
        source = import_line + source

    return source, source != original


def main():
    api_dir = Path(__file__).parent.parent / "web" / "src" / "app" / "api"
    route_files = sorted(api_dir.rglob("route.ts"))

    changed = 0
    skipped = 0
    unchanged = 0

    for path in route_files:
        key = relative_key(path)
        if key in SKIP_FILES:
            print(f"  SKIP  {key}")
            skipped += 1
            continue

        source = path.read_text(encoding="utf-8")
        new_source, was_changed = transform(source, key)

        if was_changed:
            changed += 1
            print(f"  EDIT  {key}")
            if not DRY_RUN:
                path.write_text(new_source, encoding="utf-8")
        else:
            unchanged += 1

    print(f"\nDone: {changed} edited, {skipped} skipped, {unchanged} unchanged")
    if DRY_RUN:
        print("(dry-run — no files written)")


if __name__ == "__main__":
    main()
