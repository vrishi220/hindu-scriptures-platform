"""User preferences API endpoints"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text

from api.users import get_current_user
from models.user import User
from models.user_preference import UserPreference
from models.schemas import UserPreferencePublic, UserPreferenceUpdate
from services import get_db

router = APIRouter(prefix="/preferences", tags=["preferences"])


def _ensure_preferences_schema(db: Session) -> None:
    db.execute(
        text(
            "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS preview_show_media BOOLEAN NOT NULL DEFAULT TRUE"
        )
    )
    db.execute(
        text(
            "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS preview_show_commentary BOOLEAN NOT NULL DEFAULT TRUE"
        )
    )
    db.execute(
        text(
            "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS preview_word_meanings_display_mode VARCHAR(10) NOT NULL DEFAULT 'inline'"
        )
    )
    db.execute(
        text(
            "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS preview_show_level_numbers BOOLEAN NOT NULL DEFAULT FALSE"
        )
    )
    db.execute(
        text(
            "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS preview_translation_languages VARCHAR(255) NOT NULL DEFAULT 'english'"
        )
    )
    db.execute(
        text(
            "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS preview_hidden_levels VARCHAR(2000) NOT NULL DEFAULT ''"
        )
    )
    db.execute(
        text(
            "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS scriptures_book_browser_density INTEGER NOT NULL DEFAULT 0"
        )
    )
    db.execute(
        text(
            "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS scriptures_media_manager_density INTEGER NOT NULL DEFAULT 0"
        )
    )
    db.commit()


@router.get("", response_model=UserPreferencePublic)
def get_user_preferences(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get user's display preferences (language/script)"""
    try:
        _ensure_preferences_schema(db)
        pref = db.query(UserPreference).filter(
            UserPreference.user_id == current_user.id
        ).first()
        
        if not pref:
            # Create default preferences
            pref = UserPreference(
                user_id=current_user.id,
                source_language="en",
                transliteration_enabled=True,
                transliteration_script="devanagari",
                show_roman_transliteration=True,
                show_only_preferred_script=False,
                show_media=True,
                show_commentary=True,
                preview_show_titles=False,
                preview_show_labels=False,
                preview_show_level_numbers=False,
                preview_show_details=False,
                preview_show_media=True,
                preview_show_sanskrit=True,
                preview_show_transliteration=True,
                preview_show_english=True,
                preview_show_commentary=True,
                preview_transliteration_script="iast",
                preview_word_meanings_display_mode="inline",
                preview_translation_languages="english",
                preview_hidden_levels="",
                scriptures_book_browser_view="list",
                scriptures_book_browser_density=0,
                scriptures_media_manager_view="list",
                scriptures_media_manager_density=0,
                admin_media_bank_browser_view="list",
            )
            db.add(pref)
            db.commit()
            db.refresh(pref)
        
        return UserPreferencePublic.model_validate(pref)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get preferences: {str(e)}"
        )


@router.patch("", response_model=UserPreferencePublic)
def update_user_preferences(
    payload: UserPreferenceUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update user's display preferences"""
    try:
        _ensure_preferences_schema(db)
        pref = db.query(UserPreference).filter(
            UserPreference.user_id == current_user.id
        ).first()
        
        if not pref:
            pref = UserPreference(user_id=current_user.id)
            db.add(pref)
        
        # Update only provided fields
        update_data = payload.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            if hasattr(pref, key):
                setattr(pref, key, value)
        
        db.commit()
        db.refresh(pref)
        return UserPreferencePublic.model_validate(pref)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update preferences: {str(e)}"
        )
