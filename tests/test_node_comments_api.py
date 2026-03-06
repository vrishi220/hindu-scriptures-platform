from uuid import uuid4

from fastapi import status


def _register_and_login(client, prefix: str = "nodec"):
    suffix = uuid4().hex[:8]
    email = f"{prefix}_{suffix}@example.com"
    password = "StrongPass123!"

    register_response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "username": f"{prefix}_{suffix}",
            "full_name": "Node Comments Test User",
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
            "name": f"Node Comments Schema {uuid4().hex[:6]}",
            "description": "Schema for node comments tests",
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
            "book_name": f"Node Comments Book {uuid4().hex[:6]}",
            "book_code": f"node-comments-{uuid4().hex[:6]}",
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
    node_id = node_response.json()["id"]

    return node_id


class TestNodeCommentsApi:
    def test_node_comments_crud_happy_path(self, client):
        headers = _register_and_login(client, prefix="nodec_crud")
        node_id = _create_book_and_leaf_node(client, headers)

        create_response = client.post(
            f"/api/content/nodes/{node_id}/comments",
            json={
                "node_id": node_id,
                "content_text": "This is a root comment.",
                "language_code": "en",
                "metadata": {"source": "test"},
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        created_comment = create_response.json()
        comment_id = created_comment["id"]
        assert created_comment["node_id"] == node_id
        assert created_comment["content_text"] == "This is a root comment."
        assert created_comment["language_code"] == "en"

        reply_response = client.post(
            f"/api/content/nodes/{node_id}/comments",
            json={
                "node_id": node_id,
                "parent_comment_id": comment_id,
                "content_text": "This is a reply.",
                "language_code": "en",
            },
            headers=headers,
        )
        assert reply_response.status_code == status.HTTP_201_CREATED
        reply_comment = reply_response.json()
        assert reply_comment["parent_comment_id"] == comment_id

        list_response = client.get(f"/api/content/nodes/{node_id}/comments")
        assert list_response.status_code == status.HTTP_200_OK
        listed_comments = list_response.json()
        assert len(listed_comments) >= 2

        parent_filter_response = client.get(
            f"/api/content/nodes/{node_id}/comments",
            params={"parent_comment_id": comment_id},
        )
        assert parent_filter_response.status_code == status.HTTP_200_OK
        parent_filtered = parent_filter_response.json()
        assert len(parent_filtered) >= 1
        assert all(comment["parent_comment_id"] == comment_id for comment in parent_filtered)

        patch_response = client.patch(
            f"/api/content/nodes/{node_id}/comments/{comment_id}",
            json={
                "content_text": "Updated root comment.",
                "language_code": "hi",
            },
            headers=headers,
        )
        assert patch_response.status_code == status.HTTP_200_OK
        patched = patch_response.json()
        assert patched["content_text"] == "Updated root comment."
        assert patched["language_code"] == "hi"

        delete_response = client.delete(
            f"/api/content/nodes/{node_id}/comments/{comment_id}",
            headers=headers,
        )
        assert delete_response.status_code == status.HTTP_200_OK

    def test_non_author_cannot_edit_or_delete_comment_without_node_edit_access(self, client):
        author_headers = _register_and_login(client, prefix="nodec_author")
        other_headers = _register_and_login(client, prefix="nodec_other")
        node_id = _create_book_and_leaf_node(client, author_headers)

        create_response = client.post(
            f"/api/content/nodes/{node_id}/comments",
            json={
                "node_id": node_id,
                "content_text": "Author comment",
                "language_code": "en",
            },
            headers=author_headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        comment_id = create_response.json()["id"]

        unauthorized_patch = client.patch(
            f"/api/content/nodes/{node_id}/comments/{comment_id}",
            json={"content_text": "Malicious update"},
            headers=other_headers,
        )
        assert unauthorized_patch.status_code == status.HTTP_403_FORBIDDEN

        unauthorized_delete = client.delete(
            f"/api/content/nodes/{node_id}/comments/{comment_id}",
            headers=other_headers,
        )
        assert unauthorized_delete.status_code == status.HTTP_403_FORBIDDEN

    def test_node_comment_parent_validation(self, client):
        headers = _register_and_login(client, prefix="nodec_parent")
        node_id = _create_book_and_leaf_node(client, headers)

        invalid_parent_create = client.post(
            f"/api/content/nodes/{node_id}/comments",
            json={
                "node_id": node_id,
                "parent_comment_id": 999999,
                "content_text": "Invalid parent comment",
                "language_code": "en",
            },
            headers=headers,
        )
        assert invalid_parent_create.status_code == status.HTTP_400_BAD_REQUEST

        create_response = client.post(
            f"/api/content/nodes/{node_id}/comments",
            json={
                "node_id": node_id,
                "content_text": "Valid root comment",
                "language_code": "en",
            },
            headers=headers,
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        comment_id = create_response.json()["id"]

        self_parent_patch = client.patch(
            f"/api/content/nodes/{node_id}/comments/{comment_id}",
            json={"parent_comment_id": comment_id},
            headers=headers,
        )
        assert self_parent_patch.status_code == status.HTTP_400_BAD_REQUEST
