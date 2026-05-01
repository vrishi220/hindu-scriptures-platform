"""Strict integration tests for Phase 1 backend APIs."""

import hashlib
import json
from pathlib import Path
from uuid import uuid4
from types import SimpleNamespace

import api.content as content_api
import api.draft_books as draft_books_api
from api.content import create_node
from fastapi import HTTPException
from fastapi import status
from models.book import Book
from models.content_node import ContentNode
from models.database import SessionLocal
from models.property_system import MetadataBinding
from models.provenance_record import ProvenanceRecord
from models.schemas import ContentNodeCreate, _validate_word_meanings_content_data
from models.scripture_schema import ScriptureSchema
from models.user import User
import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


_WORD_MEANINGS_FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "word_meanings"


def _load_word_meanings_fixture(filename: str) -> dict:
    fixture_path = _WORD_MEANINGS_FIXTURE_DIR / filename
    return json.loads(fixture_path.read_text(encoding="utf-8"))


def _register_and_login(client):
    suffix = uuid4().hex[:8]
    email = f"phase1_{suffix}@example.com"
    password = "StrongPass123!"

    register_payload = {
        "email": email,
        "password": password,
        "username": f"phase1_{suffix}",
        "full_name": "Phase1 Test User",
    }
    register_response = client.post("/api/auth/register", json=register_payload)
    assert register_response.status_code == status.HTTP_201_CREATED

    login_response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert login_response.status_code == status.HTTP_200_OK
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _register_user(client):
    suffix = uuid4().hex[:8]
    email = f"phase1_reset_{suffix}@example.com"
    password = "StrongPass123!"

    register_payload = {
        "email": email,
        "password": password,
        "username": f"phase1_reset_{suffix}",
        "full_name": "Phase1 Reset Test User",
    }
    register_response = client.post("/api/auth/register", json=register_payload)
    assert register_response.status_code == status.HTTP_201_CREATED
    return email, password


def _register_and_login_as_admin(client):
    headers = _register_and_login(client)
    me_response = client.get("/api/users/me", headers=headers)
    assert me_response.status_code == status.HTTP_200_OK
    user_id = me_response.json()["id"]
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        assert user is not None
        user.role = "admin"
        user.permissions = {
            "can_view": True,
            "can_contribute": True,
            "can_edit": True,
            "can_moderate": True,
            "can_admin": True,
        }
        db.commit()
    finally:
        db.close()
    return headers


def _create_minimal_book_with_exportable_content(client, headers, *, name_prefix: str = "PDF Export"):
    schema_response = client.post(
        "/api/content/schemas",
        json={
            "name": f"{name_prefix} Schema {uuid4().hex[:8]}",
            "description": "Schema for book PDF export coverage",
            "levels": ["Chapter", "Verse"],
        },
        headers=headers,
    )
    assert schema_response.status_code == status.HTTP_201_CREATED
    schema_id = schema_response.json()["id"]

    book_response = client.post(
        "/api/content/books",
        json={
            "schema_id": schema_id,
            "book_name": f"{name_prefix} Book {uuid4().hex[:6]}",
            "book_code": f"{name_prefix.lower().replace(' ', '-')}-{uuid4().hex[:8]}",
            "language_primary": "sanskrit",
            "metadata": {"author": "Regression Suite"},
        },
        headers=headers,
    )
    assert book_response.status_code == status.HTTP_201_CREATED
    book_id = book_response.json()["id"]

    chapter_response = client.post(
        "/api/content/nodes",
        json={
            "book_id": book_id,
            "level_name": "Chapter",
            "level_order": 1,
            "sequence_number": "1",
            "title_english": "Chapter 1",
            "has_content": False,
        },
        headers=headers,
    )
    assert chapter_response.status_code == status.HTTP_201_CREATED
    chapter_id = chapter_response.json()["id"]

    verse_response = client.post(
        "/api/content/nodes",
        json={
            "book_id": book_id,
            "parent_node_id": chapter_id,
            "level_name": "Verse",
            "level_order": 2,
            "sequence_number": "1",
            "title_english": "Verse 1",
            "has_content": True,
            "content_data": {
                "basic": {
                    "sanskrit": "धर्मक्षेत्रे कुरुक्षेत्रे",
                    "translation": "Dharma field verse",
                },
                "translations": {
                    "english": "Dharma field verse",
                    "hindi": "धर्मक्षेत्र का श्लोक",
                },
            },
        },
        headers=headers,
    )
    assert verse_response.status_code == status.HTTP_201_CREATED

    return {
        "schema_id": schema_id,
        "book_id": book_id,
        "chapter_id": chapter_id,
        "verse_id": verse_response.json()["id"],
    }


class TestPasswordResetIntegration:
    def test_register_rejects_weak_password(self, client):
        suffix = uuid4().hex[:8]
        register_response = client.post(
            "/api/auth/register",
            json={
                "email": f"weak_{suffix}@example.com",
                "password": "weakpass1",
                "username": f"weak_{suffix}",
            },
        )
        assert register_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_forgot_and_reset_password_flow(self, client, monkeypatch):
        monkeypatch.setenv("INCLUDE_RESET_TOKEN_IN_RESPONSE", "true")
        email, old_password = _register_user(client)

        forgot_response = client.post("/api/auth/forgot-password", json={"email": email})
        assert forgot_response.status_code == status.HTTP_200_OK
        forgot_payload = forgot_response.json()
        assert "message" in forgot_payload
        assert forgot_payload.get("reset_token")

        reset_response = client.post(
            "/api/auth/reset-password",
            json={
                "token": forgot_payload["reset_token"],
                "new_password": "NewStrongPass456!",
            },
        )
        assert reset_response.status_code == status.HTTP_200_OK

        old_login_response = client.post(
            "/api/auth/login",
            json={"email": email, "password": old_password},
        )
        assert old_login_response.status_code == status.HTTP_401_UNAUTHORIZED

        new_login_response = client.post(
            "/api/auth/login",
            json={"email": email, "password": "NewStrongPass456!"},
        )
        assert new_login_response.status_code == status.HTTP_200_OK


class TestPhase1PreferencesIntegration:
    def test_get_and_update_preferences_authenticated(self, client):
        headers = _register_and_login(client)

        get_response = client.get("/api/preferences", headers=headers)
        assert get_response.status_code == status.HTTP_200_OK
        data = get_response.json()
        assert data["source_language"] == "en"
        assert data["transliteration_script"] == "devanagari"
        assert data["show_only_preferred_script"] is False

        patch_payload = {
            "source_language": "en",
            "transliteration_enabled": True,
            "transliteration_script": "tamil",
            "show_roman_transliteration": False,
            "show_only_preferred_script": True,
            "preview_show_titles": True,
            "preview_show_labels": True,
            "preview_show_details": True,
            "preview_show_sanskrit": True,
            "preview_show_transliteration": False,
            "preview_show_english": False,
            "preview_show_commentary": False,
            "preview_transliteration_script": "iast",
        }
        patch_response = client.patch("/api/preferences", json=patch_payload, headers=headers)
        assert patch_response.status_code == status.HTTP_200_OK
        updated = patch_response.json()
        assert updated["transliteration_script"] == "tamil"
        assert updated["show_roman_transliteration"] is False
        assert updated["show_only_preferred_script"] is True
        assert updated["preview_show_titles"] is True
        assert updated["preview_show_labels"] is True
        assert updated["preview_show_details"] is True
        assert updated["preview_show_sanskrit"] is True
        assert updated["preview_show_transliteration"] is False
        assert updated["preview_show_english"] is False
        assert updated["preview_show_commentary"] is False
        assert updated["preview_transliteration_script"] == "iast"


class TestPhase1UsersMeIntegration:
    def test_get_and_patch_current_user_profile(self, client):
        headers = _register_and_login(client)

        me_response = client.get("/api/users/me", headers=headers)
        assert me_response.status_code == status.HTTP_200_OK
        me_payload = me_response.json()

        updated_username = f"patched_{uuid4().hex[:8]}"
        patch_response = client.patch(
            "/api/users/me",
            json={
                "full_name": "Updated Phase1 Name",
                "username": updated_username,
            },
            headers=headers,
        )
        assert patch_response.status_code == status.HTTP_200_OK
        patched_user = patch_response.json()
        assert patched_user["full_name"] == "Updated Phase1 Name"
        assert patched_user["username"] == updated_username
        assert patched_user["email"] == me_payload["email"]


class TestPhase1CompilationsIntegration:
    def test_create_update_and_list_compilation_authenticated(self, client):
        headers = _register_and_login(client)

        create_payload = {
            "title": "Integration Compilation",
            "description": "Phase 1 integration test",
            "schema_type": "custom",
            "items": [{"node_id": 1, "order": 1}],
            "metadata": {"introduction": "test intro"},
            "status": "draft",
            "is_public": False,
        }
        create_response = client.post("/api/compilations", json=create_payload, headers=headers)
        assert create_response.status_code == status.HTTP_201_CREATED
        created = create_response.json()
        compilation_id = created["id"]
        assert created["title"] == "Integration Compilation"
        assert created["status"] == "draft"

        my_response = client.get("/api/compilations/my", headers=headers)
        assert my_response.status_code == status.HTTP_200_OK
        my_ids = [item["id"] for item in my_response.json()]
        assert compilation_id in my_ids

        update_response = client.patch(
            f"/api/compilations/{compilation_id}",
            json={"status": "published", "is_public": True},
            headers=headers,
        )
        assert update_response.status_code == status.HTTP_200_OK
        updated = update_response.json()
        assert updated["status"] == "published"
        assert updated["is_public"] is True

        public_response = client.get("/api/compilations/public")
        assert public_response.status_code == status.HTTP_200_OK
        public_ids = [item["id"] for item in public_response.json()]
        assert compilation_id in public_ids


class TestViewerOwnershipAndReferences:
    def test_viewer_cannot_edit_others_but_can_reference_into_own_book(self, client):
        headers_a = _register_and_login(client)
        headers_b = _register_and_login(client)

        schema_payload = {
            "name": f"Ownership Schema {uuid4().hex[:8]}",
            "description": "Schema for ownership integration test",
            "levels": ["Chapter", "Verse"],
        }
        schema_response = client.post("/api/content/schemas", json=schema_payload, headers=headers_a)
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_a_payload = {
            "schema_id": schema_id,
            "book_name": f"Book A {uuid4().hex[:6]}",
            "book_code": f"book-a-{uuid4().hex[:6]}",
            "language_primary": "sanskrit",
        }
        book_a_response = client.post("/api/content/books", json=book_a_payload, headers=headers_a)
        assert book_a_response.status_code == status.HTTP_201_CREATED
        book_a_id = book_a_response.json()["id"]

        node_a_payload = {
            "book_id": book_a_id,
            "parent_node_id": None,
            "level_name": "Chapter",
            "level_order": 1,
            "sequence_number": "1",
            "title_english": "Chapter 1",
            "has_content": False,
        }
        node_a_response = client.post("/api/content/nodes", json=node_a_payload, headers=headers_a)
        assert node_a_response.status_code == status.HTTP_201_CREATED
        node_a_id = node_a_response.json()["id"]

        forbidden_edit = client.patch(
            f"/api/content/nodes/{node_a_id}",
            json={"title_english": "Unauthorized Edit Attempt"},
            headers=headers_b,
        )
        assert forbidden_edit.status_code == status.HTTP_403_FORBIDDEN

        book_b_payload = {
            "schema_id": schema_id,
            "book_name": f"Book B {uuid4().hex[:6]}",
            "book_code": f"book-b-{uuid4().hex[:6]}",
            "language_primary": "sanskrit",
        }
        book_b_response = client.post("/api/content/books", json=book_b_payload, headers=headers_b)
        assert book_b_response.status_code == status.HTTP_201_CREATED
        book_b_id = book_b_response.json()["id"]

        insert_refs_response = client.post(
            f"/api/content/books/{book_b_id}/insert-references",
            json={"node_ids": [node_a_id]},
            headers=headers_b,
        )
        assert insert_refs_response.status_code == status.HTTP_200_OK
        payload = insert_refs_response.json()
        assert payload["created_ids"]
        assert len(payload["created_ids"]) == 1
        created_ref_id = payload["created_ids"][0]

        provenance_list_response = client.get(
            f"/api/content/books/{book_b_id}/provenance",
            headers=headers_b,
        )
        assert provenance_list_response.status_code == status.HTTP_200_OK
        provenance_items = provenance_list_response.json()
        assert len(provenance_items) >= 1
        assert provenance_items[0]["target_book_id"] == book_b_id

        node_provenance_response = client.get(
            f"/api/content/nodes/{created_ref_id}/provenance",
            headers=headers_b,
        )
        assert node_provenance_response.status_code == status.HTTP_200_OK
        node_provenance_items = node_provenance_response.json()
        assert len(node_provenance_items) == 1
        assert node_provenance_items[0]["target_node_id"] == created_ref_id

        cross_user_provenance_read = client.get(
            f"/api/content/books/{book_b_id}/provenance",
            headers=headers_a,
        )
        assert cross_user_provenance_read.status_code == status.HTTP_200_OK
        cross_user_items = cross_user_provenance_read.json()
        assert len(cross_user_items) >= 1
        assert cross_user_items[0]["target_book_id"] == book_b_id

        db = SessionLocal()
        try:
            records = (
                db.query(ProvenanceRecord)
                .filter(
                    ProvenanceRecord.target_book_id == book_b_id,
                    ProvenanceRecord.target_node_id == created_ref_id,
                )
                .all()
            )
            assert len(records) == 1
            record = records[0]
            assert record.source_node_id == node_a_id
            assert record.source_book_id == book_a_id
            assert record.source_type == "library_reference"
            assert record.license_type
            assert record.source_version
        finally:
            db.close()


class TestNodeInsertAfterParentResolution:
    def test_create_sibling_with_insert_after_works_without_parent_id(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Insert After Schema {uuid4().hex[:8]}",
                "description": "Schema for insert-after sibling regression",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Insert After Book {uuid4().hex[:6]}",
                "book_code": f"insert-after-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_id = chapter_response.json()["id"]

        first_verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse 1",
                "has_content": True,
                "content_data": {"translations": {"english": "First verse"}},
            },
            headers=headers,
        )
        assert first_verse_response.status_code == status.HTTP_201_CREATED
        first_verse_id = first_verse_response.json()["id"]

        sibling_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "level_name": "Verse",
                "level_order": 2,
                "insert_after_node_id": first_verse_id,
                "title_english": "Verse 2",
                "has_content": True,
                "content_data": {"translations": {"english": "Second verse"}},
            },
            headers=headers,
        )

        assert sibling_response.status_code == status.HTTP_201_CREATED
        sibling_payload = sibling_response.json()
        assert sibling_payload["parent_node_id"] == chapter_id
        assert sibling_payload["level_name"] == "Verse"

    def test_create_sibling_with_insert_after_ignores_stale_parent_id(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Insert After Parent Mismatch {uuid4().hex[:8]}",
                "description": "Schema for insert-after parent mismatch regression",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Parent Mismatch Book {uuid4().hex[:6]}",
                "book_code": f"parent-mismatch-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_one_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_one_response.status_code == status.HTTP_201_CREATED
        chapter_one_id = chapter_one_response.json()["id"]

        chapter_two_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "2",
                "title_english": "Chapter 2",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_two_response.status_code == status.HTTP_201_CREATED
        chapter_two_id = chapter_two_response.json()["id"]

        first_verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_one_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse 1",
                "has_content": True,
                "content_data": {"translations": {"english": "First verse"}},
            },
            headers=headers,
        )
        assert first_verse_response.status_code == status.HTTP_201_CREATED
        first_verse_id = first_verse_response.json()["id"]

        sibling_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_two_id,
                "level_name": "Verse",
                "level_order": 2,
                "insert_after_node_id": first_verse_id,
                "title_english": "Verse 2",
                "has_content": True,
                "content_data": {"translations": {"english": "Second verse"}},
            },
            headers=headers,
        )

        assert sibling_response.status_code == status.HTTP_201_CREATED
        sibling_payload = sibling_response.json()
        assert sibling_payload["parent_node_id"] == chapter_one_id
        assert sibling_payload["level_name"] == "Verse"

    def test_create_sibling_with_insert_after_ignores_stale_level_context(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Insert After Level Schema {uuid4().hex[:8]}",
                "description": "Schema for insert-after stale level context",
                "levels": ["Chapter", "Section", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Insert After Level Book {uuid4().hex[:6]}",
                "book_code": f"insert-after-level-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_id = chapter_response.json()["id"]

        section_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Section",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Section 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert section_response.status_code == status.HTTP_201_CREATED
        section_id = section_response.json()["id"]

        sibling_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "insert_after_node_id": section_id,
                # Intentionally stale/incorrect values (from parent context).
                "level_name": "Chapter",
                "level_order": 1,
                "title_english": "Section 2",
                "has_content": False,
            },
            headers=headers,
        )

        assert sibling_response.status_code == status.HTTP_201_CREATED
        sibling_payload = sibling_response.json()
        assert sibling_payload["parent_node_id"] == chapter_id
        # insert-after node level "Section" is in schema → wins over stale payload "Chapter"
        assert sibling_payload["level_name"] == "Section"
        assert sibling_payload["level_order"] == 2

    def test_create_sibling_with_insert_after_and_stale_node_level_uses_payload_level(self, client):
        """When the insert-after node has a level_name that no longer exists in the schema
        (e.g., schema was changed after nodes were created), the payload's valid level wins."""
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Stale Level Schema {uuid4().hex[:8]}",
                "description": "Schema for stale-level regression",
                "levels": ["Adhyaya", "Shloka"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Stale Level Book {uuid4().hex[:6]}",
                "book_code": f"stale-level-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        # Create a root node via raw SQL with legacy level_name not in schema
        db_url = "postgresql://postgres@127.0.0.1:5432/hindu_scriptures"
        import sqlalchemy as _sa
        _engine = _sa.create_engine(db_url)
        with _engine.connect() as conn:
            result = conn.execute(_sa.text(
                "INSERT INTO content_nodes (book_id, level_name, level_order, sequence_number, has_content, created_by, last_modified_by) "
                "VALUES (:book_id, 'Prakarana', 1, '1', false, 1, 1) RETURNING id"
            ), {"book_id": book_id})
            conn.commit()
            legacy_node_id = result.scalar()
        _engine.dispose()

        sibling_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "insert_after_node_id": legacy_node_id,
                # Frontend correctly resolves "Adhyaya" based on level_order fallback
                "level_name": "Adhyaya",
                "level_order": 1,
                "title_english": "Adhyaya 2",
                "has_content": False,
            },
            headers=headers,
        )

        assert sibling_response.status_code == status.HTTP_201_CREATED
        sibling_payload = sibling_response.json()
        assert sibling_payload["level_name"] == "Adhyaya"
        assert sibling_payload["level_order"] == 1


class TestNodeDeleteSequenceRenumbering:
    def test_delete_node_renumbers_remaining_siblings(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Delete Renumber Schema {uuid4().hex[:8]}",
                "description": "Schema for delete renumber regression",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Delete Renumber Book {uuid4().hex[:6]}",
                "book_code": f"delete-renumber-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_id = chapter_response.json()["id"]

        created_verse_ids: list[int] = []
        for index in range(1, 4):
            verse_response = client.post(
                "/api/content/nodes",
                json={
                    "book_id": book_id,
                    "parent_node_id": chapter_id,
                    "level_name": "Verse",
                    "level_order": 2,
                    "sequence_number": str(index),
                    "title_english": f"Verse {index}",
                    "has_content": True,
                    "content_data": {"translations": {"english": f"Verse {index} content"}},
                },
                headers=headers,
            )
            assert verse_response.status_code == status.HTTP_201_CREATED
            created_verse_ids.append(verse_response.json()["id"])

        delete_response = client.delete(f"/api/content/nodes/{created_verse_ids[1]}", headers=headers)
        assert delete_response.status_code == status.HTTP_200_OK

        tree_response = client.get(f"/api/content/books/{book_id}/tree", headers=headers)
        assert tree_response.status_code == status.HTTP_200_OK
        tree_payload = tree_response.json()
        verses = [
            item
            for item in tree_payload
            if item.get("parent_node_id") == chapter_id and item.get("level_name") == "Verse"
        ]
        assert len(verses) == 2
        assert [str(item["sequence_number"]) for item in verses] == ["1", "2"]

    def test_viewer_cannot_copy_existing_content_as_independent_node(self, client):
        headers_a = _register_and_login(client)
        headers_b = _register_and_login(client)

        schema_payload = {
            "name": f"Copy Restriction Schema {uuid4().hex[:8]}",
            "description": "Schema for copy restriction integration test",
            "levels": ["Chapter", "Verse"],
        }
        schema_response = client.post("/api/content/schemas", json=schema_payload, headers=headers_a)
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        source_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Source Book {uuid4().hex[:6]}",
                "book_code": f"src-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers_a,
        )
        assert source_book_response.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_response.json()["id"]

        source_node_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Source Chapter",
                "has_content": False,
            },
            headers=headers_a,
        )
        assert source_node_response.status_code == status.HTTP_201_CREATED

        target_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Target Book {uuid4().hex[:6]}",
                "book_code": f"tgt-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers_b,
        )
        assert target_book_response.status_code == status.HTTP_201_CREATED
        target_book_id = target_book_response.json()["id"]

        source_node = source_node_response.json()
        forbidden_copy = client.post(
            "/api/content/nodes",
            json={
                "book_id": target_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": source_node.get("title_english"),
                "has_content": source_node.get("has_content", False),
                "content_data": source_node.get("content_data") or {},
                "summary_data": source_node.get("summary_data") or {},
                "source_attribution": "Copied from source node",
                "license_type": source_node.get("license_type") or "CC-BY-SA-4.0",
                "tags": source_node.get("tags") or [],
            },
            headers=headers_b,
        )
        assert forbidden_copy.status_code == status.HTTP_403_FORBIDDEN
        assert (
            forbidden_copy.json()["detail"]
            == "You can only add existing content as references"
        )


class TestBookCreationValidation:
    def test_create_book_with_invalid_schema_returns_400(self, client):
        headers = _register_and_login(client)

        create_response = client.post(
            "/api/content/books",
            json={
                "schema_id": 999999,
                "book_name": f"Invalid Schema Book {uuid4().hex[:6]}",
                "book_code": None,
                "language_primary": "sanskrit",
            },
            headers=headers,
        )

        assert create_response.status_code == status.HTTP_400_BAD_REQUEST
        assert create_response.json()["detail"] == "Invalid schema_id"


