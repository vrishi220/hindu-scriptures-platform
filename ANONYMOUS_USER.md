# Anonymous User Experience & Flow

This document describes how unauthenticated (anonymous) users interact with the Hindu Scriptures Platform.

## Overview

The platform follows a **read-first, auth-gated contribution** model:
- **Full access** to browse, search, and read all scriptures
- **No registration required** to explore content
- **Authentication required** only to create or modify content

---

## Entry Point: Home Page (`/`)

The home page is the primary entry point for all users, completely **accessible without authentication**.

### Features Available to Anonymous Users

- **Daily Verse Widget**: A date-seeded verse (changes daily) selected from the entire corpus
- **Full-Text Search Bar**: Search across all scriptures by keyword, phrase, book, or chapter
- **Books Overview**: Browsable list of available scripture collections with structure previews
- **Platform Statistics**: Display of total books, nodes, and registered users
- **Sign In / Register CTAs**: Call-to-action buttons promoting account creation
- **User Preferences**: Quick access to language and display format preferences (session-based)

### What Anonymous Users Cannot Do

- Cannot access authenticated-only features (drafts, compilations, admin panel)
- Cannot create or edit content
- Preferences are session-only (not persisted)

---

## Core Experience: Scriptures Browser (`/scriptures`)

The **Scriptures page** is the main reading interface and is **fully public and unauthenticated-accessible**.

### What Anonymous Users Can Do

✅ **Browse & Navigate**
- View complete hierarchical tree of any scripture
- Expand/collapse sections to navigate through books
- Jump to specific verses or chapters via direct URL navigation

✅ **Read Content**
- View Sanskrit text, transliterations, and translations
- Multiple display options (language selection, transliteration scripts)
- Full-text search within individual books

✅ **Manage Display**
- Adjust transliteration script (Devanagari, IAST, ITRANS, etc.)
- Change source language preference (session-based)
- View basket/reading history sidebar

### What Anonymous Users Cannot Do

❌ **Create or Modify**
- No "Add to Basket" button visible
- Cannot create new books or draft editions
- Cannot edit or delete existing content

❌ **Access Advanced Features**
- Contributor or Admin UI elements invisible
- Draft management not available
- Compilation creation unavailable
- Metadata editing disabled

### UI/UX Approach

The interface **gracefully hides** all edit/create/delete controls rather than showing them as disabled. Anonymous users see a read-only view optimized for content discovery.

---

## Exploration: Explorer Page (`/explorer`)

The **Explorer page** allows users to browse and understand scripture structures, useful for learning how content is organized.

### What Anonymous Users Can See

✅ View existing compiled scripture collections
✅ See how others have assembled references across books
✅ Explore hierarchical tree structure of scriptures
✅ Experience the "pick and insert" workflow UI (for reference)

### Technical Note

While the UI is visible, attempting to **save or create** a custom collection requires authentication. The backend will redirect to sign-in if an unauthenticated request is made to a protected creation endpoint.

---

## Navigation: Dynamic NavBar

The **navigation bar adjusts dynamically** based on authentication state.

### Anonymous User NavBar

```
┌──────────────────────────────────────────┐
│ 🏠 Home | 📖 Scriptures | 🔍 Explorer     │
│                         [Sign In] [Register]
└──────────────────────────────────────────┘
```

### Authenticated User NavBar (for comparison)

```
┌──────────────────────────────────────────────────────┐
│ 🏠 Home | 📖 Scriptures | 📚 Compilations | ✍️ Drafts │
│         🔍 Explorer | ⚙️ Admin      [user@email] [⋯]
└──────────────────────────────────────────────────────┘
```

**Key Difference**: `Compilations` and `Drafts` only appear when logged in. Explorer is always visible.

---

## Sign In & Registration

### Initiating Authentication

An anonymous user may initiate sign-in through:

