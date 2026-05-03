#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from models.commentary_author import CommentaryAuthor
from models.commentary_work import CommentaryWork
from models.database import DATABASE_URL
from models.translation_author import TranslationAuthor
from models.translation_work import TranslationWork
from models.user import User
from services.schema_bootstrap import ensure_phase1_schema


AI_AUTHOR_NAME = "HSP AI"
AI_AUTHOR_BIO = (
    "AI-generated commentary on behalf of the Hindu Scriptures Platform. "
    "Outputs are intended for editorial review before publication."
)
AI_AUTHOR_METADATA = {
    "type": "ai",
    "provider": "anthropic",
    "model": "claude-sonnet-4",
    "languages": ["english", "telugu", "hindi", "tamil"],
}

AI_WORKS = [
    {
        "title": "HSP AI Commentary - English",
        "description": "AI-generated English commentary for supported scripture nodes.",
        "metadata": {
            "type": "ai_commentary",
            "language_code": "en",
            "language_name": "english",
            "model": "claude-sonnet-4",
        },
    },
    {
        "title": "HSP AI Commentary - Telugu",
        "description": "AI-generated Telugu commentary for supported scripture nodes.",
        "metadata": {
            "type": "ai_commentary",
            "language_code": "te",
            "language_name": "telugu",
            "model": "claude-sonnet-4",
        },
    },
    {
        "title": "HSP AI Commentary - Hindi",
        "description": "AI-generated Hindi commentary for supported scripture nodes.",
        "metadata": {
            "type": "ai_commentary",
            "language_code": "hi",
            "language_name": "hindi",
            "model": "claude-sonnet-4",
        },
    },
    {
        "title": "HSP AI Commentary - Tamil",
        "description": "AI-generated Tamil commentary for supported scripture nodes.",
        "metadata": {
            "type": "ai_commentary",
            "language_code": "ta",
            "language_name": "tamil",
            "model": "claude-sonnet-4",
        },
    },
]

AI_TRANSLATION_WORKS = [
    {
        "title": "HSP AI Translation - English",
        "description": "AI-generated English translations for supported scripture nodes.",
        "metadata": {
            "type": "ai_translation",
            "language_code": "en",
            "language_name": "english",
            "model": "claude-sonnet-4",
        },
    },
    {
        "title": "HSP AI Translation - Telugu",
        "description": "AI-generated Telugu translations for supported scripture nodes.",
        "metadata": {
            "type": "ai_translation",
            "language_code": "te",
            "language_name": "telugu",
            "model": "claude-sonnet-4",
        },
    },
    {
        "title": "HSP AI Translation - Hindi",
        "description": "AI-generated Hindi translations for supported scripture nodes.",
        "metadata": {
            "type": "ai_translation",
            "language_code": "hi",
            "language_name": "hindi",
            "model": "claude-sonnet-4",
        },
    },
    {
        "title": "HSP AI Translation - Tamil",
        "description": "AI-generated Tamil translations for supported scripture nodes.",
        "metadata": {
            "type": "ai_translation",
            "language_code": "ta",
            "language_name": "tamil",
            "model": "claude-sonnet-4",
        },
    },
]


def _resolve_creator_id(db, explicit_creator_id: int | None) -> int | None:
    if explicit_creator_id is not None:
        return explicit_creator_id

    admin_user = db.query(User).filter(User.role == "admin").order_by(User.id.asc()).first()
    if admin_user:
        return int(admin_user.id)

    any_user = db.query(User).order_by(User.id.asc()).first()
    if any_user:
        return int(any_user.id)

    return None


