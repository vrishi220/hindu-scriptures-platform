"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, MoreVertical, ShoppingBasket, SlidersHorizontal } from "lucide-react";
import { contentPath } from "../lib/apiPaths";
import { getMe, invalidateMeCache } from "../lib/authClient";
import BasketPanel from "../components/BasketPanel";
import UserPreferencesDialog, {
  type UserPreferences,
} from "../components/UserPreferencesDialog";
import { normalizeTransliterationScript } from "../lib/indicScript";
import {
  applyUiPreferencesToDocument,
  normalizeUiDensity,
  normalizeUiTheme,
  persistUiPreferences,
  readStoredUiPreferences,
} from "../lib/uiPreferences";

type SearchNode = {
  id: number;
  book_id: number;
  title_english?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  level_name: string;
  sequence_number?: number | null;
  content_data?: {
    basic?: {
      sanskrit?: string;
      transliteration?: string;
    };
    translations?: {
      english?: string;
    };
  };
};

type SearchResult = {
  node: SearchNode;
  snippet?: string | null;
};

type SearchResponse = {
  query: string;
  total: number;
  results: SearchResult[];
};

type BookOption = {
  id: number;
  book_name: string;
  schema?: {
    id: number;
    name: string;
    description?: string | null;
    levels: string[];
  } | null;
};

