"""Integration tests for metadata governance and binding validation APIs."""

from uuid import uuid4

from fastapi import status



def _register_and_login(client):
    suffix = uuid4().hex[:8]
    email = f"meta_user_{suffix}@example.com"
    password = "StrongPass123"

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