1. **Clicking "Sign In" in NavBar** → Routes to `/signin` page
2. **Attempting to access protected features** → Prompts to log in (e.g., `/compilations`, `/drafts`)
3. **Clicking "Create Compilation"** → Redirects to sign-in if unauthenticated

### Sign In Page (`/signin`)

The sign-in page offers two flows:

#### Register (New User)
- **Fields**: Email, Password, Optional Name
- **Validation**:
  - Email uniqueness check on backend
  - Password strength requirements
  - Duplicate account detection
- **Result**: Creates user with default role (`viewer`)
- **Response**: Automatic login and redirect to scriptures

#### Login (Existing User)
- **Fields**: Email, Password
- **Validation**:
  - Credential verification against password hash
  - User active status check
- **Response**: Issues tokens (access + refresh) in HTTP-only cookies
- **Tokens**:
  - `access_token`: JWT valid for ~15 minutes
  - `refresh_token`: Valid for 30 days, used to obtain new access tokens

### Post-Login State

After successful authentication:

```javascript
// Frontend loads user identity via GET /api/me
{
  id: 42,
  email: "user@example.com",
  role: "viewer",  // or "contributor", "editor", "admin"
  permissions: {
    can_admin: false,
    can_contribute: false,
    can_edit: false
  }
}
```

The UI **re-renders** to show:
- Updated nav bar with `Compilations` and `Drafts` links
- Edit/delete buttons in appropriate contexts
- Admin panel link (if admin role)
- User email and logout option

---

## Typical User Journey: Content Discovery

Here's a common flow for an anonymous user exploring the platform:

```
Step 1: ARRIVES at Home (/)
├─ Sees Daily Verse widget
├─ Reads platform blurb and statistics
├─ Uses search bar to find "Bhagavad Gita Chapter 2"
└─ Clicks first search result

Step 2: NAVIGATES to Scripture (/scriptures?book_id=1&node_id=...)
├─ Left sidebar: Full hierarchical tree (Bhagavad Gita structure)
├─ Center: Content display (Sanskrit, transliteration, English translation)
├─ Right sidebar: Search box, basket (empty), preferences
└─ Can see full content of every verse

Step 3: EXPLORES DEEPLY
├─ Clicks verse by verse in tree
├─ Uses search to find all references to "dharma"
├─ Switches language and transliteration options
├─ Expand/collapse chapters and sections
└─ Content loads via page URL parameters (stateless navigation)

Step 4: DISCOVERS COMPILATION FEATURE
├─ Clicks "Explorer" in nav bar
├─ Views example compiled editions
├─ Sees UI for assembling references
└─ Clicks "Create My Compilation" → Redirected to Sign In

Step 5: (Optional) CREATES ACCOUNT
├─ Fills registration form (email, password, name)
├─ Account created with "viewer" role
├─ Automatically logged in
├─ Redirected to Compilations page
└─ Can now create personal compilations

OR (Optional) LEAVES WITHOUT Signing Up
├─ Backtracks to Scriptures
├─ Continues reading
├─ Closes browser
```

---

## Backend Access Control

The backend enforces authentication via role-based and endpoint-level guards.

### Public Endpoints (No Auth Required)

```
GET  /api/content/books              # List available books
GET  /api/content/nodes/{id}         # Read scripture content
GET  /api/search                     # Full-text search
GET  /api/daily-verse                # Fetch daily verse
GET  /api/stats                      # Platform statistics
GET  /api/compilations/public        # Browse public compilations
GET  /api/edition-snapshots/{id}     # View published editions
```

### Optional Auth Endpoints (Work with or without Auth)

```
GET  /api/nodes/{id}                 # View nodes (auth optional for metadata)
GET  /api/content/nodes/{id}         # Detailed node content
```

### Protected Endpoints (Auth Required)

```
GET  /api/me                         # 401 if not authenticated
GET  /api/compilations/my            # 401 - requires user identity
POST /api/compilations               # 401 - requires user to own
GET  /api/draft-books/my             # 401 - requires user identity
POST /api/draft-books                # 401 - requires editor/contributor
PATCH /api/draft-books/{id}          # 401 - requires creator/editor/admin
DELETE /api/books/{id}               # 403 - requires owner or admin
```

