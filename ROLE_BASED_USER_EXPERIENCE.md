# Role-Based User Experience (Current Behavior + Review Checklist)

This document captures how the app currently behaves for:
- Owner (resource-level ownership, not a global role)
- Viewer
- Contributor
- Editor
- Moderator
- Admin

It is intended for use-case validation and identifying policy/UX tweaks.

---

## 1) Permission Model Snapshot

### Global role/permission flags
The app evaluates capability using a combination of:
- `role` (viewer/contributor/editor/moderator/admin)
- granular permissions (`can_view`, `can_contribute`, `can_edit`, `can_moderate`, `can_admin`)
- resource ownership (`owner_id` in book metadata, `owner_id` in draft books)
- per-book share permission (`viewer`, `contributor`, `editor`)

### Important implementation notes (as of now)
1. **Viewer currently has contribute rights in backend defaults**
   - `api/auth.py` default registration permissions include `can_contribute: True`
   - `api/users.py` admin-create role map for `viewer` also sets `can_contribute: True`
2. **Frontend admin UI role template says viewer cannot contribute**
   - `web/src/app/admin/page.tsx` role preset for viewer has `can_contribute: false`
   - This is inconsistent with backend defaults above.
3. **`can_moderate` is defined but not meaningfully enforced in route guards**
   - Most restricted actions use `can_edit` or `can_admin` checks.

---

## 2) Shared UX Baseline (All Signed-In Users)

After sign-in:
- Nav shows `Compilations` and `Drafts`
- User can access personal preferences (`/api/preferences`)
- User can manage own compilations/drafts (subject to endpoint checks)

All users (including anonymous) can:
- Read scriptures
- Search content
- Use explorer/read-only flows

---

## 3) Owner UX (Resource-Level)

> Owner is not a separate global role; it means the user owns a specific resource.

### Owner of a **Book**
Current behavior:
- Can edit own private book even without global editor/admin role
- Can publish/unpublish own book (toggle visibility/status)
- Can manage shares for own book
- Can delete own private book
- Cannot delete own public book unless first unpublished (private)

Notable details:
- Book owner ID is tracked in `book.metadata_json.owner_id`
- Book edit/delete in UI is now owner-aware (`canEditCurrentBook`, `canDeleteCurrentBook`)

### Owner of a **Draft Book**
Current behavior:
- Draft routes are owner-scoped (`owner_id == current_user.id`)
- User can CRUD their own drafts/snapshots
- Cannot access another user’s draft directly

### Owner review checklist
- [x] Can owner edit own private book from Scriptures UI?
- [x] Can owner publish and unpublish own book?
- [x] Can owner delete private book but blocked from deleting public book directly?
- [x] Can owner manage shares for own book? **YES - Full CRUD with email invitations**
- [x] Can owner access only own draft books?

---

## 4) Viewer UX

### Intended (typical product expectation)
- Read-only discovery and consumption
- No contribution or editing

### Current behavior in app
- Read/search works as expected
- **Can likely contribute content due to backend default `can_contribute: true`**
  - `Contribute` page grants access if `permissions.can_contribute` is true
  - Node creation endpoint requires `can_contribute`
- Can access `Drafts` and create drafts (draft create currently requires authenticated user, not `can_contribute`)

### Viewer review checklist
- [ ] Should viewer be strictly read-only?
- [ ] If yes, verify viewer can no longer access `/contribute` submit flow
- [ ] If yes, verify viewer cannot create drafts

---

## 5) Contributor UX

Current behavior:
- Can access Contribute page and create nodes (`can_contribute`)
- Can create books (book create checks `_ensure_can_contribute`)
- Cannot use schema edit/delete operations that require `can_edit`
- Can use own drafts/compilations workflows (authenticated features)

Potential nuance:
- Contributor may edit books if shared with contributor-level access, because book edit guard accepts access rank >= 2.

### Contributor review checklist
- [ ] Can contributor create content nodes successfully?
- [ ] Can contributor create books?
- [ ] Is contributor blocked from schema edit/delete admin-like operations?
- [ ] Confirm shared-book contributor permissions match intended policy.

---

## 6) Editor UX

Current behavior:
- Inherits contributor capabilities
- Can perform edit-level operations guarded by `can_edit`
- Can edit across books/content where edit guard allows
- Can delete books under current backend rule (edit-any users can delete)
- Can access Drafts and Compilations
- Does not automatically get admin panel access