def _merge_metadata(current: dict | None, updates: dict) -> dict:
    merged = dict(current or {})
    merged.update(updates)
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the HSP AI commentary author and works.")
    parser.add_argument("--apply", action="store_true", help="Persist changes. Dry-run by default.")
    parser.add_argument("--verbose", action="store_true", help="Print each create/update action.")
    parser.add_argument("--creator-id", type=int, default=None, help="Creator user id override.")
    parser.add_argument("--database-url", default=None, help="Optional database URL override.")
    args = parser.parse_args()

    resolved_database_url = args.database_url or os.getenv("DATABASE_URL") or DATABASE_URL
    ensure_phase1_schema(resolved_database_url)
    engine = create_engine(resolved_database_url, pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = session_factory()

    try:
        creator_id = _resolve_creator_id(db, args.creator_id)

        author = (
            db.query(CommentaryAuthor)
            .filter(CommentaryAuthor.name == AI_AUTHOR_NAME)
            .first()
        )
        translation_author = (
            db.query(TranslationAuthor)
            .filter(TranslationAuthor.name == AI_AUTHOR_NAME)
            .first()
        )

        created_authors = 0
        updated_authors = 0
        created_works = 0
        updated_works = 0

        if author is None:
            author = CommentaryAuthor(
                name=AI_AUTHOR_NAME,
                bio=AI_AUTHOR_BIO,
                metadata_json=AI_AUTHOR_METADATA,
                created_by=creator_id,
            )
            db.add(author)
            db.flush()
            created_authors += 1
            if args.verbose:
                print(f"CREATE author name={AI_AUTHOR_NAME} author_id={author.id}")
        else:
            author.bio = AI_AUTHOR_BIO
            author.metadata_json = _merge_metadata(author.metadata_json, AI_AUTHOR_METADATA)
            if creator_id is not None and author.created_by is None:
                author.created_by = creator_id
            updated_authors += 1
            if args.verbose:
                print(f"UPDATE author name={AI_AUTHOR_NAME} author_id={author.id}")

        if translation_author is None:
            translation_author = TranslationAuthor(
                name=AI_AUTHOR_NAME,
                bio=AI_AUTHOR_BIO,
                metadata_json=AI_AUTHOR_METADATA,
            )
            db.add(translation_author)
            db.flush()
            created_authors += 1
            if args.verbose:
                print(f"CREATE translation_author name={AI_AUTHOR_NAME} author_id={translation_author.id}")
        else:
            translation_author.bio = AI_AUTHOR_BIO
            translation_author.metadata_json = _merge_metadata(translation_author.metadata_json, AI_AUTHOR_METADATA)
            updated_authors += 1
            if args.verbose:
                print(f"UPDATE translation_author name={AI_AUTHOR_NAME} author_id={translation_author.id}")

        for work_seed in AI_WORKS:
            work = (
                db.query(CommentaryWork)
                .filter(
                    CommentaryWork.author_id == author.id,
                    CommentaryWork.title == work_seed["title"],
                )
                .first()
            )

            if work is None:
                work = CommentaryWork(
                    title=work_seed["title"],
                    author_id=author.id,
                    description=work_seed["description"],
                    metadata_json=work_seed["metadata"],
                    created_by=creator_id,
                )
                db.add(work)
                created_works += 1
                if args.verbose:
                    print(f"CREATE work title={work_seed['title']}")
                continue

            work.description = work_seed["description"]
            work.metadata_json = _merge_metadata(work.metadata_json, work_seed["metadata"])
            if creator_id is not None and work.created_by is None:
                work.created_by = creator_id
            updated_works += 1
            if args.verbose:
                print(f"UPDATE work title={work_seed['title']}")

        for work_seed in AI_TRANSLATION_WORKS:
            work = (
                db.query(TranslationWork)
                .filter(
                    TranslationWork.author_id == translation_author.id,
                    TranslationWork.title == work_seed["title"],
                )
                .first()
            )

            if work is None:
                work = TranslationWork(
                    title=work_seed["title"],
                    author_id=translation_author.id,
                    description=work_seed["description"],
                    metadata_json=work_seed["metadata"],
                )
                db.add(work)
                created_works += 1
                if args.verbose:
                    print(f"CREATE translation_work title={work_seed['title']}")
                continue

            work.description = work_seed["description"]
            work.metadata_json = _merge_metadata(work.metadata_json, work_seed["metadata"])
            updated_works += 1
            if args.verbose:
                print(f"UPDATE translation_work title={work_seed['title']}")

        if args.apply:
            db.commit()
            mode = "APPLY"
        else:
            db.rollback()
            mode = "DRY-RUN"

        print(
            f"[{mode}] created_authors={created_authors} updated_authors={updated_authors} "
            f"created_works={created_works} updated_works={updated_works} creator_id={creator_id}"
        )
        if not args.apply:
            print("[NOTE] No database changes were committed. Re-run with --apply to persist.")
        return 0
    except SQLAlchemyError as error:
        db.rollback()
        print("[ERROR] Failed to seed HSP AI commentary author/works.")
        print(f"[ERROR] URL: {resolved_database_url}")
        print(f"[ERROR] Details: {error}")
        return 1
    finally:
        db.close()
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())