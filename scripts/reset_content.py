#!/usr/bin/env python3
"""Reset content tables on local database only.

This script is destructive by design, so it:
- Prints row counts first
- Requires --confirm to execute deletes
- Refuses to run against non-local hosts
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine.url import make_url


DELETE_ORDER = [
    "word_meaning_entries",
    "word_meaning_works",
    "word_meaning_authors",
    "commentary_entries",
    "commentary_works",
    "commentary_authors",
    "provenance_records",
    "media_files",
    "collection_cart_items",
    "edition_snapshots",
    "draft_books",
    "content_nodes",
    "books",
    "ai_jobs",
]

UNTOUCHED_TABLES = [
    "users",
    "user_sessions",
    "user_preferences",
    "scripture_schemas",
    "render_templates",
    "render_template_assignments",
    "property_definitions",
    "categories",
    "metadata_bindings",
]

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


@dataclass
class TableStats:
    table: str
    count: int


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Delete content tables from local DB only."
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Execute deletion. Without this flag, script runs in dry-run mode.",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Optional local DB URL override.",
    )
    parser.add_argument(
        "--count",
        action="store_true",
        help="Count rows before truncate (optional; disabled by default for instant dry-run).",
    )
    parser.add_argument(
        "--force-production",
        action="store_true",
        help="Bypass local-only check. Requires interactive confirmation. Use with extreme caution.",
    )
    return parser.parse_args()


def _resolve_database_url(override_url: str | None) -> str:
    if override_url and override_url.strip():
        return override_url.strip()

    for key in ("DATABASE_URL", "LOCAL_DATABASE_URL"):
        value = os.getenv(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    raise RuntimeError("No DATABASE_URL/LOCAL_DATABASE_URL found and no --database-url provided")


def _assert_local_only(database_url: str) -> None:
    url = make_url(database_url)

    if url.drivername.startswith("sqlite"):
        return

    host = (url.host or "").strip().lower()

    # Conservative production guards.
    blocked_markers = ("railway", "rlwy", "proxy", "amazonaws", "render.com")
    if any(marker in database_url.lower() for marker in blocked_markers):
        raise RuntimeError("Refusing to run: database URL looks like production/remote")

    if host and host not in LOCAL_HOSTS:
        raise RuntimeError(f"Refusing to run: host '{host}' is not local")


def _read_counts(connection) -> list[TableStats]:
    stats: list[TableStats] = []
    for table in DELETE_ORDER:
        count = connection.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0
        stats.append(TableStats(table=table, count=int(count)))
    return stats


def _print_plan(stats: list[TableStats] | None = None) -> None:
    print("Delete plan (in order):")
    if stats is None:
        for table in DELETE_ORDER:
            print(f"  - {table}")
    else:
        for item in stats:
            print(f"  - {item.table}: {item.count} rows")

    print("\nWill NOT touch:")
    for table in UNTOUCHED_TABLES:
        print(f"  - {table}")


def _execute_delete(connection) -> None:
    connection.execute(text("""
        TRUNCATE TABLE
            word_meaning_entries,
            word_meaning_works,
            word_meaning_authors,
            commentary_entries,
            commentary_works,
            commentary_authors,
            provenance_records,
            media_files,
            collection_cart_items,
            edition_snapshots,
            draft_books,
            content_nodes,
            books,
            ai_jobs
        CASCADE
    """))


def _print_summary(stats_before: list[TableStats] | None = None) -> None:
    print("\nReset summary:")
    print("  All target tables truncated.")
    print(f"  Tables processed: {len(DELETE_ORDER)}")
    if stats_before is not None:
        total_before = sum(item.count for item in stats_before)
        print(f"  Rows before truncate: {total_before}")
        print("\nPre-truncate per-table counts:")
        for item in stats_before:
            print(f"  - {item.table}: {item.count}")


def _confirm_production_reset(database_url: str) -> None:
    """Prompt user to confirm a non-local database reset. Exits if not confirmed."""
    url = make_url(database_url)
    host = url.host or "(unknown host)"
    print("\n" + "=" * 60, file=sys.stderr)
    print("WARNING: You are about to reset a NON-LOCAL database.", file=sys.stderr)
    print("All content will be permanently deleted.", file=sys.stderr)
    print(f"Target host: {host}", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    response = input("\nType 'YES I AM SURE' to continue: ").strip()
    if response != "YES I AM SURE":
        print("Aborted. Confirmation phrase did not match.", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    load_dotenv()
    args = _parse_args()

    try:
        database_url = _resolve_database_url(args.database_url)
        if args.force_production:
            _confirm_production_reset(database_url)
        else:
            _assert_local_only(database_url)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    engine = create_engine(database_url, pool_pre_ping=True)

    try:
        stats_before: list[TableStats] | None = None
        if args.count:
            with engine.connect() as connection:
                stats_before = _read_counts(connection)
            _print_plan(stats_before)
        else:
            _print_plan()

        if not args.confirm:
            print("\nDry-run only. Re-run with --confirm to execute deletes.")
            if not args.count:
                print("Pass --count if you also want row counts before execution.")
            return

        print("\n--confirm provided. Executing TRUNCATE ... CASCADE")
        with engine.begin() as connection:
            _execute_delete(connection)

        _print_summary(stats_before)

    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