### Error Response (Anonymous Access to Protected Endpoint)

```json
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "detail": "Invalid token"
}
```

---

## URL-Based State Management

The platform uses **URL parameters** to preserve anonymous user navigation context.

### Example URL

```
/scriptures?book_id=1&node_id=42&expanded_ids=1,2,5,10
```

**Parameters**:
- `book_id`: Currently selected scripture
- `node_id`: Currently selected verse/chapter
- `expanded_ids`: Tree sections currently open
- `scroll_position`: (preserved via SessionStorage)

### Benefits for Anonymous Users

- ✅ Browser back/forward works naturally
- ✅ Can share URLs showing exact location in scripture
- ✅ No session required to preserve location
- ✅ Refresh page returns to same location

---

## Authentication & Token Management

### How Token Refresh Works

The frontend uses a two-token system:

1. **Access Token** (short-lived, ~15 min)
   - Sent with every protected request
   - Stored in HTTP-only cookie (secure against XSS)
   - Not accessible to JavaScript

2. **Refresh Token** (long-lived, 30 days)
   - Also stored in HTTP-only cookie
   - Used only to obtain new access tokens
   - Never sent to frontend JavaScript

### Token Refresh Flow

```
User makes API request
├─ Access token still valid?
│  ├─ YES → Request succeeds
│  └─ NO → Check refresh token
├─ Refresh token valid?
│  ├─ YES → Get new access token, retry request
│  └─ NO → Redirect to login (/signin)
```

This is **automatic and transparent** to the user—they don't see token management.

---

## Features Comparison: Anonymous vs. Authenticated

| Feature | Anonymous | Authenticated |
|---------|-----------|---------------|
| **Reading** | ✅ Full access | ✅ Full access |
| **Search** | ✅ Full-text search | ✅ Full-text + filters |
| **Preferences** | ⚠️ Session-only (localStorage) | ✅ Persisted to DB |
| **Basket/History** | ✅ Session only | ✅ Persisted |
| **Create Compilations** | ❌ No | ✅ Yes (all users) |
| **Create Books** | ❌ No | ✅ Editors/Admins only |
| **Edit Books** | ❌ No | ✅ Owners/Editors/Admins |
| **Delete Books** | ❌ No | ✅ Owners/Admins only |
| **Draft Editor** | ❌ No | ✅ Yes (editors/admins) |
| **Admin Panel** | ❌ No | ✅ Admins only |
| **User Management** | ❌ No | ✅ Admins only |

---

## Design Philosophy

1. **Read-First Model**: All content is freely accessible without friction
2. **Low Auth Barrier**: Users can explore extensively before deciding to create an account
3. **Graceful Degradation**: UI hides unavailable features rather than showing disabled buttons
4. **Stateless Navigation**: URL-based state allows bookmarking and sharing
5. **Permission Layering**: Role-based (admin/editor/contributor) + ownership-based (can edit own content) access control
6. **Transparent Token Handling**: Auth tokens managed server-side; users remain unaware of refresh cycles

---

## Security Considerations

### For Anonymous Users

- No PII required to browse
- No tracking or profiling
- All content access is logged on backend
- No local storage of sensitive data

### Session Safety

- Preferences stored in browser SessionStorage (cleared on browser close)
- No persistent cookies for anonymous users
- URLs are the only persistent state mechanism

---

## Conclusion

Anonymous users in the Hindu Scriptures Platform experience a **rich, fully-featured reading and exploration interface** with zero friction to get started. The platform is designed for **discovery and learning**, with authentication acting as an optional gateway to **contribution and curation** features.

The experience gracefully transitions from anonymous browsing to authenticated creation, encouraging users to explore deeply before deciding whether they want to contribute.
