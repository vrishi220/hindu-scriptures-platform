"""Unit tests for Collection Cart API (A-01: modeless shopping basket)."""

import pytest
from uuid import uuid4
from fastapi import status
from sqlalchemy.orm import Session

from models.collection_cart import CollectionCart, CollectionCartItem
from models.database import SessionLocal


def _register_and_login(client):
    """Helper: register user and return auth header."""
    suffix = uuid4().hex[:8]
    email = f"cart_user_{suffix}@example.com"
    password = "StrongPass123"

    register_payload = {
        "email": email,
        "password": password,
        "username": f"cart_{suffix}",
        "full_name": "Cart Test User",
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


class TestCollectionCartBasicOperations:
    """Test basic cart CRUD operations."""

    def test_get_my_cart_creates_cart_on_first_access(self, client):
        """GET /api/cart/me should create a cart if user has none."""
        headers = _register_and_login(client)

        # First access: should create and return empty cart
        response = client.get("/api/cart/me", headers=headers)
        if response.status_code != status.HTTP_200_OK:
            print(f"Response: {response.status_code}")
            print(f"Content: {response.text}")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["title"] == "My Collection"
        assert data["items"] == []
        assert "owner_id" in data
        assert "id" in data
        cart_id = data["id"]

        # Second access: should return same cart
        response = client.get("/api/cart/me", headers=headers)
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["id"] == cart_id

    def test_add_item_to_cart(self, client):
        """POST /api/cart/items should add item to user's cart."""
        headers = _register_and_login(client)

        # Get cart (creates one)
        response = client.get("/api/cart/me", headers=headers)
        assert response.status_code == status.HTTP_200_OK

        # Add item
        payload = {
            "item_id": 42,
            "item_type": "library_node",
            "source_book_id": 1,
            "metadata": {"section": "Chapter 1"},
        }
        response = client.post("/api/cart/items", json=payload, headers=headers)
        assert response.status_code == status.HTTP_201_CREATED
        item = response.json()
        assert item["item_id"] == 42
        assert item["item_type"] == "library_node"
        assert item["order"] == 0

    def test_add_multiple_items_ordered(self, client):
        """Items should maintain order based on insertion."""
        headers = _register_and_login(client)
        client.get("/api/cart/me", headers=headers)

        # Add first item
        response1 = client.post(
            "/api/cart/items",
            json={"item_id": 1, "item_type": "library_node"},
            headers=headers,
        )
        assert response1.json()["order"] == 0

        # Add second item
        response2 = client.post(
            "/api/cart/items",
            json={"item_id": 2, "item_type": "library_node"},
            headers=headers,
        )
        assert response2.json()["order"] == 1

        # Verify order in cart
        cart_response = client.get("/api/cart/me", headers=headers)
        items = cart_response.json()["items"]
        assert len(items) == 2
        assert items[0]["item_id"] == 1
        assert items[1]["item_id"] == 2

    def test_add_duplicate_item_fails(self, client):
        """Adding same item twice should return 409 Conflict."""
        headers = _register_and_login(client)
        client.get("/api/cart/me", headers=headers)

        payload = {"item_id": 99, "item_type": "library_node"}

        # First add succeeds
        response1 = client.post("/api/cart/items", json=payload, headers=headers)
        assert response1.status_code == status.HTTP_201_CREATED

        # Second add fails
        response2 = client.post("/api/cart/items", json=payload, headers=headers)
        assert response2.status_code == status.HTTP_409_CONFLICT
        assert "already in cart" in response2.json()["detail"].lower()

    def test_remove_item_from_cart(self, client):
        """DELETE /api/cart/items/{item_id} should remove item."""
        headers = _register_and_login(client)
        client.get("/api/cart/me", headers=headers)

        # Add item
        add_response = client.post(
            "/api/cart/items",
            json={"item_id": 77, "item_type": "library_node"},
            headers=headers,
        )
        item_id = add_response.json()["id"]

        # Verify it's there
        cart = client.get("/api/cart/me", headers=headers).json()
        assert len(cart["items"]) == 1

        # Remove it
        response = client.delete(f"/api/cart/items/{item_id}", headers=headers)
        assert response.status_code == status.HTTP_204_NO_CONTENT

        # Verify it's gone
        cart = client.get("/api/cart/me", headers=headers).json()
        assert len(cart["items"]) == 0

    def test_remove_nonexistent_item_fails(self, client):
        """DELETE on non-existent item should return 404."""
        headers = _register_and_login(client)
        response = client.delete("/api/cart/items/99999", headers=headers)
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_clear_cart(self, client):
        """DELETE /api/cart/me should clear all items."""
        headers = _register_and_login(client)
        client.get("/api/cart/me", headers=headers)

        # Add multiple items
        for i in range(3):
            client.post(
                "/api/cart/items",
                json={"item_id": i, "item_type": "library_node"},
                headers=headers,
            )

        # Verify items exist
        cart = client.get("/api/cart/me", headers=headers).json()
        assert len(cart["items"]) == 3

        # Clear cart
        response = client.delete("/api/cart/me", headers=headers)
        assert response.status_code == status.HTTP_204_NO_CONTENT

        # Verify empty
        cart = client.get("/api/cart/me", headers=headers).json()
        assert len(cart["items"]) == 0


class TestCollectionCartOwnership:
    """Test ownership isolation between users."""

    def test_users_have_separate_carts(self, client):
        """Each user should have their own isolated cart."""
        # User 1
        headers1 = _register_and_login(client)
        user1_cart = client.get("/api/cart/me", headers=headers1).json()
        user1_cart_id = user1_cart["id"]

        # User 2
        headers2 = _register_and_login(client)
        user2_cart = client.get("/api/cart/me", headers=headers2).json()
        user2_cart_id = user2_cart["id"]

        # Different cart IDs
        assert user1_cart_id != user2_cart_id

    def test_user_cannot_access_other_user_item(self, client):
        """User should not be able to remove another user's cart item."""
        # User 1 adds item
        headers1 = _register_and_login(client)
        client.get("/api/cart/me", headers=headers1)
        add_response = client.post(
            "/api/cart/items",
            json={"item_id": 123, "item_type": "library_node"},
            headers=headers1,
        )
        item_id = add_response.json()["id"]

        # User 2 tries to delete it
        headers2 = _register_and_login(client)
        response = client.delete(f"/api/cart/items/{item_id}", headers=headers2)
        assert response.status_code == status.HTTP_404_NOT_FOUND

        # Item still exists in user 1's cart
        cart1 = client.get("/api/cart/me", headers=headers1).json()
        assert len(cart1["items"]) == 1

    def test_user_cannot_access_other_user_cart_items_in_list(self, client):
        """User should only see their own cart items."""
        # User 1
        headers1 = _register_and_login(client)
        client.get("/api/cart/me", headers=headers1)
        client.post(
            "/api/cart/items",
            json={"item_id": 111, "item_type": "library_node"},
            headers=headers1,
        )
        client.post(
            "/api/cart/items",
            json={"item_id": 222, "item_type": "library_node"},
            headers=headers1,
        )

        # User 2
        headers2 = _register_and_login(client)
        client.get("/api/cart/me", headers=headers2)
        client.post(
            "/api/cart/items",
            json={"item_id": 333, "item_type": "library_node"},
            headers=headers2,
        )

        # User 1 sees only their items
        cart1 = client.get("/api/cart/me", headers=headers1).json()
        item_ids_1 = [item["item_id"] for item in cart1["items"]]
        assert set(item_ids_1) == {111, 222}

        # User 2 sees only their items
        cart2 = client.get("/api/cart/me", headers=headers2).json()
        item_ids_2 = [item["item_id"] for item in cart2["items"]]
        assert set(item_ids_2) == {333}


class TestCollectionCartMetadata:
    """Test cart metadata and attributes."""

    def test_update_cart_title(self, client):
        """PATCH /api/cart/me should update title."""
        headers = _register_and_login(client)
        client.get("/api/cart/me", headers=headers)

        response = client.patch(
            "/api/cart/me",
            json={"title": "My Sacred Verses"},
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["title"] == "My Sacred Verses"

        # Verify persistence
        cart = client.get("/api/cart/me", headers=headers).json()
        assert cart["title"] == "My Sacred Verses"

    def test_update_cart_description(self, client):
        """PATCH /api/cart/me should update description."""
        headers = _register_and_login(client)
        client.get("/api/cart/me", headers=headers)

        response = client.patch(
            "/api/cart/me",
            json={"description": "A collection of verses from Chapter 2"},
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["description"] == "A collection of verses from Chapter 2"

    def test_item_metadata_preserved(self, client):
        """Item metadata should be stored and retrieved."""
        headers = _register_and_login(client)
        client.get("/api/cart/me", headers=headers)

        metadata = {
            "section_assignment": "Part 1",
            "notes": "Important verse",
            "transliteration_config": {"script": "devanagari"},
        }
        response = client.post(
            "/api/cart/items",
            json={
                "item_id": 444,
                "item_type": "library_node",
                "metadata": metadata,
            },
            headers=headers,
        )
        assert response.json()["metadata"] == metadata

        # Verify it persists
        cart = client.get("/api/cart/me", headers=headers).json()
        assert cart["items"][0]["metadata"] == metadata


class TestCollectionCartReordering:
    """Test item reordering in cart."""

    def test_reorder_items(self, client):
        """POST /api/cart/items/reorder should reorder items."""
        headers = _register_and_login(client)
        client.get("/api/cart/me", headers=headers)

        # Add 4 items
        item_ids = []
        for i in range(4):
            response = client.post(
                "/api/cart/items",
                json={"item_id": i, "item_type": "library_node"},
                headers=headers,
            )
            item_ids.append(response.json()["id"])

        # Reverse the order
        response = client.post(
            "/api/cart/items/reorder",
            json={"item_order": item_ids[::-1]},
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK

        # Verify new order
        cart = response.json()
        item_id_list = [item["id"] for item in cart["items"]]
        assert item_id_list == item_ids[::-1]

    def test_reorder_with_invalid_item_id_fails(self, client):
        """Reorder with non-existent item ID should fail."""
        headers = _register_and_login(client)
        client.get("/api/cart/me", headers=headers)

        # Add item
        response = client.post(
            "/api/cart/items",
            json={"item_id": 555, "item_type": "library_node"},
            headers=headers,
        )
        valid_id = response.json()["id"]

        # Try to reorder with invalid ID
        response = client.post(
            "/api/cart/items/reorder",
            json={"item_order": [valid_id, 99999]},
            headers=headers,
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_update_item_metadata(self, client):
        """PATCH /api/cart/items/{item_id} should update metadata."""
        headers = _register_and_login(client)
        client.get("/api/cart/me", headers=headers)

        add_response = client.post(
            "/api/cart/items",
            json={"item_id": 666, "item_type": "library_node"},
            headers=headers,
        )
        item_id = add_response.json()["id"]

        # Update metadata
        response = client.patch(
            f"/api/cart/items/{item_id}",
            json={"metadata": {"important": True}},
            headers=headers,
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["metadata"] == {"important": True}


class TestCollectionCartUnauthorized:
    """Test authorization requirements."""

    def test_cart_requires_authentication(self, client):
        """Accessing cart without auth should return 401."""
        response = client.get("/api/cart/me")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_add_item_requires_authentication(self, client):
        """Adding item without auth should return 401."""
        response = client.post(
            "/api/cart/items",
            json={"item_id": 1, "item_type": "library_node"},
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_invalid_token_rejected(self, client):
        """Request with invalid token should return 401."""
        headers = {"Authorization": "Bearer invalid_token_xyz"}
        response = client.get("/api/cart/me", headers=headers)
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
