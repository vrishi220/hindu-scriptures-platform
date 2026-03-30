from uuid import uuid4

from fastapi import status


def _register_and_login(client, prefix: str = "rend"):
    suffix = uuid4().hex[:8]
    email = f"{prefix}_{suffix}@example.com"
    password = "StrongPass123!"

    register_response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "username": f"{prefix}_{suffix}",
            "full_name": "Content Renditions Test User",
        },
    )
    assert register_response.status_code == status.HTTP_201_CREATED

    login_response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert login_response.status_code == status.HTTP_200_OK
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_book_and_leaf_node(client, headers):
    schema_response = client.post(
        "/api/content/schemas",
        json={
            "name": f"Renditions Schema {uuid4().hex[:6]}",
            "description": "Schema for rendition tests",
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
            "book_name": f"Renditions Book {uuid4().hex[:6]}",
            "book_code": f"renditions-{uuid4().hex[:6]}",
            "language_primary": "sanskrit",
            "status": "published",
            "visibility": "public",
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
            "referenced_node_id": None,
            "level_name": "Chapter",
            "level_order": 1,
            "sequence_number": "1",
            "title_english": "Chapter 1",
            "has_content": False,
            "content_data": None,
            "summary_data": None,
            "metadata_json": {},
            "source_attribution": None,
            "license_type": "CC-BY-SA-4.0",
            "original_source_url": None,
            "tags": [],
        },
        headers=headers,
    )
    assert chapter_response.status_code == status.HTTP_201_CREATED
    chapter_id = chapter_response.json()["id"]

    node_response = client.post(
        "/api/content/nodes",
        json={
            "book_id": book_id,
            "parent_node_id": chapter_id,
            "referenced_node_id": None,
            "level_name": "Verse",
            "level_order": 2,
            "sequence_number": "1",
            "title_english": "Verse 1",
            "has_content": True,
            "content_data": {
                "basic": {
                    "translation": "Test verse content",
                }
            },
            "summary_data": None,
            "metadata_json": {},
            "source_attribution": None,
            "license_type": "CC-BY-SA-4.0",
            "original_source_url": None,
            "tags": [],
        },
        headers=headers,
    )
    assert node_response.status_code == status.HTTP_201_CREATED
    return node_response.json()["id"]


def test_content_renditions_crud(client):
    headers = _register_and_login(client)
    node_id = _create_book_and_leaf_node(client, headers)

    author_response = client.post(
        "/api/content/commentary/authors",
        json={"name": f"Author {uuid4().hex[:6]}"},
        headers=headers,
    )
    assert author_response.status_code == status.HTTP_201_CREATED
    author_id = author_response.json()["id"]

    work_response = client.post(
        "/api/content/commentary/works",
        json={"title": f"Work {uuid4().hex[:6]}", "author_id": author_id},
        headers=headers,
    )
    assert work_response.status_code == status.HTTP_201_CREATED
    work_id = work_response.json()["id"]

    create_response = client.post(
        f"/api/content/nodes/{node_id}/renditions",
        json={
            "node_id": node_id,
            "rendition_type": "translation",
            "author_id": author_id,
            "work_id": work_id,
            "content_text": "This is a translation",
            "language_code": "en",
            "script_code": "latn",
            "display_order": 1,
            "metadata": {"source": "test"},
        },
        headers=headers,
    )
    assert create_response.status_code == status.HTTP_201_CREATED
    created = create_response.json()
    rendition_id = created["id"]
    assert created["rendition_type"] == "translation"

    list_response = client.get(
        f"/api/content/nodes/{node_id}/renditions?rendition_type=translation&language_code=en",
        headers=headers,
    )
    assert list_response.status_code == status.HTTP_200_OK
    rows = list_response.json()
    assert len(rows) == 1
    assert rows[0]["id"] == rendition_id

    update_response = client.patch(
        f"/api/content/nodes/{node_id}/renditions/{rendition_id}",
        json={"rendition_type": "commentary", "content_text": "Updated commentary"},
        headers=headers,
    )
    assert update_response.status_code == status.HTTP_200_OK
    updated = update_response.json()
    assert updated["rendition_type"] == "commentary"
    assert updated["content_text"] == "Updated commentary"

    delete_response = client.delete(
        f"/api/content/nodes/{node_id}/renditions/{rendition_id}",
        headers=headers,
    )
    assert delete_response.status_code == status.HTTP_200_OK

    list_after_delete = client.get(
        f"/api/content/nodes/{node_id}/renditions",
        headers=headers,
    )
    assert list_after_delete.status_code == status.HTTP_200_OK
    assert list_after_delete.json() == []
