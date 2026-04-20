import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from jose import JWTError
from sqlalchemy.orm import Session

from api.users import get_current_user
from models.email_verification_token import EmailVerificationToken
from models.schemas import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LogoutRequest,
    MessageResponse,
    RegistrationResponse,
    ResetPasswordRequest,
    RefreshRequest,
    ResendVerificationRequest,
    TokenResponse,
    UserCreate,
    UserLogin,
    UserPublic,
    VerifyEmailRequest,
)
from models.session import UserSession
from models.user import User
from services import (
    EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS,
    create_access_token,
    create_email_verification_token_value,
    create_password_reset_token,
    create_refresh_token,
    decode_token,
    email_verification_token_signature,
    get_db,
    get_token_subject,
    hash_password,
    password_hash_signature,
    verify_password_reset_token,
    verify_password,
)
from services.email_service import send_registration_verification_email

router = APIRouter(prefix="/auth", tags=["auth"])

ACCESS_TOKEN_COOKIE = os.getenv("ACCESS_TOKEN_COOKIE", "access_token")
REFRESH_TOKEN_COOKIE = os.getenv("REFRESH_TOKEN_COOKIE", "refresh_token")
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
COOKIE_DOMAIN = os.getenv("COOKIE_DOMAIN")
COOKIE_PATH = os.getenv("COOKIE_PATH", "/")


def include_reset_token_in_response() -> bool:
    explicit_value = os.getenv("INCLUDE_RESET_TOKEN_IN_RESPONSE")
    if explicit_value is not None:
        return explicit_value.lower() == "true"

    # Security-first default: never include reset tokens unless explicitly enabled.
    return False


def email_verification_required() -> bool:
    explicit_value = os.getenv("EMAIL_VERIFICATION_REQUIRED")
    if explicit_value is not None:
        return explicit_value.lower() == "true"

    app_env = os.getenv("APP_ENV", os.getenv("ENV", "development")).lower()
    return app_env == "production"

DEFAULT_PERMISSIONS = {
    "can_view": True,
    "can_contribute": True,
    "can_edit": False,
    "can_moderate": False,
    "can_admin": False,
}


def _issue_email_verification_token(db: Session, user: User) -> str:
    now = datetime.now(timezone.utc)
    db.query(EmailVerificationToken).filter(
        EmailVerificationToken.user_id == user.id,
        EmailVerificationToken.used_at.is_(None),
    ).update({EmailVerificationToken.used_at: now}, synchronize_session=False)

    raw_token = create_email_verification_token_value()
    db.add(
        EmailVerificationToken(
            user_id=user.id,
            token_hash=email_verification_token_signature(raw_token),
            expires_at=now + timedelta(hours=EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS),
        )
    )
    return raw_token


def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
) -> None:
    response.set_cookie(
        ACCESS_TOKEN_COOKIE,
        access_token,
        httponly=True,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
        domain=COOKIE_DOMAIN,
        path=COOKIE_PATH,
    )
    response.set_cookie(
        REFRESH_TOKEN_COOKIE,
        refresh_token,
        httponly=True,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
        domain=COOKIE_DOMAIN,
        path=COOKIE_PATH,
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_TOKEN_COOKIE, domain=COOKIE_DOMAIN, path=COOKIE_PATH)
    response.delete_cookie(REFRESH_TOKEN_COOKIE, domain=COOKIE_DOMAIN, path=COOKIE_PATH)


@router.post("/register", response_model=RegistrationResponse, status_code=status.HTTP_201_CREATED)
def register_user(payload: UserCreate, db: Session = Depends(get_db)) -> RegistrationResponse:
    existing_email = db.query(User).filter(User.email == payload.email).first()
    if existing_email and existing_email.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email in use")

    if payload.username:
        existing_username = (
            db.query(User).filter(User.username == payload.username).first()
        )
        if existing_username and (
            existing_email is None or existing_username.id != existing_email.id
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Username in use"
            )

    verification_required = email_verification_required()

    if existing_email and not existing_email.is_active:
        existing_email.username = payload.username
        existing_email.full_name = payload.full_name
        existing_email.password_hash = hash_password(payload.password)
        existing_email.is_active = True
        existing_email.is_verified = False
        existing_email.email_verified_at = None
        if not existing_email.role:
            existing_email.role = "viewer"
        if existing_email.permissions is None:
            existing_email.permissions = DEFAULT_PERMISSIONS
        db.flush()
        verification_email_sent = False
        if verification_required:
            verification_token = _issue_email_verification_token(db, existing_email)
            try:
                send_registration_verification_email(existing_email.email, verification_token)
            except RuntimeError as exc:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Verification email failed: {exc}",
                ) from exc
            verification_email_sent = True
        db.commit()
        db.refresh(existing_email)
        return RegistrationResponse.model_validate(existing_email).model_copy(
            update={
                "requires_email_verification": verification_required,
                "verification_email_sent": verification_email_sent,
                "message": "Account created. Check your email to confirm your account."
                if verification_required
                else "Account created.",
            }
        )

    user = User(
        email=payload.email,
        username=payload.username,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role="viewer",
        permissions=DEFAULT_PERMISSIONS,
        is_verified=False,
        email_verified_at=None,
    )
    db.add(user)
    db.flush()
    verification_email_sent = False
    if verification_required:
        verification_token = _issue_email_verification_token(db, user)
        try:
            send_registration_verification_email(user.email, verification_token)
        except RuntimeError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Verification email failed: {exc}",
            ) from exc
        verification_email_sent = True
    db.commit()
    db.refresh(user)
    return RegistrationResponse.model_validate(user).model_copy(
        update={
            "requires_email_verification": verification_required,
            "verification_email_sent": verification_email_sent,
            "message": "Account created. Check your email to confirm your account."
            if verification_required
            else "Account created.",
        }
    )


