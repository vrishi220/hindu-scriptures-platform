"""Strict integration tests for Phase 1 backend APIs."""

from uuid import uuid4
from types import SimpleNamespace

from api.content import create_node
from fastapi import HTTPException
from fastapi import status
from models.book import Book
from models.content_node import ContentNode
from models.database import SessionLocal
from models.schemas import ContentNodeCreate
from models.scripture_schema import ScriptureSchema
import pytest


def _register_and_login(client):
    suffix = uuid4().hex[:8]
    email = f"phase1_{suffix}@example.com"
    password = "StrongPass123"

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


class TestPhase1PreferencesIntegration:
    def test_get_and_update_preferences_authenticated(self, client):
        headers = _register_and_login(client)

        get_response = client.get("/api/preferences", headers=headers)
        assert get_response.status_code == status.HTTP_200_OK
        data = get_response.json()
        assert data["source_language"] == "en"
        assert data["transliteration_script"] == "devanagari"

        patch_payload = {
            "source_language": "en",
            "transliteration_enabled": True,
            "transliteration_script": "tamil",
            "show_roman_transliteration": False,
        }
        patch_response = client.patch("/api/preferences", json=patch_payload, headers=headers)
        assert patch_response.status_code == status.HTTP_200_OK
        updated = patch_response.json()
        assert updated["transliteration_script"] == "tamil"
        assert updated["show_roman_transliteration"] is False


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

            with pytest.raises(HTTPException) as invalid_nonleaf_content_exc:
                create_node(
                    payload=ContentNodeCreate(
                        book_id=book.id,
                        parent_node_id=kanda_id,
                        level_name="Sarga",
                        level_order=2,
                        sequence_number="1",
                        title_english="Sarga with content should fail",
                        has_content=True,
                        content_data={"basic": {"translation": "invalid"}},
                    ),
                    db=db,
                    current_user=test_user,
                )
            assert invalid_nonleaf_content_exc.value.status_code == status.HTTP_400_BAD_REQUEST
            assert "Content items can only be placed" in invalid_nonleaf_content_exc.value.detail

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

            sarga = ContentNode(
                book_id=book.id,
                parent_node_id=kanda_id,
                level_name="Sarga",
                level_order=2,
                sequence_number=1,
                title_english="Sarga 1",
                has_content=False,
                created_by=test_user.id,
                last_modified_by=test_user.id,
            )
            db.add(sarga)
            db.commit()
            db.refresh(sarga)
            sarga_id = sarga.id

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
