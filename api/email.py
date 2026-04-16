import os
import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional
import requests
from api.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()

def _mailgun_config() -> tuple[str, str, str]:
    api_key = os.getenv("MAILGUN_API_KEY", "").strip()
    domain = os.getenv("MAILGUN_DOMAIN", "").strip()
    from_address = os.getenv("MAIL_FROM_ADDRESS", f"postmaster@{domain}").strip()
    return api_key, domain, from_address


class EmailRequest(BaseModel):
    to: EmailStr
    subject: str
    body: str
    html: Optional[str] = None


@router.post("/email/send")
async def send_email(request: EmailRequest, current_user = Depends(get_current_user)):
    """Send an email via Mailgun API."""

    mailgun_api_key, mailgun_domain, from_address = _mailgun_config()

    if not mailgun_api_key or not mailgun_domain:
        logger.error("Mailgun credentials not configured")
        raise HTTPException(status_code=500, detail="Email service not configured")

    mailgun_api_base_url = os.getenv("MAILGUN_API_BASE_URL", "https://api.mailgun.net").strip().rstrip("/")
    if not mailgun_api_base_url:
        mailgun_api_base_url = "https://api.mailgun.net"

    mailgun_api_url = f"{mailgun_api_base_url}/v3/{mailgun_domain}/messages"
    
    try:
        data = {
            "from": f"Hindu Scriptures Platform <{from_address}>",
            "to": request.to,
            "subject": request.subject,
            "text": request.body,
        }
        
        if request.html:
            data["html"] = request.html
        
        response = requests.post(
            mailgun_api_url,
            auth=("api", mailgun_api_key),
            data=data,
            timeout=10
        )
        
        if response.status_code != 200:
            logger.error(f"Mailgun API error: {response.status_code} {response.text}")
            error_detail = response.text.strip() or "Failed to send email"
            raise HTTPException(status_code=502, detail=f"Mailgun error: {error_detail}")
        
        result = response.json()
        logger.info(f"Email sent successfully: {result.get('id')}")
        
        return {
            "success": True,
            "message_id": result.get("id"),
            "recipient": request.to
        }
    
    except requests.RequestException as e:
        logger.error(f"Request error sending email: {e}")
        raise HTTPException(status_code=502, detail="Failed to contact Mailgun API")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error sending email: {e}")
        raise HTTPException(status_code=500, detail="Failed to send email")