class TestBookPrivacyAndPublishToggle:
    def test_private_draft_readable_but_not_publishable_by_non_owner(self, client):
        headers_owner = _register_and_login(client)
        headers_other = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Privacy Schema {uuid4().hex[:8]}",
                "description": "Schema for privacy test",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers_owner,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Owner Draft {uuid4().hex[:6]}",
                "book_code": f"owner-draft-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers_owner,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        created_book = book_response.json()
        book_id = created_book["id"]
        assert created_book["status"] == "draft"
        assert created_book["visibility"] == "private"

        list_other_before = client.get("/api/content/books", headers=headers_other)
        assert list_other_before.status_code == status.HTTP_200_OK
        assert any(item["id"] == book_id for item in list_other_before.json())

        get_other_before = client.get(f"/api/content/books/{book_id}", headers=headers_other)
        assert get_other_before.status_code == status.HTTP_200_OK

        list_anon_before = client.get("/api/content/books")
        assert list_anon_before.status_code == status.HTTP_200_OK
        assert any(item["id"] == book_id for item in list_anon_before.json())

        unauthorized_publish = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "published", "visibility": "public"},
            headers=headers_other,
        )
        assert unauthorized_publish.status_code == status.HTTP_403_FORBIDDEN

        publish_response = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "published", "visibility": "public"},
            headers=headers_owner,
        )
        assert publish_response.status_code == status.HTTP_200_OK
        published_book = publish_response.json()
        assert published_book["status"] == "published"
        assert published_book["visibility"] == "public"

        list_other_after = client.get("/api/content/books", headers=headers_other)
        assert list_other_after.status_code == status.HTTP_200_OK
        assert any(item["id"] == book_id for item in list_other_after.json())

        get_other_after = client.get(f"/api/content/books/{book_id}", headers=headers_other)
        assert get_other_after.status_code == status.HTTP_200_OK

    def test_owner_can_toggle_public_book_back_to_private(self, client):
        owner_headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Toggle Schema {uuid4().hex[:8]}",
                "description": "Schema for owner visibility toggle test",
                "levels": ["Chapter"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Toggle Book {uuid4().hex[:6]}",
                "book_code": f"toggle-book-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        publish_response = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "published", "visibility": "public"},
            headers=owner_headers,
        )
        assert publish_response.status_code == status.HTTP_200_OK
        assert publish_response.json()["status"] == "published"
        assert publish_response.json()["visibility"] == "public"

        unpublish_response = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "draft", "visibility": "private"},
            headers=owner_headers,
        )
        assert unpublish_response.status_code == status.HTTP_200_OK
        assert unpublish_response.json()["status"] == "draft"
        assert unpublish_response.json()["visibility"] == "private"

    def test_non_owner_cannot_make_public_book_private(self, client):
        owner_headers = _register_and_login(client)
        other_headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Toggle Guard Schema {uuid4().hex[:8]}",
                "description": "Schema for non-owner visibility toggle guard",
                "levels": ["Chapter"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Toggle Guard Book {uuid4().hex[:6]}",
                "book_code": f"toggle-guard-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        publish_response = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "published", "visibility": "public"},
            headers=owner_headers,
        )
        assert publish_response.status_code == status.HTTP_200_OK

        unauthorized_toggle = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "draft", "visibility": "private"},
            headers=other_headers,
        )
        assert unauthorized_toggle.status_code == status.HTTP_403_FORBIDDEN

    def test_admin_can_change_visibility_on_another_users_book(self, client):
        owner_headers = _register_and_login(client)
        admin_headers = _register_and_login_as_admin(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Admin Toggle Schema {uuid4().hex[:8]}",
                "description": "Schema for admin visibility toggle test",
                "levels": ["Chapter"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Admin Toggle Book {uuid4().hex[:6]}",
                "book_code": f"admin-toggle-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        admin_publish = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "published", "visibility": "public"},
            headers=admin_headers,
        )
        assert admin_publish.status_code == status.HTTP_200_OK
        assert admin_publish.json()["status"] == "published"
        assert admin_publish.json()["visibility"] == "public"

        admin_unpublish = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "draft", "visibility": "private"},
            headers=admin_headers,
        )
        assert admin_unpublish.status_code == status.HTTP_200_OK
        assert admin_unpublish.json()["status"] == "draft"
        assert admin_unpublish.json()["visibility"] == "private"


class TestDailyVerseVisibilityRegression:
    def test_daily_verse_uses_user_visible_books(self, client, monkeypatch):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Daily Verse Schema {uuid4().hex[:8]}",
                "description": "Schema for daily verse visibility regression",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Daily Verse Private {uuid4().hex[:6]}",
                "book_code": f"daily-private-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_id = chapter_response.json()["id"]

        marker = f"daily-marker-{uuid4().hex}"
        verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Shloka 1",
                "has_content": True,
                "content_data": {
                    "translations": {"english": marker},
                },
            },
            headers=headers,
        )
        assert verse_response.status_code == status.HTTP_201_CREATED

        original_visibility = content_api._book_is_visible_to_user

        def only_target_book_visible(db, book, current_user):
            return book.id == book_id

        monkeypatch.setattr(content_api, "_book_is_visible_to_user", only_target_book_visible)
        try:
            response = client.get("/api/content/daily-verse?mode=daily", headers=headers)
            assert response.status_code == status.HTTP_200_OK
            payload = response.json()
            assert payload is not None
            assert payload["book_id"] == book_id
            assert marker in payload["content"]
        finally:
            monkeypatch.setattr(content_api, "_book_is_visible_to_user", original_visibility)

    def test_daily_verse_anonymous_only_uses_public_books(self, client, monkeypatch):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Daily Verse Anonymous Schema {uuid4().hex[:8]}",
                "description": "Schema for anonymous daily verse visibility",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        private_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Private Daily Book {uuid4().hex[:6]}",
                "book_code": f"private-daily-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert private_book_response.status_code == status.HTTP_201_CREATED
        private_book_id = private_book_response.json()["id"]

        public_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Public Daily Book {uuid4().hex[:6]}",
                "book_code": f"public-daily-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert public_book_response.status_code == status.HTTP_201_CREATED
        public_book_id = public_book_response.json()["id"]

        publish_response = client.patch(
            f"/api/content/books/{public_book_id}",
            json={"status": "published", "visibility": "public"},
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_200_OK

        private_chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": private_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Private Chapter 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert private_chapter_response.status_code == status.HTTP_201_CREATED
        private_chapter_id = private_chapter_response.json()["id"]

        public_chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": public_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Public Chapter 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert public_chapter_response.status_code == status.HTTP_201_CREATED
        public_chapter_id = public_chapter_response.json()["id"]

        private_marker = f"private-daily-{uuid4().hex}"
        public_marker = f"public-daily-{uuid4().hex}"

        private_verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": private_book_id,
                "parent_node_id": private_chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Private Verse 1",
                "has_content": True,
                "content_data": {
                    "translations": {"english": private_marker},
                },
            },
            headers=headers,
        )
        assert private_verse_response.status_code == status.HTTP_201_CREATED

        public_verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": public_book_id,
                "parent_node_id": public_chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Public Verse 1",
                "has_content": True,
                "content_data": {
                    "translations": {"english": public_marker},
                },
            },
            headers=headers,
        )
        assert public_verse_response.status_code == status.HTTP_201_CREATED

        original_book_visibility = content_api._book_visibility

        def scoped_book_visibility(book):
            if book.id == public_book_id:
                return "public"
            if book.id == private_book_id:
                return "private"
            return "private"

        monkeypatch.setattr(content_api, "_book_visibility", scoped_book_visibility)

        try:
            client.cookies.clear()
            anonymous_daily_response = client.get("/api/content/daily-verse?mode=daily")
            assert anonymous_daily_response.status_code == status.HTTP_200_OK
            anonymous_daily_payload = anonymous_daily_response.json()
            assert anonymous_daily_payload is not None
            assert anonymous_daily_payload["book_id"] == public_book_id
            assert public_marker in anonymous_daily_payload["content"]
            assert private_marker not in anonymous_daily_payload["content"]
        finally:
            monkeypatch.setattr(content_api, "_book_visibility", original_book_visibility)

    def test_random_verse_anonymous_returns_none_when_only_private_books(self, client, monkeypatch):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Random Verse Anonymous Schema {uuid4().hex[:8]}",
                "description": "Schema for anonymous random verse filtering",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        private_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Private Random Book {uuid4().hex[:6]}",
                "book_code": f"private-random-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert private_book_response.status_code == status.HTTP_201_CREATED
        private_book_id = private_book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": private_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Private Chapter",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_id = chapter_response.json()["id"]

        private_verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": private_book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Private Verse",
                "has_content": True,
                "content_data": {
                    "translations": {"english": f"private-random-{uuid4().hex}"},
                },
            },
            headers=headers,
        )
        assert private_verse_response.status_code == status.HTTP_201_CREATED

        original_book_visibility = content_api._book_visibility

        def private_only_visibility(book):
            if book.id == private_book_id:
                return "private"
            return "private"

        monkeypatch.setattr(content_api, "_book_visibility", private_only_visibility)

        try:
            client.cookies.clear()
            anonymous_random_response = client.get("/api/content/daily-verse?mode=random")
            assert anonymous_random_response.status_code == status.HTTP_200_OK
            assert anonymous_random_response.json() is None
        finally:
            monkeypatch.setattr(content_api, "_book_visibility", original_book_visibility)

    def test_random_verse_selects_book_before_verse(self, client, monkeypatch):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Random Verse Fairness Schema {uuid4().hex[:8]}",
                "description": "Schema for random verse fairness regression",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        small_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Small Random Book {uuid4().hex[:6]}",
                "book_code": f"small-random-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert small_book_response.status_code == status.HTTP_201_CREATED
        small_book_id = small_book_response.json()["id"]

        large_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Large Random Book {uuid4().hex[:6]}",
                "book_code": f"large-random-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert large_book_response.status_code == status.HTTP_201_CREATED
        large_book_id = large_book_response.json()["id"]

        def create_chapter(book_id: int, title: str) -> int:
            response = client.post(
                "/api/content/nodes",
                json={
                    "book_id": book_id,
                    "parent_node_id": None,
                    "level_name": "Chapter",
                    "level_order": 1,
                    "sequence_number": "1",
                    "title_english": title,
                    "has_content": False,
                },
                headers=headers,
            )
            assert response.status_code == status.HTTP_201_CREATED
            return response.json()["id"]

        small_chapter_id = create_chapter(small_book_id, "Small Chapter")
        large_chapter_id = create_chapter(large_book_id, "Large Chapter")

        small_marker = f"small-random-marker-{uuid4().hex}"
        small_verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": small_book_id,
                "parent_node_id": small_chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Small Verse 1",
                "has_content": True,
                "content_data": {"translations": {"english": small_marker}},
            },
            headers=headers,
        )
        assert small_verse_response.status_code == status.HTTP_201_CREATED

        for index in range(1, 4):
            large_verse_response = client.post(
                "/api/content/nodes",
                json={
                    "book_id": large_book_id,
                    "parent_node_id": large_chapter_id,
                    "level_name": "Verse",
                    "level_order": 2,
                    "sequence_number": str(index),
                    "title_english": f"Large Verse {index}",
                    "has_content": True,
                    "content_data": {
                        "translations": {"english": f"large-random-marker-{index}-{uuid4().hex}"}
                    },
                },
                headers=headers,
            )
            assert large_verse_response.status_code == status.HTTP_201_CREATED

        observed_choice_options: list[list[int]] = []
        observed_shuffle_sizes: list[int] = []
        original_choice = content_api.random.choice
        original_shuffle = content_api.random.shuffle

        def track_choice(options):
            option_list = list(options)
            observed_choice_options.append(option_list)
            if sorted(option_list) == sorted([small_book_id, large_book_id]):
                return small_book_id
            return original_choice(option_list)

        def track_shuffle(items):
            observed_shuffle_sizes.append(len(items))
            # no-op to keep the selected book's verse order deterministic for assertion

        original_book_visibility = content_api._book_is_visible_to_user

        def only_target_books_visible(db, book, current_user):
            return book.id in {small_book_id, large_book_id}

        monkeypatch.setattr(content_api.random, "choice", track_choice)
        monkeypatch.setattr(content_api.random, "shuffle", track_shuffle)
        monkeypatch.setattr(content_api, "_book_is_visible_to_user", only_target_books_visible)

        try:
            response = client.get("/api/content/daily-verse?mode=random", headers=headers)
            assert response.status_code == status.HTTP_200_OK
            payload = response.json()
            assert payload is not None
            assert payload["book_id"] == small_book_id
            assert small_marker in payload["content"]
            assert any(sorted(options) == sorted([small_book_id, large_book_id]) for options in observed_choice_options)
            assert observed_shuffle_sizes == [1]
        finally:
            monkeypatch.setattr(content_api, "_book_is_visible_to_user", original_book_visibility)

    def test_random_verse_skips_non_previewable_candidates(self, client, monkeypatch):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Random Verse Previewability Schema {uuid4().hex[:8]}",
                "description": "Ensure random verse picks previewable text",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Random Previewability Book {uuid4().hex[:6]}",
                "book_code": f"random-previewability-{uuid4().hex[:10]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_id = chapter_response.json()["id"]

        placeholder_verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse 1",
                "has_content": True,
                "content_data": {
                    "translations": {"english": "Chapter 1 Verse 1"},
                },
            },
            headers=headers,
        )
        assert placeholder_verse_response.status_code == status.HTTP_201_CREATED

        valid_marker = f"previewable-random-marker-{uuid4().hex}"
        valid_verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "2",
                "title_english": "Verse 2",
                "has_content": True,
                "content_data": {
                    "translations": {"english": valid_marker},
                },
            },
            headers=headers,
        )
        assert valid_verse_response.status_code == status.HTTP_201_CREATED

        original_book_visibility = content_api._book_is_visible_to_user
        original_shuffle = content_api.random.shuffle

        def only_target_book_visible(db, book, current_user):
            return book.id == book_id

        def preserve_order(items):
            return None

        monkeypatch.setattr(content_api, "_book_is_visible_to_user", only_target_book_visible)
        monkeypatch.setattr(content_api.random, "shuffle", preserve_order)

        try:
            response = client.get("/api/content/daily-verse?mode=random", headers=headers)
            assert response.status_code == status.HTTP_200_OK
            payload = response.json()
            assert payload is not None
            assert payload["book_id"] == book_id
            assert valid_marker in payload["content"]
        finally:
            monkeypatch.setattr(content_api, "_book_is_visible_to_user", original_book_visibility)
            monkeypatch.setattr(content_api.random, "shuffle", original_shuffle)


class TestBookSharesPhase2:
    def test_owner_can_share_private_book_with_selected_users(self, client):
        headers_owner = _register_and_login(client)
        headers_viewer = _register_and_login(client)
        headers_contributor = _register_and_login(client)

        owner_me = client.get("/api/users/me", headers=headers_owner)
        viewer_me = client.get("/api/users/me", headers=headers_viewer)
        contributor_me = client.get("/api/users/me", headers=headers_contributor)
        assert owner_me.status_code == status.HTTP_200_OK
        assert viewer_me.status_code == status.HTTP_200_OK
        assert contributor_me.status_code == status.HTTP_200_OK

        viewer_email = viewer_me.json()["email"]
        viewer_id = viewer_me.json()["id"]
        contributor_email = contributor_me.json()["email"]

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Share Schema {uuid4().hex[:8]}",
                "description": "Schema for sharing tests",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers_owner,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Private Shared Book {uuid4().hex[:6]}",
                "book_code": f"share-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers_owner,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        pre_share_view = client.get(f"/api/content/books/{book_id}", headers=headers_viewer)
        assert pre_share_view.status_code == status.HTTP_200_OK

        share_viewer_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": viewer_email, "permission": "viewer"},
            headers=headers_owner,
        )
        assert share_viewer_response.status_code == status.HTTP_201_CREATED

        share_contributor_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": contributor_email, "permission": "contributor"},
            headers=headers_owner,
        )
        assert share_contributor_response.status_code == status.HTTP_201_CREATED

        list_shares_response = client.get(
            f"/api/content/books/{book_id}/shares",
            headers=headers_owner,
        )
        assert list_shares_response.status_code == status.HTTP_200_OK
        shared_ids = {item["shared_with_user_id"] for item in list_shares_response.json()}
        assert viewer_id in shared_ids

        post_share_view = client.get(f"/api/content/books/{book_id}", headers=headers_viewer)
        assert post_share_view.status_code == status.HTTP_200_OK

        viewer_edit_attempt = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Viewer should not edit",
                "has_content": False,
            },
            headers=headers_viewer,
        )
        assert viewer_edit_attempt.status_code == status.HTTP_403_FORBIDDEN

        contributor_edit_attempt = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Contributor can edit",
                "has_content": False,
            },
            headers=headers_contributor,
        )
        assert contributor_edit_attempt.status_code == status.HTTP_201_CREATED

        delete_share_response = client.delete(
            f"/api/content/books/{book_id}/shares/{viewer_id}",
            headers=headers_owner,
        )
        assert delete_share_response.status_code == status.HTTP_200_OK

        post_delete_view = client.get(f"/api/content/books/{book_id}", headers=headers_viewer)
        assert post_delete_view.status_code == status.HTTP_200_OK

    def test_share_create_is_case_insensitive_and_updates_existing_share(self, client):
        headers_owner = _register_and_login(client)
        headers_viewer = _register_and_login(client)

        owner_me = client.get("/api/users/me", headers=headers_owner)
        viewer_me = client.get("/api/users/me", headers=headers_viewer)
        assert owner_me.status_code == status.HTTP_200_OK
        assert viewer_me.status_code == status.HTTP_200_OK

        viewer_email = viewer_me.json()["email"]
        viewer_id = viewer_me.json()["id"]

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Share Case Schema {uuid4().hex[:8]}",
                "description": "Schema for share case-insensitive tests",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers_owner,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Share Case Book {uuid4().hex[:6]}",
                "book_code": f"share-case-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers_owner,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        mixed_case_email = viewer_email.upper()
        first_share_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": mixed_case_email, "permission": "viewer"},
            headers=headers_owner,
        )
        assert first_share_response.status_code == status.HTTP_201_CREATED

        second_share_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": viewer_email.lower(), "permission": "editor"},
            headers=headers_owner,
        )
        assert second_share_response.status_code == status.HTTP_201_CREATED

        list_shares_response = client.get(
            f"/api/content/books/{book_id}/shares",
            headers=headers_owner,
        )
        assert list_shares_response.status_code == status.HTTP_200_OK

        shares = list_shares_response.json()
        viewer_shares = [share for share in shares if share["shared_with_user_id"] == viewer_id]
        assert len(viewer_shares) == 1
        assert viewer_shares[0]["permission"] == "editor"

    def test_create_node_copy_populates_variant_author_registry_from_author_name(self, client):
        headers = _register_and_login_as_admin(client)

        schema_resp = client.post(
            "/api/content/schemas",
            json={"name": f"Flat {uuid4().hex[:6]}", "description": "flat", "levels": ["Verse"]},
            headers=headers,
        )
        assert schema_resp.status_code == status.HTTP_201_CREATED
        schema_id = schema_resp.json()["id"]

        book_resp = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Compiled Book {uuid4().hex[:6]}",
                "book_code": f"compiled-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_resp.status_code == status.HTTP_201_CREATED
        book_id = book_resp.json()["id"]

        first_node_resp = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "level_name": "Verse",
                "level_order": 1,
                "sequence_number": "1",
                "has_content": True,
                "content_data": {
                    "translation_variants": [
                        {"author": "Bar Foo", "language": "english", "text": "First translation"}
                    ]
                },
            },
            headers=headers,
        )
        assert first_node_resp.status_code == status.HTTP_201_CREATED
        first_node_payload = first_node_resp.json()
        assert first_node_payload["content_data"]["translation_variants"][0]["author_slug"] == "bar_foo"

        second_node_resp = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "level_name": "Verse",
                "level_order": 1,
                "sequence_number": "2",
                "has_content": True,
                "content_data": {
                    "translation_variants": [
                        {"author": "Baz Qux", "language": "english", "text": "Second translation"}
                    ]
                },
            },
            headers=headers,
        )
        assert second_node_resp.status_code == status.HTTP_201_CREATED
        second_node_payload = second_node_resp.json()
        assert second_node_payload["content_data"]["translation_variants"][0]["author_slug"] == "baz_qux"

        book_detail_resp = client.get(f"/api/content/books/{book_id}", headers=headers)
        assert book_detail_resp.status_code == status.HTTP_200_OK
        assert book_detail_resp.json()["variant_authors"] == {
            "bar_foo": "Bar Foo",
            "baz_qux": "Baz Qux",
        }

    def test_create_node_copy_rewrites_conflicting_variant_author_slugs(self, client):
        headers = _register_and_login_as_admin(client)

        schema_resp = client.post(
            "/api/content/schemas",
            json={"name": f"Flat {uuid4().hex[:6]}", "description": "flat", "levels": ["Verse"]},
            headers=headers,
        )
        assert schema_resp.status_code == status.HTTP_201_CREATED
        schema_id = schema_resp.json()["id"]

        book_resp = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Collision Book {uuid4().hex[:6]}",
                "book_code": f"collision-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_resp.status_code == status.HTTP_201_CREATED
        book_id = book_resp.json()["id"]

        first_node_resp = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "level_name": "Verse",
                "level_order": 1,
                "sequence_number": "1",
                "has_content": True,
                "content_data": {
                    "translation_variants": [
                        {
                            "author_slug": "bar",
                            "author": "Bar Foo",
                            "language": "english",
                            "text": "First translation",
                        }
                    ]
                },
            },
            headers=headers,
        )
        assert first_node_resp.status_code == status.HTTP_201_CREATED

        second_node_resp = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "level_name": "Verse",
                "level_order": 1,
                "sequence_number": "2",
                "has_content": True,
                "content_data": {
                    "translation_variants": [
                        {
                            "author_slug": "bar",
                            "author": "Baz Foo",
                            "language": "english",
                            "text": "Second translation",
                        }
                    ]
                },
            },
            headers=headers,
        )
        assert second_node_resp.status_code == status.HTTP_201_CREATED
        second_variant = second_node_resp.json()["content_data"]["translation_variants"][0]
        assert second_variant["author_slug"] == "bar_2"

        book_detail_resp = client.get(f"/api/content/books/{book_id}", headers=headers)
        assert book_detail_resp.status_code == status.HTTP_200_OK
        assert book_detail_resp.json()["variant_authors"] == {
            "bar": "Bar Foo",
            "bar_2": "Baz Foo",
        }

    def test_create_node_reference_merges_source_book_variant_authors(self, client):
        headers = _register_and_login_as_admin(client)

        schema_resp = client.post(
            "/api/content/schemas",
            json={"name": f"Flat {uuid4().hex[:6]}", "description": "flat", "levels": ["Verse"]},
            headers=headers,
        )
        assert schema_resp.status_code == status.HTTP_201_CREATED
        schema_id = schema_resp.json()["id"]

        source_book_resp = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Source Book {uuid4().hex[:6]}",
                "book_code": f"source-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert source_book_resp.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_resp.json()["id"]

        update_source_book_resp = client.patch(
            f"/api/content/books/{source_book_id}",
            json={"variant_authors": {"bar": "Bar Foo"}},
            headers=headers,
        )
        assert update_source_book_resp.status_code == status.HTTP_200_OK

        source_node_resp = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "level_name": "Verse",
                "level_order": 1,
                "sequence_number": "1",
                "has_content": True,
                "content_data": {
                    "translation_variants": [
                        {
                            "author_slug": "bar",
                            "author": "Bar Foo",
                            "language": "english",
                            "text": "Source translation",
                        }
                    ]
                },
            },
            headers=headers,
        )
        assert source_node_resp.status_code == status.HTTP_201_CREATED
        source_node_id = source_node_resp.json()["id"]

        target_book_resp = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Target Book {uuid4().hex[:6]}",
                "book_code": f"target-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert target_book_resp.status_code == status.HTTP_201_CREATED
        target_book_id = target_book_resp.json()["id"]

        ref_node_resp = client.post(
            "/api/content/nodes",
            json={
                "book_id": target_book_id,
                "referenced_node_id": source_node_id,
                "level_name": "Verse",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Referenced Verse",
                "has_content": False,
                "content_data": {},
            },
            headers=headers,
        )
        assert ref_node_resp.status_code == status.HTTP_201_CREATED

        target_book_detail_resp = client.get(f"/api/content/books/{target_book_id}", headers=headers)
        assert target_book_detail_resp.status_code == status.HTTP_200_OK
        assert target_book_detail_resp.json()["variant_authors"] == {"bar": "Bar Foo"}

    def test_create_node_reference_merges_variant_authors_from_source_node_when_book_registry_empty(self, client):
        headers = _register_and_login_as_admin(client)

        schema_resp = client.post(
            "/api/content/schemas",
            json={"name": f"Flat {uuid4().hex[:6]}", "description": "flat", "levels": ["Verse"]},
            headers=headers,
        )
        assert schema_resp.status_code == status.HTTP_201_CREATED
        schema_id = schema_resp.json()["id"]

        source_book_resp = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Source No Registry {uuid4().hex[:6]}",
                "book_code": f"src-noreg-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert source_book_resp.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_resp.json()["id"]

        source_node_resp = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "level_name": "Verse",
                "level_order": 1,
                "sequence_number": "1",
                "has_content": True,
                "content_data": {
                    "translation_variants": [
                        {
                            "author_slug": "bar",
                            "author": "Bar Foo",
                            "language": "english",
                            "text": "Source translation",
                        }
                    ]
                },
            },
            headers=headers,
        )
        assert source_node_resp.status_code == status.HTTP_201_CREATED
        source_node_id = source_node_resp.json()["id"]

        target_book_resp = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Target No Registry {uuid4().hex[:6]}",
                "book_code": f"tgt-noreg-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert target_book_resp.status_code == status.HTTP_201_CREATED
        target_book_id = target_book_resp.json()["id"]

        ref_node_resp = client.post(
            "/api/content/nodes",
            json={
                "book_id": target_book_id,
                "referenced_node_id": source_node_id,
                "level_name": "Verse",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Referenced Verse",
                "has_content": False,
                "content_data": {},
            },
            headers=headers,
        )
        assert ref_node_resp.status_code == status.HTTP_201_CREATED

        target_book_detail_resp = client.get(f"/api/content/books/{target_book_id}", headers=headers)
        assert target_book_detail_resp.status_code == status.HTTP_200_OK
        assert target_book_detail_resp.json()["variant_authors"] == {"bar": "Bar Foo"}


