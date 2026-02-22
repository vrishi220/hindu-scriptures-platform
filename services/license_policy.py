from __future__ import annotations

from typing import Literal

LicenseAction = Literal["allow", "warn", "block"]

_DEFAULT_LICENSE = "CC-BY-SA-4.0"
_WARN_TOKENS = ("-NC", "-ND", "NONCOMMERCIAL", "NO-DERIVATIVES")
_BLOCKED_LICENSES = {
    "ALL-RIGHTS-RESERVED",
    "ARR",
    "PROPRIETARY",
    "UNLICENSED",
    "UNKNOWN",
}


def normalize_license(license_type: str | None) -> str:
    if not license_type or not license_type.strip():
        return "UNKNOWN"
    return license_type.strip().upper()


def classify_license_action(license_type: str | None) -> LicenseAction:
    normalized = normalize_license(license_type)

    if normalized in _BLOCKED_LICENSES:
        return "block"

    if any(token in normalized for token in _WARN_TOKENS):
        return "warn"

    if normalized == _DEFAULT_LICENSE or normalized.startswith("CC-BY"):
        return "allow"

    return "warn"
