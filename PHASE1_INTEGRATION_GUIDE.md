# Phase 1 Integration Guide: useScripturesBrowse Hook

## Overview
Integration of `useScripturesBrowse` hook into `/web/src/app/scriptures/page.tsx` (ScripturesContent component) to extract browse feature area from the monolithic component.

## State Migration Map

### States to Import from Hook
The following page-level states should be obtained from `useScripturesBrowse`:
```
- books
- bookQuery  
- bookHasMore
- bookLoadingMore
- bookId
- currentBook
- treeData
- treeLoading
- treeError
- treeReorderingNodeId
- treeReorderModeNodeId
- privateBookGate
- expandedIds
- selectedId
- urlInitialized
- breadcrumb
```

### Handlers to Import from Hook
```
- loadBooksPage
- loadBooks
- loadTree
- toggleNode
- loadBooksRefresh
- loadBookShares
```

### States to Keep in Page Component
These states are interdependent with other features and should remain in page.tsx:
```
- authEmail (needed by hook, but set in page's auth flow)
- bookBrowserDensity (config for hook)
- nodeContent (part of content/preview feature)
- treeReorderingNodeId, treeReorderModeNodeId (cross-feature with edit)
- And all non-browse feature states (edit, preview, PDF, multimedia)
```

## Configuration Required

The hook accepts this config:
```typescript
useScripturesBrowse({
  bookBrowserDensity,      // Current page state
  authEmail,               // Current page state
  booksScrollContainerRef, // Create new ref in page
  nestFlatTreeNodes,       // Import from page's utility function
  contentPath,             // Already available as import
})
```

## Integration Steps

### Step 1: Add Import and Ref (Line ~2210)
```typescript
import { useScripturesBrowse } from './hooks/useScripturesBrowse';

// In component:
const booksScrollContainerRef = useRef<HTMLDivElement>(null);
```

### Step 2: Remove Duplicate State (Lines ~2222-2236)
DELETE these 18 lines of useState declarations:
```typescript
// REMOVE:
const [books, setBooks] = useState<BookOption[]>([]);
const [bookQuery, setBookQuery] = useState("");
const [bookHasMore, setBookHasMore] = useState(true);
const [bookLoadingMore, setBookLoadingMore] = useState(false);
const [bookId, setBookId] = useState("");
const [currentBook, setCurrentBook] = useState<BookDetails | null>(null);
const [treeData, setTreeData] = useState<TreeNode[]>([]);
const [treeLoading, setTreeLoading] = useState(false);
const [treeError, setTreeError] = useState<string | null>(null);
const [treeReorderingNodeId, setTreeReorderingNodeId] = useState<number | null>(null);
const [treeReorderModeNodeId, setTreeReorderModeNodeId] = useState<number | null>(null);
const [privateBookGate, setPrivateBookGate] = useState(false);
const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
const [selectedId, setSelectedId] = useState<number | null>(null);
const [urlInitialized, setUrlInitialized] = useState(false);
const [breadcrumb, setBreadcrumb] = useState<TreeNode[]>([]);
```

### Step 3: Add Hook Call (Line ~2222)
```typescript
const {
  books,
  bookQuery,
  bookHasMore,
  bookLoadingMore,
  bookId,
  currentBook,
  treeData,
  treeLoading,
  treeError,
  treeReorderingNodeId,
  treeReorderModeNodeId,
  privateBookGate,
  expandedIds,
  selectedId,
  urlInitialized,
  breadcrumb,
  setBookQuery,
  setBooks,
  setBookHasMore,
  setBookLoadingMore,
  setBookId,
  setCurrentBook,
  setTreeData,
  setTreeLoading,
  setTreeError,
  setTreeReorderingNodeId,
  setTreeReorderModeNodeId,
  setPrivateBookGate,
  setExpandedIds,
  setSelectedId,
  setUrlInitialized,
  setBreadcrumb,
  loadBooksPage,
  loadBooks,
  loadTree,
  toggleNode,
  loadBooksRefresh,
  loadBookShares,
} = useScripturesBrowse({
  bookBrowserDensity,
  authEmail,
  booksScrollContainerRef,
  nestFlatTreeNodes,
  contentPath: (path: string) => contentPath(path),
});
```

### Step 4: Remove Duplicate Handler Implementations
DELETE these handler implementations from page.tsx:
- `loadBooksPage` (currently at line ~5533)
- `loadBooks` (currently at line ~5634)
- `loadTree` (currently at line ~5646)
- `toggleNode` (currently at line ~5890)
- `loadBooksRefresh` (currently at line ~7303)
- `loadBookShares` (currently at line ~7307)

Also remove these useEffect hooks related to book loading:
- useEffect for loadBooks (line ~5632)
- useEffect for cleanup (line ~5642)

### Step 5: Update Handler Dependencies
The following handlers use the hook's handlers and should continue working as-is:
- Any calls to `loadTree()` continue unchanged
- Any calls to `toggleNode()` continue unchanged
- Any calls to `loadBooksPage()` continue unchanged

## Ref Management
The hook manages its own abort controllers for request cancellation. No additional cleanup is needed beyond what the hook provides.

## Testing Strategy
1. Unit tests for the hook itself (already created in `__tests__/useScripturesBrowse.test.ts`)
2. Component integration tests to verify page works after integration
3. Manual testing of:
   - Book browsing and pagination
   - Tree navigation
   - Private book gating
   - Node expansion/collapse

## Risk Mitigation
- The hook is self-contained with no external side effects beyond API calls
- Request cancellation is handled internally via abort controllers
- All state transformations are pure functions
- Page component behavior should be identical after integration

## Rollback Plan
If issues arise:
1. Revert the page.tsx changes (remove hook call, restore state declarations and handlers)
2. Keep the hook in the codebase for future use
3. The PDF tests remain as regression coverage

## Lines Changed Summary
- ~2210: Add import and ref
- ~2222-2290: Replace 18 useState declarations + 600+ lines of handlers with single hook call  
- ~5533-5640: Delete loadBooksPage, loadBooks, and related useEffects
- ~5646-5755: Delete loadTree
- ~5890-5899: Delete toggleNode
- ~7303-7335: Delete loadBooksRefresh, loadBookShares
- Net result: ~1100 lines removed from page.tsx, logic moved to hook