class TestHierarchyInsertionRegression:
    def test_schema_hierarchy_rules_and_tree_payload(self, client):
        suffix = uuid4().hex[:8]
        db = SessionLocal()
        try:
            test_user = SimpleNamespace(id=1)

            schema = ScriptureSchema(
                name=f"Ramayana Regression {suffix}",
                description="Regression schema for hierarchy validation",
                levels=["Kanda", "Sarga", "Shloka"],
            )
            db.add(schema)
            db.commit()
            db.refresh(schema)

            book = Book(
                schema_id=schema.id,
                book_name=f"Ramayana Test {suffix}",
                book_code=f"ram-reg-{suffix}",
                language_primary="sanskrit",
                metadata_json={},
            )
            db.add(book)
            db.commit()
            db.refresh(book)

            kanda = ContentNode(
                book_id=book.id,
                parent_node_id=None,
                level_name="Kanda",
                level_order=1,
                sequence_number=1,
                title_english="Bala Kanda",
                has_content=False,
                created_by=test_user.id,
                last_modified_by=test_user.id,
            )
            db.add(kanda)
            db.commit()
            db.refresh(kanda)
            kanda_id = kanda.id

            with pytest.raises(HTTPException) as invalid_root_exc:
                create_node(
                    payload=ContentNodeCreate(
                        book_id=book.id,
                        parent_node_id=None,
                        level_name="Sarga",
                        level_order=2,
                        sequence_number="1",
                        title_english="Invalid Root Sarga",
                        has_content=False,
                    ),
                    db=db,
                    current_user=test_user,
                )
            assert invalid_root_exc.value.status_code == status.HTTP_400_BAD_REQUEST
            assert "Root level items must be at" in invalid_root_exc.value.detail

            sarga_with_content = create_node(
                payload=ContentNodeCreate(
                    book_id=book.id,
                    parent_node_id=kanda_id,
                    level_name="Sarga",
                    level_order=2,
                    sequence_number="1",
                    title_english="Sarga with content should pass",
                    has_content=True,
                    content_data={"basic": {"translation": "valid non-leaf content"}},
                ),
                db=db,
                current_user=test_user,
            )
            assert sarga_with_content.level_name == "Sarga"
            assert sarga_with_content.has_content is True
            sarga_id = sarga_with_content.id

            with pytest.raises(HTTPException) as invalid_direct_leaf_exc:
                create_node(
                    payload=ContentNodeCreate(
                        book_id=book.id,
                        parent_node_id=kanda_id,
                        level_name="Shloka",
                        level_order=3,
                        sequence_number="1",
                        title_english="Invalid direct Shloka",
                        has_content=True,
                        content_data={"basic": {"translation": "invalid"}},
                    ),
                    db=db,
                    current_user=test_user,
                )
            assert invalid_direct_leaf_exc.value.status_code == status.HTTP_400_BAD_REQUEST
            assert "Expected child level" in invalid_direct_leaf_exc.value.detail

            shloka = ContentNode(
                book_id=book.id,
                parent_node_id=sarga_id,
                level_name="Shloka",
                level_order=3,
                sequence_number=1,
                title_english="Shloka 1",
                has_content=True,
                content_data={"basic": {"translation": "valid"}},
                created_by=test_user.id,
                last_modified_by=test_user.id,
            )
            db.add(shloka)
            db.commit()
            db.refresh(shloka)
            shloka_id = shloka.id

            with pytest.raises(HTTPException) as invalid_child_of_leaf_exc:
                create_node(
                    payload=ContentNodeCreate(
                        book_id=book.id,
                        parent_node_id=shloka_id,
                        level_name="Shloka",
                        level_order=3,
                        sequence_number="2",
                        title_english="Invalid child of leaf",
                        has_content=True,
                        content_data={"basic": {"translation": "invalid"}},
                    ),
                    db=db,
                    current_user=test_user,
                )
            assert invalid_child_of_leaf_exc.value.status_code == status.HTTP_400_BAD_REQUEST
            assert "Cannot add children" in invalid_child_of_leaf_exc.value.detail

            persisted_nodes = db.query(ContentNode).filter(ContentNode.book_id == book.id).all()
            assert len(persisted_nodes) == 3
        finally:
            db.close()


