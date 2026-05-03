#!/usr/bin/env python3
"""
Diagnostic: test translation_entries import path directly.
Usage:
  PYTHONPATH=. DATABASE_URL=postgresql://... python scripts/diagnose_translation_import.py
"""
import json
import os
import sys

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    sys.exit("Set DATABASE_URL first.")

EXPORT_FILE = "exports/bhagavad-gita-vedicscriptures.json"

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# ── 1. Table presence ─────────────────────────────────────────────────────────
print("=" * 60)
print("1. Checking translation table existence")
insp = inspect(engine)
all_tables = set(insp.get_table_names())
for tbl in ("translation_authors", "translation_works", "translation_entries"):
    exists = tbl in all_tables
    print(f"   {tbl}: {'EXISTS ✅' if exists else 'MISSING ❌'}")

# ── 2. Row counts ─────────────────────────────────────────────────────────────
print("\n2. Row counts")
with engine.connect() as conn:
    for tbl in ("translation_authors", "translation_works", "translation_entries",
                "commentary_authors", "commentary_works", "commentary_entries"):
        try:
            n = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar()
            print(f"   {tbl}: {n} rows")
        except Exception as e:
            print(f"   {tbl}: ERROR - {e}")

# ── 3. Check export file ───────────────────────────────────────────────────────
print(f"\n3. Export file: {EXPORT_FILE}")
try:
    data = json.load(open(EXPORT_FILE))
    nodes_with_tv = [n for n in data["nodes"]
                     if n.get("content_data", {}).get("translation_variants")]
    print(f"   Nodes with translation_variants: {len(nodes_with_tv)}")
    if nodes_with_tv:
        first_tv = nodes_with_tv[0]["content_data"]["translation_variants"]
        print(f"   First node variant count: {len(first_tv)}")
        print(f"   First variant: {json.dumps(first_tv[0], ensure_ascii=False)[:120]}")
except FileNotFoundError:
    print(f"   File not found! Looking for alternative exports...")
    import glob
    exports = glob.glob("exports/*.json")
    print(f"   Available: {exports[:5]}")

# ── 4. Minimal import test ────────────────────────────────────────────────────
print("\n4. Testing _migrate_translation_variants_to_entries directly")
try:
    from models.translation_author import TranslationAuthor
    from models.translation_work import TranslationWork
    from models.translation_entry import TranslationEntry
    from models.content import ContentNode

    db = Session()
    try:
        # Find a content node to use as target
        node = db.query(ContentNode).first()
        if not node:
            print("   No content nodes found — cannot test entry creation")
        else:
            print(f"   Using ContentNode id={node.id}")
            # Try inserting a test TranslationAuthor
            test_author = TranslationAuthor(name="_diag_test_author_")
            db.add(test_author)
            db.flush()
            print(f"   TranslationAuthor created, id={test_author.id} ✅")

            test_work = TranslationWork(
                title="_diag_test_work_",
                author_id=test_author.id,
            )
            db.add(test_work)
            db.flush()
            print(f"   TranslationWork created, id={test_work.id} ✅")

            test_entry = TranslationEntry(
                node_id=node.id,
                author_id=test_author.id,
                work_id=test_work.id,
                content_text="DIAGNOSTIC TEST ENTRY",
                language_code="en",
                display_order=0,
            )
            db.add(test_entry)
            db.flush()
            print(f"   TranslationEntry created, id={test_entry.id} ✅")

            db.rollback()
            print("   Rolled back test data ✅")
    except Exception as e:
        db.rollback()
        print(f"   FAILED: {e}")
    finally:
        db.close()
except ImportError as e:
    print(f"   Import error: {e}")

# ── 5. Check content_nodes for stripped translation_variants ──────────────────
print("\n5. Content nodes state")
with engine.connect() as conn:
    try:
        n_total = conn.execute(text("SELECT COUNT(*) FROM content_nodes")).scalar()
        n_with_tv = conn.execute(text(
            "SELECT COUNT(*) FROM content_nodes "
            "WHERE content_data ? 'translation_variants' "
            "AND jsonb_array_length(content_data->'translation_variants') > 0"
        )).scalar()
        n_with_cv = conn.execute(text(
            "SELECT COUNT(*) FROM content_nodes "
            "WHERE content_data ? 'commentary_variants' "
            "AND jsonb_array_length(content_data->'commentary_variants') > 0"
        )).scalar()
        print(f"   Total content_nodes: {n_total}")
        print(f"   With translation_variants in content_data: {n_with_tv}")
        print(f"   With commentary_variants in content_data: {n_with_cv}")
    except Exception as e:
        print(f"   ERROR: {e}")

print("\nDone.")
