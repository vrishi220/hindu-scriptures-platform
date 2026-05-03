#!/usr/bin/env python3
"""Bulk import all exported book JSON files via authenticated API session."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import requests


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import all .json books from a folder using authenticated API requests."
    )
    parser.add_argument(
        "--folder",
        required=True,
        help="Path to folder containing exported .json book files.",
    )
    parser.add_argument(
        "--api-url",
        required=True,
        help="API base URL (for example: https://www.scriptle.org/api).",
    )
    parser.add_argument("--email", required=True, help="Admin account email.")
    parser.add_argument("--password", required=True, help="Admin account password.")
    parser.add_argument(
        "--delay-seconds",
        type=float,
        default=0.5,
        help="Delay between imports in seconds (default: 0.5).",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=120.0,
        help="Request timeout in seconds (default: 120).",
    )
    return parser.parse_args()


def _normalize_api_url(api_url: str) -> str:
    return api_url.rstrip("/")


def _endpoint(api_url: str, path_from_api_root: str) -> str:
    base = _normalize_api_url(api_url)
    path = path_from_api_root.lstrip("/")

    if base.endswith("/api"):
        return f"{base}/{path}"
    return f"{base}/api/{path}"


def _book_display_name(payload: dict[str, Any], file_path: Path) -> str:
    book_data = payload.get("book") if isinstance(payload.get("book"), dict) else None
    if isinstance(book_data, dict):
        book_name = book_data.get("book_name")
        if isinstance(book_name, str) and book_name.strip():
            return book_name.strip()

    # Fall back to filename if canonical metadata is missing.
    return file_path.stem


def _extract_error_message(response: requests.Response, payload: Any) -> str:
    if isinstance(payload, dict):
        detail = payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
        error = payload.get("error")
        if isinstance(error, str) and error.strip():
            return error.strip()

    text_body = (response.text or "").strip()
    if text_body:
        return text_body
    return f"HTTP {response.status_code}"


def _is_already_exists_error(message: str) -> bool:
    normalized = message.strip().lower()
    if not normalized:
        return False
    markers = (
        "book already exists",
        "already contains imported nodes",
        "already exists",
    )
    return any(marker in normalized for marker in markers)


def _prepare_import_payload(raw_payload: dict[str, Any]) -> dict[str, Any]:
    payload = dict(raw_payload)

    # The import dispatcher defaults to HTML if import_type is absent.
    payload.setdefault("import_type", "json")

    looks_canonical = (
        isinstance(payload.get("book"), dict)
        and isinstance(payload.get("schema"), dict)
        and isinstance(payload.get("nodes"), list)
    )
    if looks_canonical:
        payload.setdefault("schema_version", "hsp-book-json-v1")

    return payload


def main() -> int:
    args = _parse_args()

    folder = Path(args.folder).expanduser().resolve()
    if not folder.exists() or not folder.is_dir():
        print(f"ERROR: Folder does not exist or is not a directory: {folder}")
        return 1

    json_files = sorted(folder.glob("*.json"))
    if not json_files:
        print(f"No .json files found in: {folder}")
        return 0

    login_url = _endpoint(args.api_url, "auth/login")
    import_url = _endpoint(args.api_url, "content/import")

    session = requests.Session()

    try:
        login_response = session.post(
            login_url,
            json={"email": args.email, "password": args.password},
            timeout=args.timeout_seconds,
        )
    except requests.RequestException as exc:
        print(f"ERROR: Login request failed: {exc}")
        return 1

    if not login_response.ok:
        try:
            login_payload: Any = login_response.json()
        except ValueError:
            login_payload = None
        reason = _extract_error_message(login_response, login_payload)
        print(f"ERROR: Login failed: {reason}")
        return 1

    total = len(json_files)
    succeeded = 0
    skipped = 0
    failed = 0

    print(f"Found {total} JSON files in {folder}")

    for index, file_path in enumerate(json_files, start=1):
        try:
            with file_path.open("r", encoding="utf-8") as handle:
                raw_payload: Any = json.load(handle)
        except Exception as exc:
            failed += 1
            print(f"Importing {index} of {total}: {file_path.name}...")
            print(f"FAILED: {file_path.name} -> Could not read JSON ({exc})")
            if index < total and args.delay_seconds > 0:
                time.sleep(args.delay_seconds)
            continue

        if not isinstance(raw_payload, dict):
            failed += 1
            print(f"Importing {index} of {total}: {file_path.name}...")
            print(f"FAILED: {file_path.name} -> Root JSON must be an object")
            if index < total and args.delay_seconds > 0:
                time.sleep(args.delay_seconds)
            continue

        payload = _prepare_import_payload(raw_payload)
        book_name = _book_display_name(payload, file_path)
        print(f"Importing {index} of {total}: {book_name}...")

        try:
            response = session.post(
                import_url,
                json=payload,
                timeout=args.timeout_seconds,
            )
        except requests.RequestException as exc:
            failed += 1
            print(f"FAILED: {book_name} -> Request error ({exc})")
            if index < total and args.delay_seconds > 0:
                time.sleep(args.delay_seconds)
            continue

        try:
            response_payload: Any = response.json()
        except ValueError:
            response_payload = None

        if response.ok and isinstance(response_payload, dict) and response_payload.get("success") is True:
            succeeded += 1
            nodes_created = response_payload.get("nodes_created")
            suffix = f" ({nodes_created} nodes)" if isinstance(nodes_created, int) else ""
            print(f"SUCCESS: {book_name}{suffix}")
        elif response.ok and isinstance(response_payload, dict) and response_payload.get("success") is not False:
            succeeded += 1
            print(f"SUCCESS: {book_name}")
        else:
            reason = _extract_error_message(response, response_payload)
            if _is_already_exists_error(reason):
                skipped += 1
                print(f"SKIPPED: {book_name} -> Already exists")
            else:
                failed += 1
                print(f"FAILED: {book_name} -> {reason}")

        if index < total and args.delay_seconds > 0:
            time.sleep(args.delay_seconds)

    print("\nFinal summary:")
    print(f"{succeeded} succeeded, {failed} failed, {skipped} skipped (already exists)")

    # Treat re-runs with pre-existing books as success; only hard failures should fail the command.
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
