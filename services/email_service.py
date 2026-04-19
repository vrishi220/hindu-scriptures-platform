import logging
import os

import requests

logger = logging.getLogger(__name__)


def _mailgun_config() -> tuple[str, str, str]:
    api_key = os.getenv("MAILGUN_API_KEY", "").strip()
    domain = os.getenv("MAILGUN_DOMAIN", "").strip()
    from_address = os.getenv("MAIL_FROM_ADDRESS", f"postmaster@{domain}").strip()
    return api_key, domain, from_address


def is_email_service_configured() -> bool:
    api_key, domain, _ = _mailgun_config()
    return bool(api_key and domain)


def send_email_message(to: str, subject: str, body: str, html: str | None = None) -> dict:
    mailgun_api_key, mailgun_domain, from_address = _mailgun_config()
    if not mailgun_api_key or not mailgun_domain:
        raise RuntimeError("Email service not configured")

    mailgun_api_base_url = os.getenv("MAILGUN_API_BASE_URL", "https://api.mailgun.net").strip().rstrip("/")
    if not mailgun_api_base_url:
        mailgun_api_base_url = "https://api.mailgun.net"

    mailgun_api_url = f"{mailgun_api_base_url}/v3/{mailgun_domain}/messages"
    data = {
        "from": f"Hindu Scriptures Platform <{from_address}>",
        "to": to,
        "subject": subject,
        "text": body,
    }
    if html:
        data["html"] = html

    try:
        response = requests.post(
            mailgun_api_url,
            auth=("api", mailgun_api_key),
            data=data,
            timeout=10,
        )
    except requests.RequestException as exc:
        logger.error("Request error sending email: %s", exc)
        raise RuntimeError("Failed to contact Mailgun API") from exc

    if response.status_code != 200:
        logger.error("Mailgun API error: %s %s", response.status_code, response.text)
        error_detail = response.text.strip() or "Failed to send email"
        raise RuntimeError(f"Mailgun error: {error_detail}")

    result = response.json()
    logger.info("Email sent successfully: %s", result.get("id"))
    return result


def build_email_verification_url(token: str) -> str:
    app_base_url = os.getenv("APP_BASE_URL", "https://scriptle.org").strip().rstrip("/")
    if not app_base_url:
        app_base_url = "https://scriptle.org"
    return f"{app_base_url}/verify-email?token={token}"


def send_registration_verification_email(email: str, token: str) -> dict:
    verification_url = build_email_verification_url(token)
    subject = "Confirm your Hindu Scriptures Platform account"
    body = (
        "Complete your registration by confirming your email address.\n\n"
        f"Open this link to finish registration:\n{verification_url}\n\n"
        "If you did not create this account, you can ignore this email."
    )
    html = (
        "<p>Complete your registration by confirming your email address.</p>"
        f'<p><a href="{verification_url}">Confirm your email address</a></p>'
        "<p>If you did not create this account, you can ignore this email.</p>"
    )
    return send_email_message(email, subject, body, html=html)