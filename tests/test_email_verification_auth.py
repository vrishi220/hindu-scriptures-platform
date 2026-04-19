from uuid import uuid4

from fastapi import status

from api import auth as auth_api
from models.database import SessionLocal
from models.user import User


class TestEmailVerificationAuth:
    def test_register_verify_and_login_flow(self, client, monkeypatch):
        monkeypatch.setenv("EMAIL_VERIFICATION_REQUIRED", "true")

        sent: dict[str, str] = {}

        def fake_send_registration_verification_email(email: str, token: str) -> dict:
            sent["email"] = email
            sent["token"] = token
            return {"id": "test-message-id"}

        monkeypatch.setattr(
            auth_api,
            "send_registration_verification_email",
            fake_send_registration_verification_email,
        )

        email = f"verify_{uuid4().hex[:8]}@example.com"
        password = "StrongPass123!"
        register_response = client.post(
            "/api/auth/register",
            json={
                "email": email,
                "password": password,
                "username": f"verify_{uuid4().hex[:8]}",
                "full_name": "Verify User",
            },
        )
        assert register_response.status_code == status.HTTP_201_CREATED
        payload = register_response.json()
        assert payload["email"] == email
        assert payload["requires_email_verification"] is True
        assert payload["verification_email_sent"] is True
        assert sent["email"] == email
        assert sent["token"]

        unverified_login = client.post(
            "/api/auth/login",
            json={"email": email, "password": password},
        )
        assert unverified_login.status_code == status.HTTP_403_FORBIDDEN
        assert unverified_login.json()["detail"] == "Please verify your email before signing in"

        verify_response = client.post(
            "/api/auth/verify-email",
            json={"token": sent["token"]},
        )
        assert verify_response.status_code == status.HTTP_200_OK
        assert verify_response.json()["message"] == "Email verified. You can now sign in."

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == email).first()
            assert user is not None
            assert user.is_verified is True
            assert user.email_verified_at is not None
        finally:
            db.close()

        verified_login = client.post(
            "/api/auth/login",
            json={"email": email, "password": password},
        )
        assert verified_login.status_code == status.HTTP_200_OK
        assert verified_login.json()["token_type"] == "bearer"

    def test_verify_email_rejects_invalid_token(self, client, monkeypatch):
        monkeypatch.setenv("EMAIL_VERIFICATION_REQUIRED", "true")

        response = client.post(
            "/api/auth/verify-email",
            json={"token": "definitely-invalid"},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.json()["detail"] == "Invalid or expired verification link"