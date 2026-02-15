# URL Navigation Flow Diagram

## User Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                    Scripture Browser                           │
└─────────────────────────────────────────────────────────────────┘

SCENARIO 1: Direct URL Visit
═══════════════════════════════
User enters: /scriptures?book=1&node=42
                    ↓
         ┌──────────────────────┐
         │ URL Parameters Read  │
         │ book=1, node=42      │
         └──────────────────────┘
                    ↓
         ┌──────────────────────┐
         │ Book 1 Loads         │
         │ (Bhagavad Gita)      │
         └──────────────────────┘
                    ↓
         ┌──────────────────────┐
         │ Tree Expands         │
         │ Shows All Chapters   │
         └──────────────────────┘
                    ↓
         ┌──────────────────────┐
         │ Node 42 Selected     │
         │ Breadcrumb Updated   │
         └──────────────────────┘
                    ↓
         ┌──────────────────────┐
         │ Content Displayed    │
         │ Verse Full View      │
         └──────────────────────┘


SCENARIO 2: Manual Selection
═══════════════════════════════
User visits: /scriptures
              ↓
     ┌────────────────────┐
     │ Select Book from   │
     │ Dropdown           │
     └────────────────────┘
     URL: /scriptures?book=1
              ↓
     ┌────────────────────┐
     │ Tree Loads         │
     │ (Book 1 Content)   │
     └────────────────────┘
              ↓
     ┌────────────────────┐
     │ Click Verse/Node   │
     │ in Tree            │
     └────────────────────┘
     URL: /scriptures?book=1&node=42
              ↓
     ┌────────────────────┐
     │ Content Shows      │
     │ "Copy Link" Button │
     │ Appears            │
     └────────────────────┘
              ↓
     ┌────────────────────┐
     │ Click Copy Link    │
     │ Button             │
     └────────────────────┘
              ↓
     ┌────────────────────┐
     │ URL Copied to      │
     │ Clipboard          │
     └────────────────────┘
              ↓
     ┌────────────────────┐
     │ Share with Others  │
     │ Email/Chat/Social  │
     └────────────────────┘
              ↓
     ┌────────────────────┐
     │ Recipient Clicks   │
     │ Link               │
     └────────────────────┘
              ↓
     ┌────────────────────┐
     │ Same Verse Shows   │
     │ for Recipient      │
     │ (Scene 1)          │
     └────────────────────┘
```

## Component State Flow

```
Page Load with URL: /scriptures?book=1&node=42
    │
    ├─→ searchParams.get("book") → "1"
    └─→ searchParams.get("node") → "42"
         │
         ├─→ setBookId("1")
         └─→ setUrlInitialized(false)
              │
              ├─→ useEffect watches bookId
              │   and urlInitialized
              │
              ├─→ Calls loadTree("1", 42)
              │
              ├─→ Tree API fetches data
              │   for Book 1
              │
              ├─→ findPath() locates Node 42
              │   in tree structure
              │
              ├─→ Updates:
              │   - setSelectedId(42)
              │   - setExpandedIds(path)
              │   - setBreadcrumb(path)
              │
              ├─→ loadNodeContent(42)
              │   fetches verse content
              │
              └─→ setUrlInitialized(true)
                  (Initialization complete)
```

## URL Update on User Action

```
User selects Verse 15 in Tree
    │
    └─→ selectNode(15) called
        │
        ├─→ setSelectedId(15)
        │
        ├─→ path = findPath(treeData, 15)
        │
        ├─→ setBreadcrumb(path)
        │
        ├─→ setExpandedIds() updated
        │
        ├─→ loadNodeContent(15)
        │
        └─→ router.push(
             `/scriptures?book=1&node=15`
            )
            │
            └─→ Browser Address Bar Updates
                    ↓
                 /scriptures?book=1&node=15
                    ↓
                 Back/Forward History Updated
                    ↓
                 User can now share this URL
```

## Copy Link Feature

```
User has selected Node 42
    │
    └─→ "🔗 Copy link" Button Visible
        │
        └─→ User clicks button
            │
            ├─→ Get current URL:
            │   window.location.origin + 
            │   /scriptures?book=1&node=42
            │
            ├─→ navigator.clipboard.writeText()
            │
            ├─→ Alert: "Link copied!"
            │
            └─→ URL in clipboard:
                http://localhost:3000/scriptures?book=1&node=42
                    │
                    ├─→ paste in email
                    ├─→ paste in chat
                    ├─→ paste in browser
                    ├─→ paste in document
                    └─→ share anywhere!
