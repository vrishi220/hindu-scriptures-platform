#!/usr/bin/env python3

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path
import sys
import os

from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from models.database import DATABASE_URL
from models.scripture_schema import ScriptureSchema
from models.template_library import RenderTemplate


def _normalized_level(value: str | None) -> str:
    return (value or "").strip()


def build_schema_level_index(schemas: list[ScriptureSchema]) -> dict[str, list[ScriptureSchema]]:
    index: dict[str, list[ScriptureSchema]] = defaultdict(list)
    for schema in schemas:
        levels = schema.levels if isinstance(schema.levels, list) else []
        for level in levels:
            if not isinstance(level, str):
                continue
            normalized = _normalized_level(level)
            if not normalized:
                continue
            index[normalized].append(schema)
    return index


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill render_templates.target_schema_id from existing target_level values."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist updates to the database. Without this flag, runs in dry-run mode.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print per-template update decisions.",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Optional database URL override. Falls back to DATABASE_URL env var/project default.",
    )
    args, unknown_args = parser.parse_known_args()
    filtered_unknown_args = [
        arg
        for arg in unknown_args
        if not arg.startswith("http://_vscodecontentref_/")
    ]
    if filtered_unknown_args:
        parser.error(f"unrecognized arguments: {' '.join(filtered_unknown_args)}")

    resolved_database_url = args.database_url or os.getenv("DATABASE_URL") or DATABASE_URL
    engine = create_engine(resolved_database_url, pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = session_factory()
    try:
        schemas = db.query(ScriptureSchema).all()
        schema_index = build_schema_level_index(schemas)

        candidates = (
            db.query(RenderTemplate)
            .filter(RenderTemplate.target_schema_id.is_(None))
            .all()
        )

        updated = 0
        skipped_empty_level = 0
        skipped_unmapped = 0
        skipped_ambiguous = 0

        for template in candidates:
            normalized_level = _normalized_level(template.target_level)
            if not normalized_level:
                skipped_empty_level += 1
                if args.verbose:
                    print(f"SKIP empty-level template_id={template.id} name={template.name!r}")
                continue

            matching_schemas = schema_index.get(normalized_level, [])
            if not matching_schemas:
                skipped_unmapped += 1
                if args.verbose:
                    print(
                        f"SKIP unmapped-level template_id={template.id} name={template.name!r} level={normalized_level!r}"
                    )
                continue

            if len(matching_schemas) > 1:
                skipped_ambiguous += 1
                if args.verbose:
                    schema_names = ", ".join(schema.name for schema in matching_schemas)
                    print(
                        "SKIP ambiguous-level "
                        f"template_id={template.id} name={template.name!r} level={normalized_level!r} "
                        f"schemas=[{schema_names}]"
                    )
                continue

            schema = matching_schemas[0]
            template.target_schema_id = schema.id
            updated += 1
            if args.verbose:
                print(
                    f"UPDATE template_id={template.id} name={template.name!r} "
                    f"level={normalized_level!r} schema_id={schema.id} schema={schema.name!r}"
                )

        if args.apply:
            db.commit()
        else:
            db.rollback()

        mode = "APPLY" if args.apply else "DRY-RUN"
        print(f"[{mode}] examined={len(candidates)} updated={updated}")
        print(
            "[SUMMARY] "
            f"skipped_empty_level={skipped_empty_level} "
            f"skipped_unmapped={skipped_unmapped} "
            f"skipped_ambiguous={skipped_ambiguous}"
        )
        if not args.apply:
            print("[NOTE] No database changes were committed. Re-run with --apply to persist updates.")

        return 0
    except SQLAlchemyError as error:
        print("[ERROR] Database connection/query failed.")
        print(f"[ERROR] URL: {resolved_database_url}")
        print(f"[ERROR] Details: {error}")
        print("[HINT] Pass --database-url or export DATABASE_URL with a valid Postgres connection string.")
        return 1
    finally:
        db.close()
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