class TestDraftBookAndEditionSnapshotIntegration:
    def test_delete_draft_returns_409_when_snapshot_exists(self, client):
        headers = _register_and_login(client)

        create_response = client.post(
            "/api/draft-books",
            json={
                "title": "Draft With Snapshot",
                "description": "Delete guard test",
                "section_structure": {"front": [], "body": [{"title": "Body"}], "back": []},
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        draft_id = create_response.json()["id"]

        snapshot_response = client.post(
            f"/api/draft-books/{draft_id}/snapshots",
            json={},
            headers=headers,
        )
        assert snapshot_response.status_code == status.HTTP_201_CREATED

        delete_response = client.delete(
            f"/api/draft-books/{draft_id}",
            headers=headers,
        )
        assert delete_response.status_code == status.HTTP_409_CONFLICT
        assert "cannot delete" in delete_response.json()["detail"].lower()

    def test_force_delete_draft_with_snapshot_succeeds(self, client):
        headers = _register_and_login(client)

        create_response = client.post(
            "/api/draft-books",
            json={
                "title": "Draft Force Delete",
                "description": "Force delete guard test",
                "section_structure": {"front": [], "body": [{"title": "Body"}], "back": []},
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        draft_id = create_response.json()["id"]

        snapshot_response = client.post(
            f"/api/draft-books/{draft_id}/snapshots",
            json={},
            headers=headers,
        )
        assert snapshot_response.status_code == status.HTTP_201_CREATED

        force_delete_response = client.delete(
            f"/api/draft-books/{draft_id}?force=true",
            headers=headers,
        )
        assert force_delete_response.status_code == status.HTTP_200_OK
        force_payload = force_delete_response.json()
        assert force_payload.get("forced") is True
        assert force_payload.get("deleted_snapshot_count", 0) >= 1

        get_response = client.get(
            f"/api/draft-books/{draft_id}",
            headers=headers,
        )
        assert get_response.status_code == status.HTTP_404_NOT_FOUND

    def test_delete_draft_returns_409_when_published(self, client):
        headers = _register_and_login(client)

        create_response = client.post(
            "/api/draft-books",
            json={
                "title": "Published Draft",
                "description": "Delete guard test",
                "section_structure": {"front": [], "body": [{"title": "Body"}], "back": []},
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        draft_id = create_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={},
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED

        delete_response = client.delete(
            f"/api/draft-books/{draft_id}",
            headers=headers,
        )
        assert delete_response.status_code == status.HTTP_409_CONFLICT
        assert "cannot delete" in delete_response.json()["detail"].lower()

    def test_admin_can_create_clean_draft_for_target_owner(self, client):
        admin_headers = _register_and_login_as_admin(client)
        owner_headers = _register_and_login(client)

        me_response = client.get("/api/users/me", headers=owner_headers)
        assert me_response.status_code == status.HTTP_200_OK
        owner_id = me_response.json()["id"]

        create_response = client.post(
            "/api/draft-books/admin/create-clean",
            json={"owner_id": owner_id, "title": "Clean Admin Draft"},
            headers=admin_headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        payload = create_response.json()
        assert payload["owner_id"] == owner_id
        assert payload["title"] == "Clean Admin Draft"
        assert payload["status"] == "draft"
        assert payload["section_structure"] == {"front": [], "body": [], "back": []}

    def test_non_admin_cannot_create_clean_draft(self, client):
        headers = _register_and_login(client)

        create_response = client.post(
            "/api/draft-books/admin/create-clean",
            json={"title": "Should Not Work"},
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_403_FORBIDDEN

    def test_draft_is_editable_and_snapshot_is_immutable(self, client):
        headers = _register_and_login(client)

        create_response = client.post(
            "/api/draft-books",
            json={
                "title": "My Draft Book",
                "description": "Draft for A-02 integration",
                "section_structure": {
                    "front": [{"title": "Preface"}],
                    "body": [{"title": "Chapter 1"}],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        draft = create_response.json()
        draft_id = draft["id"]
        assert draft["status"] == "draft"

        patch_response = client.patch(
            f"/api/draft-books/{draft_id}",
            json={
                "title": "Updated Draft Title",
                "section_structure": {
                    "front": [{"title": "Foreword"}],
                    "body": [{"title": "Chapter 1"}, {"title": "Chapter 2"}],
                    "back": [{"title": "Appendix"}],
                },
            },
            headers=headers,
        )
        assert patch_response.status_code == status.HTTP_200_OK
        updated_draft = patch_response.json()
        assert updated_draft["title"] == "Updated Draft Title"
        assert len(updated_draft["section_structure"]["body"]) == 2

        snapshot_response = client.post(
            f"/api/draft-books/{draft_id}/snapshots",
            json={},
            headers=headers,
        )
        assert snapshot_response.status_code == status.HTTP_201_CREATED
        snapshot = snapshot_response.json()
        snapshot_id = snapshot["id"]
        assert snapshot["immutable"] is True

        forbidden_snapshot_patch = client.patch(
            f"/api/edition-snapshots/{snapshot_id}",
            json={"snapshot_data": {"body": []}},
            headers=headers,
        )
        assert forbidden_snapshot_patch.status_code == status.HTTP_409_CONFLICT
        assert "immutable" in forbidden_snapshot_patch.json()["detail"].lower()

        draft_after_snapshot_patch = client.patch(
            f"/api/draft-books/{draft_id}",
            json={"description": "Still editable after snapshot"},
            headers=headers,
        )
        assert draft_after_snapshot_patch.status_code == status.HTTP_200_OK
        assert draft_after_snapshot_patch.json()["description"] == "Still editable after snapshot"

    def test_draft_history_returns_ordered_revision_events(self, client):
        headers = _register_and_login(client)

        create_response = client.post(
            "/api/draft-books",
            json={
                "title": "History Draft",
                "description": "Revision feed contract",
                "section_structure": {
                    "front": [{"title": "Preface", "order": 1}],
                    "body": [{"title": "Body", "order": 1}],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        draft_id = create_response.json()["id"]

        snapshot_response = client.post(
            f"/api/draft-books/{draft_id}/snapshots",
            json={},
            headers=headers,
        )
        assert snapshot_response.status_code == status.HTTP_201_CREATED
        snapshot_id = snapshot_response.json()["id"]

        history_response = client.get(
            f"/api/draft-books/{draft_id}/history",
            headers=headers,
        )
        assert history_response.status_code == status.HTTP_200_OK
        payload = history_response.json()

        assert payload["draft_book_id"] == draft_id
        events = payload["events"]
        assert len(events) == 2
        assert [event["sequence"] for event in events] == [1, 2]
        assert [event["event_type"] for event in events] == ["draft.created", "snapshot.created"]
        assert events[0]["entity_type"] == "draft_book"
        assert events[1]["entity_type"] == "edition_snapshot"
        assert events[1]["snapshot_id"] == snapshot_id
        assert events[1]["immutable"] is True
        assert events[0]["occurred_at"] <= events[1]["occurred_at"]
        assert "combined_hash" in events[1]["metadata"]

    def test_draft_license_policy_warns_and_blocks_snapshot(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Draft License Schema {uuid4().hex[:8]}",
                "description": "Schema for draft license policy tests",
                "levels": ["Chapter"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        source_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Policy Source {uuid4().hex[:6]}",
                "book_code": f"policy-src-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert source_book_response.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_response.json()["id"]

        warn_node_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Warn License Node",
                "has_content": False,
                "license_type": "CC-BY-NC-4.0",
            },
            headers=headers,
        )
        assert warn_node_response.status_code == status.HTTP_201_CREATED
        warn_node_id = warn_node_response.json()["id"]

        blocked_node_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "2",
                "title_english": "Blocked License Node",
                "has_content": False,
                "license_type": "ALL-RIGHTS-RESERVED",
            },
            headers=headers,
        )
        assert blocked_node_response.status_code == status.HTTP_201_CREATED
        blocked_node_id = blocked_node_response.json()["id"]

        warn_draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Warn Draft",
                "description": "Contains non-commercial source",
                "section_structure": {
                    "front": [],
                    "body": [
                        {
                            "node_id": warn_node_id,
                            "source_type": "library_reference",
                            "source_book_id": source_book_id,
                            "title": "Warn Node",
                        }
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert warn_draft_response.status_code == status.HTTP_201_CREATED
        warn_draft_id = warn_draft_response.json()["id"]

        warn_policy_response = client.get(
            f"/api/draft-books/{warn_draft_id}/license-policy",
            headers=headers,
        )
        assert warn_policy_response.status_code == status.HTTP_200_OK
        warn_policy = warn_policy_response.json()
        assert warn_policy["status"] == "warn"
        assert len(warn_policy["warning_issues"]) == 1
        assert warn_policy["warning_issues"][0]["source_node_id"] == warn_node_id
        assert warn_policy["warning_issues"][0]["license_type"] == "CC-BY-NC-4.0"
        assert warn_policy["blocked_issues"] == []

        warn_snapshot_response = client.post(
            f"/api/draft-books/{warn_draft_id}/snapshots",
            json={},
            headers=headers,
        )
        assert warn_snapshot_response.status_code == status.HTTP_201_CREATED
        warn_snapshot_payload = warn_snapshot_response.json()
        assert "provenance_appendix" in warn_snapshot_payload["snapshot_data"]
        assert len(warn_snapshot_payload["snapshot_data"]["provenance_appendix"]["entries"]) == 1

        blocked_draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Blocked Draft",
                "description": "Contains disallowed source",
                "section_structure": {
                    "front": [],
                    "body": [
                        {
                            "node_id": blocked_node_id,
                            "source_type": "library_reference",
                            "source_book_id": source_book_id,
                            "title": "Blocked Node",
                        }
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert blocked_draft_response.status_code == status.HTTP_201_CREATED
        blocked_draft_id = blocked_draft_response.json()["id"]

        blocked_policy_response = client.get(
            f"/api/draft-books/{blocked_draft_id}/license-policy",
            headers=headers,
        )
        assert blocked_policy_response.status_code == status.HTTP_200_OK
        blocked_policy = blocked_policy_response.json()
        assert blocked_policy["status"] == "block"
        assert len(blocked_policy["blocked_issues"]) == 1
        assert blocked_policy["blocked_issues"][0]["source_node_id"] == blocked_node_id
        assert blocked_policy["blocked_issues"][0]["license_type"] == "ALL-RIGHTS-RESERVED"

        blocked_snapshot_response = client.post(
            f"/api/draft-books/{blocked_draft_id}/snapshots",
            json={},
            headers=headers,
        )
        assert blocked_snapshot_response.status_code == status.HTTP_409_CONFLICT
        assert "license policy" in blocked_snapshot_response.json()["detail"].lower()

    def test_publish_endpoint_returns_snapshot_and_policy_and_blocks_disallowed(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Publish License Schema {uuid4().hex[:8]}",
                "description": "Schema for publish endpoint policy tests",
                "levels": ["Chapter"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        source_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Publish Source {uuid4().hex[:6]}",
                "book_code": f"publish-src-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert source_book_response.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_response.json()["id"]

        warn_node_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Warn Publish Node",
                "has_content": False,
                "license_type": "CC-BY-NC-4.0",
            },
            headers=headers,
        )
        assert warn_node_response.status_code == status.HTTP_201_CREATED
        warn_node_id = warn_node_response.json()["id"]

        blocked_node_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "2",
                "title_english": "Blocked Publish Node",
                "has_content": False,
                "license_type": "ALL-RIGHTS-RESERVED",
            },
            headers=headers,
        )
        assert blocked_node_response.status_code == status.HTTP_201_CREATED
        blocked_node_id = blocked_node_response.json()["id"]

        warn_draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Warn Publish Draft",
                "description": "Contains warn-only license",
                "section_structure": {
                    "front": [],
                    "body": [
                        {
                            "node_id": warn_node_id,
                            "source_type": "library_reference",
                            "source_book_id": source_book_id,
                            "title": "Warn Publish Item",
                        }
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert warn_draft_response.status_code == status.HTTP_201_CREATED
        warn_draft_id = warn_draft_response.json()["id"]

        warn_publish_response = client.post(
            f"/api/draft-books/{warn_draft_id}/publish",
            json={},
            headers=headers,
        )
        assert warn_publish_response.status_code == status.HTTP_201_CREATED
        warn_publish_payload = warn_publish_response.json()
        assert "snapshot" in warn_publish_payload
        assert "license_policy" in warn_publish_payload
        assert "provenance_appendix" in warn_publish_payload
        assert warn_publish_payload["snapshot"]["draft_book_id"] == warn_draft_id
        assert warn_publish_payload["snapshot"]["immutable"] is True
        assert warn_publish_payload["license_policy"]["status"] == "warn"
        assert len(warn_publish_payload["license_policy"]["warning_issues"]) == 1
        assert warn_publish_payload["license_policy"]["blocked_issues"] == []
        assert len(warn_publish_payload["provenance_appendix"]["entries"]) == 1
        assert warn_publish_payload["provenance_appendix"]["entries"][0]["source_node_id"] == warn_node_id
        assert "provenance_appendix" in warn_publish_payload["snapshot"]["snapshot_data"]

        blocked_draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Blocked Publish Draft",
                "description": "Contains disallowed license",
                "section_structure": {
                    "front": [],
                    "body": [
                        {
                            "node_id": blocked_node_id,
                            "source_type": "library_reference",
                            "source_book_id": source_book_id,
                            "title": "Blocked Publish Item",
                        }
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert blocked_draft_response.status_code == status.HTTP_201_CREATED
        blocked_draft_id = blocked_draft_response.json()["id"]

        blocked_publish_response = client.post(
            f"/api/draft-books/{blocked_draft_id}/publish",
            json={},
            headers=headers,
        )
        assert blocked_publish_response.status_code == status.HTTP_409_CONFLICT
        assert "publish blocked by license policy" in blocked_publish_response.json()["detail"].lower()

    def test_draft_rbac_matrix_for_critical_actions(self, client):
        headers_owner = _register_and_login(client)
        headers_non_owner = _register_and_login(client)

        create_response = client.post(
            "/api/draft-books",
            json={
                "title": "RBAC Draft",
                "description": "Ownership matrix check",
                "section_structure": {"front": [], "body": [], "back": []},
            },
            headers=headers_owner,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        draft_id = create_response.json()["id"]

        owner_get_response = client.get(
            f"/api/draft-books/{draft_id}",
            headers=headers_owner,
        )
        assert owner_get_response.status_code == status.HTTP_200_OK

        owner_patch_response = client.patch(
            f"/api/draft-books/{draft_id}",
            json={"description": "Owner updated draft"},
            headers=headers_owner,
        )
        assert owner_patch_response.status_code == status.HTTP_200_OK

        owner_policy_response = client.get(
            f"/api/draft-books/{draft_id}/license-policy",
            headers=headers_owner,
        )
        assert owner_policy_response.status_code == status.HTTP_200_OK

        owner_publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={},
            headers=headers_owner,
        )
        assert owner_publish_response.status_code == status.HTTP_201_CREATED

        owner_snapshots_response = client.get(
            f"/api/draft-books/{draft_id}/snapshots",
            headers=headers_owner,
        )
        assert owner_snapshots_response.status_code == status.HTTP_200_OK
        assert len(owner_snapshots_response.json()) >= 1

        non_owner_get_response = client.get(
            f"/api/draft-books/{draft_id}",
            headers=headers_non_owner,
        )
        assert non_owner_get_response.status_code == status.HTTP_404_NOT_FOUND

        non_owner_patch_response = client.patch(
            f"/api/draft-books/{draft_id}",
            json={"description": "Unauthorized update"},
            headers=headers_non_owner,
        )
        assert non_owner_patch_response.status_code == status.HTTP_404_NOT_FOUND

        non_owner_policy_response = client.get(
            f"/api/draft-books/{draft_id}/license-policy",
            headers=headers_non_owner,
        )
        assert non_owner_policy_response.status_code == status.HTTP_404_NOT_FOUND

        non_owner_snapshots_response = client.get(
            f"/api/draft-books/{draft_id}/snapshots",
            headers=headers_non_owner,
        )
        assert non_owner_snapshots_response.status_code == status.HTTP_404_NOT_FOUND

        non_owner_publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={},
            headers=headers_non_owner,
        )
        assert non_owner_publish_response.status_code == status.HTTP_404_NOT_FOUND

        anonymous_get_response = client.get(f"/api/draft-books/{draft_id}")
        assert anonymous_get_response.status_code == status.HTTP_404_NOT_FOUND

        anonymous_publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={},
        )
        assert anonymous_publish_response.status_code == status.HTTP_404_NOT_FOUND

    def test_snapshot_pdf_export_contains_pdf_content_and_honors_ownership(self, client):
        headers_owner = _register_and_login(client)
        headers_non_owner = _register_and_login(client)

        create_response = client.post(
            "/api/draft-books",
            json={
                "title": "PDF Export Draft",
                "description": "Snapshot PDF export coverage",
                "section_structure": {"front": [], "body": [], "back": []},
            },
            headers=headers_owner,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        draft_id = create_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={},
            headers=headers_owner,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED
        snapshot_id = publish_response.json()["snapshot"]["id"]

        export_response = client.get(
            f"/api/edition-snapshots/{snapshot_id}/export/pdf",
            headers=headers_owner,
        )
        assert export_response.status_code == status.HTTP_200_OK
        assert export_response.headers.get("content-type", "").startswith("application/pdf")
        assert export_response.content.startswith(b"%PDF")

        forbidden_export_response = client.get(
            f"/api/edition-snapshots/{snapshot_id}/export/pdf",
            headers=headers_non_owner,
        )
        assert forbidden_export_response.status_code == status.HTTP_404_NOT_FOUND

    def test_snapshot_pdf_export_is_deterministic_for_same_snapshot(self, client):
        headers = _register_and_login(client)

        create_response = client.post(
            "/api/draft-books",
            json={
                "title": "Deterministic PDF Draft",
                "description": "Determinism check",
                "section_structure": {"front": [], "body": [], "back": []},
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        draft_id = create_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={},
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED
        snapshot_id = publish_response.json()["snapshot"]["id"]

        export_response_1 = client.get(
            f"/api/edition-snapshots/{snapshot_id}/export/pdf",
            headers=headers,
        )
        assert export_response_1.status_code == status.HTTP_200_OK
        export_response_2 = client.get(
            f"/api/edition-snapshots/{snapshot_id}/export/pdf",
            headers=headers,
        )
        assert export_response_2.status_code == status.HTTP_200_OK

        hash_1 = hashlib.sha256(export_response_1.content).hexdigest()
        hash_2 = hashlib.sha256(export_response_2.content).hexdigest()
        assert hash_1 == hash_2

    def test_book_pdf_export_honors_visibility_and_returns_pdf_headers(self, client):
        headers_owner = _register_and_login(client)
        headers_non_owner = _register_and_login(client)
        book_fixture = _create_minimal_book_with_exportable_content(
            client,
            headers_owner,
            name_prefix="Visibility PDF",
        )
        book_id = book_fixture["book_id"]

        private_non_owner_response = client.get(
            f"/api/books/{book_id}/export/pdf",
            headers=headers_non_owner,
        )
        assert private_non_owner_response.status_code == status.HTTP_404_NOT_FOUND

        owner_export_response = client.get(
            f"/api/books/{book_id}/export/pdf",
            headers=headers_owner,
        )
        assert owner_export_response.status_code == status.HTTP_200_OK
        assert owner_export_response.headers.get("content-type", "").startswith("application/pdf")
        assert "inline; filename=" in owner_export_response.headers.get("content-disposition", "")
        assert owner_export_response.headers.get("x-backend-pdf-fonts") is not None
        assert owner_export_response.content.startswith(b"%PDF")

        publish_response = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "published", "visibility": "public"},
            headers=headers_owner,
        )
        assert publish_response.status_code == status.HTTP_200_OK

        public_non_owner_response = client.get(
            f"/api/books/{book_id}/export/pdf",
            headers=headers_non_owner,
        )
        assert public_non_owner_response.status_code == status.HTTP_200_OK
        assert public_non_owner_response.content.startswith(b"%PDF")

    def test_book_pdf_export_with_payload_is_deterministic_for_same_scope(self, client):
        headers = _register_and_login(client)
        book_fixture = _create_minimal_book_with_exportable_content(
            client,
            headers,
            name_prefix="Deterministic PDF",
        )
        book_id = book_fixture["book_id"]
        verse_id = book_fixture["verse_id"]

        payload = {
            "node_id": verse_id,
            "preview_show_titles": False,
            "preview_show_labels": False,
            "preview_transliteration_script": "devanagari",
            "preview_word_meanings_display_mode": "hide",
            "selected_translation_languages": ["english"],
        }

        export_response_1 = client.post(
            f"/api/books/{book_id}/export/pdf",
            json=payload,
            headers=headers,
        )
        assert export_response_1.status_code == status.HTTP_200_OK
        assert export_response_1.content.startswith(b"%PDF")

        export_response_2 = client.post(
            f"/api/books/{book_id}/export/pdf",
            json=payload,
            headers=headers,
        )
        assert export_response_2.status_code == status.HTTP_200_OK

        hash_1 = hashlib.sha256(export_response_1.content).hexdigest()
        hash_2 = hashlib.sha256(export_response_2.content).hexdigest()
        assert hash_1 == hash_2

    def test_snapshot_render_artifact_is_section_ordered_and_deterministic(self, client):
        headers = _register_and_login(client)
        headers_non_owner = _register_and_login(client)

        create_response = client.post(
            "/api/draft-books",
            json={
                "title": "Render Artifact Draft",
                "description": "N-01 render artifact coverage",
                "section_structure": {
                    "front": [
                        {"title": "Foreword", "order": 2},
                        {"title": "Title Page", "order": 1},
                    ],
                    "body": [
                        {"title": "Chapter 3", "order": 3},
                        {"title": "Chapter 1", "order": 1},
                        {"title": "Chapter 2", "order": 2},
                    ],
                    "back": [
                        {"title": "Appendix", "sequence_number": "2"},
                        {"title": "Glossary", "sequence_number": "1"},
                    ],
                },
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        draft_id = create_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={},
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED
        snapshot_id = publish_response.json()["snapshot"]["id"]

        render_response_1 = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        assert render_response_1.status_code == status.HTTP_200_OK

        render_response_2 = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        assert render_response_2.status_code == status.HTTP_200_OK

        forbidden_render_response = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers_non_owner,
        )
        assert forbidden_render_response.status_code == status.HTTP_404_NOT_FOUND

        payload_1 = render_response_1.json()
        payload_2 = render_response_2.json()

        assert payload_1["section_order"] == ["front", "body", "back"]
        assert [block["title"] for block in payload_1["sections"]["front"]] == ["Title Page", "Foreword"]
        assert [block["title"] for block in payload_1["sections"]["body"]] == ["Chapter 1", "Chapter 2", "Chapter 3"]
        assert [block["title"] for block in payload_1["sections"]["back"]] == ["Glossary", "Appendix"]

        for index, block in enumerate(payload_1["sections"]["body"], start=1):
            assert block["order"] == index
            assert block["template_key"] == "default.body.content_item.v1"

        canonical_1 = json.dumps(payload_1, sort_keys=True, separators=(",", ":")).encode("utf-8")
        canonical_2 = json.dumps(payload_2, sort_keys=True, separators=(",", ":")).encode("utf-8")
        assert hashlib.sha256(canonical_1).hexdigest() == hashlib.sha256(canonical_2).hexdigest()

    def test_snapshot_render_artifact_resolves_template_precedence(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Template Precedence Schema {uuid4().hex[:8]}",
                "description": "Schema for template precedence",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        source_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Template Source {uuid4().hex[:6]}",
                "book_code": f"tpl-src-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert source_book_response.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Template Chapter",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_node_id = chapter_response.json()["id"]

        verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": chapter_node_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Template Verse",
                "has_content": True,
                "content_data": {"basic": {"translation": "Template verse content"}},
            },
            headers=headers,
        )
        assert verse_response.status_code == status.HTTP_201_CREATED
        verse_node_id = verse_response.json()["id"]

        draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Template Precedence Draft",
                "description": "Validate node > level > book > global",
                "section_structure": {
                    "front": [],
                    "body": [
                        {
                            "title": "Node-level override block",
                            "node_id": chapter_node_id,
                            "source_book_id": source_book_id,
                            "order": 1,
                        },
                        {
                            "title": "Level-level override block",
                            "node_id": verse_node_id,
                            "source_book_id": source_book_id,
                            "order": 2,
                        },
                        {
                            "title": "Book-level override block",
                            "source_book_id": source_book_id,
                            "order": 3,
                        },
                        {
                            "title": "Global fallback block",
                            "order": 4,
                        },
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={
                "snapshot_data": {
                    "front": [],
                    "body": [
                        {
                            "title": "Node-level override block",
                            "node_id": chapter_node_id,
                            "source_book_id": source_book_id,
                            "order": 1,
                        },
                        {
                            "title": "Level-level override block",
                            "node_id": verse_node_id,
                            "source_book_id": source_book_id,
                            "order": 2,
                        },
                        {
                            "title": "Book-level override block",
                            "source_book_id": source_book_id,
                            "order": 3,
                        },
                        {
                            "title": "Global fallback block",
                            "order": 4,
                        },
                    ],
                    "back": [],
                    "template_bindings": {
                        "global_template_key": "template.global.content_item.v1",
                        "book_template_key": "template.book.content_item.v1",
                        "level_template_keys": {
                            "verse": "template.level.verse.content_item.v1"
                        },
                        "node_template_keys": {
                            str(chapter_node_id): "template.node.chapter.content_item.v1"
                        },
                    },
                }
            },
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED
        snapshot_id = publish_response.json()["snapshot"]["id"]

        render_response = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        assert render_response.status_code == status.HTTP_200_OK
        payload = render_response.json()

        body_blocks = payload["sections"]["body"]
        assert [block["title"] for block in body_blocks] == [
            "Node-level override block",
            "Level-level override block",
            "Book-level override block",
            "Global fallback block",
        ]
        assert [block["template_key"] for block in body_blocks] == [
            "template.node.chapter.content_item.v1",
            "template.level.verse.content_item.v1",
            "template.book.content_item.v1",
            "template.global.content_item.v1",
        ]

    def test_snapshot_render_artifact_uses_default_templates_for_level_fields(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Default Template Levels {uuid4().hex[:8]}",
                "description": "Default template field rendering by level",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        source_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Default Template Source {uuid4().hex[:6]}",
                "book_code": f"default-tpl-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert source_book_response.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter One",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_node_id = chapter_response.json()["id"]

        verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": chapter_node_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse One",
                "has_content": True,
                "content_data": {
                    "basic": {
                        "sanskrit": "ॐ",
                        "transliteration": "om",
                        "translation": "Sacred syllable",
                        "text": "Fallback verse text",
                    }
                },
            },
            headers=headers,
        )
        assert verse_response.status_code == status.HTTP_201_CREATED
        verse_node_id = verse_response.json()["id"]

        draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Default Template Draft",
                "description": "Use built-in default templates for level fields",
                "section_structure": {
                    "front": [],
                    "body": [
                        {
                            "title": "Chapter block",
                            "node_id": chapter_node_id,
                            "source_book_id": source_book_id,
                            "order": 1,
                        },
                        {
                            "title": "Verse block",
                            "node_id": verse_node_id,
                            "source_book_id": source_book_id,
                            "order": 2,
                        },
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={},
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED
        snapshot_id = publish_response.json()["snapshot"]["id"]

        render_response = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        assert render_response.status_code == status.HTTP_200_OK
        body_blocks = render_response.json()["sections"]["body"]

        chapter_lines = body_blocks[0]["content"].get("rendered_lines", [])
        verse_lines = body_blocks[1]["content"].get("rendered_lines", [])

        assert body_blocks[0]["template_key"] == "default.body.chapter.content_item.v1"
        assert body_blocks[1]["template_key"] == "default.body.verse.content_item.v1"
        assert "{{ metadata.english }}" in body_blocks[0]["resolved_template_source"]
        assert "{{ metadata.sanskrit }}" in body_blocks[1]["resolved_template_source"]
        assert [line["field"] for line in chapter_lines] == ["english"]
        assert [line["field"] for line in verse_lines] == [
            "sanskrit",
            "transliteration",
            "english",
            "text",
        ]

    def test_render_liquid_lines_supports_inline_unlabeled_text(self, client):
        rendered_lines = draft_books_api._render_liquid_lines(
            "{{ english }} of Krishna",
            {"english": "Govinda"},
        )

        assert rendered_lines == [
            {
                "field": "text",
                "label": "",
                "value": "Govinda of Krishna",
            }
        ]

    def test_word_meaning_source_resolution_runtime_generation_order(self, client, monkeypatch):
        source_payload = {
            "language": "sa",
            "transliteration": {
                "hk": "dharmakSetre",
            },
        }

        monkeypatch.setattr(
            draft_books_api,
            "latin_to_devanagari",
            lambda value: "धर्मक्षेत्रे" if value == "dharmakSetre" else None,
        )

        resolved_with_runtime = draft_books_api._resolve_word_meaning_source_token(
            source_payload=source_payload,
            preferred_mode="script",
            preferred_scheme="iast",
            allow_runtime_generation=True,
        )
        assert resolved_with_runtime == {
            "text": "धर्मक्षेत्रे",
            "mode": "script",
            "scheme": None,
            "generated": True,
        }

        resolved_without_runtime = draft_books_api._resolve_word_meaning_source_token(
            source_payload=source_payload,
            preferred_mode="script",
            preferred_scheme="iast",
            allow_runtime_generation=False,
        )
        assert resolved_without_runtime == {
            "text": "dharmakSetre",
            "mode": "transliteration",
            "scheme": "hk",
            "generated": False,
        }

    def test_word_meanings_rows_resolution_is_deterministic(self, client):
        content_data = {
            "word_meanings": {
                "version": "1.0",
                "rows": [
                    {
                        "id": "wm_b",
                        "order": 2,
                        "source": {
                            "language": "sa",
                            "script_text": "कर्म",
                            "transliteration": {
                                "iast": "karma",
                                "hk": "karma_hk",
                            },
                        },
                        "meanings": {
                            "en": {"text": "action"},
                        },
                    },
                    {
                        "id": "wm_a",
                        "order": 1,
                        "source": {
                            "language": "sa",
                            "script_text": "योग",
                        },
                        "meanings": {
                            "en": {"text": "union"},
                        },
                    },
                ],
            }
        }
        resolved_metadata = {
            "word_meanings": {
                "source": {
                    "source_display_mode": "transliteration",
                    "preferred_transliteration_scheme": "hk",
                    "allow_runtime_transliteration_generation": False,
                }
            }
        }

        rows = draft_books_api._resolve_word_meanings_rows(content_data, resolved_metadata)

        assert [row["id"] for row in rows] == ["wm_a", "wm_b"]
        assert rows[0]["resolved_source"] == {
            "text": "योग",
            "mode": "script",
            "scheme": None,
            "generated": False,
        }
        assert rows[1]["resolved_source"] == {
            "text": "karma_hk",
            "mode": "transliteration",
            "scheme": "hk",
            "generated": False,
        }

    def test_word_meaning_language_fallback_pref_then_en_then_first_available(self, client):
        meanings = {
            "hi": {"text": "कर्म"},
            "en": {"text": "action"},
            "ta": {"text": "செயல்"},
        }

        resolved_preferred = draft_books_api._resolve_word_meaning_meaning_text(
            meanings_payload=meanings,
            preferred_language="hi",
            fallback_order=["user_preference", "en", "first_available"],
            show_badge_when_fallback_used=True,
        )
        assert resolved_preferred == {
            "language": "hi",
            "text": "कर्म",
            "fallback_used": False,
            "fallback_badge_visible": False,
        }

        resolved_en_fallback = draft_books_api._resolve_word_meaning_meaning_text(
            meanings_payload=meanings,
            preferred_language="ml",
            fallback_order=["user_preference", "en", "first_available"],
            show_badge_when_fallback_used=True,
        )
        assert resolved_en_fallback == {
            "language": "en",
            "text": "action",
            "fallback_used": True,
            "fallback_badge_visible": True,
        }

        resolved_first_available = draft_books_api._resolve_word_meaning_meaning_text(
            meanings_payload={
                "ta": {"text": "செயல்"},
                "hi": {"text": "कर्म"},
            },
            preferred_language="ml",
            fallback_order=["user_preference", "en", "first_available"],
            show_badge_when_fallback_used=False,
        )
        assert resolved_first_available == {
            "language": "ta",
            "text": "செயல்",
            "fallback_used": True,
            "fallback_badge_visible": False,
        }

    def test_word_meanings_rows_include_resolved_meaning_with_badge_control(self, client):
        content_data = {
            "word_meanings": {
                "version": "1.0",
                "rows": [
                    {
                        "id": "wm_001",
                        "order": 1,
                        "source": {
                            "language": "sa",
                            "script_text": "धर्म",
                        },
                        "meanings": {
                            "en": {"text": "dharma"},
                            "hi": {"text": "धर्म"},
                        },
                    }
                ],
            }
        }

        metadata_with_badge = {
            "word_meanings": {
                "meanings": {
                    "meaning_language": "ml",
                    "fallback_order": ["user_preference", "en", "first_available"],
                },
                "rendering": {
                    "show_language_badge_when_fallback_used": True,
                },
            }
        }

        rows_with_badge = draft_books_api._resolve_word_meanings_rows(content_data, metadata_with_badge)
        assert rows_with_badge[0]["resolved_meaning"] == {
            "language": "en",
            "text": "dharma",
            "fallback_used": True,
            "fallback_badge_visible": True,
        }

        metadata_without_badge = {
            "word_meanings": {
                "meanings": {
                    "meaning_language": "ml",
                    "fallback_order": ["user_preference", "en", "first_available"],
                },
                "rendering": {
                    "show_language_badge_when_fallback_used": False,
                },
            }
        }

        rows_without_badge = draft_books_api._resolve_word_meanings_rows(content_data, metadata_without_badge)
        assert rows_without_badge[0]["resolved_meaning"] == {
            "language": "en",
            "text": "dharma",
            "fallback_used": True,
            "fallback_badge_visible": False,
        }

    def test_pdf_content_lines_include_word_meanings_with_fallback_and_deterministic_order(self, client):
        content = {
            "metadata": {
                "word_meanings": {
                    "source": {
                        "source_display_mode": "transliteration",
                        "preferred_transliteration_scheme": "hk",
                        "allow_runtime_transliteration_generation": False,
                    },
                    "meanings": {
                        "meaning_language": "ml",
                        "fallback_order": ["user_preference", "en", "first_available"],
                    },
                }
            },
            "word_meanings": {
                "version": "1.0",
                "rows": [
                    {
                        "id": "wm_b",
                        "order": 2,
                        "source": {
                            "language": "sa",
                            "script_text": "कर्म",
                            "transliteration": {"hk": "karma_hk"},
                        },
                        "meanings": {
                            "en": {"text": "action"},
                        },
                    },
                    {
                        "id": "wm_a",
                        "order": 1,
                        "source": {
                            "language": "sa",
                            "script_text": "योग",
                        },
                        "meanings": {
                            "en": {"text": "union"},
                        },
                    },
                ],
            },
        }

        lines = draft_books_api._resolve_pdf_content_lines(
            content,
            draft_books_api.SnapshotRenderSettings(),
        )

        assert lines == [
            ("Word Meanings", "योग — union"),
            ("", "karma_hk — action"),
        ]

    def test_pdf_text_normalization_uses_nfc_and_normalizes_newlines(self, client):
        normalized = draft_books_api._normalize_pdf_text("na\u0304rada\r\nline2\rline3")

        assert normalized == "nārada\nline2\nline3"

    def test_pdf_text_wrap_uses_rendered_width_not_character_count(self, client):
        font_name = "Helvetica"
        font_size = 10
        max_width = draft_books_api.pdfmetrics.stringWidth("alpha beta gamma", font_name, font_size) - 1

        wrapped = draft_books_api._wrap_pdf_text_to_width(
            "alpha beta gamma delta",
            font_name,
            font_size,
            max_width,
        )

        assert wrapped == ["alpha beta", "gamma delta"]

    def test_pdf_text_wrap_splits_long_tokens_without_losing_text(self, client):
        font_name = "Helvetica"
        font_size = 10
        token = "dharmaksetradharmaksetra"
        max_width = draft_books_api.pdfmetrics.stringWidth("dharmak", font_name, font_size)

        wrapped = draft_books_api._wrap_pdf_text_to_width(token, font_name, font_size, max_width)

        assert len(wrapped) > 1
        assert "".join(wrapped) == token

    def test_book_preview_render_includes_word_meanings_with_fallback_badge_metadata(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"WM09 Schema {uuid4().hex[:8]}",
                "description": "Schema for WM-09 preview contract",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"WM09 Book {uuid4().hex[:6]}",
                "book_code": f"wm09-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_id = chapter_response.json()["id"]

        verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse 1",
                "has_content": True,
                "content_data": {
                    "word_meanings": {
                        "version": "1.0",
                        "rows": [
                            {
                                "id": "wm_001",
                                "order": 1,
                                "source": {
                                    "language": "sa",
                                    "script_text": "धर्म",
                                },
                                "meanings": {
                                    "en": {"text": "dharma"},
                                    "hi": {"text": "धर्म"},
                                },
                            }
                        ],
                    }
                },
            },
            headers=headers,
        )
        assert verse_response.status_code == status.HTTP_201_CREATED
        verse_id = verse_response.json()["id"]

        preview_response = client.post(
            f"/api/books/{book_id}/preview/render",
            json={
                "node_id": verse_id,
                "metadata_bindings": {
                    "global": {
                        "word_meanings": {
                            "meanings": {
                                "meaning_language": "ml",
                                "fallback_order": ["user_preference", "en", "first_available"],
                            },
                            "rendering": {
                                "show_language_badge_when_fallback_used": True,
                            },
                        }
                    }
                },
            },
            headers=headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK
        payload = preview_response.json()
        body_blocks = payload["sections"]["body"]
        assert len(body_blocks) == 1

        word_meaning_rows = body_blocks[0]["content"]["word_meanings_rows"]
        assert len(word_meaning_rows) == 1
        assert word_meaning_rows[0]["resolved_meaning"] == {
            "language": "en",
            "text": "dharma",
            "fallback_used": True,
            "fallback_badge_visible": True,
        }

    def test_snapshot_render_artifact_resolves_metadata_precedence(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Metadata Precedence Schema {uuid4().hex[:8]}",
                "description": "Schema for metadata precedence",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        source_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Metadata Source {uuid4().hex[:6]}",
                "book_code": f"meta-src-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert source_book_response.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Metadata Chapter",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_node_id = chapter_response.json()["id"]

        verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": chapter_node_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Metadata Verse",
                "has_content": True,
                "content_data": {"basic": {"translation": "Metadata verse content"}},
            },
            headers=headers,
        )
        assert verse_response.status_code == status.HTTP_201_CREATED
        verse_node_id = verse_response.json()["id"]

        draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Metadata Precedence Draft",
                "description": "Validate field > node > level > book > global",
                "section_structure": {
                    "front": [],
                    "body": [
                        {
                            "title": "Field override block",
                            "node_id": chapter_node_id,
                            "source_book_id": source_book_id,
                            "order": 1,
                            "metadata_overrides": {"audience": "field", "tier": "field"},
                        },
                        {
                            "title": "Node override block",
                            "node_id": verse_node_id,
                            "source_book_id": source_book_id,
                            "order": 2,
                        },
                        {
                            "title": "Level override block",
                            "source_book_id": source_book_id,
                            "level_name": "Verse",
                            "order": 3,
                        },
                        {
                            "title": "Book override block",
                            "source_book_id": source_book_id,
                            "order": 4,
                        },
                        {
                            "title": "Global fallback block",
                            "order": 5,
                        },
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={
                "snapshot_data": {
                    "front": [],
                    "body": [
                        {
                            "title": "Field override block",
                            "node_id": chapter_node_id,
                            "source_book_id": source_book_id,
                            "order": 1,
                            "metadata_overrides": {"audience": "field", "tier": "field"},
                        },
                        {
                            "title": "Node override block",
                            "node_id": verse_node_id,
                            "source_book_id": source_book_id,
                            "order": 2,
                        },
                        {
                            "title": "Level override block",
                            "source_book_id": source_book_id,
                            "level_name": "Verse",
                            "order": 3,
                        },
                        {
                            "title": "Book override block",
                            "source_book_id": source_book_id,
                            "order": 4,
                        },
                        {
                            "title": "Global fallback block",
                            "order": 5,
                        },
                    ],
                    "back": [],
                    "metadata_bindings": {
                        "global_metadata": {"audience": "global", "tier": "global"},
                        "book_metadata": {"audience": "book", "book_only": True},
                        "level_metadata": {
                            "verse": {"audience": "level", "level_only": "verse"}
                        },
                        "node_metadata": {
                            str(chapter_node_id): {"audience": "node-chapter", "node_only": "chapter"},
                            str(verse_node_id): {"audience": "node-verse", "node_only": "verse"},
                        },
                    },
                }
            },
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED
        snapshot_id = publish_response.json()["snapshot"]["id"]

        render_response = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        assert render_response.status_code == status.HTTP_200_OK

        body_blocks = render_response.json()["sections"]["body"]
        resolved = [
            block.get("resolved_metadata", {})
            for block in body_blocks
        ]

        assert resolved[0] == {
            "audience": "field",
            "tier": "field",
            "book_only": True,
            "node_only": "chapter",
        }
        assert resolved[1] == {
            "audience": "node-verse",
            "tier": "global",
            "book_only": True,
            "level_only": "verse",
            "node_only": "verse",
        }
        assert resolved[2] == {
            "audience": "level",
            "tier": "global",
            "book_only": True,
            "level_only": "verse",
        }
        assert resolved[3] == {
            "audience": "book",
            "tier": "global",
            "book_only": True,
        }
        assert resolved[4] == {
            "audience": "global",
            "tier": "global",
        }

    def test_snapshot_render_artifact_handles_missing_bindings_with_deterministic_output(self, client):
        headers = _register_and_login(client)

        draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Missing Bindings Draft",
                "description": "Fallback and determinism coverage",
                "section_structure": {
                    "front": [{"title": "Intro", "order": 1}],
                    "body": [
                        {"title": "Verse Item", "level_name": "Verse", "order": 1},
                        {"title": "Generic Item", "order": 2},
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={
                "snapshot_data": {
                    "front": [{"title": "Intro", "order": 1}],
                    "body": [
                        {"title": "Verse Item", "level_name": "Verse", "order": 1},
                        {"title": "Generic Item", "order": 2},
                    ],
                    "back": [],
                    "template_bindings": {},
                    "metadata_bindings": {
                        "global_metadata": {"audience": "all"}
                    },
                }
            },
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED
        snapshot_payload = publish_response.json()["snapshot"]
        snapshot_id = snapshot_payload["id"]
        assert "snapshot_fingerprint" in snapshot_payload["snapshot_data"]

        render_response_1 = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        render_response_2 = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        assert render_response_1.status_code == status.HTTP_200_OK
        assert render_response_2.status_code == status.HTTP_200_OK

        payload_1 = render_response_1.json()
        payload_2 = render_response_2.json()

        body_blocks = payload_1["sections"]["body"]
        assert [block["template_key"] for block in body_blocks] == [
            "default.body.verse.content_item.v1",
            "default.body.content_item.v1",
        ]
        assert [block.get("resolved_metadata") for block in body_blocks] == [
            {"audience": "all"},
            {"audience": "all"},
        ]

        canonical_1 = json.dumps(payload_1, sort_keys=True, separators=(",", ":")).encode("utf-8")
        canonical_2 = json.dumps(payload_2, sort_keys=True, separators=(",", ":")).encode("utf-8")
        assert hashlib.sha256(canonical_1).hexdigest() == hashlib.sha256(canonical_2).hexdigest()

    def test_snapshot_render_artifact_uses_metadata_driven_template_fields_for_unknown_level(self, client):
        headers = _register_and_login(client)

        draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Metadata Driven Template Fields Draft",
                "description": "Unknown level should use metadata-driven default fields",
                "section_structure": {
                    "front": [],
                    "body": [
                        {
                            "title": "Commentary Block",
                            "level_name": "Commentary",
                            "order": 1,
                            "metadata": {
                                "template_fields": ["english"],
                                "template_field_labels": {"english": "Commentary"},
                            },
                        },
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={
                "snapshot_data": {
                    "front": [],
                    "body": [
                        {
                            "title": "Commentary Block",
                            "level_name": "Commentary",
                            "order": 1,
                            "metadata": {
                                "template_fields": ["english"],
                                "template_field_labels": {"english": "Commentary"},
                            },
                        },
                    ],
                    "back": [],
                }
            },
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED
        snapshot_id = publish_response.json()["snapshot"]["id"]

        render_response = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        assert render_response.status_code == status.HTTP_200_OK
        body_block = render_response.json()["sections"]["body"][0]

        assert body_block["template_key"] == "default.body.commentary.content_item.v1"
        assert body_block["resolved_template_source"].startswith("{% if metadata.english %}Commentary:")
        assert body_block["content"]["rendered_lines"] == []

    def test_book_preview_render_allows_public_library_preview_for_non_owner(self, client):
        owner_headers = _register_and_login(client)
        viewer_headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Public Preview Schema {uuid4().hex[:8]}",
                "description": "Schema for public book preview",
                "levels": ["Chapter", "Verse"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Understanding Dharma {uuid4().hex[:6]}",
                "book_code": f"preview-public-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter One",
                "has_content": False,
            },
            headers=owner_headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_node_id = chapter_response.json()["id"]

        verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_node_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse One",
                "has_content": True,
                "content_data": {"basic": {"translation": "Dharma verse"}},
            },
            headers=owner_headers,
        )
        assert verse_response.status_code == status.HTTP_201_CREATED

        publish_visibility_response = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "published", "visibility": "public"},
            headers=owner_headers,
        )
        assert publish_visibility_response.status_code == status.HTTP_200_OK

        preview_response = client.post(
            f"/api/books/{book_id}/preview/render",
            json={},
            headers=viewer_headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK
        payload = preview_response.json()

        assert payload["book_id"] == book_id
        assert payload["preview_mode"] == "book"
        assert payload["book_name"].startswith("Understanding Dharma")
        assert payload["section_order"] == ["body"]
        assert "front" not in payload["sections"]
        assert "back" not in payload["sections"]
        assert len(payload["sections"]["body"]) >= 1
        assert payload["sections"]["body"][0]["template_key"].startswith("default.body.")
        assert payload["book_template"]["template_key"] == "default.book.summary.v1"
        assert payload["book_template"]["child_count"] == len(payload["sections"]["body"])
        assert isinstance(payload["book_template"]["rendered_text"], str)

    def test_book_preview_render_allows_shared_private_book_for_viewer(self, client):
        owner_headers = _register_and_login(client)
        viewer_headers = _register_and_login(client)

        viewer_me_response = client.get("/api/users/me", headers=viewer_headers)
        assert viewer_me_response.status_code == status.HTTP_200_OK
        viewer_email = viewer_me_response.json()["email"]

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Shared Preview Schema {uuid4().hex[:8]}",
                "description": "Schema for shared private book preview",
                "levels": ["Chapter", "Verse"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Shared Private Book {uuid4().hex[:6]}",
                "book_code": f"preview-shared-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Shared Chapter",
                "has_content": False,
            },
            headers=owner_headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_node_id = chapter_response.json()["id"]

        verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_node_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Shared Verse",
                "has_content": True,
                "content_data": {"basic": {"translation": "Shared preview verse"}},
            },
            headers=owner_headers,
        )
        assert verse_response.status_code == status.HTTP_201_CREATED

        share_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": viewer_email, "permission": "viewer"},
            headers=owner_headers,
        )
        assert share_response.status_code == status.HTTP_201_CREATED

        preview_response = client.post(
            f"/api/books/{book_id}/preview/render",
            json={},
            headers=viewer_headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK
        payload = preview_response.json()
        assert payload["book_id"] == book_id
        assert payload["preview_mode"] == "book"
        assert len(payload["sections"]["body"]) >= 1
        assert payload["book_template"]["template_key"] == "default.book.summary.v1"
        assert payload["book_template"]["child_count"] == len(payload["sections"]["body"])

    def test_book_preview_render_allows_legacy_book_without_owner_metadata(self, client):
        owner_headers = _register_and_login(client)
        viewer_headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Legacy Preview Schema {uuid4().hex[:8]}",
                "description": "Schema for legacy metadata preview visibility",
                "levels": ["Chapter", "Verse"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Legacy Metadata Book {uuid4().hex[:6]}",
                "book_code": f"preview-legacy-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Legacy Chapter",
                "has_content": False,
            },
            headers=owner_headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED

        db = SessionLocal()
        try:
            book_record = db.query(Book).filter(Book.id == book_id).first()
            assert book_record is not None
            book_record.metadata_json = {}
            db.commit()
        finally:
            db.close()

        preview_response = client.post(
            f"/api/books/{book_id}/preview/render",
            json={},
            headers=viewer_headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK
        payload = preview_response.json()
        assert payload["book_id"] == book_id
        assert payload["preview_mode"] == "book"

    def test_book_preview_render_preserves_hierarchy_and_sibling_order(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Hierarchy Preview Schema {uuid4().hex[:8]}",
                "description": "Schema for hierarchical preview ordering",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Hierarchy Preview Book {uuid4().hex[:6]}",
                "book_code": f"preview-hierarchy-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_one_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_one_response.status_code == status.HTTP_201_CREATED
        chapter_one_id = chapter_one_response.json()["id"]

        chapter_two_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "2",
                "title_english": "Chapter 2",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_two_response.status_code == status.HTTP_201_CREATED
        chapter_two_id = chapter_two_response.json()["id"]

        verse_one_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_one_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Chapter 1 Verse 1",
                "has_content": True,
                "content_data": {"basic": {"translation": "C1V1"}},
            },
            headers=headers,
        )
        assert verse_one_response.status_code == status.HTTP_201_CREATED

        verse_two_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_one_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "2",
                "title_english": "Chapter 1 Verse 2",
                "has_content": True,
                "content_data": {"basic": {"translation": "C1V2"}},
            },
            headers=headers,
        )
        assert verse_two_response.status_code == status.HTTP_201_CREATED

        verse_three_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_two_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Chapter 2 Verse 1",
                "has_content": True,
                "content_data": {"basic": {"translation": "C2V1"}},
            },
            headers=headers,
        )
        assert verse_three_response.status_code == status.HTTP_201_CREATED

        preview_response = client.post(
            f"/api/books/{book_id}/preview/render",
            json={},
            headers=headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK

        payload = preview_response.json()
        titles = [block["title"] for block in payload["sections"]["body"][:5]]
        assert titles == [
            "Chapter 1",
            "Chapter 1 Verse 1",
            "Chapter 1 Verse 2",
            "Chapter 2",
            "Chapter 2 Verse 1",
        ]

    def test_book_preview_render_returns_reader_hierarchy_path_for_schema_root_levels(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Reader Hierarchy Schema {uuid4().hex[:8]}",
                "description": "Schema for reader hierarchy path",
                "levels": ["Kanda", "Sarga", "Shloka"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Hierarchy Book {uuid4().hex[:6]}",
                "book_code": f"reader-hierarchy-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        kanda_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Kanda",
                "level_order": 1,
                "sequence_number": "4",
                "title_english": "Kishkindha Kanda",
                "has_content": False,
            },
            headers=headers,
        )
        assert kanda_response.status_code == status.HTTP_201_CREATED
        kanda_id = kanda_response.json()["id"]

        sarga_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": kanda_id,
                "level_name": "Sarga",
                "level_order": 2,
                "sequence_number": "3",
                "title_english": "Sarga 3",
                "has_content": False,
            },
            headers=headers,
        )
        assert sarga_response.status_code == status.HTTP_201_CREATED
        sarga_id = sarga_response.json()["id"]

        db = SessionLocal()
        try:
            sarga_node = db.query(ContentNode).filter(ContentNode.id == sarga_id).first()
            assert sarga_node is not None
            # Emulate imported canonical data where child levels can carry composite numbering.
            sarga_node.sequence_number = "4.3"
            db.commit()
        finally:
            db.close()

        shloka_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": sarga_id,
                "level_name": "Shloka",
                "level_order": 3,
                "sequence_number": "4",
                "title_english": "Shloka 4",
                "has_content": True,
                "content_data": {"basic": {"translation": "Verse text"}},
            },
            headers=headers,
        )
        assert shloka_response.status_code == status.HTTP_201_CREATED
        shloka_id = shloka_response.json()["id"]

        preview_response = client.post(
            f"/api/books/{book_id}/preview/render",
            json={"node_id": shloka_id},
            headers=headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK
        payload = preview_response.json()
        assert payload["preview_scope"] == "node"
        assert payload["reader_hierarchy_path"] == "3.4"

    def test_book_preview_render_returns_reader_hierarchy_path_for_non_schema_root_levels(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Reader Hierarchy Mismatch Schema {uuid4().hex[:8]}",
                "description": "Schema for reader hierarchy path mismatch",
                "levels": ["Kanda", "Sarga", "Shloka"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Hierarchy Mismatch Book {uuid4().hex[:6]}",
                "book_code": f"reader-hierarchy-mismatch-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        db = SessionLocal()
        try:
            prakarana = ContentNode(
                book_id=book_id,
                parent_node_id=None,
                level_name="Prakarana",
                level_order=1,
                sequence_number=5,
                title_english="Prakarana 5",
                has_content=False,
            )
            db.add(prakarana)
            db.flush()

            sarga = ContentNode(
                book_id=book_id,
                parent_node_id=prakarana.id,
                level_name="Sarga",
                level_order=2,
                sequence_number=2,
                title_english="Upadesanuvarnanam",
                has_content=False,
            )
            db.add(sarga)
            db.flush()

            shloka = ContentNode(
                book_id=book_id,
                parent_node_id=sarga.id,
                level_name="Shloka",
                level_order=3,
                sequence_number=3,
                title_english="Shloka 3",
                has_content=True,
                content_data={"basic": {"translation": "Verse text"}},
            )
            db.add(shloka)
            db.commit()
            shloka_id = shloka.id
        finally:
            db.close()

        preview_response = client.post(
            f"/api/books/{book_id}/preview/render",
            json={"node_id": shloka_id},
            headers=headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK
        payload = preview_response.json()
        assert payload["preview_scope"] == "node"
        assert payload["reader_hierarchy_path"] == "5.2.3"

    def test_book_preview_render_preserves_first_level_for_two_level_composite_leaf_sequence(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Reader Hierarchy Two Level Schema {uuid4().hex[:8]}",
                "description": "Schema for two-level hierarchy path",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Two Level Hierarchy Book {uuid4().hex[:6]}",
                "book_code": f"two-level-hierarchy-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "9",
                "title_english": "Chapter 9",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_id = chapter_response.json()["id"]

        verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "4",
                "title_english": "Verse 4",
                "has_content": True,
                "content_data": {"basic": {"translation": "Verse text"}},
            },
            headers=headers,
        )
        assert verse_response.status_code == status.HTTP_201_CREATED
        verse_id = verse_response.json()["id"]

        db = SessionLocal()
        try:
            verse_node = db.query(ContentNode).filter(ContentNode.id == verse_id).first()
            assert verse_node is not None
            # Imported hierarchies may store leaf sequence as Chapter.Verse.
            verse_node.sequence_number = "9.4"
            db.commit()
        finally:
            db.close()

        preview_response = client.post(
            f"/api/books/{book_id}/preview/render",
            json={"node_id": verse_id},
            headers=headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK
        payload = preview_response.json()
        assert payload["preview_scope"] == "node"
        assert payload["reader_hierarchy_path"] == "9.4"

    def test_book_preview_render_preserves_full_path_for_mirrored_composite_middle_sequence(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Reader Hierarchy Mirrored Composite Schema {uuid4().hex[:8]}",
                "description": "Schema for mirrored composite middle sequence",
                "levels": ["Kanda", "Sarga", "Shloka"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Mirrored Composite Book {uuid4().hex[:6]}",
                "book_code": f"mirrored-composite-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        kanda_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Kanda",
                "level_order": 1,
                "sequence_number": "6",
                "title_english": "Yuddha Kanda",
                "has_content": False,
            },
            headers=headers,
        )
        assert kanda_response.status_code == status.HTTP_201_CREATED
        kanda_id = kanda_response.json()["id"]

        sarga_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": kanda_id,
                "level_name": "Sarga",
                "level_order": 2,
                "sequence_number": "6",
                "title_english": "Sarga 6",
                "has_content": False,
            },
            headers=headers,
        )
        assert sarga_response.status_code == status.HTTP_201_CREATED
        sarga_id = sarga_response.json()["id"]

        db = SessionLocal()
        try:
            sarga_node = db.query(ContentNode).filter(ContentNode.id == sarga_id).first()
            assert sarga_node is not None
            # Imported canonical data may redundantly encode Kanda and Sarga as 6.6.
            sarga_node.sequence_number = "6.6"
            db.commit()
        finally:
            db.close()

        shloka_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": sarga_id,
                "level_name": "Shloka",
                "level_order": 3,
                "sequence_number": "4",
                "title_english": "Shloka 4",
                "has_content": True,
                "content_data": {"basic": {"translation": "Verse text"}},
            },
            headers=headers,
        )
        assert shloka_response.status_code == status.HTTP_201_CREATED
        shloka_id = shloka_response.json()["id"]

        preview_response = client.post(
            f"/api/books/{book_id}/preview/render",
            json={"node_id": shloka_id},
            headers=headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK
        payload = preview_response.json()
        assert payload["preview_scope"] == "node"
        assert payload["reader_hierarchy_path"] == "6.6.4"

    def test_book_preview_render_preserves_root_for_non_redundant_composite_middle_sequence(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Reader Hierarchy Non Redundant Composite Schema {uuid4().hex[:8]}",
                "description": "Schema for non-redundant composite middle sequence",
                "levels": ["Kanda", "Sarga", "Shloka"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Non Redundant Composite Book {uuid4().hex[:6]}",
                "book_code": f"non-redundant-composite-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        kanda_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Kanda",
                "level_order": 1,
                "sequence_number": "5",
                "title_english": "Sundara Kanda",
                "has_content": False,
            },
            headers=headers,
        )
        assert kanda_response.status_code == status.HTTP_201_CREATED
        kanda_id = kanda_response.json()["id"]

        sarga_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": kanda_id,
                "level_name": "Sarga",
                "level_order": 2,
                "sequence_number": "6",
                "title_english": "Sarga 6",
                "has_content": False,
            },
            headers=headers,
        )
        assert sarga_response.status_code == status.HTTP_201_CREATED
        sarga_id = sarga_response.json()["id"]

        db = SessionLocal()
        try:
            sarga_node = db.query(ContentNode).filter(ContentNode.id == sarga_id).first()
            assert sarga_node is not None
            # Composite sarga sequence preserves kanda and sarga context and should not drop root.
            sarga_node.sequence_number = "5.6"
            db.commit()
        finally:
            db.close()

        shloka_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": sarga_id,
                "level_name": "Shloka",
                "level_order": 3,
                "sequence_number": "7",
                "title_english": "Shloka 7",
                "has_content": True,
                "content_data": {"basic": {"translation": "Verse text"}},
            },
            headers=headers,
        )
        assert shloka_response.status_code == status.HTTP_201_CREATED
        shloka_id = shloka_response.json()["id"]

        preview_response = client.post(
            f"/api/books/{book_id}/preview/render",
            json={"node_id": shloka_id},
            headers=headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK
        payload = preview_response.json()
        assert payload["preview_scope"] == "node"
        assert payload["reader_hierarchy_path"] == "5.6.7"

    def test_draft_body_can_reference_entire_source_book_for_rendering(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Whole Book Draft Schema {uuid4().hex[:8]}",
                "description": "Schema for whole-book draft body references",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        source_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Source Library Book {uuid4().hex[:6]}",
                "book_code": f"source-lib-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert source_book_response.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter One",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_node_id = chapter_response.json()["id"]

        verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": chapter_node_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse One",
                "has_content": True,
                "content_data": {"basic": {"translation": "Verse content"}},
            },
            headers=headers,
        )
        assert verse_response.status_code == status.HTTP_201_CREATED

        draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Whole Book In Draft",
                "description": "Draft body expands from source book",
                "section_structure": {
                    "front": [],
                    "body": [
                        {
                            "title": "Imported Book Body",
                            "source_book_id": source_book_id,
                            "source_scope": "book",
                            "order": 1,
                        }
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={},
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED
        snapshot_id = publish_response.json()["snapshot"]["id"]

        render_response = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        assert render_response.status_code == status.HTTP_200_OK
        body_blocks = render_response.json()["sections"]["body"]

        assert len(body_blocks) >= 2
        assert all(block["source_book_id"] == source_book_id for block in body_blocks)
        assert all(block["source_node_id"] is not None for block in body_blocks)
        assert "Chapter One" in [block["title"] for block in body_blocks]
        assert "Verse One" in [block["title"] for block in body_blocks]

    def test_snapshot_render_artifact_collision_matrix_prefers_highest_precedence(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Collision Matrix Schema {uuid4().hex[:8]}",
                "description": "Collision precedence coverage",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        source_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Collision Source {uuid4().hex[:6]}",
                "book_code": f"collision-src-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert source_book_response.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Collision Chapter",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_node_id = chapter_response.json()["id"]

        verse_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": chapter_node_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Collision Verse",
                "has_content": True,
                "content_data": {"basic": {"translation": "Collision verse content"}},
            },
            headers=headers,
        )
        assert verse_response.status_code == status.HTTP_201_CREATED
        verse_node_id = verse_response.json()["id"]

        draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Collision Matrix Draft",
                "description": "Node/level/book/global collisions",
                "section_structure": {
                    "front": [],
                    "body": [
                        {"title": "Node collision", "node_id": verse_node_id, "source_book_id": source_book_id, "order": 1},
                        {"title": "Level collision", "source_book_id": source_book_id, "level_name": "Verse", "order": 2},
                        {"title": "Book collision", "source_book_id": source_book_id, "order": 3},
                        {"title": "Global collision", "order": 4},
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={
                "snapshot_data": {
                    "front": [],
                    "body": [
                        {"title": "Node collision", "node_id": verse_node_id, "source_book_id": source_book_id, "order": 1},
                        {"title": "Level collision", "source_book_id": source_book_id, "level_name": "Verse", "order": 2},
                        {"title": "Book collision", "source_book_id": source_book_id, "order": 3},
                        {"title": "Global collision", "order": 4},
                    ],
                    "back": [],
                    "template_bindings": {
                        "global_template_key": "template.global.content_item.v1",
                        "book_template_key": "template.book.content_item.v1",
                        "level_template_keys": {
                            "verse": "template.level.content_item.v1"
                        },
                        "node_template_keys": {
                            str(verse_node_id): "template.node.content_item.v1"
                        },
                    },
                    "metadata_bindings": {
                        "global_metadata": {"collision": "global"},
                        "book_metadata": {"collision": "book"},
                        "level_metadata": {"verse": {"collision": "level"}},
                        "node_metadata": {str(verse_node_id): {"collision": "node"}},
                    },
                }
            },
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED
        snapshot_payload = publish_response.json()["snapshot"]
        snapshot_id = snapshot_payload["id"]
        assert "snapshot_fingerprint" in snapshot_payload["snapshot_data"]

        render_response_1 = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        render_response_2 = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        assert render_response_1.status_code == status.HTTP_200_OK
        assert render_response_2.status_code == status.HTTP_200_OK

        payload_1 = render_response_1.json()
        payload_2 = render_response_2.json()
        body_blocks = payload_1["sections"]["body"]

        assert [block["template_key"] for block in body_blocks] == [
            "template.node.content_item.v1",
            "template.level.content_item.v1",
            "template.book.content_item.v1",
            "template.global.content_item.v1",
        ]
        assert [block["resolved_metadata"]["collision"] for block in body_blocks] == [
            "node",
            "level",
            "book",
            "global",
        ]

        canonical_1 = json.dumps(payload_1, sort_keys=True, separators=(",", ":")).encode("utf-8")
        canonical_2 = json.dumps(payload_2, sort_keys=True, separators=(",", ":")).encode("utf-8")
        assert hashlib.sha256(canonical_1).hexdigest() == hashlib.sha256(canonical_2).hexdigest()

    def test_snapshot_contains_deterministic_fingerprint(self, client):
        headers = _register_and_login(client)

        create_response = client.post(
            "/api/draft-books",
            json={
                "title": "Fingerprint Draft",
                "description": "Snapshot fingerprint coverage",
                "section_structure": {
                    "front": [{"title": "Preface", "order": 1}],
                    "body": [{"title": "Chapter 1", "order": 1}],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        draft_id = create_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={
                "snapshot_data": {
                    "front": [{"title": "Preface", "order": 1}],
                    "body": [{"title": "Chapter 1", "order": 1}],
                    "back": [],
                    "render_settings": {
                        "show_metadata": True,
                        "text_order": ["sanskrit", "english", "text"],
                    },
                    "template_bindings": {
                        "global_template_key": "template.global.content_item.v1"
                    },
                    "metadata_bindings": {
                        "global_metadata": {"audience": "all"}
                    },
                }
            },
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED

        snapshot_payload = publish_response.json()["snapshot"]
        snapshot_id = snapshot_payload["id"]
        snapshot_data = snapshot_payload["snapshot_data"]

        fingerprint = snapshot_data.get("snapshot_fingerprint")
        assert isinstance(fingerprint, dict)
        assert fingerprint.get("version") == "v1"
        assert fingerprint.get("algorithm") == "sha256"

        for key in ("content_hash", "template_hash", "render_hash", "combined_hash"):
            value = fingerprint.get(key)
            assert isinstance(value, str)
            assert len(value) == 64

        expected_combined = hashlib.sha256(
            json.dumps(
                {
                    "content_hash": fingerprint["content_hash"],
                    "template_hash": fingerprint["template_hash"],
                    "render_hash": fingerprint["render_hash"],
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        assert fingerprint["combined_hash"] == expected_combined

        snapshot_response_1 = client.get(
            f"/api/edition-snapshots/{snapshot_id}",
            headers=headers,
        )
        assert snapshot_response_1.status_code == status.HTTP_200_OK
        snapshot_response_2 = client.get(
            f"/api/edition-snapshots/{snapshot_id}",
            headers=headers,
        )
        assert snapshot_response_2.status_code == status.HTTP_200_OK

        fingerprint_1 = snapshot_response_1.json()["snapshot_data"].get("snapshot_fingerprint")
        fingerprint_2 = snapshot_response_2.json()["snapshot_data"].get("snapshot_fingerprint")
        assert fingerprint_1 == fingerprint_2

    def test_draft_preview_render_applies_session_template_overrides(self, client):
        headers = _register_and_login(client)

        draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Preview Override Draft",
                "description": "Session override preview coverage",
                "section_structure": {
                    "front": [],
                    "body": [
                        {"title": "Verse 1", "level_name": "Verse", "order": 1},
                        {"title": "Verse 2", "level_name": "Verse", "order": 2},
                    ],
                    "back": [],
                    "template_bindings": {
                        "level_template_keys": {
                            "verse": "template.level.base.content_item.v1"
                        }
                    },
                },
            },
            headers=headers,
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        preview_response = client.post(
            f"/api/draft-books/{draft_id}/preview/render",
            json={
                "session_template_bindings": {
                    "level_template_keys": {
                        "verse": "template.level.session.content_item.v1"
                    }
                }
            },
            headers=headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK
        preview_payload = preview_response.json()

        assert preview_payload["preview_mode"] == "session"
        body_blocks = preview_payload["sections"]["body"]
        assert len(body_blocks) == 2
        assert {block["template_key"] for block in body_blocks} == {
            "template.level.session.content_item.v1"
        }

        draft_after_preview = client.get(
            f"/api/draft-books/{draft_id}",
            headers=headers,
        )
        assert draft_after_preview.status_code == status.HTTP_200_OK
        persisted_bindings = (
            draft_after_preview.json().get("section_structure", {}).get("template_bindings", {})
        )
        assert persisted_bindings.get("level_template_keys", {}).get("verse") == "template.level.base.content_item.v1"

    def test_preview_warns_and_publish_blocks_on_invalid_template_bindings(self, client):
        headers = _register_and_login(client)

        draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Invalid Template Binding Draft",
                "description": "Template validation gate coverage",
                "section_structure": {
                    "front": [],
                    "body": [
                        {"title": "Verse 1", "level_name": "Verse", "order": 1},
                    ],
                    "back": [],
                    "template_bindings": {
                        "level_template_keys": {
                            "verse": "template.level.invalid"
                        }
                    },
                },
            },
            headers=headers,
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        preview_response = client.post(
            f"/api/draft-books/{draft_id}/preview/render",
            json={},
            headers=headers,
        )
        assert preview_response.status_code == status.HTTP_200_OK
        preview_payload = preview_response.json()

        assert preview_payload["preview_mode"] == "draft"
        assert len(preview_payload["warnings"]) == 1
        assert "level_template_keys.verse" in preview_payload["warnings"][0]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={
                "snapshot_data": {
                    "front": [],
                    "body": [
                        {"title": "Verse 1", "level_name": "Verse", "order": 1},
                    ],
                    "back": [],
                    "template_bindings": {
                        "level_template_keys": {
                            "verse": "template.level.invalid"
                        }
                    },
                }
            },
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        detail = publish_response.json()["detail"]
        assert detail["message"] == "Publish blocked by template validation."
        assert len(detail["errors"]) == 1
        assert "level_template_keys.verse" in detail["errors"][0]

    def test_publish_and_policy_failures_emit_audit_events(self, client, caplog):
        headers = _register_and_login(client)
        caplog.set_level("INFO", logger="api.draft_books")

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Audit Schema {uuid4().hex[:8]}",
                "description": "Schema for audit event test",
                "levels": ["Chapter"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        source_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Audit Source {uuid4().hex[:6]}",
                "book_code": f"audit-src-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert source_book_response.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_response.json()["id"]

        blocked_node_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Blocked Audit Node",
                "has_content": False,
                "license_type": "ALL-RIGHTS-RESERVED",
            },
            headers=headers,
        )
        assert blocked_node_response.status_code == status.HTTP_201_CREATED
        blocked_node_id = blocked_node_response.json()["id"]

        blocked_draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Audit Blocked Draft",
                "description": "Blocked policy path",
                "section_structure": {
                    "front": [],
                    "body": [
                        {
                            "node_id": blocked_node_id,
                            "source_type": "library_reference",
                            "source_book_id": source_book_id,
                            "title": "Blocked Item",
                        }
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert blocked_draft_response.status_code == status.HTTP_201_CREATED
        blocked_draft_id = blocked_draft_response.json()["id"]

        blocked_publish_response = client.post(
            f"/api/draft-books/{blocked_draft_id}/publish",
            json={},
            headers=headers,
        )
        assert blocked_publish_response.status_code == status.HTTP_409_CONFLICT

        allowed_draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "Audit Allowed Draft",
                "description": "Success publish path",
                "section_structure": {"front": [], "body": [], "back": []},
            },
            headers=headers,
        )
        assert allowed_draft_response.status_code == status.HTTP_201_CREATED
        allowed_draft_id = allowed_draft_response.json()["id"]

        allowed_publish_response = client.post(
            f"/api/draft-books/{allowed_draft_id}/publish",
            json={},
            headers=headers,
        )
        assert allowed_publish_response.status_code == status.HTTP_201_CREATED

        joined_messages = "\n".join(record.getMessage() for record in caplog.records)
        assert "publish.policy_blocked" in joined_messages
        assert "publish.succeeded" in joined_messages


class TestCollectLicensePolicyIntegration:
    def test_collect_license_policy_check_reports_warn_and_block(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Collect License Schema {uuid4().hex[:8]}",
                "description": "Schema for collect-time license checks",
                "levels": ["Chapter"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        source_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Collect Source {uuid4().hex[:6]}",
                "book_code": f"collect-src-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert source_book_response.status_code == status.HTTP_201_CREATED
        source_book_id = source_book_response.json()["id"]

        warn_node_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Warn Node",
                "has_content": False,
                "license_type": "CC-BY-NC-4.0",
            },
            headers=headers,
        )
        assert warn_node_response.status_code == status.HTTP_201_CREATED
        warn_node_id = warn_node_response.json()["id"]

        blocked_node_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": source_book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "2",
                "title_english": "Blocked Node",
                "has_content": False,
                "license_type": "ALL-RIGHTS-RESERVED",
            },
            headers=headers,
        )
        assert blocked_node_response.status_code == status.HTTP_201_CREATED
        blocked_node_id = blocked_node_response.json()["id"]

        check_response = client.post(
            "/api/content/license-policy-check",
            json={"node_ids": [warn_node_id, blocked_node_id]},
            headers=headers,
        )
        assert check_response.status_code == status.HTTP_200_OK
        report = check_response.json()
        assert report["status"] == "block"
        assert len(report["warning_issues"]) == 1
        assert len(report["blocked_issues"]) == 1
        assert report["warning_issues"][0]["source_node_id"] == warn_node_id
        assert report["warning_issues"][0]["license_type"] == "CC-BY-NC-4.0"
        assert report["blocked_issues"][0]["source_node_id"] == blocked_node_id
        assert report["blocked_issues"][0]["license_type"] == "ALL-RIGHTS-RESERVED"


class TestContentCoverageSprintCOV01:
    def test_update_book_rejects_invalid_status_and_visibility(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Status Schema {uuid4().hex[:8]}",
                "description": "Schema for update-book validation coverage",
                "levels": ["Chapter"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Status Book {uuid4().hex[:6]}",
                "book_code": f"cov-status-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        invalid_status_response = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "archived"},
            headers=headers,
        )
        assert invalid_status_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        invalid_visibility_response = client.patch(
            f"/api/content/books/{book_id}",
            json={"visibility": "internal"},
            headers=headers,
        )
        assert invalid_visibility_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_book_share_rejects_owner_email(self, client):
        headers = _register_and_login(client)

        me_response = client.get("/api/users/me", headers=headers)
        assert me_response.status_code == status.HTTP_200_OK
        owner_email = me_response.json()["email"]

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Share Schema {uuid4().hex[:8]}",
                "description": "Schema for share-owner guard coverage",
                "levels": ["Chapter"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Share Book {uuid4().hex[:6]}",
                "book_code": f"cov-share-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        share_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": owner_email, "permission": "viewer"},
            headers=headers,
        )
        assert share_response.status_code == status.HTTP_400_BAD_REQUEST
        assert "owner cannot be shared" in share_response.json()["detail"].lower()

    def test_insert_references_validates_schema_and_parent(self, client):
        headers = _register_and_login(client)

        target_no_schema_response = client.post(
            "/api/content/books",
            json={
                "schema_id": None,
                "book_name": f"COV No Schema Target {uuid4().hex[:6]}",
                "book_code": f"cov-noschema-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert target_no_schema_response.status_code == status.HTTP_201_CREATED
        target_no_schema_id = target_no_schema_response.json()["id"]

        no_schema_insert_response = client.post(
            f"/api/content/books/{target_no_schema_id}/insert-references",
            json={"node_ids": []},
            headers=headers,
        )
        assert no_schema_insert_response.status_code == status.HTTP_400_BAD_REQUEST
        assert "book has no schema" in no_schema_insert_response.json()["detail"].lower()

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Ref Schema {uuid4().hex[:8]}",
                "description": "Schema for insert-reference parent validation",
                "levels": ["Chapter"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        target_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Target {uuid4().hex[:6]}",
                "book_code": f"cov-target-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert target_response.status_code == status.HTTP_201_CREATED
        target_book_id = target_response.json()["id"]

        bad_parent_response = client.post(
            f"/api/content/books/{target_book_id}/insert-references",
            json={"node_ids": [], "parent_node_id": 999999},
            headers=headers,
        )
        assert bad_parent_response.status_code == status.HTTP_404_NOT_FOUND
        assert "parent node not found" in bad_parent_response.json()["detail"].lower()

    def test_delete_book_requires_edit_access(self, client):
        owner_headers = _register_and_login(client)
        other_headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Delete Schema {uuid4().hex[:8]}",
                "description": "Schema for delete-book access coverage",
                "levels": ["Chapter"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Delete Book {uuid4().hex[:6]}",
                "book_code": f"cov-delete-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        forbidden_delete_response = client.delete(
            f"/api/content/books/{book_id}",
            headers=other_headers,
        )
        assert forbidden_delete_response.status_code == status.HTTP_403_FORBIDDEN

        owner_delete_response = client.delete(
            f"/api/content/books/{book_id}",
            headers=owner_headers,
        )
        assert owner_delete_response.status_code == status.HTTP_200_OK
        assert owner_delete_response.json()["message"] == "Deleted"

        get_deleted_response = client.get(
            f"/api/content/books/{book_id}",
            headers=owner_headers,
        )
        assert get_deleted_response.status_code == status.HTTP_404_NOT_FOUND


class TestContentCoverageSprintCOV02:
    def test_shared_editor_cannot_change_book_status_or_visibility(self, client):
        owner_headers = _register_and_login(client)
        editor_headers = _register_and_login(client)

        editor_me = client.get("/api/users/me", headers=editor_headers)
        assert editor_me.status_code == status.HTTP_200_OK
        editor_email = editor_me.json()["email"]

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV OwnerOnly Schema {uuid4().hex[:8]}",
                "description": "Schema for owner-only publish/visibility branch",
                "levels": ["Chapter"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV OwnerOnly Book {uuid4().hex[:6]}",
                "book_code": f"cov-owner-only-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        share_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": editor_email, "permission": "editor"},
            headers=owner_headers,
        )
        assert share_response.status_code == status.HTTP_201_CREATED

        editor_title_patch = client.patch(
            f"/api/content/books/{book_id}",
            json={"book_name": "Editor Updated Title"},
            headers=editor_headers,
        )
        assert editor_title_patch.status_code == status.HTTP_200_OK

        editor_status_patch = client.patch(
            f"/api/content/books/{book_id}",
            json={"status": "published"},
            headers=editor_headers,
        )
        assert editor_status_patch.status_code == status.HTTP_403_FORBIDDEN
        assert "only the book owner" in editor_status_patch.json()["detail"].lower()

        editor_visibility_patch = client.patch(
            f"/api/content/books/{book_id}",
            json={"visibility": "public"},
            headers=editor_headers,
        )
        assert editor_visibility_patch.status_code == status.HTTP_403_FORBIDDEN

    def test_create_share_creates_pending_invite_for_unknown_user_email(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Unknown Share Schema {uuid4().hex[:8]}",
                "description": "Schema for unknown share user branch",
                "levels": ["Chapter"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Unknown Share Book {uuid4().hex[:6]}",
                "book_code": f"cov-unknown-share-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        share_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": f"missing_{uuid4().hex[:8]}@example.com", "permission": "viewer"},
            headers=headers,
        )
        assert share_response.status_code == status.HTTP_201_CREATED
        payload = share_response.json()
        assert payload["book_id"] == book_id
        assert payload["permission"] == "viewer"
        assert payload["shared_with_email"].startswith("missing_")
        assert payload["shared_with_is_active"] is False

        db = SessionLocal()
        try:
            invited_user = db.query(User).filter(User.email == payload["shared_with_email"]).first()
            assert invited_user is not None
            assert invited_user.id == payload["shared_with_user_id"]
            assert invited_user.is_active is False
            assert invited_user.password_hash is None
        finally:
            db.close()

    def test_create_share_email_for_pending_invite_uses_preview_link(self, client, monkeypatch):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Invite Preview Schema {uuid4().hex[:8]}",
                "description": "Schema for invite preview link coverage",
                "levels": ["Chapter"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Invite Preview Book {uuid4().hex[:6]}",
                "book_code": f"cov-invite-preview-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        captured: dict[str, str] = {}

        def fake_send_share_invitation(**kwargs):
            captured.update(kwargs)

        monkeypatch.setattr(content_api, "send_share_invitation", fake_send_share_invitation)

        invite_email = f"invite_preview_{uuid4().hex[:8]}@example.com"
        share_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": invite_email, "permission": "viewer", "send_email": True},
            headers=headers,
        )
        assert share_response.status_code == status.HTTP_201_CREATED
        assert captured["recipient_email"] == invite_email
        assert "/signup?email=" in captured["invite_link"]
        assert captured["invite_link"].endswith(
            f"next=%2Fscriptures%3Fbook%3D{book_id}%26preview%3Dbook"
        )

    def test_create_share_email_for_pending_invite_preserves_node_access_path(self, client, monkeypatch):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Invite Node Schema {uuid4().hex[:8]}",
                "description": "Schema for invite node link coverage",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Invite Node Book {uuid4().hex[:6]}",
                "book_code": f"cov-invite-node-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        captured: dict[str, str] = {}

        def fake_send_share_invitation(**kwargs):
            captured.update(kwargs)

        monkeypatch.setattr(content_api, "send_share_invitation", fake_send_share_invitation)

        invite_email = f"invite_node_{uuid4().hex[:8]}@example.com"
        share_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={
                "email": invite_email,
                "permission": "viewer",
                "send_email": True,
                "access_path": f"/scriptures?book={book_id}&node=108&preview=node",
            },
            headers=headers,
        )
        assert share_response.status_code == status.HTTP_201_CREATED
        assert captured["recipient_email"] == invite_email
        assert "/signup?email=" in captured["invite_link"]
        assert captured["invite_link"].endswith(
            f"next=%2Fscriptures%3Fbook%3D{book_id}%26node%3D108%26preview%3Dnode"
        )

    def test_create_share_email_for_existing_user_includes_prefilled_email_link(self, client, monkeypatch):
        headers = _register_and_login(client)

        existing_suffix = uuid4().hex[:8]
        existing_email = f"existing_invite_{existing_suffix}@example.com"
        register_response = client.post(
            "/api/auth/register",
            json={
                "email": existing_email,
                "password": "StrongPass123!",
                "username": f"existing_invite_{existing_suffix}",
                "full_name": "Existing Invite User",
            },
        )
        assert register_response.status_code == status.HTTP_201_CREATED

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Existing Invite Schema {uuid4().hex[:8]}",
                "description": "Schema for existing invite link coverage",
                "levels": ["Chapter"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Existing Invite Book {uuid4().hex[:6]}",
                "book_code": f"cov-existing-invite-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        captured: dict[str, str] = {}

        def fake_send_share_invitation(**kwargs):
            captured.update(kwargs)

        monkeypatch.setattr(content_api, "send_share_invitation", fake_send_share_invitation)

        share_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": existing_email, "permission": "viewer", "send_email": True},
            headers=headers,
        )
        assert share_response.status_code == status.HTTP_201_CREATED
        assert captured["recipient_email"] == existing_email
        assert f"/scriptures?book={book_id}&preview=book" in captured["invite_link"]
        assert "&email=" in captured["invite_link"]
        assert existing_email.replace("@", "%40") in captured["invite_link"]

    def test_create_share_email_for_existing_user_preserves_node_access_path(self, client, monkeypatch):
        headers = _register_and_login(client)

        existing_suffix = uuid4().hex[:8]
        existing_email = f"existing_node_invite_{existing_suffix}@example.com"
        register_response = client.post(
            "/api/auth/register",
            json={
                "email": existing_email,
                "password": "StrongPass123!",
                "username": f"existing_node_invite_{existing_suffix}",
                "full_name": "Existing Node Invite User",
            },
        )
        assert register_response.status_code == status.HTTP_201_CREATED

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Existing Node Invite Schema {uuid4().hex[:8]}",
                "description": "Schema for existing invite node link coverage",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Existing Node Invite Book {uuid4().hex[:6]}",
                "book_code": f"cov-existing-node-invite-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        captured: dict[str, str] = {}

        def fake_send_share_invitation(**kwargs):
            captured.update(kwargs)

        monkeypatch.setattr(content_api, "send_share_invitation", fake_send_share_invitation)

        share_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={
                "email": existing_email,
                "permission": "viewer",
                "send_email": True,
                "access_path": f"/scriptures?book={book_id}&node=305&preview=node",
            },
            headers=headers,
        )
        assert share_response.status_code == status.HTTP_201_CREATED
        assert captured["recipient_email"] == existing_email
        assert f"/scriptures?book={book_id}&node=305&preview=node" in captured["invite_link"]
        assert "&email=" in captured["invite_link"]
        assert existing_email.replace("@", "%40") in captured["invite_link"]

    def test_scriptures_action_permission_matrix_for_shared_roles(self, client):
        admin_headers = _register_and_login_as_admin(client)
        owner_headers = _register_and_login(client)
        viewer_headers = _register_and_login(client)
        contributor_headers = _register_and_login(client)

        viewer_me = client.get("/api/users/me", headers=viewer_headers)
        assert viewer_me.status_code == status.HTTP_200_OK
        viewer_email = viewer_me.json()["email"]

        contributor_me = client.get("/api/users/me", headers=contributor_headers)
        assert contributor_me.status_code == status.HTTP_200_OK
        contributor_email = contributor_me.json()["email"]

        owner_me = client.get("/api/users/me", headers=owner_headers)
        assert owner_me.status_code == status.HTTP_200_OK
        owner_email = owner_me.json()["email"]

        category_suffix = uuid4().hex[:8]
        category_response = client.post(
            "/api/metadata/categories",
            headers=admin_headers,
            json={
                "name": f"matrix_category_{category_suffix}",
                "description": "Role matrix category",
                "applicable_scopes": ["book"],
                "parent_category_ids": [],
                "properties": [],
            },
        )
        assert category_response.status_code == status.HTTP_201_CREATED
        category_id = category_response.json()["id"]

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Matrix Schema {uuid4().hex[:8]}",
                "description": "Schema for scriptures permission matrix",
                "levels": ["Chapter"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Matrix Book {uuid4().hex[:6]}",
                "book_code": f"matrix-book-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        share_viewer_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": viewer_email, "permission": "viewer"},
            headers=owner_headers,
        )
        assert share_viewer_response.status_code == status.HTTP_201_CREATED

        share_contributor_response = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": contributor_email, "permission": "contributor"},
            headers=owner_headers,
        )
        assert share_contributor_response.status_code == status.HTTP_201_CREATED

        viewer_share_attempt = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": owner_email, "permission": "viewer"},
            headers=viewer_headers,
        )
        assert viewer_share_attempt.status_code == status.HTTP_403_FORBIDDEN

        contributor_share_attempt = client.post(
            f"/api/content/books/{book_id}/shares",
            json={"email": owner_email, "permission": "viewer"},
            headers=contributor_headers,
        )
        assert contributor_share_attempt.status_code == status.HTTP_403_FORBIDDEN

        viewer_edit_attempt = client.patch(
            f"/api/content/books/{book_id}",
            json={"book_name": "Viewer Should Not Edit"},
            headers=viewer_headers,
        )
        assert viewer_edit_attempt.status_code == status.HTTP_403_FORBIDDEN

        contributor_edit_attempt = client.patch(
            f"/api/content/books/{book_id}",
            json={"book_name": "Contributor Can Edit"},
            headers=contributor_headers,
        )
        assert contributor_edit_attempt.status_code == status.HTTP_200_OK

        viewer_metadata_bind_attempt = client.post(
            f"/api/metadata/books/{book_id}/metadata-binding",
            headers=viewer_headers,
            json={
                "category_id": category_id,
                "property_overrides": {},
                "unset_overrides": [],
            },
        )
        assert viewer_metadata_bind_attempt.status_code == status.HTTP_403_FORBIDDEN

        contributor_metadata_bind_attempt = client.post(
            f"/api/metadata/books/{book_id}/metadata-binding",
            headers=contributor_headers,
            json={
                "category_id": category_id,
                "property_overrides": {},
                "unset_overrides": [],
            },
        )
        assert contributor_metadata_bind_attempt.status_code == status.HTTP_200_OK

    def test_update_and_delete_share_return_404_when_share_missing(self, client):
        headers = _register_and_login(client)

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Missing Share Schema {uuid4().hex[:8]}",
                "description": "Schema for missing share branch coverage",
                "levels": ["Chapter"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        create_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Missing Share Book {uuid4().hex[:6]}",
                "book_code": f"cov-missing-share-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert create_book_response.status_code == status.HTTP_201_CREATED
        book_id = create_book_response.json()["id"]

        patch_missing_share = client.patch(
            f"/api/content/books/{book_id}/shares/999999",
            json={"permission": "editor"},
            headers=headers,
        )
        assert patch_missing_share.status_code == status.HTTP_404_NOT_FOUND
        assert "share not found" in patch_missing_share.json()["detail"].lower()

        delete_missing_share = client.delete(
            f"/api/content/books/{book_id}/shares/999999",
            headers=headers,
        )
        assert delete_missing_share.status_code == status.HTTP_404_NOT_FOUND
        assert "share not found" in delete_missing_share.json()["detail"].lower()

    def test_list_nodes_book_filter_returns_404_for_missing_book(self, client):
        headers = _register_and_login(client)

        list_nodes_response = client.get(
            "/api/content/nodes?book_id=999999",
            headers=headers,
        )
        assert list_nodes_response.status_code == status.HTTP_404_NOT_FOUND
        assert list_nodes_response.json()["detail"] == "Not found"

    def test_list_node_media_returns_404_for_missing_node(self, client):
        headers = _register_and_login(client)

        media_response = client.get("/api/content/nodes/999999/media", headers=headers)
        assert media_response.status_code == status.HTTP_404_NOT_FOUND
        assert media_response.json()["detail"] == "Not found"


class TestUsersCoverageSprintCOV03:
    def test_non_admin_cannot_access_admin_user_endpoints(self, client):
        headers = _register_and_login(client)

        list_response = client.get("/api/users", headers=headers)
        assert list_response.status_code == status.HTTP_403_FORBIDDEN

        create_response = client.post(
            "/api/users",
            json={
                "email": f"cov_user_{uuid4().hex[:8]}@example.com",
                "password": "StrongPass123!",
                "username": f"cov_user_{uuid4().hex[:8]}",
                "role": "viewer",
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_403_FORBIDDEN

    def test_admin_can_create_user_and_list_users(self, client):
        admin_headers = _register_and_login_as_admin(client)

        create_response = client.post(
            "/api/users",
            json={
                "email": f"cov_admin_create_{uuid4().hex[:8]}@example.com",
                "password": "StrongPass123!",
                "username": f"cov_admin_create_{uuid4().hex[:8]}",
                "full_name": "Coverage Admin Created",
                "role": "editor",
                "permissions": {"can_moderate": True},
            },
            headers=admin_headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        created = create_response.json()
        assert created["role"] == "editor"
        assert created["permissions"]["can_edit"] is True
        assert created["permissions"]["can_moderate"] is True

        list_response = client.get("/api/users", headers=admin_headers)
        assert list_response.status_code == status.HTTP_200_OK
        ids = {item["id"] for item in list_response.json()}
        assert created["id"] in ids

    def test_admin_create_user_rejects_duplicate_email_and_username(self, client):
        admin_headers = _register_and_login_as_admin(client)
        user_headers = _register_and_login(client)
        user_me = client.get("/api/users/me", headers=user_headers)
        assert user_me.status_code == status.HTTP_200_OK
        existing_email = user_me.json()["email"]
        existing_username = user_me.json()["username"]

        duplicate_email = client.post(
            "/api/users",
            json={
                "email": existing_email,
                "password": "StrongPass123!",
                "username": f"cov_unique_{uuid4().hex[:8]}",
                "role": "viewer",
            },
            headers=admin_headers,
        )
        assert duplicate_email.status_code == status.HTTP_400_BAD_REQUEST
        assert duplicate_email.json()["detail"] == "Email in use"

        duplicate_username = client.post(
            "/api/users",
            json={
                "email": f"cov_dup_{uuid4().hex[:8]}@example.com",
                "password": "StrongPass123!",
                "username": existing_username,
                "role": "viewer",
            },
            headers=admin_headers,
        )
        assert duplicate_username.status_code == status.HTTP_400_BAD_REQUEST
        assert duplicate_username.json()["detail"] == "Username in use"

    def test_admin_can_update_permissions_and_status(self, client):
        admin_headers = _register_and_login_as_admin(client)

        created_user_response = client.post(
            "/api/users",
            json={
                "email": f"cov_update_{uuid4().hex[:8]}@example.com",
                "password": "StrongPass123!",
                "username": f"cov_update_{uuid4().hex[:8]}",
                "role": "viewer",
            },
            headers=admin_headers,
        )
        assert created_user_response.status_code == status.HTTP_201_CREATED
        target_user_id = created_user_response.json()["id"]

        permissions_response = client.patch(
            f"/api/users/{target_user_id}/permissions",
            json={"can_edit": True, "role": "editor"},
            headers=admin_headers,
        )
        assert permissions_response.status_code == status.HTTP_200_OK
        permissions_payload = permissions_response.json()
        assert permissions_payload["role"] == "editor"
        assert permissions_payload["permissions"]["can_edit"] is True

        deactivate_response = client.patch(
            f"/api/users/{target_user_id}/status?is_active=false",
            headers=admin_headers,
        )
        assert deactivate_response.status_code == status.HTTP_200_OK
        assert deactivate_response.json()["is_active"] is False

        not_found_permissions = client.patch(
            "/api/users/999999/permissions",
            json={"can_edit": True},
            headers=admin_headers,
        )
        assert not_found_permissions.status_code == status.HTTP_404_NOT_FOUND

        not_found_status = client.patch(
            "/api/users/999999/status?is_active=false",
            headers=admin_headers,
        )
        assert not_found_status.status_code == status.HTTP_404_NOT_FOUND

    def test_admin_delete_user_respects_contribution_guard(self, client):
        admin_headers = _register_and_login_as_admin(client)
        contributor_headers = _register_and_login(client)

        contributor_me = client.get("/api/users/me", headers=contributor_headers)
        assert contributor_me.status_code == status.HTTP_200_OK
        contributor_id = contributor_me.json()["id"]

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Delete Guard Schema {uuid4().hex[:8]}",
                "description": "Schema for delete-user contribution guard coverage",
                "levels": ["Chapter"],
            },
            headers=contributor_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Delete Guard Book {uuid4().hex[:6]}",
                "book_code": f"cov-delete-guard-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=contributor_headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        node_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Contributor Node",
                "has_content": False,
            },
            headers=contributor_headers,
        )
        assert node_response.status_code == status.HTTP_201_CREATED

        delete_with_contrib = client.delete(f"/api/users/{contributor_id}", headers=admin_headers)
        assert delete_with_contrib.status_code == status.HTTP_400_BAD_REQUEST
        assert "cannot delete user with existing contributions" in delete_with_contrib.json()["detail"].lower()

        non_existent_delete = client.delete("/api/users/999999", headers=admin_headers)
        assert non_existent_delete.status_code == status.HTTP_404_NOT_FOUND

    def test_admin_delete_user_returns_400_when_user_has_import_jobs(self, client):
        admin_headers = _register_and_login_as_admin(client)
        user_headers = _register_and_login(client)

        me = client.get("/api/users/me", headers=user_headers)
        assert me.status_code == status.HTTP_200_OK
        user_id = me.json()["id"]

        from models.import_job import ImportJob

        db = SessionLocal()
        try:
            db.add(
                ImportJob(
                    job_id=f"import-guard-{uuid4().hex[:8]}",
                    status="completed",
                    requested_by=user_id,
                    payload_json={"source": "test"},
                )
            )
            db.commit()
        finally:
            db.close()

        delete_response = client.delete(f"/api/users/{user_id}", headers=admin_headers)
        assert delete_response.status_code == status.HTTP_400_BAD_REQUEST
        assert "import job" in delete_response.json()["detail"].lower()

    def test_admin_delete_user_succeeds_when_only_search_queries_exist(self, client):
        admin_headers = _register_and_login_as_admin(client)
        user_headers = _register_and_login(client)

        me = client.get("/api/users/me", headers=user_headers)
        assert me.status_code == status.HTTP_200_OK
        user_id = me.json()["id"]

        from models.search_query import SearchQuery

        db = SessionLocal()
        try:
            db.add(SearchQuery(user_id=user_id, query_text="test query"))
            db.commit()
        finally:
            db.close()

        delete_response = client.delete(f"/api/users/{user_id}", headers=admin_headers)
        assert delete_response.status_code == status.HTTP_204_NO_CONTENT

    def test_book_ownership_transfer_does_not_allow_user_deletion_with_contributions(self, client):
        admin_headers = _register_and_login_as_admin(client)
        source_headers = _register_and_login(client)
        target_headers = _register_and_login(client)

        source_me = client.get("/api/users/me", headers=source_headers)
        assert source_me.status_code == status.HTTP_200_OK
        source_user_id = source_me.json()["id"]

        target_me = client.get("/api/users/me", headers=target_headers)
        assert target_me.status_code == status.HTTP_200_OK
        target_user_id = target_me.json()["id"]

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Transfer Ownership Schema {uuid4().hex[:8]}",
                "description": "Schema for transfer-ownership coverage",
                "levels": ["Chapter"],
            },
            headers=source_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Transfer Ownership Book {uuid4().hex[:6]}",
                "book_code": f"cov-transfer-own-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=source_headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        node_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Transfer Source Node",
                "has_content": False,
            },
            headers=source_headers,
        )
        assert node_response.status_code == status.HTTP_201_CREATED

        target_email = target_me.json()["email"]

        forbidden_transfer_response = client.post(
            "/api/content/books/ownership/transfer",
            json={"target_email": target_email, "book_ids": [book_id]},
            headers=admin_headers,
        )
        assert forbidden_transfer_response.status_code in (
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_403_FORBIDDEN,
        )

        transfer_response = client.post(
            "/api/content/books/ownership/transfer",
            json={"target_email": target_email, "book_ids": [book_id]},
            headers=source_headers,
        )
        assert transfer_response.status_code == status.HTTP_200_OK
        transfer_payload = transfer_response.json()
        assert transfer_payload["source_user_id"] == source_user_id
        assert transfer_payload["target_user_id"] == target_user_id
        assert transfer_payload["transferred_count"] == 1
        assert transfer_payload["transferred_book_ids"] == [book_id]

        delete_response = client.delete(f"/api/users/{source_user_id}", headers=admin_headers)
        assert delete_response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Cannot delete user with existing contributions" in delete_response.json()["detail"]

    def test_admin_can_list_books_owned_by_user(self, client):
        admin_headers = _register_and_login_as_admin(client)
        owner_headers = _register_and_login(client)

        owner_me = client.get("/api/users/me", headers=owner_headers)
        assert owner_me.status_code == status.HTTP_200_OK
        owner_id = owner_me.json()["id"]

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Owned Books Schema {uuid4().hex[:8]}",
                "description": "Schema for user-owned books listing coverage",
                "levels": ["Chapter"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Owned Book {uuid4().hex[:6]}",
                "book_code": f"cov-owned-book-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        created_book_id = book_response.json()["id"]

        owned_books_response = client.get(f"/api/users/{owner_id}/books", headers=admin_headers)
        assert owned_books_response.status_code == status.HTTP_200_OK
        payload = owned_books_response.json()
        assert isinstance(payload, list)
        assert any(book.get("id") == created_book_id for book in payload)

        unauthorized_response = client.get(f"/api/users/{owner_id}/books")
        assert unauthorized_response.status_code in (
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        )

    def test_owner_can_transfer_selected_book_ownership(self, client):
        owner_headers = _register_and_login(client)
        target_headers = _register_and_login(client)

        owner_me = client.get("/api/users/me", headers=owner_headers)
        assert owner_me.status_code == status.HTTP_200_OK
        owner_id = owner_me.json()["id"]

        target_me = client.get("/api/users/me", headers=target_headers)
        assert target_me.status_code == status.HTTP_200_OK
        target_id = target_me.json()["id"]
        target_email = target_me.json()["email"]

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Book Ownership Transfer Schema {uuid4().hex[:8]}",
                "description": "Schema for selected book ownership transfer coverage",
                "levels": ["Chapter"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_one_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Ownership Book One {uuid4().hex[:6]}",
                "book_code": f"cov-own-one-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert book_one_response.status_code == status.HTTP_201_CREATED
        book_one_id = book_one_response.json()["id"]

        book_two_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Ownership Book Two {uuid4().hex[:6]}",
                "book_code": f"cov-own-two-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert book_two_response.status_code == status.HTTP_201_CREATED
        book_two_id = book_two_response.json()["id"]

        transfer_response = client.post(
            "/api/content/books/ownership/transfer",
            json={
                "target_email": target_email,
                "book_ids": [book_one_id],
            },
            headers=owner_headers,
        )
        assert transfer_response.status_code == status.HTTP_200_OK
        transfer_payload = transfer_response.json()
        assert transfer_payload["source_user_id"] == owner_id
        assert transfer_payload["target_user_id"] == target_id
        assert transfer_payload["transferred_count"] == 1
        assert transfer_payload["transferred_book_ids"] == [book_one_id]

        transferred_book = client.get(f"/api/content/books/{book_one_id}", headers=owner_headers)
        assert transferred_book.status_code == status.HTTP_200_OK
        transferred_metadata = transferred_book.json().get("metadata_json") or {}
        assert transferred_metadata.get("owner_id") == target_id

        untouched_book = client.get(f"/api/content/books/{book_two_id}", headers=owner_headers)
        assert untouched_book.status_code == status.HTTP_200_OK
        untouched_metadata = untouched_book.json().get("metadata_json") or {}
        assert untouched_metadata.get("owner_id") == owner_id

    def test_non_owner_cannot_transfer_unowned_books(self, client):
        owner_headers = _register_and_login(client)
        other_headers = _register_and_login(client)
        target_headers = _register_and_login(client)

        target_me = client.get("/api/users/me", headers=target_headers)
        assert target_me.status_code == status.HTTP_200_OK
        target_email = target_me.json()["email"]

        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"COV Book Ownership Guard Schema {uuid4().hex[:8]}",
                "description": "Schema for ownership transfer guard coverage",
                "levels": ["Chapter"],
            },
            headers=owner_headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        owned_book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"COV Ownership Guard Book {uuid4().hex[:6]}",
                "book_code": f"cov-own-guard-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=owner_headers,
        )
        assert owned_book_response.status_code == status.HTTP_201_CREATED
        owned_book_id = owned_book_response.json()["id"]

        forbidden_transfer_response = client.post(
            "/api/content/books/ownership/transfer",
            json={
                "target_email": target_email,
                "book_ids": [owned_book_id],
            },
            headers=other_headers,
        )
        assert forbidden_transfer_response.status_code in (
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_403_FORBIDDEN,
        )
        detail = forbidden_transfer_response.json().get("detail", "").lower()
        assert "do not own any books" in detail or "you can only transfer books that you own" in detail

class TestWordMeaningsValidation:
    def _create_leaf_parent(self, client, headers, book_metadata: dict | None = None):
        unique_suffix = uuid4().hex[:12]
        schema_response = client.post(
            "/api/content/schemas",
            json={
                "name": f"Word Meanings Schema {uuid4().hex[:8]}",
                "description": "Schema for word meanings validation tests",
                "levels": ["Chapter", "Verse"],
            },
            headers=headers,
        )
        assert schema_response.status_code == status.HTTP_201_CREATED
        schema_id = schema_response.json()["id"]

        book_response = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Word Meanings Book {unique_suffix}",
                "book_code": f"wm-book-{unique_suffix}",
                "language_primary": "sanskrit",
                "metadata_json": book_metadata,
            },
            headers=headers,
        )
        assert book_response.status_code == status.HTTP_201_CREATED
        book_id = book_response.json()["id"]

        chapter_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": None,
                "level_name": "Chapter",
                "level_order": 1,
                "sequence_number": "1",
                "title_english": "Chapter 1",
                "has_content": False,
            },
            headers=headers,
        )
        assert chapter_response.status_code == status.HTTP_201_CREATED
        chapter_id = chapter_response.json()["id"]
        return book_id, chapter_id

    def test_create_node_rejects_word_meanings_when_level_not_in_enabled_rollout(self, client):
        headers = _register_and_login(client)
        book_id, chapter_id = self._create_leaf_parent(
            client,
            headers,
            book_metadata={
                "word_meanings": {
                    "enabled_levels": ["Chapter"],
                }
            },
        )

        create_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Rollout-disabled Verse",
                "has_content": True,
                "content_data": {
                    "word_meanings": {
                        "version": "1.0",
                        "rows": [
                            {
                                "id": "wm_1301",
                                "order": 1,
                                "source": {
                                    "language": "sa",
                                    "script_text": "धर्म",
                                },
                                "meanings": {
                                    "en": {"text": "dharma"},
                                },
                            }
                        ],
                    }
                },
            },
            headers=headers,
        )

        assert create_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        assert "not enabled for this level" in str(create_response.json().get("detail", ""))

    def test_create_node_accepts_word_meanings_when_level_in_enabled_rollout(self, client):
        headers = _register_and_login(client)
        book_id, chapter_id = self._create_leaf_parent(
            client,
            headers,
            book_metadata={
                "word_meanings": {
                    "enabled_levels": ["Verse"],
                }
            },
        )

        create_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Rollout-enabled Verse",
                "has_content": True,
                "content_data": {
                    "word_meanings": {
                        "version": "1.0",
                        "rows": [
                            {
                                "id": "wm_1302",
                                "order": 1,
                                "source": {
                                    "language": "sa",
                                    "script_text": "योग",
                                },
                                "meanings": {
                                    "en": {"text": "union"},
                                },
                            }
                        ],
                    }
                },
            },
            headers=headers,
        )

        assert create_response.status_code == status.HTTP_201_CREATED

    def test_create_node_rejects_word_meanings_missing_required_en(self, client):
        headers = _register_and_login(client)
        book_id, chapter_id = self._create_leaf_parent(client, headers)

        create_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse 1",
                "has_content": True,
                "content_data": {
                    "word_meanings": {
                        "version": "1.0",
                        "rows": [
                            {
                                "id": "wm_001",
                                "order": 1,
                                "source": {
                                    "language": "sa",
                                    "script_text": "धर्मक्षेत्रे",
                                },
                                "meanings": {
                                    "hi": {"text": "धर्म क्षेत्र में"},
                                },
                            }
                        ],
                    }
                },
            },
            headers=headers,
        )

        assert create_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        detail = create_response.json().get("detail") or []
        assert any("meanings.en.text is required" in str(item.get("msg", "")) for item in detail)

    def test_create_node_rejects_invalid_word_meanings_fixture(self, client):
        headers = _register_and_login(client)
        book_id, chapter_id = self._create_leaf_parent(client, headers)
        invalid_fixture = _load_word_meanings_fixture("invalid_missing_required_en.json")

        create_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Fixture Invalid Verse",
                "has_content": True,
                "content_data": invalid_fixture,
            },
            headers=headers,
        )

        assert create_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        detail = create_response.json().get("detail") or []
        assert any("meanings.en.text is required" in str(item.get("msg", "")) for item in detail)

    def test_create_node_rejects_word_meanings_rows_not_array(self, client):
        headers = _register_and_login(client)
        book_id, chapter_id = self._create_leaf_parent(client, headers)

        create_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse 1",
                "has_content": True,
                "content_data": {
                    "word_meanings": {
                        "version": "1.0",
                        "rows": {"id": "wm_001"},
                    }
                },
            },
            headers=headers,
        )

        assert create_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        detail = create_response.json().get("detail") or []
        assert any("rows must be an array" in str(item.get("msg", "")) for item in detail)

    def test_patch_node_rejects_word_meanings_html_content(self, client):
        headers = _register_and_login(client)
        book_id, chapter_id = self._create_leaf_parent(client, headers)

        create_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse 1",
                "has_content": True,
                "content_data": {
                    "word_meanings": {
                        "version": "1.0",
                        "rows": [
                            {
                                "id": "wm_001",
                                "order": 1,
                                "source": {
                                    "language": "sa",
                                    "script_text": "धर्मक्षेत्रे",
                                },
                                "meanings": {
                                    "en": {"text": "in the field of dharma"},
                                },
                            }
                        ],
                    }
                },
            },
            headers=headers,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        node_id = create_response.json()["id"]

        patch_response = client.patch(
            f"/api/content/nodes/{node_id}",
            json={
                "content_data": {
                    "word_meanings": {
                        "version": "1.0",
                        "rows": [
                            {
                                "id": "wm_001",
                                "order": 1,
                                "source": {
                                    "language": "sa",
                                    "script_text": "धर्मक्षेत्रे",
                                },
                                "meanings": {
                                    "en": {"text": "<b>bad html</b>"},
                                },
                            }
                        ],
                    }
                }
            },
            headers=headers,
        )

        assert patch_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        detail = patch_response.json().get("detail") or []
        assert any("must not contain HTML" in str(item.get("msg", "")) for item in detail)

    def test_word_meanings_roundtrip_preserves_order_and_unknown_keys(self, client):
        headers = _register_and_login(client)
        book_id, chapter_id = self._create_leaf_parent(client, headers)

        source_payload = {
            "word_meanings": {
                "version": "1.0",
                "future_metadata": {
                    "v_next_enabled": True,
                    "layout_hint": "compact",
                },
                "rows": [
                    {
                        "id": "wm_010",
                        "order": 10,
                        "source": {
                            "language": "sa",
                            "script_text": "कर्मण्येव",
                            "transliteration": {
                                "iast": "karmaṇyeva",
                                "future_scheme_x": "karmanyeva",
                            },
                        },
                        "meanings": {
                            "en": {"text": "only in action"},
                        },
                        "future_row_field": {
                            "confidence": 0.92,
                        },
                    },
                    {
                        "id": "wm_001",
                        "order": 1,
                        "source": {
                            "language": "sa",
                            "script_text": "अधिकारः",
                        },
                        "meanings": {
                            "en": {"text": "entitlement"},
                        },
                    },
                ],
            }
        }

        create_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse with word meanings",
                "has_content": True,
                "content_data": source_payload,
            },
            headers=headers,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        node_id = create_response.json()["id"]

        get_response = client.get(f"/api/content/nodes/{node_id}", headers=headers)
        assert get_response.status_code == status.HTTP_200_OK
        stored = get_response.json()["content_data"]["word_meanings"]

        assert [row["id"] for row in stored["rows"]] == ["wm_010", "wm_001"]
        assert stored["future_metadata"]["v_next_enabled"] is True
        assert stored["rows"][0]["future_row_field"]["confidence"] == 0.92
        assert (
            stored["rows"][0]["source"]["transliteration"]["future_scheme_x"]
            == "karmanyeva"
        )

    def test_word_meanings_patch_persists_forward_compatible_keys(self, client):
        headers = _register_and_login(client)
        book_id, chapter_id = self._create_leaf_parent(client, headers)

        create_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Verse 1",
                "has_content": True,
                "content_data": {
                    "word_meanings": {
                        "version": "1.0",
                        "rows": [
                            {
                                "id": "wm_001",
                                "order": 1,
                                "source": {
                                    "language": "sa",
                                    "script_text": "धर्मक्षेत्रे",
                                },
                                "meanings": {
                                    "en": {"text": "in the field of dharma"},
                                },
                            }
                        ],
                    }
                },
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        node_id = create_response.json()["id"]

        patch_payload = {
            "content_data": {
                "word_meanings": {
                    "version": "1.0",
                    "runtime_hints": {
                        "preferred_alignment": "left",
                    },
                    "rows": [
                        {
                            "id": "wm_001",
                            "order": 1,
                            "source": {
                                "language": "sa",
                                "script_text": "धर्मक्षेत्रे",
                                "transliteration": {
                                    "iast": "dharmakṣetre",
                                    "scheme_future": "dharmakshetre",
                                },
                            },
                            "meanings": {
                                "en": {"text": "in the field of dharma"},
                            },
                            "future_row_field": {
                                "note": "keep-me",
                            },
                        }
                    ],
                }
            }
        }

        patch_response = client.patch(
            f"/api/content/nodes/{node_id}",
            json=patch_payload,
            headers=headers,
        )
        assert patch_response.status_code == status.HTTP_200_OK

        get_response = client.get(f"/api/content/nodes/{node_id}", headers=headers)
        assert get_response.status_code == status.HTTP_200_OK
        stored = get_response.json()["content_data"]["word_meanings"]

        assert stored["runtime_hints"]["preferred_alignment"] == "left"
        assert stored["rows"][0]["future_row_field"]["note"] == "keep-me"
        assert (
            stored["rows"][0]["source"]["transliteration"]["scheme_future"]
            == "dharmakshetre"
        )

    def test_legacy_word_meanings_are_normalized_to_rows_with_iast_sources(self, client):
        normalized = _validate_word_meanings_content_data(
            {
                "word_meanings": {
                    "english": (
                        "1. dharmaj~naH = knower of dharma; "
                        "2. kR^itaj~naH = grateful; "
                        "3. tapasvii = ascetic"
                    )
                }
            }
        )

        assert normalized is not None
        word_meanings = normalized["word_meanings"]
        assert word_meanings["version"] == "1.0"
        rows = word_meanings["rows"]
        assert len(rows) == 3
        assert rows[0]["source"]["transliteration"]["iast"] == "dharmajñaḥ"
        assert rows[0]["source"]["script_text"] == "धर्मज्ञः"
        assert rows[1]["source"]["transliteration"]["iast"] == "kṛtajñaḥ"
        assert rows[1]["source"]["script_text"] == "कृतज्ञः"
        assert rows[2]["source"]["transliteration"]["iast"] == "tapasvī"
        assert rows[2]["source"]["script_text"] == "तपस्वी"
        assert rows[2]["meanings"]["en"]["text"] == "ascetic"

    def test_create_node_accepts_legacy_word_meanings_semicolon_payload(self, client):
        headers = _register_and_login(client)
        book_id, chapter_id = self._create_leaf_parent(client, headers)

        create_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Legacy WM Verse",
                "has_content": True,
                "content_data": {
                    "word_meanings": {
                        "english": "1. dharmaj~naH = knower of dharma; 2. tapasvii = ascetic"
                    }
                },
            },
            headers=headers,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        node_id = create_response.json()["id"]

        get_response = client.get(f"/api/content/nodes/{node_id}", headers=headers)
        assert get_response.status_code == status.HTTP_200_OK
        rows = get_response.json()["content_data"]["word_meanings"]["rows"]
        assert rows[0]["source"]["transliteration"]["iast"] == "dharmajñaḥ"
        assert rows[0]["source"]["script_text"] == "धर्मज्ञः"
        assert rows[1]["source"]["transliteration"]["iast"] == "tapasvī"
        assert rows[1]["meanings"]["en"]["text"] == "ascetic"

    def test_search_matches_word_meanings_source_and_meanings(self, client):
        headers = _register_and_login(client)
        book_id, chapter_id = self._create_leaf_parent(client, headers)

        create_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "Searchable Verse",
                "has_content": True,
                "content_data": {
                    "word_meanings": {
                        "version": "1.0",
                        "rows": [
                            {
                                "id": "wm_001",
                                "order": 1,
                                "source": {
                                    "language": "sa",
                                    "script_text": "शब्दपरीक्षणम्",
                                    "transliteration": {
                                        "hk": "wm10sourceascii",
                                    },
                                },
                                "meanings": {
                                    "en": {"text": "wm10meaningenglish"},
                                    "hi": {"text": "wm10meaninghindi"},
                                },
                            }
                        ],
                    }
                },
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        node_id = create_response.json()["id"]

        script_search = client.get(
            "/api/search",
            params={"q": "शब्दपरीक्षणम्", "book_id": book_id},
            headers=headers,
        )
        assert script_search.status_code == status.HTTP_200_OK
        script_results = script_search.json().get("results") or []
        assert any(item.get("node", {}).get("id") == node_id for item in script_results)

        transliteration_search = client.get(
            "/api/search",
            params={"q": "wm10sourceascii", "book_id": book_id},
            headers=headers,
        )
        assert transliteration_search.status_code == status.HTTP_200_OK
        transliteration_results = transliteration_search.json().get("results") or []
        assert any(item.get("node", {}).get("id") == node_id for item in transliteration_results)

        meaning_search = client.get(
            "/api/search",
            params={"q": "wm10meaninghindi", "book_id": book_id},
            headers=headers,
        )
        assert meaning_search.status_code == status.HTTP_200_OK
        meaning_results = meaning_search.json().get("results") or []
        assert any(item.get("node", {}).get("id") == node_id for item in meaning_results)

    def test_word_meanings_e2e_author_save_browse_search_export_flow(self, client):
        headers = _register_and_login(client)
        book_id, chapter_id = self._create_leaf_parent(client, headers)
        valid_fixture = _load_word_meanings_fixture("valid_multilingual.json")

        create_response = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "parent_node_id": chapter_id,
                "level_name": "Verse",
                "level_order": 2,
                "sequence_number": "1",
                "title_english": "WM12 E2E Verse",
                "has_content": True,
                "content_data": valid_fixture,
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        node_id = create_response.json()["id"]

        draft_response = client.post(
            "/api/draft-books",
            json={
                "title": "WM12 E2E Draft",
                "description": "Author save browse search export flow",
                "section_structure": {
                    "front": [],
                    "body": [
                        {
                            "title": "Imported Source Book",
                            "source_book_id": book_id,
                            "source_scope": "book",
                            "order": 1,
                        }
                    ],
                    "back": [],
                },
            },
            headers=headers,
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            json={},
            headers=headers,
        )
        assert publish_response.status_code == status.HTTP_201_CREATED
        snapshot_id = publish_response.json()["snapshot"]["id"]

        browse_response = client.get(
            f"/api/edition-snapshots/{snapshot_id}/render-artifact",
            headers=headers,
        )
        assert browse_response.status_code == status.HTTP_200_OK
        body_blocks = browse_response.json().get("sections", {}).get("body", [])

        matching_blocks = [block for block in body_blocks if block.get("source_node_id") == node_id]
        assert matching_blocks
        word_rows = matching_blocks[0].get("content", {}).get("word_meanings_rows", [])
        assert word_rows
        assert word_rows[0]["id"] == "wm_1201"
        assert word_rows[0]["resolved_meaning"]["text"] == "wm12meaningenglish"

        search_source_response = client.get(
            "/api/search",
            params={"q": "wm12sourceascii", "book_id": book_id},
            headers=headers,
        )
        assert search_source_response.status_code == status.HTTP_200_OK
        source_results = search_source_response.json().get("results") or []
        assert any(item.get("node", {}).get("id") == node_id for item in source_results)

        search_meaning_response = client.get(
            "/api/search",
            params={"q": "wm12meaninghindi", "book_id": book_id},
            headers=headers,
        )
        assert search_meaning_response.status_code == status.HTTP_200_OK
        meaning_results = search_meaning_response.json().get("results") or []
        assert any(item.get("node", {}).get("id") == node_id for item in meaning_results)

        export_response = client.get(
            f"/api/edition-snapshots/{snapshot_id}/export/pdf",
            headers=headers,
        )
        assert export_response.status_code == status.HTTP_200_OK
        assert export_response.content.startswith(b"%PDF")


