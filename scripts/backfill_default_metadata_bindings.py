#!/usr/bin/env python3

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models.database import DATABASE_URL, SessionLocal
from services.schema_bootstrap import ensure_phase1_schema
from services.metadata_defaults import backfill_default_metadata_bindings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill default metadata bindings for existing draft books."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without committing",
    )
    args = parser.parse_args()

    ensure_phase1_schema(DATABASE_URL)
    db = SessionLocal()
    try:
        result = backfill_default_metadata_bindings(db)

        if args.dry_run:
            db.rollback()
        else:
            db.commit()

        mode = "DRY-RUN" if args.dry_run else "APPLIED"
        print(f"[{mode}] scanned_drafts={result.scanned_drafts}")
        print(f"[{mode}] created_bindings={result.created_bindings}")
        print(f"[{mode}] default_category_found={result.default_category_found}")

        if not result.default_category_found:
            print("Default category 'system_default_metadata' not found. No changes applied.")
            return 1

        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