### Editor review checklist
- [ ] Can editor update schemas/content requiring `can_edit`?
- [ ] Is editor delete-book power intended (global vs scoped)?
- [ ] Are editor-level share/book actions matching policy?

---

## 7) Moderator UX

### Current behavior
- Role exists in user model/admin UI presets
- Has `can_moderate: true` by preset
- **But moderator-specific powers are not distinctly wired in endpoint guards**
  - Most checks are `can_edit` or `can_admin`
- Practical result: moderator behaves very similarly to editor in most places
- Does not get admin panel unless also `can_admin`

### Moderator review checklist
- [ ] Define what moderation means functionally (flag/review/hide/approve?)
- [ ] Confirm whether moderator should have unique actions not available to editor
- [ ] Add explicit `require_permission("can_moderate")` routes if needed

---

## 8) Admin UX

Current behavior:
- Full access to admin user management
- Can create users, assign roles/permissions, activate/deactivate users, delete eligible users
- Can access metadata admin surfaces and schema management
- Can perform broad edit actions via `can_admin`
- Can delete books irrespective of owner checks that block normal users

### Admin review checklist
- [ ] Can admin access all admin pages and user-management actions?
- [ ] Are any non-admin routes unintentionally blocked for admin?
- [ ] Are destructive actions (user delete/book delete) requiring confirmations as desired?

---

## 9) Key Cross-Role Behaviors to Validate

1. **Navigation gating**
   - `Compilations` and `Drafts` are shown for authenticated users (not role-specific)
   - `Admin` is shown only for `can_admin`/admin role

2. **Contribute gating**
   - Contribute page allows if `can_contribute` OR `can_edit` OR role contributor/editor/admin

3. **Book ownership overlay**
   - Owner can edit own book even without global edit role
   - Owner controls publish toggle and shares

4. **Draft ownership model**
   - Draft APIs are owner-scoped for read/update/delete

5. **Public vs private deletion rule**
   - Non-admin owner cannot delete a public book without unpublishing first

---

## 10) Recommended Tweaks (High Value)

### A) Resolve Viewer permission inconsistency (High priority)
Issue:
- Backend defaults give viewer contribute rights.
- Admin frontend role template says viewer should not contribute.

Recommendation:
- Decide canonical policy for viewer.
- If viewer should be read-only, set `can_contribute: false` in:
  - `api/auth.py` `DEFAULT_PERMISSIONS`
  - `api/users.py` viewer role map
- Add regression tests for new registration/admin-created viewer.

### B) Define Moderator capabilities (High priority)
Issue:
- `can_moderate` exists but has no meaningful distinct route guards.

Recommendation:
- Introduce explicit moderation endpoints/actions guarded by `require_permission("can_moderate")`.
- Add moderator-only UI affordances separate from editor.

### C) Clarify Draft access policy by role (Medium priority)
Issue:
- Any authenticated user can create drafts currently.

Recommendation:
- If drafts should be contributor+ only, enforce `can_contribute` at draft create entry points and UI.

### D) Confirm editor global delete policy (Medium priority)
Issue:
- Editors/admins can delete books beyond ownership.

Recommendation:
- Validate if this is desired.
- If not, tighten delete policy to owner/admin only.

---

## 11) Quick Test Matrix

| Scenario | Expected (Current) |
|---|---|
| Anonymous opens `/scriptures` | Allowed |
| Viewer opens `/contribute` | Likely allowed today (due to permission defaults) |
| Contributor creates content node | Allowed |
| Editor updates schema | Allowed |
| Moderator performs unique moderation action | Not clearly distinct today |
| Admin opens `/admin` | Allowed |
| Non-owner non-editor edits private book | Blocked unless share grants contributor/editor |
| Owner edits own private book | Allowed |
| Owner deletes own public book directly | Blocked (must unpublish first) |
| Admin deletes public book | Allowed |

---

## 12) Proposed Next Step

Run a focused role QA pass in this order:
1. Viewer vs Contributor distinction
2. Owner book lifecycle (create/edit/publish/share/delete)
3. Moderator uniqueness
4. Admin destructive controls

Then lock policy decisions and align backend defaults, route guards, and frontend role templates.
