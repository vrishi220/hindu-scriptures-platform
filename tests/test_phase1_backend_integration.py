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
    def test_private_draft_visible_only_to_owner_until_published(self, client):
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
        assert all(item["id"] != book_id for item in list_other_before.json())

        get_other_before = client.get(f"/api/content/books/{book_id}", headers=headers_other)
        assert get_other_before.status_code == status.HTTP_404_NOT_FOUND

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
        assert pre_share_view.status_code == status.HTTP_404_NOT_FOUND

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
        assert post_delete_view.status_code == status.HTTP_404_NOT_FOUND


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
