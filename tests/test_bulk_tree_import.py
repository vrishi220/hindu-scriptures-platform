"""Test bulk tree import endpoint for scripture hierarchies."""

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from uuid import uuid4

from main import app
from models.database import SessionLocal


def _register_and_login(client):
    """Register and login a test user."""
    suffix = uuid4().hex[:8]
    email = f"tree_import_{suffix}@example.com"
    password = "TreeImportPass123!"
    
    register_response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "username": f"tree_user_{suffix}",
            "full_name": "Tree Import Test User",
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


def test_bulk_tree_import():
    """Test importing hierarchical chapter/verse tree structure."""
    client = TestClient(app)
    
    # 1. Register and login
    headers = _register_and_login(client)
    
    # 2. Create a book with schema
    schema_resp = client.post(
        "/api/content/schemas",
        json={
            "name": "Test Scripture Schema",
            "description": "Two-level: Chapter and Verse",
            "levels": ["Adhyaya", "Shloka"]
        },
        headers=headers
    )
    assert schema_resp.status_code == status.HTTP_201_CREATED
    schema_id = schema_resp.json()["id"]
    
    book_resp = client.post(
        "/api/content/books",
        json={
            "book_name": "Test Scripture",
            "book_code": f"test-scripture-{uuid4().hex[:6]}",
            "language_primary": "sanskrit",
            "schema_id": schema_id,
            "status": "published",
            "visibility": "public",
        },
        headers=headers
    )
    assert book_resp.status_code == status.HTTP_201_CREATED
    book_id = book_resp.json()["id"]
    
    # 3. Create test tree structure
    tree_data = {
        "book_id": book_id,
        "nodes": [
            {
                "level_name": "Adhyaya",
                "level_order": 0,
                "sequence_number": "1",
                "title_english": "Chapter 1",
                "title_transliteration": "Adhyaya 1",
                "has_content": False,
                "children": [
                    {
                        "level_name": "Shloka",
                        "level_order": 1,
                        "sequence_number": "1.1",
                        "title_english": "Verse 1",
                        "title_transliteration": "Shloka 1",
                        "has_content": True,
                        "content_data": {
                            "basic": {
                                "sanskrit": "पहला श्लोक",
                                "translation": "First verse"
                            }
                        }
                    },
                    {
                        "level_name": "Shloka",
                        "level_order": 1,
                        "sequence_number": "1.2",
                        "title_english": "Verse 2",
                        "title_transliteration": "Shloka 2",
                        "has_content": True,
                        "content_data": {
                            "basic": {
                                "sanskrit": "दूसरा श्लोक",
                                "translation": "Second verse"
                            }
                        }
                    }
                ]
            }
        ],
        "clear_existing": False,
        "language_code": "en",
        "license_type": "CC-BY-SA-4.0"
    }
    
    # 4. Call tree import endpoint
    import_resp = client.post(
        f"/api/content/books/{book_id}/import-tree",
        json=tree_data,
        headers=headers
    )
    
    assert import_resp.status_code == status.HTTP_201_CREATED
    result = import_resp.json()
    
    # 5. Verify response structure
    assert result["success"] is True, f"Import failed: {result}"
    assert result["book_id"] == book_id
    assert result["chapters_created"] == 1
    assert result["verses_created"] == 2
    assert result["total_nodes_created"] == 3
    assert result["errors"] == []
    
    # 6. Verify nodes were created by querying the book's tree
    nodes_resp = client.get(
        f"/api/content/books/{book_id}/tree/nested",
        headers=headers
    )
    assert nodes_resp.status_code == status.HTTP_200_OK, f"Error: {nodes_resp.text}"
    nodes = nodes_resp.json()
    
    # Should have at least the chapter we imported
    assert len(nodes) >= 1
    print("✓ Bulk tree import test passed")


def test_bulk_tree_import_with_clear():
    """Test importing tree with clear_existing flag."""
    client = TestClient(app)
    
    # 1. Register and login
    headers = _register_and_login(client)
    
    # 2. Create book with schema
    schema_resp = client.post(
        "/api/content/schemas",
        json={
            "name": "Test Schema Clear",
            "description": "Chapter and Verse",
            "levels": ["Adhyaya", "Shloka"]
        },
        headers=headers
    )
    assert schema_resp.status_code == status.HTTP_201_CREATED
    schema_id = schema_resp.json()["id"]
    
    book_resp = client.post(
        "/api/content/books",
        json={
            "book_name": "Test Scripture Clear",
            "book_code": f"test-clear-{uuid4().hex[:6]}",
            "language_primary": "sanskrit",
            "schema_id": schema_id,
            "status": "published",
            "visibility": "public",
        },
        headers=headers
    )
    assert book_resp.status_code == status.HTTP_201_CREATED
    book_id = book_resp.json()["id"]
    
    # 3. Create initial nodes
    tree_data_1 = {
        "book_id": book_id,
        "nodes": [
            {
                "level_name": "Adhyaya",
                "level_order": 0,
                "sequence_number": "1",
                "title_english": "First Chapter",
                "has_content": False,
                "children": []
            }
        ]
    }
    
    import_resp_1 = client.post(
        f"/api/content/books/{book_id}/import-tree",
        json=tree_data_1,
        headers=headers
    )
    assert import_resp_1.status_code == status.HTTP_201_CREATED
    assert import_resp_1.json()["chapters_created"] == 1
    
    # 4. Import new tree with clear_existing=True
    tree_data_2 = {
        "book_id": book_id,
        "nodes": [
            {
                "level_name": "Adhyaya",
                "level_order": 0,
                "sequence_number": "1",
                "title_english": "Replacement Chapter",
                "has_content": False,
                "children": [
                    {
                        "level_name": "Shloka",
                        "level_order": 1,
                        "title_english": "Verse in new chapter",
                        "has_content": True,
                        "children": []
                    }
                ]
            }
        ],
        "clear_existing": True
    }
    
    import_resp_2 = client.post(
        f"/api/content/books/{book_id}/import-tree",
        json=tree_data_2,
        headers=headers
    )
    assert import_resp_2.status_code == status.HTTP_201_CREATED
    result = import_resp_2.json()
    assert result["chapters_created"] == 1
    assert result["verses_created"] == 1
    
    print("✓ Bulk tree import with clear test passed")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
