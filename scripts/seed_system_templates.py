#!/usr/bin/env python3

from __future__ import annotations

import argparse
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
from models.template_library import RenderTemplate, RenderTemplateVersion
from models.user import User


def _metadata_liquid_template(fields: list[str]) -> str:
    labels = {
        "title": "Title",
        "sanskrit": "Sanskrit",
        "transliteration": "Transliteration",
        "english": "English",
        "text": "Text",
    }
    lines: list[str] = []
    for field_name in fields:
        label = labels.get(field_name, field_name.title())
        lines.append(f"{{% if metadata.{field_name} %}}{label}: {{{{ metadata.{field_name} }}}}\\n{{% endif %}}")
    return "".join(lines)


def _default_templates() -> dict[str, str]:
    return {
        "default.book.content_item.v1": (
            "{% if title %}Book: {{ title }}\\n{% endif %}"
            "{% if child_count %}Child Count: {{ child_count }}\\n{% endif %}"
            "{% if children %}Children: {{ children }}\\n{% endif %}"
        ),
        "default.front.content_item.v1": _metadata_liquid_template(["english", "text"]),
        "default.front.chapter.content_item.v1": _metadata_liquid_template(["english", "text"]),
        "default.front.section.content_item.v1": _metadata_liquid_template(["english", "text"]),
        "default.front.verse.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
        "default.front.shloka.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
        "default.body.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
        "default.body.chapter.content_item.v1": _metadata_liquid_template(["english", "text"]),
        "default.body.section.content_item.v1": _metadata_liquid_template(["english", "text"]),
        "default.body.verse.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
        "default.body.shloka.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
        "default.back.content_item.v1": _metadata_liquid_template(["english", "text"]),
        "default.back.chapter.content_item.v1": _metadata_liquid_template(["english", "text"]),
        "default.back.section.content_item.v1": _metadata_liquid_template(["english", "text"]),
        "default.back.verse.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
        "default.back.shloka.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
    }


def _infer_target_level(template_key: str) -> str | None:
    parts = template_key.split(".")
    if len(parts) >= 5:
        level = parts[2].strip().lower()
        if level in {"chapter", "section", "verse", "shloka"}:
            return level
    return None


def _resolve_owner_id(db, explicit_owner_id: int | None) -> int | None:
    if explicit_owner_id is not None:
        return explicit_owner_id

    admin_user = (
        db.query(User)
        .filter(User.role == "admin")
        .order_by(User.id.asc())
        .first()
    )
    if admin_user:
        return int(admin_user.id)

    any_user = db.query(User).order_by(User.id.asc()).first()
    if any_user:
        return int(any_user.id)

    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed default system templates into render_templates.")
    parser.add_argument("--apply", action="store_true", help="Persist changes. Dry-run by default.")
    parser.add_argument("--verbose", action="store_true", help="Print each template action.")
    parser.add_argument("--owner-id", type=int, default=None, help="Owner user id for system templates.")
    parser.add_argument("--database-url", default=None, help="Optional database URL override.")
    args = parser.parse_args()

    resolved_database_url = args.database_url or os.getenv("DATABASE_URL") or DATABASE_URL
    engine = create_engine(resolved_database_url, pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = session_factory()

    try:
        owner_id = _resolve_owner_id(db, args.owner_id)
        if owner_id is None:
            print("[ERROR] No users found; cannot assign owner for system templates.")
            print("[HINT] Create at least one user, then run this script again.")
            return 1

        defaults = _default_templates()
        created = 0
        updated = 0
        unchanged = 0

        for system_key, liquid_template in defaults.items():
            template = (
                db.query(RenderTemplate)
                .filter(RenderTemplate.system_key == system_key)
                .first()
            )

            if not template:
                template = RenderTemplate(
                    owner_id=owner_id,
                    name=system_key,
                    description="System default template",
                    target_schema_id=None,
                    target_level=_infer_target_level(system_key),
                    visibility="published",
                    is_system=True,
                    system_key=system_key,
                    liquid_template=liquid_template,
                    current_version=1,
                    is_active=True,
                )
                db.add(template)
                db.flush()
                db.add(
                    RenderTemplateVersion(
                        template_id=template.id,
                        version=1,
                        liquid_template=liquid_template,
                        change_note="Seeded system default template",
                        created_by=owner_id,
                    )
                )
                created += 1
                if args.verbose:
                    print(f"CREATE system_key={system_key} template_id={template.id}")
                continue

            template.owner_id = owner_id
            template.name = system_key
            template.visibility = "published"
            template.is_system = True
            template.system_key = system_key
            template.is_active = True
            inferred_level = _infer_target_level(system_key)
            if inferred_level:
                template.target_level = inferred_level

            if (template.liquid_template or "") != liquid_template:
                next_version = int(template.current_version or 0) + 1
                template.current_version = next_version
                template.liquid_template = liquid_template
                db.add(
                    RenderTemplateVersion(
                        template_id=template.id,
                        version=next_version,
                        liquid_template=liquid_template,
                        change_note="Updated system default template",
                        created_by=owner_id,
                    )
                )
                updated += 1
                if args.verbose:
                    print(f"UPDATE system_key={system_key} template_id={template.id} version={next_version}")
            else:
                unchanged += 1
                if args.verbose:
                    print(f"SKIP unchanged system_key={system_key} template_id={template.id}")

        if args.apply:
            db.commit()
            mode = "APPLY"
        else:
            db.rollback()
            mode = "DRY-RUN"

        print(f"[{mode}] created={created} updated={updated} unchanged={unchanged} owner_id={owner_id}")
        if not args.apply:
            print("[NOTE] No database changes were committed. Re-run with --apply to persist.")
        return 0
    except SQLAlchemyError as error:
        db.rollback()
        print("[ERROR] Failed to seed system templates.")
        print(f"[ERROR] URL: {resolved_database_url}")
        print(f"[ERROR] Details: {error}")
        return 1
    finally:
        db.close()
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
