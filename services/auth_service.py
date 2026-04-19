import os
import secrets
from hashlib import sha256
from datetime import datetime, timedelta, timezone

from jose import jwt
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_SECRET = os.getenv("JWT_SECRET", "change_me")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = int(
    os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES", "30")
)
EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS = int(
    os.getenv("EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS", "24")
)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return pwd_context.verify(password, hashed_password)


def create_token(user_id: int, token_type: str, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "exp": now + expires_delta,
        "iat": now,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_access_token(user_id: int) -> str:
    return create_token(
        user_id,
        "access",
        timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )


def create_refresh_token(user_id: int) -> str:
    return create_token(user_id, "refresh", timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def get_token_subject(token: str) -> int:
    payload = decode_token(token)
    subject = payload.get("sub")
    if subject is None:
        raise JWTError("Missing subject")
    return int(subject)


def password_hash_signature(password_hash: str) -> str:
    return sha256(password_hash.encode("utf-8")).hexdigest()


def create_email_verification_token_value() -> str:
    return secrets.token_urlsafe(32)


def email_verification_token_signature(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def create_password_reset_token(user_id: int, password_hash: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": "password_reset",
        "pwd": password_hash_signature(password_hash),
        "exp": now + timedelta(minutes=PASSWORD_RESET_TOKEN_EXPIRE_MINUTES),
        "iat": now,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_password_reset_token(token: str) -> dict:
    payload = decode_token(token)
    if payload.get("type") != "password_reset":
        raise JWTError("Invalid token type")
    if not payload.get("pwd"):
        raise JWTError("Invalid token payload")
    return payload
