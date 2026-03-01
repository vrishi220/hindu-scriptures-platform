"""Integration tests for metadata governance and binding validation APIs."""

import logging
from uuid import uuid4

from fastapi import status



def _register_and_login(client):
    suffix = uuid4().hex[:8]
    email = f"meta_user_{suffix}@example.com"
    password = "StrongPass123!"

    register_payload = {
        "email": email,
        "password": password,
        "username": f"meta_user_{suffix}",
        "full_name": "Metadata Test User",
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



def _register_and_login_as_admin(client):
    from models.database import SessionLocal
    from models.user import User

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


class TestMetadataGovernance:
    def test_non_admin_cannot_create_property_definition(self, client):
        headers = _register_and_login(client)

        response = client.post(
            "/api/metadata/property-definitions",
            headers=headers,
            json={
                "internal_name": f"meta_key_{uuid4().hex[:8]}",
                "display_name": "Meta Key",
                "data_type": "text",
                "is_required": False,
            },
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_admin_can_create_property_and_category(self, client):
        admin_headers = _register_and_login_as_admin(client)
        suffix = uuid4().hex[:8]

        prop_response = client.post(
            "/api/metadata/property-definitions",
            headers=admin_headers,
            json={
                "internal_name": f"chapter_label_{suffix}",
                "display_name": "Chapter Label",
                "data_type": "text",
                "default_value": "Intro",
                "is_required": True,
            },
        )
        assert prop_response.status_code == status.HTTP_201_CREATED
        prop_id = prop_response.json()["id"]

        cat_response = client.post(
            "/api/metadata/categories",
            headers=admin_headers,
            json={
                "name": f"chapter_category_{suffix}",
                "description": "Category for chapter metadata",
                "applicable_scopes": ["book", "level"],
                "parent_category_ids": [],
                "properties": [
                    {
                        "property_definition_id": prop_id,
                        "order": 1,
                        "is_required_override": True,
                    }
                ],
            },
        )
        assert cat_response.status_code == status.HTTP_201_CREATED
        cat_id = cat_response.json()["id"]

        effective_response = client.get(
            f"/api/metadata/categories/{cat_id}/effective-properties",
            headers=admin_headers,
        )
        assert effective_response.status_code == status.HTTP_200_OK
        effective_payload = effective_response.json()
        assert effective_payload["category_id"] == cat_id
        assert any(prop["property_internal_name"] == f"chapter_label_{suffix}" for prop in effective_payload["properties"])


class TestMetadataPublishValidation:
    def test_binding_rejects_missing_required_property_value(self, client):
        admin_headers = _register_and_login_as_admin(client)
        editor_headers = _register_and_login(client)
        suffix = uuid4().hex[:8]

        draft_response = client.post(
            "/api/draft-books",
            headers=editor_headers,
            json={
                "title": f"Required Metadata Draft {suffix}",
                "description": "Draft for required metadata validation",
                "section_structure": {"front": [], "body": [], "back": []},
            },
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        prop_response = client.post(
            "/api/metadata/property-definitions",
            headers=admin_headers,
            json={
                "internal_name": f"required_prop_{suffix}",
                "display_name": "Required Prop",
                "data_type": "text",
                "is_required": False,
                "default_value": None,
            },
        )
        assert prop_response.status_code == status.HTTP_201_CREATED
        prop_id = prop_response.json()["id"]

        category_response = client.post(
            "/api/metadata/categories",
            headers=admin_headers,
            json={
                "name": f"required_category_{suffix}",
                "description": "Category with required override",
                "applicable_scopes": ["book"],
                "parent_category_ids": [],
                "properties": [
                    {
                        "property_definition_id": prop_id,
                        "order": 1,
                        "is_required_override": True,
                    }
                ],
            },
        )
        assert category_response.status_code == status.HTTP_201_CREATED
        category_id = category_response.json()["id"]

        binding_response = client.post(
            f"/api/metadata/draft-books/{draft_id}/metadata-binding",
            headers=editor_headers,
            json={
                "category_id": category_id,
                "property_overrides": {},
                "unset_overrides": [],
            },
        )
        assert binding_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        assert "required property" in str(binding_response.json().get("detail", "")).lower()

    def test_publish_blocks_when_category_scope_invalid_for_binding(self, client):
        admin_headers = _register_and_login_as_admin(client)
        editor_headers = _register_and_login(client)
        suffix = uuid4().hex[:8]

        draft_response = client.post(
            "/api/draft-books",
            headers=editor_headers,
            json={
                "title": f"Metadata Draft {suffix}",
                "description": "Draft for metadata validation",
                "section_structure": {"front": [], "body": [], "back": []},
            },
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        category_response = client.post(
            "/api/metadata/categories",
            headers=admin_headers,
            json={
                "name": f"book_only_category_{suffix}",
                "description": "Book-only category",
                "applicable_scopes": ["book"],
                "parent_category_ids": [],
                "properties": [],
            },
        )
        assert category_response.status_code == status.HTTP_201_CREATED
        category_id = category_response.json()["id"]

        level_binding_response = client.post(
            f"/api/metadata/draft-books/{draft_id}/levels/1/metadata-binding",
            headers=editor_headers,
            json={
                "category_id": category_id,
                "scope_key": "verse",
                "property_overrides": {},
                "unset_overrides": [],
            },
        )
        assert level_binding_response.status_code == status.HTTP_200_OK

        publish_response = client.post(
            f"/api/draft-books/{draft_id}/publish",
            headers=editor_headers,
            json={},
        )
        assert publish_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        assert "metadata validation" in str(publish_response.json().get("detail", "")).lower()


class TestMetadataAuditEvents:
    def test_governance_endpoints_emit_audit_events(self, client, caplog):
        admin_headers = _register_and_login_as_admin(client)
        suffix = uuid4().hex[:8]

        caplog.set_level(logging.INFO, logger="api.metadata")

        create_prop = client.post(
            "/api/metadata/property-definitions",
            headers=admin_headers,
            json={
                "internal_name": f"audit_prop_{suffix}",
                "display_name": "Audit Prop",
                "data_type": "text",
                "default_value": "d",
                "is_required": False,
            },
        )
        assert create_prop.status_code == status.HTTP_201_CREATED
        prop_id = create_prop.json()["id"]

        update_prop = client.patch(
            f"/api/metadata/property-definitions/{prop_id}",
            headers=admin_headers,
            json={"display_name": "Audit Prop Updated"},
        )
        assert update_prop.status_code == status.HTTP_200_OK

        create_cat = client.post(
            "/api/metadata/categories",
            headers=admin_headers,
            json={
                "name": f"audit_category_{suffix}",
                "description": "Audit category",
                "applicable_scopes": ["book"],
                "parent_category_ids": [],
                "properties": [],
            },
        )
        assert create_cat.status_code == status.HTTP_201_CREATED
        cat_id = create_cat.json()["id"]

        publish_cat = client.post(
            f"/api/metadata/categories/{cat_id}/publish",
            headers=admin_headers,
        )
        assert publish_cat.status_code == status.HTTP_200_OK

        delete_prop = client.delete(
            f"/api/metadata/property-definitions/{prop_id}",
            headers=admin_headers,
        )
        assert delete_prop.status_code == status.HTTP_204_NO_CONTENT

        messages = "\n".join(record.getMessage() for record in caplog.records)
        assert "metadata.property_definition.created" in messages
        assert "metadata.property_definition.updated" in messages
        assert "metadata.category.created" in messages
        assert "metadata.category.published" in messages
        assert "metadata.property_definition.deleted" in messages

    def test_binding_endpoints_emit_audit_events(self, client, caplog):
        admin_headers = _register_and_login_as_admin(client)
        editor_headers = _register_and_login(client)
        suffix = uuid4().hex[:8]

        draft_response = client.post(
            "/api/draft-books",
            headers=editor_headers,
            json={
                "title": f"Audit Binding Draft {suffix}",
                "description": "Draft for binding audit",
                "section_structure": {"front": [], "body": [], "back": []},
            },
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        category_response = client.post(
            "/api/metadata/categories",
            headers=admin_headers,
            json={
                "name": f"audit_binding_category_{suffix}",
                "description": "Binding category",
                "applicable_scopes": ["book", "level", "node"],
                "parent_category_ids": [],
                "properties": [],
            },
        )
        assert category_response.status_code == status.HTTP_201_CREATED
        category_id = category_response.json()["id"]

        caplog.set_level(logging.INFO, logger="api.metadata")

        book_binding = client.post(
            f"/api/metadata/draft-books/{draft_id}/metadata-binding",
            headers=editor_headers,
            json={
                "category_id": category_id,
                "property_overrides": {},
                "unset_overrides": [],
            },
        )
        assert book_binding.status_code == status.HTTP_200_OK

        patch_binding = client.patch(
            f"/api/metadata/draft-books/{draft_id}/metadata-binding",
            headers=editor_headers,
            json={
                "property_overrides": {},
                "unset_overrides": [],
            },
        )
        assert patch_binding.status_code == status.HTTP_200_OK

        level_binding = client.post(
            f"/api/metadata/draft-books/{draft_id}/levels/1/metadata-binding",
            headers=editor_headers,
            json={
                "category_id": category_id,
                "scope_key": "verse",
                "property_overrides": {},
                "unset_overrides": [],
            },
        )
        assert level_binding.status_code == status.HTTP_200_OK

        node_binding = client.post(
            f"/api/metadata/draft-books/{draft_id}/sections/1/nodes/1/metadata-binding",
            headers=editor_headers,
            json={
                "category_id": category_id,
                "property_overrides": {},
                "unset_overrides": [],
            },
        )
        assert node_binding.status_code == status.HTTP_200_OK

        messages = "\n".join(record.getMessage() for record in caplog.records)
        assert "metadata.binding.upserted" in messages
        assert "metadata.binding.patched" in messages


class TestMetadataDeprecationSemantics:
    def test_deprecated_property_cannot_be_assigned_to_new_category(self, client):
        admin_headers = _register_and_login_as_admin(client)
        suffix = uuid4().hex[:8]

        prop_response = client.post(
            "/api/metadata/property-definitions",
            headers=admin_headers,
            json={
                "internal_name": f"deprecated_prop_{suffix}",
                "display_name": "Deprecated Prop",
                "data_type": "text",
                "default_value": "x",
                "is_required": False,
            },
        )
        assert prop_response.status_code == status.HTTP_201_CREATED
        prop_id = prop_response.json()["id"]

        deprecate_response = client.post(
            f"/api/metadata/property-definitions/{prop_id}/deprecate",
            headers=admin_headers,
        )
        assert deprecate_response.status_code == status.HTTP_200_OK
        assert deprecate_response.json()["is_deprecated"] is True
        assert deprecate_response.json().get("deprecated_at")

        category_response = client.post(
            "/api/metadata/categories",
            headers=admin_headers,
            json={
                "name": f"category_with_deprecated_prop_{suffix}",
                "description": "Should fail",
                "applicable_scopes": ["book"],
                "parent_category_ids": [],
                "properties": [
                    {
                        "property_definition_id": prop_id,
                        "order": 1,
                    }
                ],
            },
        )
        assert category_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        assert "deprecated properties" in str(category_response.json().get("detail", "")).lower()

    def test_deprecated_category_cannot_be_used_for_new_binding(self, client):
        admin_headers = _register_and_login_as_admin(client)
        editor_headers = _register_and_login(client)
        suffix = uuid4().hex[:8]

        draft_response = client.post(
            "/api/draft-books",
            headers=editor_headers,
            json={
                "title": f"Deprecated Category Draft {suffix}",
                "description": "Draft for deprecation test",
                "section_structure": {"front": [], "body": [], "back": []},
            },
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        category_response = client.post(
            "/api/metadata/categories",
            headers=admin_headers,
            json={
                "name": f"deprecated_category_{suffix}",
                "description": "Deprecated category",
                "applicable_scopes": ["book"],
                "parent_category_ids": [],
                "properties": [],
            },
        )
        assert category_response.status_code == status.HTTP_201_CREATED
        category_id = category_response.json()["id"]

        deprecate_category = client.post(
            f"/api/metadata/categories/{category_id}/deprecate",
            headers=admin_headers,
        )
        assert deprecate_category.status_code == status.HTTP_200_OK
        assert deprecate_category.json()["is_deprecated"] is True
        assert deprecate_category.json().get("deprecated_at")

        binding_response = client.post(
            f"/api/metadata/draft-books/{draft_id}/metadata-binding",
            headers=editor_headers,
            json={
                "category_id": category_id,
                "property_overrides": {},
                "unset_overrides": [],
            },
        )
        assert binding_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        assert "deprecated categories" in str(binding_response.json().get("detail", "")).lower()


class TestMetadataSystemDefaults:
    def test_seeded_system_properties_and_category_exist(self, client):
        admin_headers = _register_and_login_as_admin(client)

        properties_response = client.get(
            "/api/metadata/property-definitions",
            headers=admin_headers,
        )
        assert properties_response.status_code == status.HTTP_200_OK
        properties = properties_response.json()

        system_internal_names = {item["internal_name"] for item in properties if item.get("is_system")}
        assert {
            "render_template_key",
            "template_key",
            "level_template_key",
            "content_template_key",
            "source_language",
            "is_transliterable",
        }.issubset(system_internal_names)

        categories_response = client.get(
            "/api/metadata/categories",
            headers=admin_headers,
        )
        assert categories_response.status_code == status.HTTP_200_OK
        categories = categories_response.json()

        default_category = next(
            (item for item in categories if item.get("name") == "system_default_metadata"),
            None,
        )
        assert default_category is not None
        assert default_category.get("is_system") is True

    def test_new_draft_gets_default_metadata_binding(self, client):
        editor_headers = _register_and_login(client)

        draft_response = client.post(
            "/api/draft-books",
            headers=editor_headers,
            json={
                "title": f"Default Metadata Draft {uuid4().hex[:8]}",
                "description": "Draft for default metadata binding",
                "section_structure": {"front": [], "body": [], "back": []},
            },
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        binding_response = client.get(
            f"/api/metadata/draft-books/{draft_id}/metadata-binding",
            headers=editor_headers,
        )
        assert binding_response.status_code == status.HTTP_200_OK
        payload = binding_response.json()
        assert payload["category_name"] == "system_default_metadata"


class TestMetadataBackfillDefaults:
    def test_backfill_adds_default_binding_for_existing_draft(self, client):
        from models.database import SessionLocal
        from models.property_system import MetadataBinding
        from services.metadata_defaults import backfill_default_metadata_bindings

        editor_headers = _register_and_login(client)

        draft_response = client.post(
            "/api/draft-books",
            headers=editor_headers,
            json={
                "title": f"Backfill Metadata Draft {uuid4().hex[:8]}",
                "description": "Draft for backfill validation",
                "section_structure": {"front": [], "body": [], "back": []},
            },
        )
        assert draft_response.status_code == status.HTTP_201_CREATED
        draft_id = draft_response.json()["id"]

        db = SessionLocal()
        try:
            db.query(MetadataBinding).filter(
                MetadataBinding.entity_type == "draft_book",
                MetadataBinding.entity_id == draft_id,
                MetadataBinding.scope_type == "book",
            ).delete(synchronize_session=False)
            db.commit()

            result = backfill_default_metadata_bindings(db)
            db.commit()
            assert result.default_category_found is True
            assert result.created_bindings >= 1
        finally:
            db.close()

        binding_response = client.get(
            f"/api/metadata/draft-books/{draft_id}/metadata-binding",
            headers=editor_headers,
        )
        assert binding_response.status_code == status.HTTP_200_OK
        assert binding_response.json()["category_name"] == "system_default_metadata"
