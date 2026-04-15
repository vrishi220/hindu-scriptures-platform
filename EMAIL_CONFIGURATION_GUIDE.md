# Email Configuration Guide - Mailgun Setup

## Overview

The Scriptle platform now supports sharing books/levels with other users via email invitations. This guide explains how to set up and configure the Mailgun email service for the share-by-email feature.

## Architecture

**Email Service Module:** `services/email.py`
- Abstracted email service layer using Mailgun as the transactional email provider
- Supports sending HTML and plain text email templates
- Graceful degradation: if `MAILGUN_API_KEY` is not set, emails skip silently (for development)

**Share Endpoint:** `POST /api/books/{book_id}/shares`
- Updated to support `send_email: bool` field in request payload
- When `send_email=true`, sends invitation email to recipient
- Email includes invitation message, book title, and a deep link to the shared book

**Frontend Integration:** `web/src/app/scriptures/page.tsx`
- Share modal now includes "Send invitation email" checkbox
- Checkbox is checked by default when sharing a book
- Email is only sent if checkbox is checked

## Email Provider: Mailgun

**Why Mailgun?**
- **Free tier:** 3,000 emails/month (permanent, no time limit)
- **No credit card required** for free tier
- **Reliable transactional email service** (not a marketing platform)
- **Professional** - used by production platforms globally
- **RESTful API** - easy to implement and maintain

**Mailgun Account Status:**
- Domain registered: `scriptle.org`
- API endpoint: `https://api.mailgun.net/v3/scriptle.org/messages`
- Sender email: `noreply@scriptle.org`

## Environment Configuration

### Required Environment Variables

Add these to your `.env` file or deployment environment:

```bash
# Mailgun Configuration (REQUIRED for email functionality)
MAILGUN_API_KEY=key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MAILGUN_DOMAIN=scriptle.org
MAILGUN_FROM_EMAIL=noreply@scriptle.org

# Frontend Base URL (REQUIRED for email deep links)
APP_BASE_URL=https://scriptle.org
```

### Local Development Setup

