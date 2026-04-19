import os
import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional
from api.auth import get_current_user
from services.email_service import send_email_message

logger = logging.getLogger(__name__)

router = APIRouter()


class EmailRequest(BaseModel):
    to: EmailStr
    subject: str
    body: str
    html: Optional[str] = None


@router.post("/email/send")
async def send_email(request: EmailRequest, current_user = Depends(get_current_user)):
    """Send an email via Mailgun API."""

    try:
        result = send_email_message(request.to, request.subject, request.body, html=request.html)
        return {
            "success": True,
            "message_id": result.get("id"),
            "recipient": request.to
        }
    except RuntimeError as e:
        logger.error(f"Error sending email: {e}")
        detail = str(e)
        status_code = 500 if "configured" in detail.lower() else 502
        raise HTTPException(status_code=status_code, detail=detail)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error sending email: {e}")
        raise HTTPException(status_code=500, detail="Failed to send email")