class TestBookJsonExport:
    """Integration tests for GET /api/content/books/{book_id}/export/json."""

    def test_export_plain_book_returns_valid_payload(self, client):
        """Export a book whose nodes own their content directly (no references)."""
        headers = _register_and_login_as_admin(client)

        schema_resp = client.post(
            "/api/content/schemas",
            json={"name": f"Flat {uuid4().hex[:6]}", "description": "flat", "levels": ["Verse"]},
            headers=headers,
        )
        assert schema_resp.status_code == status.HTTP_201_CREATED
        schema_id = schema_resp.json()["id"]

        book_resp = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Export Test Book {uuid4().hex[:6]}",
                "book_code": f"export-test-{uuid4().hex[:6]}",
                "language_primary": "english",
            },
            headers=headers,
        )
        assert book_resp.status_code == status.HTTP_201_CREATED
        book_id = book_resp.json()["id"]

        node1_resp = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "level_name": "Verse",
                "level_order": 1,
                "sequence_number": "1",
                "has_content": True,
                "content_data": {"en": "First verse content"},
            },
            headers=headers,
        )
        assert node1_resp.status_code == status.HTTP_201_CREATED
        node1_id = node1_resp.json()["id"]

        node2_resp = client.post(
            "/api/content/nodes",
            json={
                "book_id": book_id,
                "level_name": "Verse",
                "level_order": 1,
                "sequence_number": "2",
                "has_content": True,
                "content_data": {"en": "Second verse content"},
            },
            headers=headers,
        )
        assert node2_resp.status_code == status.HTTP_201_CREATED
        node2_id = node2_resp.json()["id"]

        export_resp = client.get(f"/api/content/books/{book_id}/export/json", headers=headers)
        assert export_resp.status_code == status.HTTP_200_OK

        payload = export_resp.json()
        assert payload["schema_version"] == "hsp-book-json-v1"
        assert "schema" in payload
        assert payload["book"]["book_name"] is not None

        nodes = payload["nodes"]
        assert len(nodes) == 2

        by_id = {n["node_id"]: n for n in nodes}
        assert by_id[node1_id]["has_content"] is True
        assert by_id[node1_id]["content_data"].get("en") == "First verse content"
        assert by_id[node2_id]["content_data"].get("en") == "Second verse content"

    def test_export_inlines_referenced_node_content(self, client):
        """Nodes that reference content from another book must export the resolved content,
        not the empty shell stored on the reference node itself."""
        headers = _register_and_login_as_admin(client)

        schema_resp = client.post(
            "/api/content/schemas",
            json={"name": f"Flat {uuid4().hex[:6]}", "description": "flat", "levels": ["Verse"]},
            headers=headers,
        )
        assert schema_resp.status_code == status.HTTP_201_CREATED
        schema_id = schema_resp.json()["id"]

        # Source book — owns the actual content
        src_book_resp = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Source Book {uuid4().hex[:6]}",
                "book_code": f"src-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert src_book_resp.status_code == status.HTTP_201_CREATED
        src_book_id = src_book_resp.json()["id"]

        src_node_resp = client.post(
            "/api/content/nodes",
            json={
                "book_id": src_book_id,
                "level_name": "Verse",
                "level_order": 1,
                "sequence_number": "1",
                "has_content": True,
                "content_data": {"sa": "source sanskrit", "en": "source english"},
                "source_attribution": "Test Source",
                "license_type": "CC-BY-SA-4.0",
            },
            headers=headers,
        )
        assert src_node_resp.status_code == status.HTTP_201_CREATED
        src_node_id = src_node_resp.json()["id"]

        # Reference book — nodes point at the source book's nodes via referenced_node_id
        ref_book_resp = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Reference Book {uuid4().hex[:6]}",
                "book_code": f"ref-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert ref_book_resp.status_code == status.HTTP_201_CREATED
        ref_book_id = ref_book_resp.json()["id"]

        # Use the insert-references API which creates reference nodes
        insert_resp = client.post(
            f"/api/content/books/{ref_book_id}/insert-references",
            json={"node_ids": [src_node_id]},
            headers=headers,
        )
        assert insert_resp.status_code == status.HTTP_200_OK
        ref_node_id = insert_resp.json()["created_ids"][0]

        # Export the reference book
        export_resp = client.get(f"/api/content/books/{ref_book_id}/export/json", headers=headers)
        assert export_resp.status_code == status.HTTP_200_OK

        payload = export_resp.json()
        nodes = payload["nodes"]
        assert len(nodes) == 1

        exported_node = nodes[0]
        assert exported_node["node_id"] == ref_node_id

        # The key assertion: content must be inlined from the source node
        assert exported_node["has_content"] is True, (
            "Export should inline has_content=True from the referenced source node"
        )
        assert exported_node["content_data"].get("en") == "source english", (
            "Export should inline English content from the referenced source node"
        )
        assert exported_node["content_data"].get("sa") == "source sanskrit", (
            "Export should inline Sanskrit content from the referenced source node"
        )
        assert exported_node["source_attribution"] == "Test Source"

        # referenced_node_id must be cleared — DB-local IDs are meaningless on another system
        assert exported_node["referenced_node_id"] is None, (
            "Export should clear referenced_node_id so round-trip import works"
        )

    def test_export_includes_book_summary_from_metadata_binding(self, client):
        """Book-level preview summary text stored in metadata bindings should be exported."""
        headers = _register_and_login_as_admin(client)

        schema_resp = client.post(
            "/api/content/schemas",
            json={"name": f"Flat {uuid4().hex[:6]}", "description": "flat", "levels": ["Verse"]},
            headers=headers,
        )
        assert schema_resp.status_code == status.HTTP_201_CREATED
        schema_id = schema_resp.json()["id"]

        book_resp = client.post(
            "/api/content/books",
            json={
                "schema_id": schema_id,
                "book_name": f"Summary Book {uuid4().hex[:6]}",
                "book_code": f"summary-{uuid4().hex[:6]}",
                "language_primary": "sanskrit",
            },
            headers=headers,
        )
        assert book_resp.status_code == status.HTTP_201_CREATED
        book_id = book_resp.json()["id"]

        db = SessionLocal()
        try:
            binding = MetadataBinding(
                entity_type="book",
                entity_id=book_id,
                scope_type="book",
                category_id=None,
                property_overrides={
                    "english": "Seven stages of knowledge summary",
                    "sanskrit": "सप्त ज्ञानभूमिकाः",
                    "transliteration": "sapta jnanabhumikah",
                },
                unset_overrides=[],
            )
            db.add(binding)
            db.commit()
        finally:
            db.close()

        export_resp = client.get(f"/api/content/books/{book_id}/export/json", headers=headers)
        assert export_resp.status_code == status.HTTP_200_OK

        metadata = export_resp.json()["book"]["metadata"]
        assert metadata.get("summary_english") == "Seven stages of knowledge summary"
        assert metadata.get("summary_sanskrit") == "सप्त ज्ञानभूमिकाः"
        assert metadata.get("summary_transliteration") == "sapta jnanabhumikah"
        assert metadata.get("english") == "Seven stages of knowledge summary"
