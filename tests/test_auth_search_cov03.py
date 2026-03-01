from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import status

from api.search import build_search_query, extract_snippet
from models.database import SessionLocal
from models.session import UserSession
from models.user import User
from services import hash_password


def _register_and_login(client):
    suffix = uuid4().hex[:8]
    email = f"cov03_{suffix}@example.com"
    password = "StrongPass123!"
    username = f"cov03_{suffix}"

    register_response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "username": username,
            "full_name": "COV03 User",
        },
    )
    assert register_response.status_code == status.HTTP_201_CREATED

    login_response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert login_response.status_code == status.HTTP_200_OK
    return {
        "email": email,
        "password": password,
        "access_token": login_response.json()["access_token"],
        "refresh_token": login_response.json()["refresh_token"],
        "headers": {"Authorization": f"Bearer {login_response.json()['access_token']}"},
    }


class TestAuthCoverageCOV03:
    def test_register_rejects_duplicate_username(self, client):
        first = _register_and_login(client)

        duplicate_response = client.post(
            "/api/auth/register",
            json={
                "email": f"other_{uuid4().hex[:8]}@example.com",
                "password": "StrongPass123!",
                "username": first["email"].split("@")[0],
                "full_name": "Duplicate Username",
            },
        )
        assert duplicate_response.status_code == status.HTTP_400_BAD_REQUEST
        assert duplicate_response.json()["detail"] == "Username in use"

    def test_refresh_rejects_access_token_and_missing_session(self, client):
        auth = _register_and_login(client)

        wrong_type = client.post(
            "/api/auth/refresh",
            json={"refresh_token": auth["access_token"]},
        )
        assert wrong_type.status_code == status.HTTP_401_UNAUTHORIZED
        assert wrong_type.json()["detail"] == "Invalid token"

        logout_response = client.post(
            "/api/auth/logout",
            json={"refresh_token": auth["refresh_token"]},
        )
        assert logout_response.status_code == status.HTTP_200_OK

        missing_session = client.post(
            "/api/auth/refresh",
            json={"refresh_token": auth["refresh_token"]},
        )
        assert missing_session.status_code == status.HTTP_401_UNAUTHORIZED
        assert missing_session.json()["detail"] == "Invalid token"

    def test_refresh_rejects_expired_session_and_inactive_user(self, client):
        auth = _register_and_login(client)

        db = SessionLocal()
        try:
            session = (
                db.query(UserSession)
                .filter(UserSession.refresh_token == auth["refresh_token"])
                .first()
            )
            assert session is not None
            session.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            db.commit()
        finally:
            db.close()

        expired_response = client.post(
            "/api/auth/refresh",
            json={"refresh_token": auth["refresh_token"]},
        )
        assert expired_response.status_code == status.HTTP_401_UNAUTHORIZED
        assert expired_response.json()["detail"] == "Token expired"

        auth2 = _register_and_login(client)
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == auth2["email"]).first()
            assert user is not None
            user.is_active = False
            db.commit()
        finally:
            db.close()

        inactive_response = client.post(
            "/api/auth/refresh",
            json={"refresh_token": auth2["refresh_token"]},
        )
        assert inactive_response.status_code == status.HTTP_401_UNAUTHORIZED
        assert inactive_response.json()["detail"] == "Invalid user"

    def test_logout_all_revokes_all_sessions(self, client):
        auth = _register_and_login(client)
        second_login = client.post(
            "/api/auth/login",
            json={"email": auth["email"], "password": auth["password"]},
        )
        assert second_login.status_code == status.HTTP_200_OK
        second_refresh = second_login.json()["refresh_token"]

        logout_all = client.post("/api/auth/logout-all", headers=auth["headers"])
        assert logout_all.status_code == status.HTTP_200_OK

        refresh_after_logout_all = client.post(
            "/api/auth/refresh",
            json={"refresh_token": second_refresh},
        )
        assert refresh_after_logout_all.status_code == status.HTTP_401_UNAUTHORIZED
        assert refresh_after_logout_all.json()["detail"] == "Invalid token"

    def test_forgot_password_production_hides_reset_token(self, client, monkeypatch):
        auth = _register_and_login(client)

        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.delenv("INCLUDE_RESET_TOKEN_IN_RESPONSE", raising=False)

        response = client.post("/api/auth/forgot-password", json={"email": auth["email"]})
        assert response.status_code == status.HTTP_200_OK
        assert response.json().get("reset_token") is None

    def test_reset_password_rejects_invalid_or_stale_token(self, client):
        auth = _register_and_login(client)

        invalid_token_response = client.post(
            "/api/auth/reset-password",
            json={"token": "definitely-invalid", "new_password": "NewStrongPass456!"},
        )
        assert invalid_token_response.status_code == status.HTTP_400_BAD_REQUEST

        forgot_response = client.post("/api/auth/forgot-password", json={"email": auth["email"]})
        assert forgot_response.status_code == status.HTTP_200_OK
        reset_token = forgot_response.json().get("reset_token")
        assert reset_token

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == auth["email"]).first()
            assert user is not None
            user.password_hash = hash_password("AnotherPass789")
            db.commit()
        finally:
            db.close()

        stale_token_response = client.post(
            "/api/auth/reset-password",
            json={"token": reset_token, "new_password": "NewestStrongPass999!"},
        )
        assert stale_token_response.status_code == status.HTTP_400_BAD_REQUEST
        assert stale_token_response.json()["detail"] == "Invalid or expired reset token"


class TestSearchCoverageCOV03:
    def test_advanced_search_rejects_blank_query(self, client):
        response = client.post(
            "/api/search/advanced",
            json={"text": "   ", "limit": 10, "offset": 0},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.json()["detail"] == "Query required"

    def test_fulltext_search_rejects_blank_query_and_accepts_tags(self, client):
        blank = client.get("/api/search/fulltext", params={"q": "   "})
        assert blank.status_code == status.HTTP_400_BAD_REQUEST
        assert blank.json()["detail"] == "Query required"

        tagged = client.get(
            "/api/search/fulltext",
            params={"q": "karma", "tags": "bhagavad-gita, verse", "limit": 5},
        )
        assert tagged.status_code == status.HTTP_200_OK
        assert "results" in tagged.json()

    def test_build_search_query_handles_quoted_and_unquoted_modes(self):
        db = SessionLocal()
        try:
            quoted_query, quoted_rank, quoted_headline = build_search_query(
                db,
                '"karma yoga"',
                book_id=1,
                level_name="Verse",
                has_content=True,
            )
            assert quoted_query is not None
            assert quoted_rank is not None
            assert quoted_headline is not None

            plain_query, plain_rank, plain_headline = build_search_query(
                db,
                "karma",
                book_id=None,
                level_name=None,
                has_content=None,
            )
            assert plain_query is not None
            assert plain_rank is not None
            assert plain_headline is not None
        finally:
            db.close()

    def test_extract_snippet_variants(self):
        with_match = SimpleNamespace(content_data={"text": "This is karma yoga guidance text."})
        snippet = extract_snippet(with_match, "karma")
        assert snippet is not None
        assert "karma" in snippet.lower()

        without_match = SimpleNamespace(content_data={"english": "First line only"})
        snippet_no_match = extract_snippet(without_match, "missing")
        assert snippet_no_match == "First line only"

        empty = SimpleNamespace(content_data=None)
        assert extract_snippet(empty, "anything") is None
