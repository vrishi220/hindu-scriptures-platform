"""Email service for transactional emails via Mailgun."""
import os
import logging
from typing import Optional
import requests

logger = logging.getLogger(__name__)


class MailgunEmailService:
    """Mailgun email service for transactional emails."""

    def __init__(self):
        self.api_key = os.getenv("MAILGUN_API_KEY")
        self.domain = os.getenv("MAILGUN_DOMAIN", "scriptle.org")
        self.from_email = os.getenv("MAILGUN_FROM_EMAIL", "noreply@scriptle.org")
        self.api_url = f"https://api.mailgun.net/v3/{self.domain}/messages"

    def is_configured(self) -> bool:
        """Check if Mailgun is configured."""
        return bool(self.api_key)

    def send_share_invitation_email(
        self,
        recipient_email: str,
        book_title: str,
        inviter_name: str,
        inviter_email: str,
        invite_link: str,
        permission: str = "viewer",
    ) -> bool:
        """
        Send a book share invitation email.

        Args:
            recipient_email: Email address of the recipient
            book_title: Title of the book being shared
            inviter_name: Name of the person sharing
            inviter_email: Email of the person sharing
            invite_link: Deep link to the book on Scriptle
            permission: Permission level (viewer, contributor, editor)

        Returns:
            True if email sent successfully, False otherwise
        """
        if not self.is_configured():
            logger.warning("Mailgun not configured; skipping email send")
            return False

        subject = f"You were invited to view "{book_title}" on Scriptle"

        html_body = self._build_invitation_html(
            book_title=book_title,
            inviter_name=inviter_name,
            inviter_email=inviter_email,
            invite_link=invite_link,
            permission=permission,
        )

        text_body = self._build_invitation_text(
            book_title=book_title,
            inviter_name=inviter_name,
            invite_link=invite_link,
        )

        try:
            response = requests.post(
                self.api_url,
                auth=("api", self.api_key),
                data={
                    "from": self.from_email,
                    "to": recipient_email,
                    "subject": subject,
                    "text": text_body,
                    "html": html_body,
                },
                timeout=10,
            )
            response.raise_for_status()
            logger.info(f"Share invitation email sent to {recipient_email}")
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to send email to {recipient_email}: {str(e)}")
            return False

    def _build_invitation_html(
        self,
        book_title: str,
        inviter_name: str,
        inviter_email: str,
        invite_link: str,
        permission: str,
    ) -> str:
        """Build HTML email body for invitation."""
        permission_text = {
            "viewer": "view",
            "contributor": "view and contribute to",
            "editor": "edit",
        }.get(permission, "view")

        return f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2>You're invited to Scriptle!</h2>
                    
                    <p>
                        <strong>{inviter_name}</strong> ({inviter_email}) has invited you to 
                        <strong>{permission_text}</strong> <em>"{book_title}"</em> on Scriptle.
                    </p>
                    
                    <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
                        <p style="margin-top: 0;">
                            <a href="{invite_link}" 
                               style="display: inline-block; background-color: #4CAF50; color: white; 
                                      padding: 12px 24px; text-decoration: none; border-radius: 4px; 
                                      font-weight: bold;">
                                View on Scriptle
                            </a>
                        </p>
                    </div>
                    
                    <p>
                        <small>
                            If you don't have a Scriptle account, you'll be able to create one 
                            or sign in when you click the link above.
                        </small>
                    </p>
                    
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                    
                    <p style="font-size: 12px; color: #666;">
                        <strong>About Scriptle:</strong> Scriptle is a platform for exploring 
                        Hindu scriptures with collaborative annotation and translation features.
                    </p>
                </div>
            </body>
        </html>
        """

    def _build_invitation_text(
        self, book_title: str, inviter_name: str, invite_link: str
    ) -> str:
        """Build plain text email body for invitation."""
        return f"""
You're invited to Scriptle!

{inviter_name} has invited you to view "{book_title}" on Scriptle.

Click the link below to access the book:
{invite_link}

If you don't have a Scriptle account, you'll be able to create one or sign in when you click the link above.

---
About Scriptle: Scriptle is a platform for exploring Hindu scriptures with collaborative annotation and translation features.
        """.strip()


# Initialize email service
email_service = MailgunEmailService()


def send_share_invitation(
    recipient_email: str,
    book_title: str,
    inviter_name: str,
    inviter_email: str,
    invite_link: str,
    permission: str = "viewer",
) -> bool:
    """
    Public function to send share invitation email.

    Returns True if email sent successfully or if Mailgun is not configured
    (to allow graceful degradation in development).
    """
    return email_service.send_share_invitation_email(
        recipient_email=recipient_email,
        book_title=book_title,
        inviter_name=inviter_name,
        inviter_email=inviter_email,
        invite_link=invite_link,
        permission=permission,
    )
