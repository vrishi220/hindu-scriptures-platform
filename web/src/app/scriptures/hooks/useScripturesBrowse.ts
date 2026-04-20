'use client';

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

// Types
export interface BookOption {
  id: number;
  book_name: string;
  title?: string;
  slug?: string;
  status?: string;
  visibility?: 'private' | 'public' | string;
  metadata?: Record<string, unknown> | null;
  metadata_json?: Record<string, unknown> | null;
  schema?: {
    id: number;
    name?: string;
    levels: string[];
    level_template_defaults?: Record<string, number | string | null>;
  } | null;
  variant_authors?: Record<string, string>;
  level_name_overrides?: Record<string, string> | null;
  [key: string]: unknown;
}

export interface BookDetails {
  id: number;
  book_name: string;
  title?: string;
  slug?: string;
  status?: string;
  visibility?: 'private' | 'public' | string;
  metadata?: Record<string, unknown> | null;
  metadata_json?: Record<string, unknown> | null;
  schema: {
    id: number;
    name?: string;
    levels: string[];
    level_template_defaults?: Record<string, number | string | null>;
  };
  variant_authors?: Record<string, string>;
  level_name_overrides?: Record<string, string> | null;
  [key: string]: unknown;
}

export interface TreeNode {
  id: number;
  parent_node_id?: number | null;
  level_name: string;
  level_order?: number | null;
  sequence_number?: number | string | null;
  title_english?: string | null;
  title_hindi?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  has_content?: boolean | null;
  children?: TreeNode[];
}

export interface BookShare {
  id: number;
  [key: string]: unknown;
}

export interface UseScripturesBrowseConfig {
  bookBrowserDensity?: number;
  authEmail?: string | null;
  booksScrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onPrivateBookGateChange?: (gated: boolean) => void;
  nestFlatTreeNodes?: (nodes: TreeNode[]) => TreeNode[];
  contentPath?: (path: string) => string;
}

export interface UseScripturesBrowseReturn {
  // State
  books: BookOption[];
  bookQuery: string;
  bookHasMore: boolean;
  bookLoadingMore: boolean;
  bookId: string | null;
  currentBook: BookDetails | null;
  treeData: TreeNode[];
  treeLoading: boolean;
  treeError: string | null;
  treeReorderingNodeId: number | null;
  treeReorderModeNodeId: number | null;
  privateBookGate: boolean;
  expandedIds: Set<number>;
  selectedId: number | null;
  urlInitialized: boolean;
  breadcrumb: TreeNode[];

  // Handlers
  setBookQuery: (query: string) => void;
  setBooks: (books: BookOption[] | ((prev: BookOption[]) => BookOption[])) => void;
  setBookHasMore: (hasMore: boolean) => void;
  setBookLoadingMore: (loading: boolean) => void;
  setBookId: (id: string | null) => void;
  setCurrentBook: (book: BookDetails | null) => void;
  setTreeData: (data: TreeNode[]) => void;
  setTreeLoading: (loading: boolean) => void;
  setTreeError: (error: string | null) => void;
  setTreeReorderingNodeId: (id: number | null) => void;
  setTreeReorderModeNodeId: (id: SetStateAction<number | null>) => void;
  setPrivateBookGate: (gate: boolean) => void;
  setExpandedIds: (ids: Set<number> | ((prev: Set<number>) => Set<number>)) => void;
  setSelectedId: (id: number | null) => void;
  setUrlInitialized: (initialized: boolean) => void;
  setBreadcrumb: (breadcrumb: TreeNode[]) => void;

  // Action handlers
  loadBooksPage: (options?: { reset?: boolean }) => Promise<void>;
  loadBooks: () => Promise<void>;
  loadTree: (selectedId: string, autoSelectNodeId?: number) => Promise<void>;
  toggleNode: (nodeId: number) => void;
  loadBooksRefresh: () => Promise<void>;
  loadBookShares: () => Promise<void>;
}

const BOOK_ROOT_NODE_ID = 1;
const ANONYMOUS_BOOK_NOT_FOUND_MESSAGE = 'Book not found. Please sign in to access this book.';
const BOOKS_PAGE_SIZE_LIST = 20;
const TREE_CACHE_TTL_MS = 90_000;
const TREE_CACHE_MAX_ENTRIES = 20;
const BOOKS_PAGE_SIZE_BY_DENSITY: Record<number, number> = {
  1: 15,
  2: 20,
  3: 25,
  4: 30,
  5: 40,
};

