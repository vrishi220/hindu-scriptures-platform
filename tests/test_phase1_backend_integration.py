"""Strict integration tests for Phase 1 backend APIs."""

import hashlib
import json
from uuid import uuid4
from types import SimpleNamespace

import api.content as content_api
from api.content import create_node
from fastapi import HTTPException
from fastapi import status
from models.book import Book
from models.content_node import ContentNode
from models.database import SessionLocal
from models.provenance_record import ProvenanceRecord
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


def _register_user(client):
    suffix = uuid4().hex[:8]
    email = f"phase1_reset_{suffix}@example.com"
    password = "StrongPass123"

    register_payload = {
        "email": email,
        "password": password,
        "username": f"phase1_reset_{suffix}",
        "full_name": "Phase1 Reset Test User",
    }
    register_response = client.post("/api/auth/register", json=register_payload)
    assert register_response.status_code == status.HTTP_201_CREATED
    return email, password


class TestPasswordResetIntegration:
    def test_forgot_and_reset_password_flow(self, client):
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
                "new_password": "NewStrongPass456",
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
            json={"email": email, "password": "NewStrongPass456"},
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


class TestDraftBookAndEditionSnapshotIntegration:
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
        assert [line["field"] for line in chapter_lines] == ["english"]
        assert [line["field"] for line in verse_lines] == [
            "sanskrit",
            "transliteration",
            "english",
            "text",
        ]

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
