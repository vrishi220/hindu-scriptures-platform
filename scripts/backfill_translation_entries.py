#!/usr/bin/env python3
"""
Backfill translation_entries from content_nodes that still have
translation_variants inline in content_data (i.e., were imported
before the relational migration code was added).

Usage:
  PYTHONPATH=. DATABASE_URL=postgresql://... python scripts/backfill_translation_entries.py [--apply]

Without --apply: dry-run, shows what would be migrated.
With --apply: performs the migration.
"""
import argparse
import os
import sys

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    sys.exit("Set DATABASE_URL first.")

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill translation_entries")
    parser.add_argument("--apply", action="store_true", help="Perform the migration (default: dry-run)")
    args = parser.parse_args()

    from models.content_node import ContentNode
    from models.book import Book
    from models.translation_author import TranslationAuthor
    from models.translation_work import TranslationWork
    from models.translation_entry import TranslationEntry

    db = Session()
    try:
        # Find all nodes that still have translation_variants in content_data
        nodes_with_tv = (
            db.query(ContentNode)
            .filter(
                ContentNode.content_data["translation_variants"].as_string().isnot(None)
            )
            .all()
        )

        # Filter to only those with non-empty list
        candidates = [
            n for n in nodes_with_tv
            if isinstance(n.content_data, dict)
            and isinstance(n.content_data.get("translation_variants"), list)
            and len(n.content_data["translation_variants"]) > 0
        ]

        if not candidates:
            print("No nodes with residual translation_variants found. Nothing to do.")
            return 0

        # Group by book for reporting
        book_ids = set(n.book_id for n in candidates)
        books = {b.id: b for b in db.query(Book).filter(Book.id.in_(book_ids)).all()}

        print(f"Found {len(candidates)} nodes with residual translation_variants:")
        for book_id, book in books.items():
            count = sum(1 for n in candidates if n.book_id == book_id)
            print(f"  [{book_id}] {book.book_name}: {count} nodes")

        if not args.apply:
            print("\nDry-run only. Pass --apply to perform migration.")
            return 0

        print("\nMigrating...")
        author_cache: dict[str, TranslationAuthor] = {}
        work_cache: dict[tuple[int, str], TranslationWork] = {}

        total_entries = 0
        for node in candidates:
            book = books.get(node.book_id)
            variant_authors_lookup = {}
            if book and isinstance(book.variant_authors, dict):
                variant_authors_lookup = book.variant_authors

            variants = node.content_data["translation_variants"]
            entries_added = 0

            for idx, raw_variant in enumerate(variants):
                if not isinstance(raw_variant, dict):
                    continue
                text_value = str(raw_variant.get("text") or "").strip()
                if not text_value:
                    continue

                author_slug = str(raw_variant.get("author_slug") or "").strip()
                author_name = ""
                if author_slug:
                    mapped = variant_authors_lookup.get(author_slug)
                    author_name = (mapped.strip() if isinstance(mapped, str) and mapped.strip()
                                   else author_slug)
                if not author_name:
                    author_name = str(raw_variant.get("author_name") or raw_variant.get("author") or "").strip()
                if not author_name:
                    author_name = "unknown_author"

                author = author_cache.get(author_name)
                if author is None:
                    author = (
                        db.query(TranslationAuthor)
                        .filter(TranslationAuthor.name == author_name)
                        .first()
                    )
                    if author is None:
                        author = TranslationAuthor(name=author_name)
                        db.add(author)
                        db.flush()
                    author_cache[author_name] = author

                work_title = f"{author_name} Translation"
                work_key = (author.id, work_title)
                work = work_cache.get(work_key)
                if work is None:
                    work = (
                        db.query(TranslationWork)
                        .filter(
                            TranslationWork.author_id == author.id,
                            TranslationWork.title == work_title,
                        )
                        .first()
                    )
                    if work is None:
                        work = TranslationWork(title=work_title, author_id=author.id)
                        db.add(work)
                        db.flush()
                    work_cache[work_key] = work

                language_code = str(raw_variant.get("language") or "en").strip().lower() or "en"
                entry = TranslationEntry(
                    node_id=node.id,
                    author_id=author.id,
                    work_id=work.id,
                    content_text=text_value,
                    language_code=language_code,
                    display_order=idx,
                    metadata_json={
                        "field": raw_variant.get("field"),
                        "author_slug": author_slug,
                        "author_name": author_name,
                        "migrated_from": "translation_variants_backfill",
                    },
                )
                db.add(entry)
                entries_added += 1
                total_entries += 1

            # Strip translation_variants from content_data
            new_content_data = dict(node.content_data)
            new_content_data.pop("translation_variants", None)
            node.content_data = new_content_data

            if entries_added > 0:
                print(f"  node {node.id} ({book.book_name if book else '?'}): {entries_added} entries")

        db.commit()
        print(f"\nDone. Created {total_entries} translation_entries across {len(candidates)} nodes.")
        return 0

    except Exception as exc:
        db.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
