"""User preferences API endpoints"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api.users import get_current_user
from models.user import User
from models.user_preference import UserPreference
from models.schemas import UserPreferencePublic, UserPreferenceUpdate
from services import get_db

router = APIRouter(prefix="/preferences", tags=["preferences"])


@router.get("", response_model=UserPreferencePublic)
def get_user_preferences(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get user's display preferences (language/script)"""
    try:
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