/**
 * Hook for managing the browse feature area of the scriptures page.
 * Handles book listing, tree navigation, and related state.
 * 
 * This hook encapsulates all browse-related state and handlers that were
 * previously scattered throughout the page component. It manages:
 * - Book listing with pagination and search
 * - Tree node structure loading and navigation
 * - Node expansion/collapse state
 * - Private book access gating for anonymous users
 * - Book share information loading
 */
export function useScripturesBrowse(config: UseScripturesBrowseConfig = {}): UseScripturesBrowseReturn {
  const {
    bookBrowserDensity = 2,
    authEmail = null,
    booksScrollContainerRef,
    nestFlatTreeNodes = (nodes) => nodes,
    contentPath = (path) => path,
  } = config;

  // State
  const [books, setBooks] = useState<BookOption[]>([]);
  const [bookQuery, setBookQuery] = useState('');
  const [bookHasMore, setBookHasMore] = useState(true);
  const [bookLoadingMore, setBookLoadingMore] = useState(false);
  const [bookId, setBookId] = useState<string | null>(null);
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

  // Request tracking refs for books
  const activeBooksAbortController = useRef<AbortController | null>(null);
  const activeBooksRequestId = useRef(0);
  const bookNextOffsetRef = useRef(0);
  const bookHasMoreRef = useRef(true);
  const bookLoadingRef = useRef(false);

  // Request tracking refs for tree
  const activeTreeAbortController = useRef<AbortController | null>(null);
  const activeTreeRequestId = useRef(0);
  const treeCacheRef = useRef<
    Map<
      string,
      {
        cachedAt: number;
        currentBook: BookDetails | null;
        treeData: TreeNode[];
      }
    >
  >(new Map());

  const readTreeCache = useCallback((selectedBookId: string) => {
    const cached = treeCacheRef.current.get(selectedBookId);
    if (!cached) {
      return null;
    }
    const isFresh = Date.now() - cached.cachedAt <= TREE_CACHE_TTL_MS;
    if (!isFresh) {
      treeCacheRef.current.delete(selectedBookId);
      return null;
    }
    treeCacheRef.current.delete(selectedBookId);
    treeCacheRef.current.set(selectedBookId, cached);
    return cached;
  }, []);

  const writeTreeCache = useCallback(
    (selectedBookId: string, nextCurrentBook: BookDetails | null, nextTreeData: TreeNode[]) => {
      if (!selectedBookId) {
        return;
      }
      treeCacheRef.current.set(selectedBookId, {
        cachedAt: Date.now(),
        currentBook: nextCurrentBook,
        treeData: nextTreeData,
      });
      while (treeCacheRef.current.size > TREE_CACHE_MAX_ENTRIES) {
        const oldestKey = treeCacheRef.current.keys().next().value;
        if (!oldestKey) {
          break;
        }
        treeCacheRef.current.delete(oldestKey);
      }
    },
    []
  );

  // Helper: Find path to a node in the tree
  const findPath = (nodes: TreeNode[], targetId: number): TreeNode[] | null => {
    for (const node of nodes) {
      if (node.id === targetId) {
        return [node];
      }
      if (node.children && node.children.length > 0) {
        const childPath = findPath(node.children, targetId);
        if (childPath) {
          return [node, ...childPath];
        }
      }
    }
    return null;
  };

  // Helper: Collect all node IDs from tree
  const collectTreeNodeIds = (nodes: TreeNode[]) => {
    const ids = new Set<number>();
    const visit = (items: TreeNode[]) => {
      items.forEach((node) => {
        ids.add(node.id);
        if (node.children && node.children.length > 0) {
          visit(node.children);
        }
      });
    };
    visit(nodes);
    return ids;
  };

  // Helper: Apply selection to a node with path
  const applySelection = useCallback(
    (nodeId: number, path: TreeNode[], autoSelect = false, force = false, scrollToNode = false) => {
      setSelectedId(nodeId);
      setBreadcrumb(path);
      setExpandedIds((prev) => {
        if (autoSelect) {
          return new Set(path.map((node) => node.id));
        }
        const next = new Set(prev);
        path.forEach((node) => next.add(node.id));
        return next;
      });
    },
    []
  );

  // Load paginated books list
  const loadBooksPage = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      if (!reset && (!bookHasMoreRef.current || bookLoadingRef.current)) {
        return;
      }

      const query = bookQuery.trim();
      const pageSize =
        bookBrowserDensity === 0
          ? BOOKS_PAGE_SIZE_LIST
          : BOOKS_PAGE_SIZE_BY_DENSITY[bookBrowserDensity as 1 | 2 | 3 | 4 | 5];
      const offset = reset ? 0 : bookNextOffsetRef.current;

      if (reset) {
        activeBooksAbortController.current?.abort();
        setBooks([]);
        setBookHasMore(true);
        bookNextOffsetRef.current = 0;
        bookHasMoreRef.current = true;
      }

      const abortController = new AbortController();
      activeBooksAbortController.current = abortController;
      const requestId = activeBooksRequestId.current + 1;
      activeBooksRequestId.current = requestId;

      bookLoadingRef.current = true;
      setBookLoadingMore(true);
      try {
        const params = new URLSearchParams();
        if (query) {
          params.set('q', query);
        }
        params.set('limit', String(pageSize));
        params.set('offset', String(offset));

        const response = await fetch(`/api/books?${params.toString()}`, {
          credentials: 'include',
          signal: abortController.signal,
        });
        if (requestId !== activeBooksRequestId.current) {
          return;
        }

        if (!response.ok) {
          if (reset) {
            setBooks([]);
          }
          setBookHasMore(false);
          bookHasMoreRef.current = false;
          return;
        }

        const data = (await response.json()) as BookOption[];
        if (requestId !== activeBooksRequestId.current) {
          return;
        }

        setBooks((prev) => (reset ? data : [...prev, ...data]));
        const nextOffset = offset + data.length;
        bookNextOffsetRef.current = nextOffset;

        const hasMore = data.length === pageSize;
        setBookHasMore(hasMore);
        bookHasMoreRef.current = hasMore;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        if (reset) {
          setBooks([]);
        }
        setBookHasMore(false);
        bookHasMoreRef.current = false;
      } finally {
        if (requestId === activeBooksRequestId.current) {
          bookLoadingRef.current = false;
          setBookLoadingMore(false);
          if (!reset) {
            if (typeof window !== 'undefined' && booksScrollContainerRef?.current) {
              window.requestAnimationFrame(() => {
                const container = booksScrollContainerRef.current;
                if (!container || !bookHasMoreRef.current || bookLoadingRef.current) {
                  return;
                }
                const distanceToBottom =
                  container.scrollHeight - (container.scrollTop + container.clientHeight);
                const threshold = Math.max(240, container.clientHeight * 0.35);
                if (distanceToBottom <= threshold) {
                  void loadBooksPage();
                }
              });
            }
          }
        }
      }
    },
    [bookQuery, bookBrowserDensity, booksScrollContainerRef]
  );

  // Load initial books list
  const loadBooks = useCallback(async () => {
    await loadBooksPage({ reset: true });
  }, [loadBooksPage]);

  // Load tree structure for a selected book
  const loadTree = useCallback(
    async (selectedBookId: string, autoSelectNodeId?: number) => {
      activeTreeAbortController.current?.abort();
      const abortController = new AbortController();
      activeTreeAbortController.current = abortController;
      const requestId = activeTreeRequestId.current + 1;
      activeTreeRequestId.current = requestId;

      if (!selectedBookId) {
        setTreeData([]);
        setTreeError(null);
        setExpandedIds(new Set());
        setSelectedId(null);
        setBreadcrumb([]);
        setCurrentBook(null);
        setPrivateBookGate(false);
        return;
      }

      // For anonymous users, gate access to private books before API calls
      setPrivateBookGate(false);
      if (!authEmail) {
        const selectedBook = books.find((b) => b.id.toString() === selectedBookId);
        const selectedBookVisibility =
          selectedBook?.visibility ?? selectedBook?.metadata_json?.visibility ?? selectedBook?.metadata?.visibility;
        if (selectedBook && selectedBookVisibility === 'private') {
          setPrivateBookGate(true);
          setTreeData([]);
          setCurrentBook(null);
          return;
        }
      }

      const cachedTree = readTreeCache(selectedBookId);
      if (cachedTree) {
        setTreeError(null);
        setCurrentBook(cachedTree.currentBook);
        setTreeData(cachedTree.treeData);
        setExpandedIds(new Set(cachedTree.treeData.map((node) => node.id)));
        if (autoSelectNodeId) {
          const path = findPath(cachedTree.treeData, autoSelectNodeId);
          if (path) {
            applySelection(autoSelectNodeId, path, true, false);
          } else {
            setSelectedId(BOOK_ROOT_NODE_ID);
            setBreadcrumb([]);
          }
        } else {
          setSelectedId(BOOK_ROOT_NODE_ID);
          setBreadcrumb([]);
        }
        setUrlInitialized(true);
        return;
      }

      setTreeLoading(true);
      setTreeError(null);
      try {
        const detailsPromise = fetch(`/api/books/${selectedBookId}`, {
          credentials: 'include',
          signal: abortController.signal,
        });
        const treePromise = fetch(`/api/books/${selectedBookId}/tree`, {
          credentials: 'include',
          signal: abortController.signal,
        });

        const [detailsResponse, response] = await Promise.all([detailsPromise, treePromise]);
        let resolvedBookDetails: BookDetails | null = null;

        if (requestId !== activeTreeRequestId.current) return;
        if (detailsResponse.ok) {
          const detailsData = (await detailsResponse.json()) as BookDetails;
          if (requestId !== activeTreeRequestId.current) return;
          resolvedBookDetails = detailsData;
          setCurrentBook(detailsData);
        } else {
          setCurrentBook(null);
        }

        if (requestId !== activeTreeRequestId.current) return;
        if (!response.ok) {
          if (!authEmail && response.status === 404) {
            setTreeData([]);
            setCurrentBook(null);
            setSelectedId(null);
            setBreadcrumb([]);
            setTreeError(ANONYMOUS_BOOK_NOT_FOUND_MESSAGE);
            setUrlInitialized(true);
            return;
          }
          if (!authEmail && (response.status === 401 || response.status === 403)) {
            setPrivateBookGate(true);
            setTreeData([]);
            setCurrentBook(null);
            setSelectedId(null);
            setBreadcrumb([]);
            setUrlInitialized(true);
            return;
          }
          const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
          throw new Error(payload?.detail || 'Tree fetch failed');
        }
        const flatData = (await response.json()) as TreeNode[];
        const data = nestFlatTreeNodes(flatData);
        if (requestId !== activeTreeRequestId.current) return;
        setTreeData(data);
        writeTreeCache(selectedBookId, resolvedBookDetails, data);
        setExpandedIds(new Set(data.map((node) => node.id)));

        // Auto-select node if provided in params
        if (autoSelectNodeId) {
          const path = findPath(data, autoSelectNodeId);
          if (path) {
            applySelection(autoSelectNodeId, path, true, false);
          }
        } else {
          setSelectedId(BOOK_ROOT_NODE_ID);
          setBreadcrumb([]);
        }

        setUrlInitialized(true);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        if (requestId !== activeTreeRequestId.current) return;
        setTreeError(err instanceof Error ? err.message : 'Tree fetch failed');
        setUrlInitialized(true);
      } finally {
        if (requestId === activeTreeRequestId.current) {
          setTreeLoading(false);
        }
      }
    },
    [authEmail, books, nestFlatTreeNodes, applySelection, readTreeCache, writeTreeCache]
  );

  useEffect(() => {
    if (!bookId || treeData.length === 0) {
      return;
    }
    writeTreeCache(bookId, currentBook, treeData);
  }, [bookId, currentBook, treeData, writeTreeCache]);

  // Toggle tree node expansion
  const toggleNode = useCallback((nodeId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Refresh books list (reset pagination)
  const loadBooksRefresh = useCallback(async () => {
    await loadBooksPage({ reset: true });
  }, [loadBooksPage]);

  // Re-fetch books when search query changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadBooksPage({ reset: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [bookQuery, loadBooksPage]);

  // Load book sharing information
  const loadBookShares = useCallback(async () => {
    if (!bookId) return;
    try {
      const response = await fetch(`/api/books/${bookId}/shares`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => null)) as BookShare[] | { detail?: string } | null;
      if (!response.ok) {
        throw new Error(
          (payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : '') ||
            'Failed to load book shares'
        );
      }
      // TODO: Handle the shares data based on consuming component needs
    } catch (error) {
      console.error('Failed to load book shares:', error);
    }
  }, [bookId]);

  // Cleanup abort controllers on unmount
  useEffect(() => {
    return () => {
      activeBooksAbortController.current?.abort();
      activeTreeAbortController.current?.abort();
    };
  }, []);

  return {
    // State
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

    // State setters
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

    // Action handlers
    loadBooksPage,
    loadBooks,
    loadTree,
    toggleNode,
    loadBooksRefresh,
    loadBookShares,
  };
}