type TreeNode = {
  id: number;
  level_name: string;
  sequence_number?: number | null;
  title_english?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  children?: TreeNode[];
};

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [bookId, setBookId] = useState("");
  const [levelName, setLevelName] = useState("");
  const [hasContent, setHasContent] = useState(false);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setAuthMessage] = useState<string | null>(null);
  const [, setAuthStatus] = useState<string | null>(null);
  const [canAdmin, setCanAdmin] = useState(false);
  const [canContribute, setCanContribute] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [, setShowLogin] = useState(false);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState<string | null>(null);
  const [showPreferencesDialog, setShowPreferencesDialog] = useState(false);
  const [, setTreeData] = useState<TreeNode[]>([]);
  const [, setTreeLoading] = useState(false);
  const [, setTreeError] = useState<string | null>(null);
  const treeCacheRef = useRef<Map<string, TreeNode[]>>(new Map());
  const [, setCachedTreeBooks] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<{
    books_count: number;
    nodes_count: number;
    users_count: number;
  } | null>(null);
  const [dailyVerse, setDailyVerse] = useState<{
    id: number;
    title: string;
    content: string;
    book_name: string;
    book_id: number;
    node_id?: number;
  } | null>(null);
  const [verseMode, setVerseMode] = useState<"daily" | "random">("daily");
  const [isReorderingBasket, setIsReorderingBasket] = useState(false);
  const [basketItems, setBasketItems] = useState<Array<{
    cart_item_id?: number;
    node_id: number;
    title?: string;
    book_name?: string;
    level_name?: string;
    order: number;
  }>>([]);
  const [openResultActionsId, setOpenResultActionsId] = useState<number | null>(null);
  const resultActionsMenuRef = useRef<HTMLDivElement | null>(null);

  const loadBasket = async () => {
    try {
      const response = await fetch("/api/cart/me", { credentials: "include" });
      if (!response.ok) {
        setBasketItems([]);
        return;
      }
      const data = (await response.json()) as {
        items?: Array<{
          id: number;
          item_id: number;
          order: number;
          metadata?: {
            title?: string;
            book_name?: string;
            level_name?: string;
          };
        }>;
      };

      const mappedItems = (data.items || [])
        .map((item) => ({
          cart_item_id: item.id,
          node_id: item.item_id,
          title: item.metadata?.title,
          book_name: item.metadata?.book_name,
          level_name: item.metadata?.level_name,
          order: item.order,
        }))
        .sort((a, b) => a.order - b.order);

      setBasketItems(mappedItems);
    } catch {
      setBasketItems([]);
    }
  };

  const addToBasket = (nodeId: number, title: string, bookName?: string, levelName?: string) => {
    void (async () => {
      if (basketItems.some((item) => item.node_id === nodeId)) {
        return;
      }

      try {
        const response = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            item_id: nodeId,
            item_type: "library_node",
            metadata: {
              title,
              book_name: bookName,
              level_name: levelName,
            },
          }),
        });

        if (response.status === 409) {
          await loadBasket();
          return;
        }

        if (!response.ok) {
          return;
        }

        const item = (await response.json()) as {
          id: number;
          item_id: number;
          order: number;
          metadata?: {
            title?: string;
            book_name?: string;
            level_name?: string;
          };
        };

        setBasketItems((prev) =>
          [...prev, {
            cart_item_id: item.id,
            node_id: item.item_id,
            title: item.metadata?.title || title,
            book_name: item.metadata?.book_name || bookName,
            level_name: item.metadata?.level_name || levelName,
            order: item.order,
          }].sort((a, b) => a.order - b.order)
        );
      } catch {
        // ignore basket add failures for now
      }
    })();
  };

  const removeFromBasket = (nodeId: number) => {
    void (async () => {
      const target = basketItems.find((item) => item.node_id === nodeId);
      if (!target?.cart_item_id) {
        setBasketItems((prev) => prev.filter((item) => item.node_id !== nodeId));
        return;
      }

      try {
        const response = await fetch(`/api/cart/items/${target.cart_item_id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!response.ok && response.status !== 404) {
          return;
        }
        setBasketItems((prev) => prev.filter((item) => item.node_id !== nodeId));
      } catch {
        // ignore basket remove failures for now
      }
    })();
  };

  const clearBasket = () => {
    void (async () => {
      try {
        await fetch("/api/cart/me", {
          method: "DELETE",
          credentials: "include",
        });
      } finally {
        setBasketItems([]);
      }
    })();
  };

  const moveBasketItem = (nodeId: number, direction: "up" | "down") => {
    void (async () => {
      if (isReorderingBasket) return;

      setIsReorderingBasket(true);
      const current = [...basketItems].sort((a, b) => a.order - b.order);
      const index = current.findIndex((item) => item.node_id === nodeId);
      if (index === -1) {
        setIsReorderingBasket(false);
        return;
      }

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        setIsReorderingBasket(false);
        return;
      }

      const [moved] = current.splice(index, 1);
      current.splice(targetIndex, 0, moved);

      const reordered = current.map((item, idx) => ({ ...item, order: idx }));
      setBasketItems(reordered);

      const itemOrder = reordered
        .map((item) => item.cart_item_id)
        .filter((id): id is number => typeof id === "number");

      if (itemOrder.length !== reordered.length) {
        await loadBasket();
        return;
      }

      try {
        const response = await fetch("/api/cart/items/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ item_order: itemOrder }),
        });

        if (!response.ok) {
          await loadBasket();
        }
      } catch {
        await loadBasket();
      } finally {
        setIsReorderingBasket(false);
      }
    })();
  };

  const loadBooks = async () => {
    try {
      const response = await fetch("/api/books", { credentials: "include" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as BookOption[];
      setBooks(data);
    } catch {
      setBooks([]);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch("/api/stats", { credentials: "include" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as {
        books_count: number;
        nodes_count: number;
        users_count: number;
      };
      setStats(data);
    } catch {
      // Ignore errors
    }
  };

  const loadDailyVerse = async (mode: "daily" | "random" = "daily") => {
    try {
      const response = await fetch(`/api/daily-verse?mode=${mode}`, { credentials: "include" });
      if (!response.ok) {
        console.error("Failed to load verse:", response.status);
        // Set a sentinel value to indicate no content
        setDailyVerse({ id: 0, title: "", content: "", book_name: "", book_id: 0 });
        return;
      }
      const data = (await response.json()) as {
        id: number;
        title: string;
        content: string;
        book_name: string;
        book_id: number;
        node_id?: number;
      } | null;
      
      // If no verse found, set empty state
      if (!data) {
        setDailyVerse({ id: 0, title: "", content: "", book_name: "", book_id: 0 });
      } else {
        setDailyVerse(data);
      }
    } catch (err) {
      console.error("Error loading verse:", err);
      setDailyVerse({ id: 0, title: "", content: "", book_name: "", book_id: 0 });
    }
  };

  const loadAuthStatus = async () => {
    try {
      const data = await getMe();
      if (!data) {
        setAuthStatus("Not authenticated");
        setAuthEmail(null);
        setCanAdmin(false);
        setCanContribute(false);
        setCanEdit(false);
        return;
      }
      setAuthEmail(data.email || null);
      setAuthStatus(data.email ? `Signed in as ${data.email}` : "Authenticated");
      setCanAdmin(Boolean(data.permissions?.can_admin || data.role === "admin"));
      setCanContribute(Boolean(data.permissions?.can_contribute || data.role === "contributor" || data.role === "editor" || data.role === "admin"));
      setCanEdit(Boolean(data.permissions?.can_edit || data.role === "editor" || data.role === "admin"));
    } catch (err) {
      console.error("Auth check error:", err);
      setAuthStatus("Auth check failed");
      setCanAdmin(false);
      setCanContribute(false);
      setCanEdit(false);
    }
  };

  const loadPreferences = async () => {
    try {
      const storedUi = readStoredUiPreferences();
      const response = await fetch("/api/preferences", { credentials: "include" });
      if (!response.ok) {
        setPreferences(null);
        return;
      }
      const data = (await response.json()) as UserPreferences;
      setPreferences({
        ...data,
        transliteration_script: normalizeTransliterationScript(
          data.transliteration_script
        ),
        show_only_preferred_script: data.show_only_preferred_script ?? false,
        ui_theme: normalizeUiTheme(storedUi?.ui_theme ?? data.ui_theme),
        ui_density: normalizeUiDensity(storedUi?.ui_density ?? data.ui_density),
      });
    } catch {
      setPreferences(null);
    }
  };

  const savePreferences = async () => {
    if (!preferences) return;
    try {
      setPreferencesSaving(true);
      setPreferencesMessage(null);
      persistUiPreferences(preferences);
      const response = await fetch("/api/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      const payload = (await response.json().catch(() => null)) as
        | { detail?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to save preferences");
      }
      setPreferencesMessage("Preferences saved");
    } catch (err) {
      setPreferencesMessage(
        err instanceof Error ? err.message : "Failed to save preferences"
      );
    } finally {
      setPreferencesSaving(false);
      setTimeout(() => setPreferencesMessage(null), 2000);
    }
  };

  useEffect(() => {
    applyUiPreferencesToDocument(preferences);
  }, [preferences]);


  useEffect(() => {
    const init = async () => {
      await Promise.all([
        loadBooks(),
        loadAuthStatus(),
        loadBasket(),
        loadStats(),
        loadDailyVerse("daily"),
      ]);
      
      // Restore search state from URL after books are loaded
      const urlQuery = searchParams.get("q");
      const urlBookId = searchParams.get("book_id");
      const urlLevelName = searchParams.get("level_name");
      const urlHasContent = searchParams.get("has_content");
      
      if (urlQuery) {
        setQuery(urlQuery);
        if (urlBookId) setBookId(urlBookId);
        if (urlLevelName) setLevelName(urlLevelName);
        if (urlHasContent) setHasContent(urlHasContent === "true");
        // Run search after state is set
        setTimeout(() => {
          runSearch(urlQuery, urlBookId || "", urlLevelName || "", urlHasContent === "true");
        }, 50);
      }
    };
    
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authEmail) {
      setPreferences(null);
      return;
    }
    void loadPreferences();
  }, [authEmail]);

  // Restore scroll position after results are loaded
  useEffect(() => {
    if (results.length > 0) {
      const savedScrollY = sessionStorage.getItem("searchScrollY");
      if (savedScrollY) {
        // Use requestAnimationFrame to ensure DOM is fully rendered
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.scrollTo(0, parseInt(savedScrollY, 10));
            sessionStorage.removeItem("searchScrollY");
          });
        });
      }
    }
  }, [results]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!resultActionsMenuRef.current) return;
      const target = event.target as Node;
      if (!resultActionsMenuRef.current.contains(target)) {
        setOpenResultActionsId(null);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  const runSearch = async (term: string, searchBookId?: string, searchLevelName?: string, searchHasContent?: boolean) => {
    const searchTerm = term || query;
    const finalBookId = searchBookId !== undefined ? searchBookId : bookId;
    const finalLevelName = searchLevelName !== undefined ? searchLevelName : levelName;
    const finalHasContent = searchHasContent !== undefined ? searchHasContent : hasContent;
    
    if (!searchTerm.trim()) {
      setResults([]);
      setTotal(0);
      // Clear URL params
      router.push("/", { scroll: false });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: searchTerm,
        limit: "10",
      });
      if (finalBookId.trim()) {
        params.set("book_id", finalBookId.trim());
      }
      if (finalLevelName.trim()) {
        params.set("level_name", finalLevelName.trim());
      }
      if (finalHasContent) {
        params.set("has_content", "true");
      }

      const response = await fetch(`/api/search?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Search failed. Try again.");
      }
      const data = (await response.json()) as SearchResponse;
      setResults(data.results || []);
      setTotal(data.total || 0);
      
      // Load trees for all books in results for breadcrumb rendering
      if (data.results && data.results.length > 0) {
        await loadTreeForBooksInResults(data.results);
      }
      
      // Update URL with search params
      const urlParams = new URLSearchParams({ q: searchTerm });
      if (finalBookId.trim()) urlParams.set("book_id", finalBookId.trim());
      if (finalLevelName.trim()) urlParams.set("level_name", finalLevelName.trim());
      if (finalHasContent) urlParams.set("has_content", "true");
      router.push(`/?${urlParams.toString()}`, { scroll: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runSearch(query);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const quickSearch = (term: string) => {
    setQuery(term);
    setTimeout(() => runSearch(term), 0);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthMessage(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(async () => {
          const text = await response.text().catch(() => "");
          return text ? { detail: text } : null;
        })) as { detail?: string; message?: string } | null;
        const detail = payload?.detail || payload?.message || "Login failed";
        throw new Error(`Login failed (${response.status}): ${detail}`);
      }
      setAuthMessage("Logged in. Refreshing book list...");
      setEmail("");
      setPassword("");
      setShowLogin(false);
      invalidateMeCache();
      await loadBooks();
      await loadAuthStatus();
      await loadBasket();
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Login failed");
    }
  };

  const loadTree = async (selectedId: string) => {
    if (!selectedId) {
      setTreeData([]);
      setTreeError(null);
      return;
    }
    // Check cache first
    if (treeCacheRef.current.has(selectedId)) {
      setTreeData(treeCacheRef.current.get(selectedId) || []);
      setTreeError(null);
      return;
    }
    setTreeLoading(true);
    setTreeError(null);
    try {
      const response = await fetch(`/api/books/${selectedId}/tree`, {
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(payload?.detail || "Tree fetch failed");
      }
      const data = (await response.json()) as TreeNode[];
      // Cache the tree data
      treeCacheRef.current.set(selectedId, data);
      setCachedTreeBooks(prev => new Set([...prev, selectedId]));
      setTreeData(data);
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : "Tree fetch failed");
    } finally {
      setTreeLoading(false);
    }
  };

  const getTreeForBook = (bookIdStr: string): TreeNode[] => {
    return treeCacheRef.current.get(bookIdStr) || [];
  };

  const loadTreeForBooksInResults = async (resultsList: SearchResult[]) => {
    if (!resultsList || resultsList.length === 0) return;
    
    // Get unique book IDs from results
    const uniqueBookIds = new Set<string>();
    resultsList.forEach(result => {
      uniqueBookIds.add(result.node.book_id.toString());
    });

    // Load trees for any books we don't have cached yet
    for (const bookIdStr of uniqueBookIds) {
      if (!treeCacheRef.current.has(bookIdStr)) {
        try {
          const response = await fetch(`/api/books/${bookIdStr}/tree`, {
            credentials: "include",
          });
          if (response.ok) {
            const data = (await response.json()) as TreeNode[];
            treeCacheRef.current.set(bookIdStr, data);
            setCachedTreeBooks(prev => new Set([...prev, bookIdStr]));
          }
        } catch (err) {
          console.error(`Failed to load tree for book ${bookIdStr}:`, err);
        }
      }
    }
  };

  const formatValue = (value: unknown) => {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number") {
      return value.toString();
    }
    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return "[object]";
      }
    }
    return "";
  };

  // Helper function to build breadcrumb path for a node from tree
  const buildNodePath = (nodeId: number, nodes: TreeNode[]): TreeNode[] => {
    // Build path from root to target node
    const buildFullPath = (id: number, nodeList: TreeNode[], currentPath: TreeNode[] = []): TreeNode[] | null => {
      for (const node of nodeList) {
        if (node.id === id) {
          return [...currentPath, node];
        }
        if (node.children) {
          const result = buildFullPath(id, node.children, [...currentPath, node]);
          if (result) return result;
        }
      }
      return null;
    };

    const fullPath = buildFullPath(nodeId, nodes);
    return fullPath || [];
  };

  const renderBreadcrumb = (result: SearchResult, bookName?: string) => {
    const bookBookId = result.node.book_id;
    const currentBook = books.find(b => b.id === bookBookId);
    // Use cached tree for the result's book
    const treeForBook = getTreeForBook(bookBookId.toString());

    let pathNodes: TreeNode[] = [];
    if (treeForBook.length > 0) {
      pathNodes = buildNodePath(result.node.id, treeForBook);
    }

    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
        <span className="font-medium">{bookName || currentBook?.book_name || "Book"}</span>
        {pathNodes.length > 0 && (
          <>
            <span className="text-zinc-400">/</span>
            {pathNodes.map((node, idx) => (
              <div key={`${node.id}-crumb`} className="flex items-center gap-1.5">
                <span className="text-zinc-500">
                  {node.title_english || node.title_sanskrit || node.title_transliteration || `${node.level_name} ${node.sequence_number || ''}`}
                </span>
                {idx < pathNodes.length - 1 && <span className="text-zinc-400">/</span>}
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const renderTree = (nodes: TreeNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.id} className="mt-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className="rounded-full border border-black/10 bg-white/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-zinc-500"
            style={{ marginLeft: `${depth * 12}px` }}
          >
            {formatValue(node.level_name) || "Level"}
          </span>
          {node.sequence_number !== null && node.sequence_number !== undefined && (
            <span className="text-xs text-zinc-500">#{node.sequence_number}</span>
          )}
          <button
            type="button"
            onClick={() => {
              window.location.href = "/scriptures";
            }}
            className="flex items-center gap-2 rounded-lg border-2 border-black/20 bg-blue-50 px-3 py-2 text-sm font-medium text-[color:var(--deep)] transition hover:border-[color:var(--accent)] hover:shadow-md"
          >
            <span>
              {formatValue(node.title_english) ||
                formatValue(node.title_sanskrit) ||
                formatValue(node.title_transliteration) ||
                `Verse ${node.sequence_number || node.id}`}
            </span>
            <span className="text-xs opacity-60">→</span>
          </button>
          {canContribute && (node.level_name?.toUpperCase() === "BOOK" || node.level_name?.toUpperCase() === "CHAPTER") && (
            <button
              type="button"
              onClick={() => {
                window.location.href = "/contribute";
              }}
              title={`Add ${node.level_name?.toUpperCase() === "BOOK" ? "Chapter" : "Verse"}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-green-500/30 bg-green-50 text-sm text-green-700 transition hover:border-green-500/60 hover:shadow-md"
            >
              +
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                window.location.href = "/contribute";
              }}
              title="Edit"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-blue-500/30 bg-blue-50 text-sm text-blue-700 transition hover:border-blue-500/60 hover:shadow-md"
            >
              ✎
            </button>
          )}
          {canAdmin && (
            <button
              type="button"
              onClick={async () => {
                if (window.confirm("Delete this node? This cannot be undone.")) {
                  try {
                    await fetch(contentPath(`/nodes/${node.id}`), {
                      method: "DELETE",
                      credentials: "include",
                    });
                    // Refresh the tree
                    if (bookId) {
                      loadTree(bookId);
                    }
                  } catch {
                    alert("Failed to delete");
                  }
                }
              }}
              title="Delete"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/30 bg-red-50 text-sm text-red-700 transition hover:border-red-500/60 hover:shadow-md"
            >
              🗑
            </button>
          )}
        </div>
        {node.children && node.children.length > 0 && (
          <div className="ml-3 border-l border-black/10 pl-3">
            {renderTree(node.children, depth + 1)}
          </div>
        )}
      </div>
    ));
  };

  const featuredBooks = [...books]
    .sort((left, right) => {
      const leftVisibility = (left as BookOption & { visibility?: string }).visibility;
      const rightVisibility = (right as BookOption & { visibility?: string }).visibility;
      const leftStatus = (left as BookOption & { status?: string }).status;
      const rightStatus = (right as BookOption & { status?: string }).status;

      const leftPublicRank = leftVisibility === "public" ? 0 : 1;
      const rightPublicRank = rightVisibility === "public" ? 0 : 1;
      if (leftPublicRank !== rightPublicRank) {
        return leftPublicRank - rightPublicRank;
      }

      const leftPublishedRank = leftStatus === "published" ? 0 : 1;
      const rightPublishedRank = rightStatus === "published" ? 0 : 1;
      if (leftPublishedRank !== rightPublishedRank) {
        return leftPublishedRank - rightPublishedRank;
      }

      const nameCompare = left.book_name.localeCompare(right.book_name, undefined, {
        sensitivity: "base",
      });
      if (nameCompare !== 0) {
        return nameCompare;
      }

      return left.id - right.id;
    })
    .slice(0, 6);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleLogout = async () => {
    setAuthMessage(null);
    setAuthStatus(null);
    setAuthEmail(null);
    setCanAdmin(false);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      invalidateMeCache();
      setBasketItems([]);
      await loadAuthStatus();
      await loadBooks();
    }
  };

  return (
    <div className="grainy-bg min-h-screen">
      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-14 px-4 pb-14 pt-8 sm:px-6">
        <section className="grid gap-7 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="order-2 flex flex-col gap-4 lg:order-1">
            {authEmail && preferences && (
              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={() => setShowPreferencesDialog(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50"
                >
                  <SlidersHorizontal size={14} />
                  Preferences
                </button>
              </div>
            )}
            <h2 className="font-[var(--font-display)] text-4xl leading-tight text-[color:var(--deep)] sm:text-5xl">
              Read, reflect, and explore
            </h2>
            <p className="max-w-xl text-lg text-zinc-700">
              A new editorial platform for scripture library.
            </p>

            <div
              id="featured-books"
              className="rounded-3xl border border-black/10 bg-white/70 p-3 shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-black/10 px-2 pb-3">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Featured Books</p>
                <a
                  href="/scriptures"
                  className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-zinc-700 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                >
                  Browse All Books
                </a>
              </div>
              {featuredBooks.length === 0 ? (
                <div className="px-2 py-6 text-sm text-zinc-600">No books available yet.</div>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {featuredBooks.map((book) => (
                    <a
                      key={book.id}
                      href={`/scriptures?book=${book.id}&preview=book`}
                      aria-label={`Open preview for ${book.book_name}`}
                      className="rounded-2xl border border-black/10 bg-white/90 p-4 transition hover:border-[color:var(--accent)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 focus-visible:border-[color:var(--accent)]"
                    >
                      <p className="font-[var(--font-display)] text-xl text-[color:var(--deep)]">
                        {book.book_name}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                        {(book as BookOption & { visibility?: string }).visibility === "public"
                          ? "Public"
                          : "Private draft"}
                      </p>
                      <p className="mt-3 text-xs text-zinc-600">
                        {book.schema?.name || "Scripture"}
                      </p>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="order-1 flex flex-col gap-4 lg:order-2">
            <div className="rounded-[28px] border border-black/10 bg-white/80 p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Library at a glance
              </h4>
              <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                {[
                  { label: "Books", value: stats?.books_count?.toLocaleString() || "—" },
                  { label: "Verses", value: stats?.nodes_count?.toLocaleString() || "—" },
                  { label: "Contributors", value: stats?.users_count?.toLocaleString() || "—" },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-2xl bg-[color:var(--paper)] p-4">
                    <p className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                      {stat.value}
                    </p>
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[32px] border border-black/10 bg-white/80 p-4 shadow-lg">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  {verseMode === "daily" ? "Daily Verse" : "Random Verse"}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setVerseMode("daily");
                      loadDailyVerse("daily");
                    }}
                    className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] transition ${
                      verseMode === "daily"
                        ? "bg-[color:var(--accent)] text-white"
                        : "border border-black/10 bg-white/80 text-zinc-600 hover:border-[color:var(--accent)]"
                    }`}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVerseMode("random");
                      loadDailyVerse("random");
                    }}
                    className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] transition ${
                      verseMode === "random"
                        ? "bg-[color:var(--accent)] text-white"
                        : "border border-black/10 bg-white/80 text-zinc-600 hover:border-[color:var(--accent)]"
                    }`}
                  >
                    Random
                  </button>
                </div>
              </div>
              {!dailyVerse ? (
                <>
                  <h3 className="mt-3 font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    Loading...
                  </h3>
                  <p className="mt-3 text-sm text-zinc-600">
                    Fetching a verse from the library...
                  </p>
                </>
              ) : dailyVerse.id === 0 ? (
                <>
                  <h3 className="mt-3 font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    No verses yet
                  </h3>
                  <p className="mt-3 text-sm text-zinc-600">
                    Add content to your books to see a verse here.
                  </p>
                  <div className="mt-6 rounded-2xl border border-black/5 bg-[color:var(--sand)] p-4 text-sm text-[color:var(--deep)]">
                    <p className="text-sm text-zinc-700">
                      Visit the <a href="/scriptures" className="text-[color:var(--accent)] hover:underline">Scriptures</a> page to browse books, or go to <a href="/explorer" className="text-[color:var(--accent)] hover:underline">Explorer</a> to start building your collection.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="mt-3 font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    {dailyVerse.book_name}
                  </h3>
                  <p className="mt-3 text-sm text-zinc-600">
                    {verseMode === "daily" 
                      ? "Today's verse from the library."
                      : "A randomly selected verse."}
                  </p>
                  {(() => {
                    const versePreviewHref =
                      dailyVerse.book_id > 0 && dailyVerse.node_id
                        ? `/scriptures?book=${dailyVerse.book_id}&node=${dailyVerse.node_id}&preview=node`
                        : null;
                    return (
                      <div
                        className={`mt-6 rounded-2xl border border-black/5 bg-[color:var(--sand)] p-4 text-sm text-[color:var(--deep)] transition ${
                          versePreviewHref
                            ? "cursor-pointer hover:border-[color:var(--accent)] focus-within:border-[color:var(--accent)]"
                            : ""
                        }`}
                        role={versePreviewHref ? "button" : undefined}
                        tabIndex={versePreviewHref ? 0 : undefined}
                        onClick={() => {
                          if (!versePreviewHref) return;
                          router.push(versePreviewHref);
                        }}
                        onKeyDown={(event) => {
                          if (!versePreviewHref) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            router.push(versePreviewHref);
                          }
                        }}
                      >
                        <p className="font-semibold">{dailyVerse.title}</p>
                        <p className="mt-2 text-sm text-zinc-700">
                          {dailyVerse.content || "Content not available"}
                        </p>
                        {versePreviewHref && (
                          <a
                            href={versePreviewHref}
                            onClick={(event) => event.stopPropagation()}
                            className="mt-3 inline-block text-xs text-[color:var(--accent)] hover:underline"
                          >
                            Read more →
                          </a>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Floating Basket Panel */}
      <BasketPanel
        items={basketItems}
        onRemoveItem={removeFromBasket}
        onMoveItem={moveBasketItem}
        reorderLoading={isReorderingBasket}
        onClearBasket={clearBasket}
        onItemsAdded={() => {
          // Refresh or handle after items are added to book
        }}
      />

      <UserPreferencesDialog
        open={showPreferencesDialog}
        onClose={() => setShowPreferencesDialog(false)}
        preferences={preferences}
        onChange={(next) => setPreferences(next)}
        onSave={savePreferences}
        saving={preferencesSaving}
        message={preferencesMessage}
      />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}> 
      <HomeContent />
    </Suspense>
  );
}