```

## Browser Back/Forward

```
Scenario: User navigates back through history

Step 1: /scriptures
        ↓
Step 2: /scriptures?book=1
        ↓
Step 3: /scriptures?book=1&node=42
        (User is here - selected Gita 1.42)
        ↓
Clicks Back Button
        ↓
Step 2: /scriptures?book=1
        (Gita loaded, no node selected)
        ↓
Clicks Back Button Again
        ↓
Step 1: /scriptures
        (Back to book selector)
        ↓
Clicks Forward Button
        ↓
Step 2: /scriptures?book=1
        (Gita loaded again)
        ↓
Clicks Forward Button Again
        ↓
Step 3: /scriptures?book=1&node=42
        (Verse 42 selected again)
```

## State Synchronization

```
URL is the Source of Truth
    │
    ├─→ When user manually navigates:
    │   Navigation Action → URL Update
    │   (selectNode → router.push)
    │
    ├─→ When user visits URL directly:
    │   URL Parameters → State Update
    │   (searchParams → setBookId)
    │
    ├─→ When user refreshes page:
    │   URL Persisted → State Restored
    │   (window.location persists → re-render uses new params)
    │
    └─→ When user uses back/forward:
        Browser History → URL Changed → State Updated
        (window handles history → component re-renders)

Result: URL and UI always in sync ✓
```

## Multi-Book Navigation

```
Start: /scriptures?book=1&node=42
       (Reading Bhagavad Gita)
       │
       └─→ User selects "Ramayana" 
           from book dropdown
           │
           ├─→ setBookId("2")
           ├─→ loadTree("2")
           ├─→ setSelectedId(null)
           └─→ setBreadcrumb([])
               │
               └─→ Updated: /scriptures?book=2
                   (Node param removed)
                   (Ramayana tree loaded)
                   (No verse selected yet)
                   │
                   └─→ User clicks verse in Ramayana
                       │
                       ├─→ selectNode(52)
                       └─→ Updated: /scriptures?book=2&node=52
                           (Verse loads, breadcrumb shows path)
```

## Parameter Combinations

```
Parameter Combinations    →    Result
───────────────────────────────────────────────
(none)                    →    Book selector empty
?book=1                   →    Book 1 loaded, tree shown
?book=1&node=5            →    Book 1, Verse 5 auto-selected
?node=5 (no book)         →    Ignored (server error)
?book=999 (invalid)       →    Ignored (book not found)
?book=1&node=999          →    Book 1 loads, node ignored
?book=1&node=&other=xyz   →    book=1 used, other params ignored
```

## Performance Flow

```
Initial Page Load: /scriptures?book=1&node=42
    │
    ├─→ [Fast] Parse URL params (built-in)
    ├─→ [~100ms] Fetch /api/books (books list)
    ├─→ [~200ms] Fetch /api/books/1/tree (tree structure)
    ├─→ [~200ms] Fetch /api/content/nodes/42 (verse content)
    │
    └─→ [~500ms total] Page fully loaded and rendered
        All three requests happen in parallel (async)

Subsequent Navigation: User selects new verse
    │
    ├─→ [Instant] Update URL (client-side)
    ├─→ [~200ms] Fetch /api/content/nodes/15 (just new verse)
    │
    └─→ [~200ms total] Content updates
        No tree re-fetch needed
```

---

## Summary Table

| Action | URL Change | Result | Time |
|--------|-----------|--------|------|
| Load page | None → ?book=1 | Book selector → Book loaded | ~500ms |
| Click verse | ?book=1 → ?book=1&node=42 | Tree selection → Content shown | ~200ms |
| Click different verse | ?book=1&node=42 → ?book=1&node=15 | URL updates → New content | ~200ms |
| Change book | ?book=1&node=42 → ?book=2 | Node param removed → New tree | ~200ms |
| Click back button | Handled by browser | URL reverts → Content updates | ~200ms |
| Share link | No change | Other user visits → Auto-loads | ~500ms |
| Direct URL visit | None (comes from outside) | URL auto-applied → Content loads | ~500ms |

---

**All flows designed for speed and reliability! 🚀**
