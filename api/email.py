import os
import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional
import requests
from api.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()

# Mailgun configuration
MAILGUN_API_KEY = os.getenv("MAILGUN_API_KEY", "")
MAILGUN_DOMAIN = os.getenv("MAILGUN_DOMAIN", "")
MAILGUN_API_URL = f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}/messages"


class EmailRequest(BaseModel):
    to: EmailStr
    subject: str
    body: str
    html: Optional[str] = None


@router.post("/email/send")
async def send_email(request: EmailRequest, current_user = Depends(get_current_user)):
    """Send an email via Mailgun API."""
    
    if not MAILGUN_API_KEY or not MAILGUN_DOMAIN:
        logger.error("Mailgun credentials not configured")
        raise HTTPException(status_code=500, detail="Email service not configured")
    
    try:
        data = {
            "from": f"Hindu Scriptures Platform <noreply@{MAILGUN_DOMAIN}>",
            "to": request.to,
            "subject": request.subject,
            "text": request.body,
        }
        
        if request.html:
            data["html"] = request.html
        
        response = requests.post(
            MAILGUN_API_URL,
            auth=("api", MAILGUN_API_KEY),
            data=data,
            timeout=10
        )
        
        if response.status_code != 200:
            logger.error(f"Mailgun API error: {response.status_code} {response.text}")
            raise HTTPException(status_code=500, detail="Failed to send email")
        
        result = response.json()
        logger.info(f"Email sent successfully: {result.get('id')}")
        
        return {
            "success": True,
            "message_id": result.get("id"),
            "recipient": request.to
        }
    
    except requests.RequestException as e:
        logger.error(f"Request error sending email: {e}")
        raise HTTPException(status_code=500, detail="Failed to send email")
    except Exception as e:
        logger.error(f"Unexpected error sending email: {e}")
        raise HTTPException(status_code=500, detail="Failed to send email")