1. **Get your Mailgun API Key:**
   - Log in to [Mailgun Dashboard](https://mailgun.com/app/dashboard)
   - Wait for email verification to complete (if you just created account, you may see a lockout - this typically resolves in 15-30 minutes)
   - Navigate to **API Keys** section
   - Copy your **Mailgun API Key** (format: `key-xxxxxxxxxxxxxxxxxxxxxxxx`)

2. **Create or update `.env` file:**
   ```bash
   # Copy the API key from Mailgun dashboard
   MAILGUN_API_KEY=key-xxxxxxxxxxxxxxxxxxxxxxxx
   MAILGUN_DOMAIN=scriptle.org
   MAILGUN_FROM_EMAIL=noreply@scriptle.org
   
   # For local development, you can use localhost
   # For production/testing, use the actual frontend URL
   APP_BASE_URL=http://localhost:3000
   ```

3. **Restart your backend server** for changes to take effect

### Production Deployment (Render)

1. **In Render Dashboard:**
   - Go to your FastAPI service
   - Click **Environment** tab
   - Add these variables:
     ```
     MAILGUN_API_KEY=key-xxxxxxxxxxxxxxxxxxxxxxxx
     MAILGUN_DOMAIN=scriptle.org
     MAILGUN_FROM_EMAIL=noreply@scriptle.org
     APP_BASE_URL=https://scriptle.org
     ```

2. **Deploy** - the service will automatically use the new environment variables

## Testing the Email Feature

### 1. Local Testing

**Prerequisite:** API key must be set in `.env`

```bash
# Start your backend server
python main.py

# In another terminal, test the share endpoint:
curl -X POST http://localhost:8000/api/books/1/shares \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "email": "test@example.com",
    "permission": "viewer",
    "send_email": true
  }'
```

### 2. Email Verification

When `send_email: true` is passed:
1. The endpoint creates the share record in the database
2. Email service sends invitation to recipient
3. Recipient receives email with:
   - Invitation message from sharer
   - Book title
   - Deep link: `https://scriptle.org/scriptures?book={bookId}`
   - Permission level (viewer/contributor/editor)

### 3. Recipient Experience

When recipient clicks the email link:
1. They are redirected to `/scriptures?book={bookId}`
2. If not logged in, they see a registration/login dialog
3. After login, they see the shared book in their library
4. Permission level controls what actions they can perform:
   - **viewer** - Read-only access
   - **contributor** - Can add translations/commentary
   - **editor** - Full edit access including metadata

## Email Template

The email includes:
- **HTML version** - Styled with book title, invitation message, and action button
- **Plain text version** - For clients that don't support HTML

Template variables:
- `{inviter_name}` - Name/email of the person who shared
- `{book_title}` - Title of the shared book
- `{permission}` - Permission level (viewer/contributor/editor)
- `{invite_link}` - Deep link to the shared book

## Troubleshooting

### Issue: "Mailgun API Key not configured"

**Symptoms:** Emails don't send, no errors in logs

**Solution:**
1. Check that `MAILGUN_API_KEY` is set in `.env`
2. Check that the key format is correct (starts with `key-`)
3. Copy the key from Mailgun dashboard again (may have expired)
4. Restart the backend server

### Issue: "User not found" error when sharing

**Symptoms:** Share endpoint returns 404 with "User not found"

**Solution:**
1. The recipient email must be registered in the system
2. Have the recipient create an account first using their email
3. Then share with them using that same email address

### Issue: Email not received by recipient

**Symptoms:** Share request succeeds but email doesn't arrive

**Diagnosis steps:**
1. Check Mailgun logs in dashboard (**Logs** tab)
2. Verify sender email is `noreply@scriptle.org`
3. Verify recipient email is correct (no typos)
4. Check spam/junk folder
5. Verify `APP_BASE_URL` is correct (should match frontend URL)

### Issue: "Too many verification attempts" when creating Mailgun account

**Symptoms:** Account locked out from sending verification email

**Solution:**
1. This is a Mailgun rate-limit to prevent abuse
2. Wait 15-30 minutes for the lockout to expire
3. Try accessing the Mailgun dashboard again
4. You can still retrieve your API key during the lockout (it's already generated)

## API Reference

### Share Endpoint

**Endpoint:** `POST /api/books/{book_id}/shares`

**Request:**
```json
{
  "email": "user@example.com",
  "permission": "viewer",
  "send_email": true
}
```

**Response:**
```json
{
  "id": 1,
  "book_id": 123,
  "shared_with_user_id": 456,
  "shared_with_email": "user@example.com",
  "shared_with_username": "john_doe",
  "permission": "viewer",
  "shared_by_user_id": 789,
  "shared_by_email": "owner@example.com",
  "shared_by_username": "owner",
  "created_at": "2025-03-28T10:30:00Z",
  "updated_at": "2025-03-28T10:30:00Z"
}
```

**Email Service Function:** `send_share_invitation()`

Located in `services/email.py`:
```python
def send_share_invitation(
    recipient_email: str,
    book_title: str,
    inviter_name: str,
    inviter_email: str,
    invite_link: str,
    permission: str = "viewer",
) -> bool:
    """
    Send share invitation email.
    
    Args:
        recipient_email: Email of user receiving the share
        book_title: Title of the book being shared
        inviter_name: Name of the user sharing the book
        inviter_email: Email of the user sharing the book
        invite_link: Deep link to the shared book
        permission: Permission level (viewer/contributor/editor)
    
    Returns:
        bool: True if email sent successfully, False otherwise
    """
```

## DNS and Domain Configuration

The domain `scriptle.org` is already:
- ✅ Registered at Cloudflare
- ✅ Added to Mailgun account
- ✅ Configured for email sending

No additional DNS configuration is needed unless you want to add SPF/DKIM records (recommended for production):

```
# Add to DNS records:
v=spf1 include:mailgun.org ~all
v=DKIM1; k=rsa; p=YOUR_DKIM_PUBLIC_KEY
```

Check Mailgun dashboard **Domain Verification** section for exact records to add.

## Future Improvements

Potential enhancements to the email feature:

1. **Email Templates:** Customizable templates per user preference
2. **Email Scheduling:** Send invites at specific times
3. **Email Tracking:** Track if recipient opens email or clicks link
4. **Batch Sharing:** Share with multiple users at once
5. **Notification Preferences:** User opt-in/opt-out for share emails
6. **Custom Messages:** Allow sharer to add personal message in email

## Support

For issues or questions:
1. Check Mailgun logs in their dashboard
2. Review this configuration guide
3. Check the troubleshooting section above
4. Review the code in `services/email.py`
