"""Strict integration tests for Phase 1 backend APIs."""

from uuid import uuid4

from fastapi import status


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