@router.post("/login", response_model=TokenResponse)
def login_user(
    payload: UserLogin,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.password_hash:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid login")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid login")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User inactive")

    if email_verification_required() and not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before signing in",
        )

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)
    refresh_payload = decode_token(refresh_token)
    expires_at = datetime.fromtimestamp(refresh_payload["exp"], tz=timezone.utc)

    session = UserSession(
        user_id=user.id,
        refresh_token=refresh_token,
        expires_at=expires_at,
    )
    user.last_login_at = datetime.now(timezone.utc)
    db.add(session)
    db.commit()

    set_auth_cookies(response, access_token, refresh_token)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    payload: RefreshRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    try:
        decoded = decode_token(payload.refresh_token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if decoded.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id = get_token_subject(payload.refresh_token)
    session = (
        db.query(UserSession)
        .filter(UserSession.refresh_token == payload.refresh_token)
        .first()
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if session.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    now = datetime.now(timezone.utc)
    expires_at = session.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at is not None and expires_at < now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user")

    access_token = create_access_token(user.id)
    new_refresh_token = create_refresh_token(user.id)
    new_refresh_payload = decode_token(new_refresh_token)
    session.refresh_token = new_refresh_token
    session.expires_at = datetime.fromtimestamp(
        new_refresh_payload["exp"], tz=timezone.utc
    )
    db.commit()

    set_auth_cookies(response, access_token, new_refresh_token)

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
    )


@router.post("/logout", response_model=MessageResponse)
def logout(
    payload: LogoutRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> MessageResponse:
    session = (
        db.query(UserSession)
        .filter(UserSession.refresh_token == payload.refresh_token)
        .first()
    )
    if session:
        db.delete(session)
        db.commit()
    clear_auth_cookies(response)
    return MessageResponse(message="Logged out")


@router.post("/logout-all", response_model=MessageResponse)
def logout_all(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageResponse:
    db.query(UserSession).filter(UserSession.user_id == current_user.id).delete(
        synchronize_session=False
    )
    db.commit()
    clear_auth_cookies(response)
    return MessageResponse(message="Logged out all sessions")


@router.post("/verify-email", response_model=MessageResponse)
def verify_email(
    payload: VerifyEmailRequest,
    db: Session = Depends(get_db),
) -> MessageResponse:
    now = datetime.now(timezone.utc)
    verification_record = (
        db.query(EmailVerificationToken)
        .filter(EmailVerificationToken.token_hash == email_verification_token_signature(payload.token))
        .first()
    )

    if not verification_record or verification_record.used_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link",
        )

    expires_at = verification_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link",
        )

    user = db.query(User).filter(User.id == verification_record.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link",
        )

    user.is_verified = True
    user.email_verified_at = now
    verification_record.used_at = now
    db.query(EmailVerificationToken).filter(
        EmailVerificationToken.user_id == user.id,
        EmailVerificationToken.id != verification_record.id,
        EmailVerificationToken.used_at.is_(None),
    ).update({EmailVerificationToken.used_at: now}, synchronize_session=False)
    db.commit()

    return MessageResponse(message="Email verified. You can now sign in.")


@router.post("/resend-verification", response_model=MessageResponse)
def resend_verification_email(
    payload: ResendVerificationRequest,
    db: Session = Depends(get_db),
) -> MessageResponse:
    generic_message = "If an account exists for that email, a verification email has been sent."
    if not email_verification_required():
        return MessageResponse(message="Email verification is not required in this environment.")

    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.is_active or user.is_verified:
        return MessageResponse(message=generic_message)

    verification_token = _issue_email_verification_token(db, user)
    try:
        send_registration_verification_email(user.email, verification_token)
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Verification email failed: {exc}",
        ) from exc

    db.commit()
    return MessageResponse(message=generic_message)


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(
    payload: ForgotPasswordRequest,
    db: Session = Depends(get_db),
) -> ForgotPasswordResponse:
    user = db.query(User).filter(User.email == payload.email).first()
    reset_token: str | None = None

    if user and user.password_hash and user.is_active:
        reset_token = create_password_reset_token(user.id, user.password_hash)

    if include_reset_token_in_response():
        return ForgotPasswordResponse(
            message="If an account exists for that email, a reset link has been generated.",
            reset_token=reset_token,
        )

    return ForgotPasswordResponse(
        message="If an account exists for that email, a reset link has been generated."
    )


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
) -> MessageResponse:
    try:
        token_payload = verify_password_reset_token(payload.token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    user_id = token_payload.get("sub")
    token_pwd_signature = token_payload.get("pwd")
    if not user_id or not token_pwd_signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active or not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    current_signature = password_hash_signature(user.password_hash)
    if current_signature != token_pwd_signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    user.password_hash = hash_password(payload.new_password)
    db.query(UserSession).filter(UserSession.user_id == user.id).delete(synchronize_session=False)
    db.commit()

    return MessageResponse(message="Password reset successful")
